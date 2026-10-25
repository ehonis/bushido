/*
 * Strava on screen: the day's activities, and the ones the user attached.
 * Ported from app/src/strava.jsx.
 *
 * `StravaActivities` sits in the session log under the WHOOP block and does the
 * same job for rides, runs and walks: offers the day's activities, marks at most
 * ONE as likely, and attaches nothing by itself. The tap is theirs. On the
 * *Other training* card the tap also fills the card's blank fields (activity,
 * time, distance, speed, elevation) from the ride — see attachTo/detachFrom in
 * server/strava.js (blanks only; detach clears only what it filled and the user
 * left alone).
 *
 * Attaching fetches the activity in FULL first (laps, splits, calories,
 * description), so the snapshot is the whole ride. If that fetch fails the
 * summary is attached instead — every headline number is on it.
 *
 * Since wave 2 (#44): offers are rows with one action, attached ones are rows
 * that open onto their numbers, laps and Detach (the pieces are whoop.tsx's).
 */
import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { colors, font, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn } from '../ui/kit'
import { Fold } from '../ui/Fold'
import { tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { gateResolver } from '../lib/activities.js'
import {
  useStrava, rankForSession, snapshotOf, attachedMinutes, attachTo, detachFrom, activitiesOn,
  attachedStrava,
} from '../lib/strava.jsx'
import { pruneAttached } from '../lib/outputs.js'
import { AttachedRow, BlockHead, Line2, OfferRow, wh } from './whoop'

/* ---------------------------------------------------------------- formatting */

const clock = (iso: any) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
const span = (a: any, b: any) => (clock(b) ? `${clock(a)}–${clock(b)}` : clock(a))
const n1 = (v: any) => (v == null ? null : Math.round(Number(v) * 10) / 10)

/**
 * The line of numbers under an activity. Distance first, because that is the
 * question a ride answers; pace for foot sports, speed for wheels; heart rate and
 * power only where a sensor recorded them.
 */
function Numbers({ a }: { a: any }) {
  const bits: string[] = []
  if (a.distanceMi) bits.push(`${n1(a.distanceMi)} mi`)
  const mins = attachedMinutes(a) ?? a.movingMin
  if (mins) bits.push(`${Math.round(mins)} min`)
  const elapsed = a.elapsedMinutes ?? a.elapsedMin
  if (mins && elapsed && Math.round(elapsed) - Math.round(mins) > 2) bits.push(`${Math.round(elapsed)} elapsed`)
  if (a.paceLabel) bits.push(a.paceLabel)
  else if (a.avgMph) bits.push(`${n1(a.avgMph)} mph`)
  if (a.elevationFt) bits.push(`${Math.round(a.elevationFt)} ft`)
  if (a.avgHr) bits.push(`avg ${Math.round(a.avgHr)} bpm`)
  if (a.avgWatts) bits.push(`${Math.round(a.weightedAvgWatts || a.avgWatts)} W`)
  if (a.calories) bits.push(`${Math.round(a.calories)} cal`)
  if (a.sufferScore != null) bits.push(`RE ${a.sufferScore}`)
  return <T size={font.small} dim tabular>{bits.join(' · ')}</T>
}

/** Laps or mile splits, folded away — the detail that makes a snapshot the whole ride. */
function Laps({ rows, label }: { rows: any[]; label: string }) {
  if (!rows?.length) return null
  const pace = rows.some(r => r.paceMinPerMi)
  const cols = ['Lap', 'mi', 'min', pace ? 'Pace' : 'mph', 'bpm', 'W', 'ft']
  const cell = (k: number) => ({ flex: k === 0 ? 0.6 : 1, paddingHorizontal: 6, textAlign: (k === 0 ? 'left' : 'right') as 'left' | 'right' })
  return (
    <Fold headStyle={{ minHeight: TAP }} summary={`${rows.length} ${label}`}>
      <View style={{ marginTop: 6 }}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 2 }}>
          {cols.map((c, k) => <T key={c} size={font.caption} weight={500} faint tabular style={cell(k)}>{c}</T>)}
        </View>
        {rows.map((r, i) => {
          const vals = [
            r.index ?? i + 1,
            n1(r.distanceMi) ?? '',
            n1(r.movingMin) ?? '',
            pace
              ? (r.paceMinPerMi ? `${Math.floor(r.paceMinPerMi)}:${String(Math.round((r.paceMinPerMi % 1) * 60)).padStart(2, '0')}` : '')
              : (n1(r.avgMph) ?? ''),
            r.avgHr ?? '',
            r.avgWatts ?? '',
            r.elevationFt ?? '',
          ]
          return (
            <View key={r.index ?? i} style={{ flexDirection: 'row', paddingVertical: 3 }}>
              {vals.map((v, k) => <T key={k} size={font.caption} dim tabular style={cell(k)}>{String(v)}</T>)}
            </View>
          )
        })}
      </View>
    </Fold>
  )
}

