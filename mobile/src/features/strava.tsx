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
 */
import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Fold } from '../ui/Fold'
import { success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { gateResolver } from '../lib/activities.js'
import {
  useStrava, rankForSession, snapshotOf, attachedMinutes, attachTo, detachFrom, activitiesOn,
  attachedStrava,
} from '../lib/strava.jsx'
import { pruneAttached } from '../lib/outputs.js'
import { PullBtn, WhBtn, wh } from './whoop'

/* ---------------------------------------------------------------- formatting */

const clock = (iso: any) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
const span = (a: any, b: any) => (clock(b) ? `${clock(a)}–${clock(b)}` : clock(a))
const n1 = (v: any) => (v == null ? null : Math.round(Number(v) * 10) / 10)

// Strava's own orange, for its mark in the block's head (.wh-head svg.sv-ico).
const STRAVA_ORANGE = '#fc4c02'

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
  return <T size={12} dim tabular style={wh.nums}>{bits.join(' · ')}</T>
}

/** Laps or mile splits, folded away — the detail that makes a snapshot the whole ride. */
function Laps({ rows, label }: { rows: any[]; label: string }) {
  if (!rows?.length) return null
  const pace = rows.some(r => r.paceMinPerMi)
  const cols = ['#', 'mi', 'min', pace ? 'pace' : 'mph', 'bpm', 'W', 'ft']
  const cell = (k: number) => ({ flex: k === 0 ? 0.6 : 1, paddingHorizontal: 6, textAlign: (k === 0 ? 'left' : 'right') as 'left' | 'right' })
  return (
    <Fold style={{ marginTop: 9 }} headStyle={{ minHeight: 32 }} summary={<T size={12} dim>{rows.length} {label}</T>}>
      <View style={{ marginTop: 6 }}>
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, paddingVertical: 2 }}>
          {cols.map((c, k) => <T key={c} size={12} weight={500} faint tabular style={cell(k)}>{c}</T>)}
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
              {vals.map((v, k) => <T key={k} size={12} dim tabular style={cell(k)}>{String(v)}</T>)}
            </View>
          )
        })}
      </View>
    </Fold>
  )
}

