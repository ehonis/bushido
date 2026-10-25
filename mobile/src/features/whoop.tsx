/*
 * WHOOP on screen: what the band recorded, and the readiness it implies.
 * Ported from app/src/whoop.jsx.
 *
 * Two components with very different jobs.
 *
 * `WhoopWorkouts` sits inside the session log and offers the day's workouts. It
 * never attaches one by itself. Getting a match wrong writes a belay partner's
 * climb, or the warm-up lift, into the training log as this session's heart rate —
 * and nothing on screen afterwards would look wrong. So the app may mark ONE
 * candidate as likely, and the tap is theirs (AGENTS.md §8.2).
 *
 * Since wave 2 (#44) each offer is a row with one action, "Attach", and each
 * attached workout is a row that opens onto its numbers, its split and Detach.
 *
 * `WhoopReadiness` shows how recovered the user arrived, against their own
 * baseline rather than a population. A readout: nothing ranks or blocks a
 * session on it any more (the recommender went on 2026-10-25).
 *
 * `WhoopSleep` is the sleep graph from Totem's Habits tab, drawn with
 * react-native-svg and scrubbed by press-and-drag.
 */
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, H2 as CardTitle, Input, Press, Segmented } from '../ui/kit'
import { Fold } from '../ui/Fold'
import { impact, success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { gateResolver } from '../lib/activities.js'
import {
  useWhoop, rankForSession, snapshotOf, hardMinutes, recordedPct, readinessFor, workoutsOn,
  partOf, attachedMinutes, isSplit, sessionWindow, overlapMinutes, workoutWindow,
  attachTo, detachFrom, attachedWhoop,
} from '../lib/whoop.jsx'
import { pruneAttached } from '../lib/outputs.js'

/* ---------------------------------------------------------------- formatting */

const clock = (iso: any) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "6:05–7:33 PM", or just the start when the end is missing. */
const span = (a: any, b: any) => (clock(b) ? `${clock(a)}–${clock(b)}` : clock(a))

/* ------------------------------------------- shared with strava.tsx (.wh-*) */

/** .wh-head: the block's section head (its icon, its name), with Refresh as a quiet word on the right. */
export function BlockHead({ icon, title, pulling, onPull }: { icon: string; title: string; pulling: boolean; onPull: () => void }) {
  return (
    <View style={wh.head}>
      <Icon name={icon} size={16} color={colors.series2} />
      <T size={font.body} weight={600} style={{ flex: 1 }} numberOfLines={1}>{title}</T>
      <Btn kind="quiet" small title={pulling ? 'Refreshing…' : 'Refresh'} disabled={pulling}
        onPress={() => { impact(); onPull() }} />
    </View>
  )
}

/** One attached measurement: a row that opens (Fold) onto what is behind it. */
export function AttachedRow({ title, meta, open = false, first, children }: {
  title: string
  meta: string
  open?: boolean
  first?: boolean
  children: React.ReactNode
}) {
  return (
    <Fold
      key={String(open)}
      open={open}
      style={!first ? wh.rule : null}
      headStyle={{ minHeight: 52 }}
      summary={(
        <View style={wh.rowIn}>
          <Icon name="CircleCheck" size={20} color={colors.vizGood} />
          <View style={wh.rowMain}>
            <T size={font.body} weight={500} numberOfLines={1}>{title}</T>
            {meta ? <T size={font.small} dim tabular>{meta}</T> : null}
          </View>
        </View>
      )}
    >
      <View style={wh.body}>{children}</View>
    </Fold>
  )
}

/** One on offer: what it was and when, a Likely tag when the app has evidence, and the one action. */
export function OfferRow({ title, lines, likely, likelyWhy, taken, first, action, onAttach, disabled }: {
  title: string
  lines: React.ReactNode[]
  likely?: boolean
  likelyWhy?: string
  taken?: boolean
  first?: boolean
  action: string
  onAttach: () => void
  disabled?: boolean
}) {
  return (
    <View style={[wh.row, !first && wh.rule]}>
      <View style={wh.rowMain}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' }}>
          <T size={font.body} weight={500} color={taken ? colors.inkDim : colors.ink}>{title}</T>
          {/* The suggestion is marked, not applied: it still takes the tap (§8.2). */}
          {likely ? (
            <View style={wh.tag} accessibilityLabel={`Likely: ${likelyWhy || ''}`}>
              <T size={font.caption} weight={500}>Likely</T>
            </View>
          ) : null}
        </View>
        {lines}
      </View>
      <Btn kind="secondary" small title={action} disabled={disabled} onPress={() => { success(); onAttach() }} />
    </View>
  )
}

/** A line under an offer or inside an attached row. */
export function Line2({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <T size={font.small} color={warn ? colors.warn : colors.inkDim} tabular>{children}</T>
}

/**
 * The line of numbers under a workout.
 *
 * A heart rate carries its percentage of their max only where WHOOP told us their
 * max (`snapshotOf` refuses 220-minus-age). `percentRecorded` is surfaced whenever
 * the strap missed anything, through `recordedPct`, because WHOOP sends it as a
 * fraction and a complete session once read as "only 1% recorded".
 */
function Numbers({ w, minutes }: { w: any; minutes?: any }) {
  const hard = hardMinutes(w)
  const recorded = recordedPct(w.percentRecorded)
  const bits: string[] = []
  // `minutes` overrides where this session took only a slice of the workout. The
  // rest of the line stays the WHOLE workout's — see partOf.
  const mins = minutes ?? w.minutes
  if (mins) bits.push(`${mins} min`)
  if (w.strain != null) bits.push(`strain ${w.strain}`)
  if (w.avgHr) bits.push(`avg ${w.avgHr}${w.pctAvgHr ? ` (${w.pctAvgHr}%)` : ''}`)
  if (w.maxHr) bits.push(`max ${w.maxHr}${w.pctMaxHr ? ` (${w.pctMaxHr}%)` : ''}`)
  if (hard) bits.push(`${hard} min zone 3+`)
  if (w.calories) bits.push(`${w.calories} cal`)
  return (
    <T size={font.small} dim tabular>
      {bits.join(' · ')}
      {recorded !== null && recorded < 95 ? (
        <T size={font.small} color={colors.vizWarn}> · only {recorded}% recorded</T>
      ) : null}
    </T>
  )
}

/* ------------------------------------------------ one workout, two sessions */

/** "18:45" in local time for an ISO instant. */
function hhmm(iso: any) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** That back the other way: a wall-clock time, on the day the workout happened. */
function isoAt(sameDayIso: any, value: any) {
  const base = Date.parse(sameDayIso)
  const [h, m] = String(value || '').split(':').map(Number)
  if (!Number.isFinite(base) || !Number.isFinite(h) || !Number.isFinite(m)) return null
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/**
 * What the user typed in a time box, as "HH:MM", or '' when it is not a time.
 * Native has no <input type="time"> without a native module, so the box is text
 * on the numbers keyboard and accepts "1845", "18:45" and "6:45".
 */
function typedTime(raw: string) {
  const v = String(raw || '').trim()
  const m = /^(\d{1,2}):?(\d{2})$/.exec(v)
  if (!m) return ''
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return ''
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function TimeBox({ label, value, onChange, a11y }: { label: string; value: string; onChange: (v: string) => void; a11y: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T size={font.small} dim>{label}</T>
      <Input
        value={value}
        onChangeText={onChange}
        onBlur={() => { const t = typedTime(value); if (t) onChange(t) }}
        keyboardType="numbers-and-punctuation"
        placeholder="HH:MM"
        maxLength={5}
        accessibilityLabel={a11y}
        style={{ width: 92, textAlign: 'center', fontVariant: ['tabular-nums'] }}
      />
    </View>
  )
}

/**
 * Which part of one WHOOP workout this session was.
 *
 * WHOOP records a gym visit as ONE workout, but one visit can hold two sessions —
 * the board, then the laps. A 130-minute workout sitting whole on two sessions
 * makes the day read as 260 minutes, and the weekly load chart is RPE × minutes,
 * so the split is what keeps that chart true.
 *
 * The user types two clock times and the app computes the OVERLAP with the
 * workout, so two split sessions can never add up to more than the workout.
 */
function SplitEditor({ snap, onChange, onClear }: { snap: any; onChange: (part: any) => void; onClear: () => void }) {
  const part = snap.part || null
  const [from, setFrom] = useState(() => hhmm(part?.start || snap.start))
  const [to, setTo] = useState(() => hhmm(part?.end || snap.end))

  const anchor = snap.start || part?.start
  const computed: any = (partOf as any)(snap, { start: isoAt(anchor, typedTime(from)), end: isoAt(anchor, typedTime(to)) })

  return (
    <View style={{ paddingTop: space[1], paddingBottom: space[2], gap: space[2] }}>
      <View style={wh.splitRow}>
        <TimeBox label="From" value={from} onChange={setFrom} a11y="This session started at" />
        <TimeBox label="To" value={to} onChange={setTo} a11y="This session ended at" />
        <T size={font.body} weight={600} tabular style={{ paddingBottom: space[3] }}>
          {computed ? `${computed.minutes} min` : '—'}
        </T>
      </View>

      {computed && computed.minutes === 0 ? (
        <T size={font.small} color={colors.warn}>
          Those times miss the workout ({span(snap.start, snap.end)}), so this session would get none of it.
        </T>
      ) : null}

      <View style={wh.acts}>
        {part ? <Btn kind="quiet" small title="Use the whole workout" onPress={onClear} /> : null}
        <Btn kind="secondary" small title="Save this part" disabled={!computed}
          onPress={() => computed && onChange(computed)} />
      </View>
    </View>
  )
}

/* ------------------------------------------------------- attach to a session */

/**
 * The day's WHOOP workouts, for one session.
 *
 * The session's own local date is the only bucket considered — a workout from
 * another day is not a candidate, however well it would fit.
 */
export function WhoopWorkouts({ session, entry, entries, onSave }: { session: any; entry: any; entries?: any[]; onSave: (out: any) => void }) {
  const { cache, status, pulling, error, pull } = useWhoop() as any
  const out = entry?.data?.out || {}
  // A LIST since 2026-09-21: a combined workout can have several WHOOP activities.
  const attachedList: any[] = attachedWhoop(out)
  const date = entry?.date || null

  // Nothing cached and nothing attached: the app looks exactly as it did before
  // WHOOP existed. An attached snapshot still renders with no cache — it is their log.
  if (!cache && !attachedList.length) return null

  const onDay = workoutsOn(cache, date)
  const ranked: any[] = (rankForSession as any)({ workouts: onDay, entry, session, date, entries: entries || [] })

  /*
   * Attaching saves the snapshot AND answers the card's blank questions from it.
   * Only blanks are filled, what was filled is remembered on the snapshot, and
   * `pruneAttached` drops anything the picked activity does not ask for.
   */
  const put = (o: any) => onSave((pruneAttached as any)(session, o, gateResolver(session)))

  const attach = (w: any) => {
    put(attachTo(session, out, {
      ...(snapshotOf as any)(w, { maxHeartRate: cache?.maxHeartRate }),
      attachedAt: new Date().toISOString(),
      // Where workout mode timed the session, the slice is offered pre-filled.
      // The user still has to press save: a suggested window is not a stated one.
      ...(suggestPart(w) ? { part: suggestPart(w) } : {}),
    }))
  }
  const detach = (snap: any) => { tap(); put(detachFrom(out, snap.id)) }

  /*
   * Setting or clearing the split re-runs the attach, because the workout's
   * length may be one of the blanks it filled. Detach-then-attach: detaching
   * gives back only the blanks it took, so a typed duration survives.
   */
  const reattach = (snap: any) => put(attachTo(session, detachFrom(out, snap.id), snap))
  const setPart = (snap: any, part: any) => { impact(); reattach({ ...snap, part }) }
  const clearPart = (snap: any) => {
    const w = { ...snap }
    delete w.part
    reattach(w)
  }

  /*
   * A suggested slice, only for a session workout mode actually measured AND
   * whose window sits inside the workout. A hand-logged session has no time of
   * day at all, and inventing one is how the split would start lying.
   */
  function suggestPart(w: any) {
    const win = sessionWindow(entry)
    if (!win) return null
    const overlap = overlapMinutes(win, workoutWindow(w))
    if (!overlap) return null
    return (partOf as any)(w, { start: new Date(win[0]).toISOString(), end: new Date(win[1]).toISOString() })
  }

  // Everyone else holding this workout today. Two sessions each claiming the
  // WHOLE workout is the mistake this exists to catch.
  const alsoOnFor = (snap: any) => ranked.find(c => c.workout.id === snap.id)?.attachedTo || null
  const attachedIdsHere = new Set(attachedList.map(w => w.id))
  // One already on this session is not a candidate for it again; one on ANOTHER
  // session still is — the "attach here too" route.
  const offers = ranked.filter(c => !attachedIdsHere.has(c.workout.id))

  // WHOOP not connected: nothing to pull and nothing to offer.
  if (cache?.configured === false && !attachedList.length) return null

  return (
    <View style={wh.block}>
      <BlockHead icon="HeartPulse" title="WHOOP" pulling={pulling} onPull={pull} />

      {/* The fix, not the symptom — the WHOOP client names the missing scope verbatim. */}
      {error ? <T size={font.small} color={colors.warn} style={wh.err}>{error}</T> : null}
      {!error && status?.ok === false ? <T size={font.small} color={colors.warn} style={wh.err}>{status.detail}</T> : null}

      {/* Everything attached, each a row that opens onto its numbers, its split
          and its detach. A list rather than a slot: two measurements of one
          session is ordinary. */}
      {attachedList.length > 0 ? (
        <View style={wh.list}>
          {attachedList.map((snap, i) => {
            const filledKeys = Object.keys(snap.filled || {})
            const alsoOn = alsoOnFor(snap)
            const doubled = Boolean(alsoOn && !isSplit(snap) && !alsoOn.part)
            const openSplit = Boolean(doubled || isSplit(snap))
            const meta = `${span(snap.start, snap.end)}${isSplit(snap) ? ` · this session ${attachedMinutes(snap)} min` : snap.minutes ? ` · ${snap.minutes} min` : ''}`
            return (
              <AttachedRow key={snap.id} first={i === 0} title={snap.sport} meta={meta} open={doubled}>
                <Numbers w={snap} minutes={attachedMinutes(snap)} />

                {alsoOn ? (
                  doubled ? (
                    <T size={font.small} color={colors.warn}>
                      Also on <T size={font.small} weight={600} color={colors.warn}>{alsoOn.name}</T> and neither is split, so this day
                      counts these {snap.minutes} minutes twice. Set the part on both.
                    </T>
                  ) : (
                    <Line2>
                      Shared with <T size={font.small} weight={600} color={colors.inkDim}>{alsoOn.name}</T>
                      {alsoOn.part ? ` (${span(alsoOn.part.start, alsoOn.part.end)} there)` : ''}.
                    </Line2>
                  )
                ) : null}

                <Line2>
                  Saved with this session, so it stays if WHOOP goes away.
                  {isSplit(snap) ? ' The minutes are this session’s share; strain, heart rate and zones are the whole workout’s.' : ''}
                  {/* Named rather than silent: a field the app answered is one the user
                      has to be able to find and argue with. */}
                  {filledKeys.length > 0 ? ` It filled in ${filledKeys.join(', ')}; detaching clears whichever you have not changed.` : ''}
                </Line2>

                {/* Optional, and the fold is the point: on the ordinary night this is a
                    line of text you never open. Re-keyed so it opens itself when it
                    becomes the fix. */}
                <Fold
                  key={String(openSplit)}
                  open={openSplit}
                  headStyle={{ minHeight: TAP }}
                  summary={isSplit(snap)
                    ? `This session was ${attachedMinutes(snap)} min of it`
                    : 'Was this session only part of that workout?'}
                >
                  <SplitEditor snap={snap} onChange={(part) => setPart(snap, part)} onClear={() => clearPart(snap)} />
                </Fold>

                <View style={wh.acts}>
                  <Btn kind="quiet" small title="Detach" onPress={() => detach(snap)} />
                </View>
              </AttachedRow>
            )
          })}
        </View>
      ) : null}

      {/* The session's total, once more than one thing adds up to it. */}
      {attachedList.length > 1 ? (
        <View style={wh.total}>
          <Icon name="Timer" size={14} color={colors.inkDim} />
          <T size={font.small} dim style={{ flex: 1 }}>
            {attachedList.length} workouts on this session,{' '}
            <T size={font.small} weight={600}>
              {attachedList.reduce((n, w) => n + (Number(attachedMinutes(w)) || 0), 0)} min
            </T> in total
          </T>
        </View>
      ) : null}

      {offers.length === 0 ? (
        attachedList.length === 0 ? (
          <T size={font.small} dim style={wh.empty}>
            {cache?.fetchedAt
              ? 'Nothing recorded on this day. Just finished? Refresh once the band syncs.'
              : 'No WHOOP data yet.'}
          </T>
        ) : null
      ) : (
        <>
          {attachedList.length > 0 ? <T size={font.small} weight={600} style={wh.more}>Also on this day</T> : null}
          <View style={wh.list}>
            {offers.map((c, i) => {
              const w = { ...c.workout, ...(snapshotOf as any)(c.workout, { maxHeartRate: cache?.maxHeartRate }) }
              return (
                <OfferRow key={c.workout.id} first={i === 0} title={c.workout.sport}
                  likely={c.likely} taken={Boolean(c.attachedTo)}
                  likelyWhy={c.overlapMin ? `overlaps this session by ${c.overlapMin} min` : 'the only workout WHOOP recorded on this day'}
                  action={c.attachedTo ? 'Attach here too' : 'Attach'} onAttach={() => attach(c.workout)}
                  lines={[
                    <Line2 key="when">{span(c.workout.start, c.workout.end)}</Line2>,
                    <Numbers key="nums" w={w} />,
                    // Shown rather than hidden: a workout on the wrong session is
                    // invisible if the list quietly drops it.
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

/* ------------------------------------------------------- how the user arrived */

type Tone = '' | 'flat' | 'good' | 'warn'

/** Which way is good for this measure, and how far from baseline earns a colour. */
const tone = (delta: any, good: 'up' | 'down'): Tone => {
  if (delta == null) return ''
  if (Math.abs(delta) < 5) return 'flat'
  return (delta > 0) === (good === 'up') ? 'good' : 'warn'
}

const TONE_EDGE: Record<Tone, string> = {
  '': colors.line, flat: colors.vizMuted, good: colors.vizGood, warn: colors.vizWarn,
}

function Stat({ label, value, unit, sub, toneName = '' }: { label: string; value: any; unit: string; sub?: string | null; toneName?: Tone }) {
  if (value == null) return null
  return (
    <View style={[wh.stat, toneName ? { borderLeftWidth: 3, borderLeftColor: TONE_EDGE[toneName] } : null]}>
      <T size={font.small} dim>{label}</T>
      <T size={font.heading} weight={600} tabular lineHeight={28}>
        {value}<T size={font.caption} dim>{unit}</T>
      </T>
      {sub ? <T size={font.caption} dim tabular>{sub}</T> : null}
    </View>
  )
}

/**
 * How recovered the user is today, read against their own recent median.
 *
 * A raw HRV of 42 ms says nothing without knowing their normal, which is why every
 * number carries its deviation and the baseline is a median of the last fortnight.
 * Fewer than four prior days and the deviation is absent rather than shaky.
 */
export function WhoopReadiness({ date }: { date: string }) {
  const { cache, status, pulling, error, pull } = useWhoop() as any
  const r: any = readinessFor(cache, date)

  // No reading is the ordinary case — not connected, band not worn, still
  // calibrating — and it has to look like the app before WHOOP existed. The one
  // exception is a real failure with a fix attached.
  if (!r) {
    if (status?.ok !== false) return null
    return (
      <Card>
        <CardTitle>WHOOP</CardTitle>
        <T size={font.small} color={colors.warn} style={{ marginBottom: space[3] }}>{error || status.detail}</T>
        <Btn kind="secondary" title={pulling ? 'Refreshing…' : 'Try again'} disabled={pulling}
          onPress={() => pull()} style={{ alignSelf: 'flex-start' }} />
      </Card>
    )
  }

  const pct = (v: any) => (v == null ? null : `${v > 0 ? '+' : ''}${v}%`)

  return (
    <Card>
      <BlockHead icon="HeartPulse" title="WHOOP" pulling={pulling} onPull={pull} />
      <View style={wh.stats}>
        <Stat label="Recovery" value={r.recovery} unit="%"
          toneName={r.recovery == null ? '' : r.recovery >= 67 ? 'good' : r.recovery >= 34 ? 'flat' : 'warn'} />
        <Stat label="HRV" value={r.hrv} unit=" ms"
          sub={r.hrvDeltaPct != null ? `${pct(r.hrvDeltaPct)} vs your ${r.hrvBaseline} ms` : null}
          toneName={tone(r.hrvDeltaPct, 'up')} />
        <Stat label="Resting HR" value={r.restingHr} unit=" bpm"
          sub={r.restingHrDelta != null
            ? `${r.restingHrDelta > 0 ? '+' : ''}${r.restingHrDelta} vs your ${r.restingHrBaseline}`
            : null}
          toneName={tone(r.restingHrDelta == null ? null : -r.restingHrDelta, 'up')} />
        <Stat label="Day strain" value={r.strain} unit="" />
      </View>
    </Card>
  )
}

/* -------------------------------------------------------------------- sleep */

/** 452 minutes as "7h32m": the label above a night's bar. */
const hmTight = (min: number) => {
  const t = Math.round(min)
  return Math.floor(t / 60) ? `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}m` : `${t}m`
}
/** 452 minutes as "7:32". */
const hm = (min: any) => (min == null ? null : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`)

/** "2026-10-06T23:14" as the clock it was: "11:14 PM". Wall-clock, so no timezone maths. */
const wallClock = (stamp: any) => {
  const m = /T(\d{2}):(\d{2})/.exec(stamp || '')
  if (!m) return null
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// Stage order and colours, deepest first. The validated series slots plus the
// muted grey, so the palette gate covers them (app/validate_palette.js).
const STAGES = [
  { key: 'deep', label: 'Deep', color: colors.series1 },
  { key: 'rem', label: 'REM', color: colors.series3 },
  { key: 'light', label: 'Light', color: colors.vizMuted },
  { key: 'awake', label: 'Awake', color: colors.series2 },
]

// The chart's mark for the day being viewed (--sleep-today: the accent, because
// it is a highlight and not a data series).
const SLEEP_TODAY = colors.accent

/* WHOOP's own recovery bands: red to 33, yellow to 66, green above, on the viz tokens. */
const recoveryColor = (v: number) => (v >= 67 ? colors.vizGood : v >= 34 ? colors.vizWarn : colors.vizCrit)

export const SLEEP_RANGES = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]
const SLEEP_GOAL = 85

const isoShift = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const dayLabel = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString([], opts)

/*
 * A night on the clock. Minutes are measured from noon of the night's own
 * evening, so 22:36 and 00:13 bedtimes sit on one continuous scale rather than
 * a day apart. Same anchoring as Totem's chart, for the same reason.
 */
function nightSpan(n: any) {
  const at = (stamp: any) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(stamp || '')
    return m ? { date: m[1], min: Number(m[2]) * 60 + Number(m[3]) } : null
  }
  const a = at(n?.bedtime)
  const b = at(n?.wake)
  if (!a || !b) return null
  const anchor = a.min < 12 * 60 ? isoShift(a.date, -1) : a.date
  const dayDiff = (iso: string) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / 86_400_000)
  const from = dayDiff(a.date) * 1440 + a.min - 12 * 60
  const to = dayDiff(b.date) * 1440 + b.min - 12 * 60
  return to > from ? { from, to } : null
}

/** The noon-anchored minute as a clock: 660 -> "11 PM". */
const spanClock = (mins: number) => {
  const mod = (((Math.round(mins) + 720) % 1440) + 1440) % 1440
  const h = Math.floor(mod / 60)
  const m = mod % 60
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

export interface SleepRow {
  date: string
  night: any
  score: number | null
  recovery: number | null
  span: { from: number; to: number } | null
  staged: number
}

/**
 * One row per calendar day in the range, oldest first, nights WHOOP has nothing
 * for included as gaps: a missed night has to read as missing, not be closed up.
 */
export function sleepSeries(cache: any, end: string, days: number): SleepRow[] {
  const nights = new Map<string, any>((cache?.sleep || []).filter((n: any) => n?.date).map((n: any) => [n.date, n]))
  const rec = new Map<string, any>((cache?.recovery || []).filter((r: any) => r?.date).map((r: any) => [r.date, r]))
  const out: SleepRow[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = isoShift(end, -i)
    const n = nights.get(date) || null
    const r = rec.get(date)
    const stages = n?.stages || {}
    out.push({
      date,
      night: n,
      score: Number.isFinite(n?.score) ? n.score : null,
      recovery: r && r.calibrating !== true && Number.isFinite(r.recovery) ? r.recovery : null,
      span: n ? nightSpan(n) : null,
      staged: STAGES.reduce((sum, s) => sum + (Number(stages[s.key]) || 0), 0),
    })
  }
  return out
}

/** Latest, the last seven days against the seven before, and the range's mean. */
export function sleepStats(series: SleepRow[]) {
  const mean = (rows: SleepRow[]) => {
    const v = rows.map(r => r.score).filter((x): x is number => x != null)
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const scored = series.filter(r => r.score != null)
  const recent = mean(series.slice(-7))
  const prior = mean(series.slice(-14, -7))
  return {
    latest: scored.length ? scored[scored.length - 1] : null,
    recent, prior,
    delta: recent != null && prior != null ? recent - prior : null,
    avg: mean(series),
  }
}

const pct = (v: any) => (v == null ? '—' : `${Math.round(v)}%`)

/** .viz-tick: --viz-muted, 10px. */
const TICK = { fill: colors.vizMuted, fontSize: 10 } as any

/**
 * Sleep over time: the graph that used to live on Totem's Habits tab.
 *
 * Two panels on one x-axis and one crosshair. On top, sleep performance (0–100,
 * a dashed line at the goal) and recovery coloured by WHOOP's bands. Beneath,
 * each night as a bar on a clock that runs top to bottom, bedtime to wake, split
 * into stages, with its length above it. A score and a clock time are different
 * units, so they get different panels rather than two y-scales in one frame.
 *
 * Nothing here is logged by hand: the WHOOP pull fills sleep in each morning.
 * Renders nothing when there are no nights at all.
 *
 * Native: press and drag across either panel to scrub night by night (a
 * horizontal drag, so the page still scrolls vertically); a tap picks one night.
 */
export function WhoopSleep({ date }: { date: string }) {
  const { cache } = useWhoop() as any
  const [days, setDays] = useState(30)
  const [hover, setHover] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [width, setWidth] = useState(0)

  const series = date ? sleepSeries(cache, date, days) : []
  const W = Math.max(width, 280)
  const padL = 44, padR = 10
  const innerW = W - padL - padR
  const slot = innerW / Math.max(series.length, 1)

  // Where a finger is, as a night. Gesture callbacks run on the JS thread.
  const pick = (x: number) => {
    const vx = (x / (width || W)) * W
    const i = Math.max(0, Math.min(series.length - 1, Math.floor((vx - padL) / slot)))
    setHover(prev => (prev === i ? prev : i))
  }
  const scrub = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onBegin(e => pick(e.x))
    .onStart(() => tap())
    .onUpdate(e => pick(e.x))
  const press = Gesture.Tap().runOnJS(true).onEnd((e, ok) => { if (ok) { tap(); pick(e.x) } })
  const gesture = Gesture.Race(scrub, press)

  if (!series.some(r => r.night)) return null
  const stats = sleepStats(series)
  const firstNight = (cache?.sleep || []).reduce((min: string, n: any) => (n?.date && n.date < min ? n.date : min), '9999')
  const shortHistory = firstNight > series[0].date

  const xAt = (i: number) => padL + (i + 0.5) * slot
  const barW = Math.max(1, Math.min(22, slot * 0.72))

  // Panel 1: scores, 0–100.
  const H1 = 150, t1 = 12, b1 = 8
  const y1 = (v: number) => t1 + (H1 - t1 - b1) * (1 - v / 100)
  const line = (key: 'score' | 'recovery') => series.reduce((d, r, i) => (r[key] == null ? d : `${d}${d ? 'L' : 'M'}${xAt(i).toFixed(1)},${y1(r[key] as number).toFixed(1)}`), '')
  const dots = series.filter(r => r.score != null).length <= 60

  // Panel 2: the nights on a clock, snapped out to whole hours.
  const spans = series.map(r => r.span).filter(Boolean) as { from: number; to: number }[]
  const lo = spans.length ? Math.floor(Math.min(...spans.map(s => s.from)) / 60) * 60 : 600
  const hi = spans.length ? Math.ceil(Math.max(...spans.map(s => s.to)) / 60) * 60 : 1260
  const H2 = 190, t2 = 18, b2 = 22
  const y2 = (m: number) => t2 + ((m - lo) / (hi - lo || 1)) * (H2 - t2 - b2)
  const step = hi - lo > 900 ? 240 : hi - lo > 480 ? 120 : 60
  const clockTicks: number[] = []
  for (let m = lo; m <= hi; m += step) clockTicks.push(m)
  // Thin the duration labels to what fits, counting back from the newest night.
  const labelEvery = Math.max(1, Math.ceil(46 / slot))
  const dateTicks = [0, Math.floor((series.length - 1) / 2), series.length - 1]

  const cross = (H: number) => hover != null ? (
    <Rect x={xAt(hover) - slot / 2} width={slot} y={0} height={H} fill={colors.vizAxis} opacity={0.18} />
  ) : null
  // The range ends on the day being viewed, so its night is always the last
  // column. Tinted under everything, with a cap, so it reads at 1y as well as 30d.
  const today = series.length - 1
  const todayW = Math.max(slot, 4)
  const mark = (H: number) => (
    <G>
      <Rect x={xAt(today) - todayW / 2} width={todayW} y={0} height={H} fill={SLEEP_TODAY} opacity={0.16} />
      <Rect x={xAt(today) - todayW / 2} width={todayW} y={0} height={2} fill={SLEEP_TODAY} />
    </G>
  )

  const good = stats.delta == null ? null : stats.delta > 0
  const flat = stats.delta != null && Math.abs(stats.delta) < 0.5
  const shown = series[hover ?? today]
  const hasRest = series.some(r => r.span && r.span.to - r.span.from - r.staged > 1)

  return (
    <Card>
      <View onLayout={e => setWidth(Math.round(e.nativeEvent.layout.width))}>
        <View style={wh.sleepHead}>
          <CardTitle style={{ marginBottom: 0 }}>Sleep</CardTitle>
          <Segmented<string>
            style={{ marginBottom: 0, minWidth: 180 }}
            value={String(days)}
            onChange={(v) => { setDays(Number(v)); setHover(null) }}
            options={SLEEP_RANGES.map(r => ({ value: String(r.days), label: r.label }))}
          />
        </View>

        <View style={wh.sleepStats}>
          <StatPair big value={pct(stats.latest?.score)} label="latest" />
          <StatPair value={pct(stats.recent)} label="7-day avg" />
          {stats.delta != null && !flat ? (
            <StatPair value={`${good ? '▲' : '▼'} ${Math.round(Math.abs(stats.delta))}`} label="vs prior week"
              color={good ? colors.vizGood : colors.vizCrit} />
          ) : null}
          <StatPair value={pct(stats.avg)} label="average" color={colors.inkDim} />
          <Press haptic onPress={() => setShowTable(t => !t)} accessibilityRole="button"
            accessibilityState={{ selected: showTable }} hitSlop={8} style={wh.vizToggle}>
            <T size={font.small} dim>{showTable ? 'Chart' : 'Table'}</T>
          </Press>
        </View>

        {showTable ? (
          <View style={{ marginTop: 4 }}>
            <View style={wh.tr}>
              {['Night', 'Sleep', 'Recovery', 'Asleep', 'Bed'].map((h, k) => (
                <T key={h} size={12} weight={500} faint style={[wh.th, k === 4 && { flex: 2.4 }]}>{h}</T>
              ))}
            </View>
            {[...series].reverse().filter(r => r.night).map(r => (
              <View key={r.date} style={[wh.tr, wh.trBody]}>
                <T size={13} tabular style={wh.td}>{dayLabel(r.date, { month: 'short', day: 'numeric' })}</T>
                <T size={13} tabular style={wh.td}>{pct(r.score)}</T>
                <T size={13} tabular style={wh.td}>{pct(r.recovery)}</T>
                <T size={13} tabular style={wh.td}>{hm(r.night.asleepMin) || '—'}</T>
                <T size={13} tabular style={[wh.td, { flex: 2.4 }]}>{wallClock(r.night.bedtime) || '—'} → {wallClock(r.night.wake) || '—'}</T>
              </View>
            ))}
          </View>
        ) : (
          <>
            <GestureDetector gesture={gesture}>
              <View collapsable={false}>
                <Svg width="100%" height={H1} viewBox={`0 0 ${W} ${H1}`}
                  accessibilityLabel={`Sleep performance over ${days} days, latest ${pct(stats.latest?.score)}`}>
                  <Defs>
                    {/* Recovery's colour is a function of its value, so the gradient runs up the axis. */}
                    <LinearGradient id="sleep-recovery" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y1(0)} y2={y1(100)}>
                      <Stop offset="0.33" stopColor={colors.vizCrit} /><Stop offset="0.34" stopColor={colors.vizWarn} />
                      <Stop offset="0.66" stopColor={colors.vizWarn} /><Stop offset="0.67" stopColor={colors.vizGood} />
                    </LinearGradient>
                  </Defs>
                  {mark(H1)}
                  {cross(H1)}
                  {[0, 25, 50, 75, 100].map(t => (
                    <G key={t}>
                      <Line x1={padL} x2={W - padR} y1={y1(t)} y2={y1(t)} stroke={colors.vizGrid} />
                      <SvgText x={padL - 8} y={y1(t) + 4} textAnchor="end" {...TICK}>{t}</SvgText>
                    </G>
                  ))}
                  <Line x1={padL} x2={W - padR} y1={y1(SLEEP_GOAL)} y2={y1(SLEEP_GOAL)} stroke={colors.vizMuted} strokeDasharray="4 4" />
                  <SvgText x={W - padR} y={y1(SLEEP_GOAL) - 4} textAnchor="end" {...TICK}>{`goal ${SLEEP_GOAL}%`}</SvgText>
                  <Path d={line('recovery')} fill="none" stroke="url(#sleep-recovery)" strokeWidth={2} strokeLinejoin="round" />
                  <Path d={line('score')} fill="none" stroke={colors.ink} strokeWidth={2} strokeLinejoin="round" />
                  {series.map((r, i) => (
                    <G key={r.date}>
                      {r.recovery != null && (dots || hover === i) ? (
                        <Circle cx={xAt(i)} cy={y1(r.recovery)} r={hover === i ? 4.5 : 3} fill={recoveryColor(r.recovery)} stroke={colors.panel} strokeWidth={2} />
                      ) : null}
                      {r.score != null && (dots || hover === i) ? (
                        <Circle cx={xAt(i)} cy={y1(r.score)} r={hover === i ? 4.5 : 3} fill={colors.ink} stroke={colors.panel} strokeWidth={2} />
                      ) : null}
                    </G>
                  ))}
                </Svg>

                <Svg width="100%" height={H2} viewBox={`0 0 ${W} ${H2}`}
                  accessibilityLabel="Each night from bedtime to wake, split into stages">
                  {mark(H2)}
                  {cross(H2)}
                  {clockTicks.map(m => (
                    <G key={m}>
                      <Line x1={padL} x2={W - padR} y1={y2(m)} y2={y2(m)} stroke={colors.vizGrid} />
                      <SvgText x={padL - 8} y={y2(m) + 4} textAnchor="end" {...TICK}>{spanClock(m)}</SvgText>
                    </G>
                  ))}
                  {series.map((r, i) => {
                    if (!r.span) return null
                    let at = r.span.from
                    const x = xAt(i) - barW / 2
                    const segs = STAGES.map(s => {
                      const len = Number(r.night.stages?.[s.key]) || 0
                      const seg = len > 0 ? <Rect key={s.key} x={x} width={barW} y={y2(at)} height={Math.max(y2(at + len) - y2(at), 0.5)} fill={s.color} /> : null
                      at += len
                      return seg
                    })
                    const rest = r.span.to - at
                    const showLabel = (series.length - 1 - i) % labelEvery === 0
                    return (
                      <G key={r.date}>
                        {segs}
                        {rest > 1 ? (
                          <Rect x={x} width={barW} y={y2(at)} height={y2(r.span.to) - y2(at)} fill={colors.vizMuted} opacity={0.3} />
                        ) : null}
                        {showLabel ? (
                          <SvgText x={Math.min(Math.max(xAt(i), padL + 16), W - padR - 16)} y={Math.max(y2(r.span.from) - 4, 10)}
                            textAnchor="middle" {...TICK} fontSize={font.micro}>
                            {hmTight(r.span.to - r.span.from)}
                          </SvgText>
                        ) : null}
                      </G>
                    )
                  })}
                  {dateTicks.map((i, k) => (
                    <SvgText key={k} x={xAt(i)} y={H2 - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}
                      {...TICK} {...(i === today ? { fill: SLEEP_TODAY, fontWeight: '600' } : null)}>
                      {dayLabel(series[i].date, { month: 'short', day: 'numeric' })}
                    </SvgText>
                  ))}
                </Svg>
              </View>
            </GestureDetector>

            <View style={wh.readout} accessibilityLiveRegion="polite">
              {shown ? (
                <>
                  <T size={12} weight={600} tabular color={shown === series[today] ? SLEEP_TODAY : colors.ink}>
                    {dayLabel(shown.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </T>
                  {shown.night ? (
                    <>
                      <T size={12} dim tabular>sleep {pct(shown.score)}</T>
                      {shown.recovery != null ? <T size={12} tabular color={recoveryColor(shown.recovery)}>recovery {pct(shown.recovery)}</T> : null}
                      {shown.night.asleepMin != null ? <T size={12} dim tabular>{hm(shown.night.asleepMin)} asleep</T> : null}
                      {shown.night.bedtime ? <T size={12} dim tabular>{wallClock(shown.night.bedtime)} → {wallClock(shown.night.wake)}</T> : null}
                      {STAGES.filter(s => shown.night.stages?.[s.key] > 0).map(s => (
                        <Swatch key={s.key} color={s.color} size={12} dim>{`${s.label} ${hm(shown.night.stages[s.key])}`}</Swatch>
                      ))}
                    </>
                  ) : <T size={12} dim>no night from WHOOP</T>}
                  {hover == null ? <T size={12} faint>· touch a night for its numbers</T> : null}
                </>
              ) : null}
            </View>

            <View style={wh.legend}>
              <Swatch color={colors.ink} line>Sleep performance</Swatch>
              <Swatch recKey line>Recovery · red 0–33 · yellow 34–66 · green 67–100</Swatch>
              {STAGES.map(s => <Swatch key={s.key} color={s.color}>{s.label}</Swatch>)}
              {hasRest ? <Swatch color={colors.vizMuted} opacity={0.3}>In bed, unscored</Swatch> : null}
            </View>
          </>
        )}
        {shortHistory ? (
          <T size={font.small} dim style={{ marginTop: space[3] }}>
            {`History starts ${dayLabel(firstNight, { month: 'short', day: 'numeric' })} and fills in from WHOOP.`}
          </T>
        ) : null}
      </View>
    </Card>
  )
}

/** One figure in .sleep-stats: the number over its small label. */
function StatPair({ value, label, big, color }: { value: string; label: string; big?: boolean; color?: string }) {
  return (
    <View>
      <T size={big ? font.heading : font.body} weight={600} tabular color={color} lineHeight={big ? 26 : 18}>{value}</T>
      <T size={font.caption} dim lineHeight={15}>{label}</T>
    </View>
  )
}

/** A key in the legend or the readout: the 8px square (or 12×2 line) then its label. */
function Swatch({ color, line, recKey, opacity = 1, size = 11, dim, children }: {
  color?: string
  line?: boolean
  recKey?: boolean
  opacity?: number
  size?: number
  dim?: boolean
  children: React.ReactNode
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {recKey ? (
        // linear-gradient(90deg, bad 33%, warn 33% 66%, good 66%), as three stops.
        <View style={[wh.keyLine, { flexDirection: 'row', overflow: 'hidden' }]}>
          <View style={{ flex: 33, backgroundColor: colors.vizCrit }} />
          <View style={{ flex: 33, backgroundColor: colors.vizWarn }} />
          <View style={{ flex: 34, backgroundColor: colors.vizGood }} />
        </View>
      ) : (
        <View style={[line ? wh.keyLine : wh.keySquare, { backgroundColor: color, opacity }]} />
      )}
      <T size={size} faint={!dim} dim={dim} tabular>{children}</T>
    </View>
  )
}

export const wh = StyleSheet.create({
  // .wh: the block inside the session log.
  block: { marginTop: space[6] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
  list: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  rule: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
  rowIn: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  body: { paddingBottom: space[3], paddingLeft: 20 + space[3], gap: space[2] },
  acts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: space[2] },
  // The suggestion is marked, not selected — it still takes a tap.
  tag: {
    borderWidth: 1, borderColor: colors.accentLine, backgroundColor: colors.accentSoft,
    borderRadius: radius.pill, paddingHorizontal: space[2],
  },
  more: { marginTop: space[4], marginBottom: space[2] },
  total: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space[2] },
  empty: { marginTop: space[2] },
  err: { marginTop: space[2] },
  splitRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[3], flexWrap: 'wrap' },

  // The recovery card.
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  stat: {
    flexGrow: 1, flexBasis: 104, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
    paddingVertical: space[2], paddingHorizontal: space[3], backgroundColor: colors.panel2, gap: 2,
  },

  // The sleep card.
  sleepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  sleepStats: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginTop: 12, marginBottom: 6 },
  vizToggle: { marginLeft: 'auto', borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, minHeight: 36, justifyContent: 'center', paddingHorizontal: space[3] },
  readout: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, columnGap: 12, minHeight: 22, marginTop: 6, alignItems: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 4, columnGap: 12, marginTop: 8 },
  keySquare: { width: 8, height: 8, borderRadius: 2, marginRight: 5 },
  keyLine: { width: 12, height: 2, borderRadius: 1, marginRight: 5 },
  tr: { flexDirection: 'row', alignItems: 'center' },
  trBody: { borderTopWidth: 1, borderTopColor: colors.line },
  th: { flex: 1.3, paddingVertical: 6, paddingHorizontal: 4 },
  td: { flex: 1.3, paddingVertical: 9, paddingHorizontal: 4 },
})