/* ------------------------------------------------------- attach to a session */

/**
 * Why an activity is marked Likely, in the order `rankForSession` (server/strava.js)
 * weighs its evidence (strava.jsx `likelyWhy`). Shown on the row, not only to VoiceOver.
 */
const likelyWhy = (c: any) => (c.overlapMin > 0
  ? `Overlaps this session by ${Math.round(c.overlapMin)} min`
  : c.fit === true ? 'The sport you picked' : 'The only activity on Strava today')

export function StravaActivities({ session, entry, entries, onSave }: { session: any; entry: any; entries?: any[]; onSave: (out: any) => void }) {
  const { cache, status, pulling, error, pull, detail } = useStrava() as any
  const [attaching, setAttaching] = useState<any>(null)
  const out = entry?.data?.out || {}
  // A LIST since 2026-09-21: a brick is a ride and a run and one session;
  // attaching the run used to throw the ride away.
  const attachedList: any[] = attachedStrava(out)
  const date = entry?.date || null

  // Nothing cached and nothing attached: the app looks exactly as it did before
  // Strava existed. An attached snapshot renders with no cache — it is their log.
  if (!cache && !attachedList.length) return null

  const onDay = activitiesOn(cache, date)
  const ranked: any[] = (rankForSession as any)({ activities: onDay, entry, session, date, entries: entries || [] })

  const attach = async (a: any) => {
    setAttaching(a.id)
    try {
      const full = await detail(a.id)
      const snap = (snapshotOf as any)(a, { detail: full, gear: cache?.gear || null })
      // Pruned after filling: the fill works off the fields the card DECLARES,
      // and pruning keeps a lift day from acquiring a distance off a mislabelled
      // activity. See lib/outputs.js.
      onSave((pruneAttached as any)(session, attachTo(session, out, snap), gateResolver(session)))
    } finally {
      setAttaching(null)
    }
  }
  const detach = (snap: any) => {
    tap()
    onSave((pruneAttached as any)(session, detachFrom(out, snap.id), gateResolver(session)))
  }

  const alsoOnFor = (snap: any) => ranked.find(c => c.activity.id === snap.id)?.attachedTo || null
  const here = new Set(attachedList.map(a => a.id))
  const offers = ranked.filter(c => !here.has(c.activity.id))
  const totalMin = attachedList.reduce((n, a) => n + (Number(attachedMinutes(a)) || 0), 0)

  // Strava not connected. Attached snapshots are the log and still show.
  if (cache?.configured === false && !attachedList.length) return null

  return (
    <View style={wh.block}>
      <BlockHead icon="Bike" title="Strava" pulling={pulling} onPull={pull} />

      {error ? <T size={font.small} color={colors.warn} style={wh.err}>{error}</T> : null}
      {!error && status?.ok === false ? <T size={font.small} color={colors.warn} style={wh.err}>{status.detail}</T> : null}

      {/* Everything attached, each a row that opens onto its numbers, laps and
          detach. A brick is two rides and a run; a slot that held one lost
          whichever landed first. */}
      {attachedList.length > 0 ? (
        <View style={wh.list}>
          {attachedList.map((snap, i) => {
            const alsoOn = alsoOnFor(snap)
            const filledKeys = Object.keys(snap.filled || {})
            const mins = attachedMinutes(snap)
            const meta = [span(snap.start, snap.end), snap.distanceMi ? `${n1(snap.distanceMi)} mi` : '', mins ? `${Math.round(mins)} min` : '']
              .filter(Boolean).join(' · ')
            return (
              <AttachedRow key={snap.id} first={i === 0} title={snap.name || snap.sport} meta={meta} open={Boolean(alsoOn)}>
                {alsoOn ? (
                  <T size={font.small} color={colors.warn}>
                    Also on <T size={font.small} weight={600} color={colors.warn}>{alsoOn.name}</T>. A ride is one session, so one of these is wrong.
                  </T>
                ) : null}
                <Numbers a={snap} />
                {snap.gear?.name ? (
                  <Line2>{`On ${snap.gear.name}${snap.gear.distanceMi ? ` · ${Math.round(snap.gear.distanceMi).toLocaleString()} mi on it` : ''}`}</Line2>
                ) : null}
                {snap.description ? (
                  <T size={font.small} dim style={{ fontStyle: 'italic' }}>{'“'}{snap.description}{'”'}</T>
                ) : null}
                <Laps rows={snap.laps} label="laps" />
                {!snap.laps?.length ? <Laps rows={snap.splits} label="mile splits" /> : null}
                <Line2>
                  Saved with this session, so it stays if Strava goes away.
                  {filledKeys.length > 0 ? ` It filled in ${filledKeys.join(', ')}; detaching clears whichever you have not changed.` : ''}
                </Line2>
                <View style={wh.acts}>
                  {snap.url ? (
                    <Btn kind="quiet" title="Open on Strava" style={{ marginRight: 'auto' }}
                      onPress={() => { Linking.openURL(snap.url).catch(() => {}) }} />
                  ) : null}
                  <Btn kind="quiet" title="Detach" onPress={() => detach(snap)} />
                </View>
              </AttachedRow>
            )
          })}
        </View>
      ) : null}

      {attachedList.length > 1 ? (
        <View style={wh.total}>
          <Icon name="Timer" size={14} color={colors.inkDim} />
          <T size={font.small} dim style={{ flex: 1 }}>
            {attachedList.length} activities on this session,{' '}
            <T size={font.small} weight={600}>{totalMin} min</T> moving in total
          </T>
        </View>
      ) : null}

      {offers.length === 0 ? (
        attachedList.length === 0 ? (
          <T size={font.small} dim style={wh.empty}>
            {cache?.fetchedAt
              ? 'Nothing on Strava for this day. Just finished? Refresh once it uploads.'
              : 'No Strava data yet.'}
          </T>
        ) : null
      ) : (
        <>
          {attachedList.length > 0 ? <T size={font.small} weight={600} style={wh.more}>Also on this day</T> : null}
          <View style={wh.list}>
            {offers.map((c, i) => {
              const a = c.activity
              return (
                <OfferRow key={a.id} first={i === 0} title={a.name || a.sport}
                  likely={c.likely} taken={Boolean(c.attachedTo)}
                  likelyWhy={likelyWhy(c)}
                  action={attaching === a.id ? 'Attaching…' : c.attachedTo ? 'Attach here too' : 'Attach'}
                  disabled={attaching !== null} onAttach={() => attach(a)}
                  lines={[
                    <Line2 key="when">{`${a.sport} · ${span(a.start, a.end)}`}</Line2>,
                    <Numbers key="nums" a={a} />,
                    c.attachedTo ? <Line2 key="on">{`Already on ${c.attachedTo.name}`}</Line2> : null,
                  ]} />
              )
            })}
          </View>
        </>
      )}
    </View>
  )
}