/* ------------------------------------------------------- attach to a session */

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
      success()
    } finally {
      setAttaching(null)
    }
  }
  const detach = (snap: any) =>
    onSave((pruneAttached as any)(session, detachFrom(out, snap.id), gateResolver(session)))

  const alsoOnFor = (snap: any) => ranked.find(c => c.activity.id === snap.id)?.attachedTo || null
  const here = new Set(attachedList.map(a => a.id))
  const offers = ranked.filter(c => !here.has(c.activity.id))
  const totalMin = attachedList.reduce((n, a) => n + (Number(attachedMinutes(a)) || 0), 0)

  // No bridge on this install. Attached snapshots are the log and still show.
  if (cache?.configured === false && !attachedList.length) return null

  return (
    <View style={wh.block}>
      <View style={wh.head}>
        <Icon name="Bike" size={13} color={STRAVA_ORANGE} />
        <T size={11} faint caps>Strava</T>
        <PullBtn pulling={pulling} onPress={pull} />
      </View>

      {error ? <T size={12} color={colors.vizWarn} style={wh.err}>{error}</T> : null}
      {!error && status?.ok === false ? <T size={12} color={colors.vizWarn} style={wh.err}>{status.detail}</T> : null}

      {/* Everything attached, each detachable on its own. A brick is two rides
          and a run; a slot that held one lost whichever landed first. */}
      {attachedList.map(snap => {
        const alsoOn = alsoOnFor(snap)
        const filledKeys = Object.keys(snap.filled || {})
        return (
          <View key={snap.id} style={[wh.item, wh.attached, { marginTop: 9 }]}>
            <View style={wh.itemTop}>
              <View style={wh.sport}>
                <Icon name="CircleCheck" size={13} color={colors.vizGood} />
                <T size={14} weight={600}>{snap.name || snap.sport}</T>
              </View>
              <T size={12} faint tabular style={{ flexShrink: 1 }}>{snap.sport} · {span(snap.start, snap.end)}</T>
              <WhBtn ghost title="detach" onPress={() => detach(snap)} style={{ marginLeft: 'auto' }} />
            </View>
            <Numbers a={snap} />
            {snap.gear?.name ? (
              <T size={12} dim tabular style={wh.nums}>
                on {snap.gear.name}{snap.gear.distanceMi ? ` · ${Math.round(snap.gear.distanceMi).toLocaleString()} mi on it` : ''}
              </T>
            ) : null}
            {snap.description ? (
              <T size={12} faint style={[wh.note, { fontStyle: 'italic' }]}>{'“'}{snap.description}{'”'}</T>
            ) : null}
            <Laps rows={snap.laps} label="laps" />
            {!snap.laps?.length ? <Laps rows={snap.splits} label="mile splits" /> : null}
            <T size={12} faint style={wh.note}>
              Saved with this session — these numbers stay put whether or not Strava is reachable.
              {filledKeys.length > 0
                ? ` It filled in ${filledKeys.join(', ')} above; detaching clears whichever you have not changed.`
                : ''}
              {snap.url ? (
                <>
                  {' '}
                  <T size={12} faint accessibilityRole="link" onPress={() => { Linking.openURL(snap.url).catch(() => {}) }}
                    style={{ textDecorationLine: 'underline' }}>open on Strava</T>
                </>
              ) : null}
            </T>
            {alsoOn ? (
              <T size={12} color={colors.vizWarn} style={wh.err}>
                Also on <T size={12} weight={700} color={colors.vizWarn}>{alsoOn.name}</T> — a ride is one session, so one of these is wrong.
              </T>
            ) : null}
          </View>
        )
      })}

      {attachedList.length > 1 ? (
        <View style={wh.total}>
          <Icon name="Timer" size={13} color={colors.inkFaint} />
          <T size={12} faint style={{ flex: 1 }}>
            {attachedList.length} activities on this session,{' '}
            <T size={12} weight={700} color={colors.inkFaint}>{totalMin} min</T> moving in total. That is what the weekly load chart
            multiplies your RPE by.
          </T>
        </View>
      ) : null}

      {offers.length === 0 ? (
        attachedList.length === 0 ? (
          <T size={12} faint style={wh.empty}>
            {cache?.fetchedAt
              ? 'Nothing on Strava for this day. If you have just finished, give the upload a minute and pull again.'
              : 'No Strava data yet.'}
          </T>
        ) : null
      ) : (
        <View style={wh.list}>
          {attachedList.length > 0 ? (
            <T size={12} faint style={wh.more}>Also on this day — attach as many as belong to this session:</T>
          ) : null}
          {offers.map(c => {
            const a = c.activity
            return (
              <View key={a.id} style={[wh.item, c.likely && wh.likely, c.attachedTo && wh.taken]}>
                <View style={wh.itemTop}>
                  <T size={14} weight={600}>{a.name || a.sport}</T>
                  <T size={12} faint tabular>{a.sport} · {span(a.start, a.end)}</T>
                  {c.likely ? (
                    <View style={wh.tag} accessibilityLabel={c.overlapMin
                      ? `likely: overlaps this session by ${c.overlapMin} min`
                      : c.fit === true ? 'likely: the sport you picked' : 'likely: the only activity on Strava this day'}>
                      <T size={10} caps color={colors.accent} lineHeight={13}>likely</T>
                    </View>
                  ) : null}
                </View>
                <Numbers a={a} />
                {c.attachedTo ? (
                  <View>
                    <T size={12} faint style={wh.note}>
                      Already on <T size={12} weight={700} color={colors.inkFaint}>{c.attachedTo.name}</T>.
                    </T>
                    <WhBtn ghost haptic="none" title="attach here instead" onPress={() => attach(a)}
                      disabled={attaching !== null} style={{ marginTop: 6 }} />
                  </View>
                ) : (
                  <WhBtn icon="Plus" haptic="none" onPress={() => attach(a)} disabled={attaching !== null}
                    title={attaching === a.id ? 'attaching…' : 'attach to this session'} />
                )}
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}
