/*
 * WHOOP on screen: what the band recorded, and the readiness it implies.
 *
 * Two components with very different jobs.
 *
 * `WhoopWorkouts` sits inside the session log and offers the day's workouts. It
 * never attaches one by itself. Getting a match wrong writes a belay partner's
 * climb, or the warm-up lift, into the training log as this session's heart rate —
 * and nothing on screen afterwards would look wrong, which is exactly the kind of
 * error this app refuses to risk elsewhere (see the coach's cards, which suggest
 * and never apply). So the app may mark ONE candidate as likely, and the tap is their.
 *
 * `WhoopReadiness` shows how recovered the user arrived, against their own baseline rather
 * than against a population. It is a readout, not an instruction: what it feeds
 * into the recommendation is clamped and read after the hard blocks, so no number
 * here can put two hard finger days together.
 */

import { Icon } from './lib/icons.jsx'
import { gateResolver } from './lib/activities.js'
import { useCallback, useRef, useState } from 'react'
import {
  useWhoop, rankForSession, snapshotOf, hardMinutes, recordedPct, readinessFor, workoutsOn,
  partOf, attachedMinutes, isSplit, sessionWindow, overlapMinutes, workoutWindow,
  attachTo, detachFrom, attachedWhoop,
} from './lib/whoop.jsx'
import { pruneAttached } from './lib/outputs.js'

/* ---------------------------------------------------------------- formatting */

const clock = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "6:05–7:33 PM", or just the start when the end is missing. */
const span = (a, b) => (clock(b) ? `${clock(a)}–${clock(b)}` : clock(a))

/**
 * The line of numbers under a workout.
 *
 * A heart rate carries its percentage of their max only where WHOOP told us their
 * max — see `snapshotOf`, which refuses to compute one off 220-minus-age. And
 * `percentRecorded` is surfaced whenever the strap missed anything, because an
 * average over two thirds of a session is not the session's average — through
 * `recordedPct`, because WHOOP sends it as a fraction and a complete session read
 * as "only 1% recorded" until it went through there.
 */
function Numbers({ w, minutes }) {
  const hard = hardMinutes(w)
  const recorded = recordedPct(w.percentRecorded)
  const bits = []
  // `minutes` overrides where this session took only a slice of the workout. The
  // rest of the line stays the WHOLE workout's, because that is what those
  // numbers are — see partOf, and the caption under this row.
  const mins = minutes ?? w.minutes
  if (mins) bits.push(`${mins} min`)
  if (w.strain != null) bits.push(`strain ${w.strain}`)
  if (w.avgHr) bits.push(`avg ${w.avgHr}${w.pctAvgHr ? ` (${w.pctAvgHr}%)` : ''}`)
  if (w.maxHr) bits.push(`max ${w.maxHr}${w.pctMaxHr ? ` (${w.pctMaxHr}%)` : ''}`)
  if (hard) bits.push(`${hard} min zone 3+`)
  if (w.calories) bits.push(`${w.calories} cal`)
  return (
    <div className="wh-nums">
      {bits.join(' · ')}
      {recorded !== null && recorded < 95 && (
        <span className="wh-partial"> · only {recorded}% recorded</span>
      )}
    </div>
  )
}

/* ------------------------------------------------ one workout, two sessions */

/** "18:45" in local time for an ISO instant, which is what <input type="time"> wants. */
function hhmm(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** That back the other way: a wall-clock time, on the day the workout happened. */
function isoAt(sameDayIso, value) {
  const base = Date.parse(sameDayIso)
  const [h, m] = String(value || '').split(':').map(Number)
  if (!Number.isFinite(base) || !Number.isFinite(h) || !Number.isFinite(m)) return null
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/**
 * Which part of one WHOOP workout this session was.
 *
 * WHOOP records a gym visit as ONE workout, but one visit can hold two sessions —
 * the board, then the laps — so both must be able to carry it. Attaching
 * it twice is the easy half. The half that matters is that a 130-minute workout
 * sitting whole on two sessions makes the day read as 260 minutes of training, and
 * the weekly load chart is RPE × minutes, so the split is what keeps that chart
 * true rather than a nicety.
 *
 * The user types two clock times and the app computes the OVERLAP with the workout, so
 * the arithmetic is never their to do and the numbers of two split sessions can
 * never add up to more than the workout. Everything else on the snapshot stays
 * the whole workout's, and says so.
 */
function SplitEditor({ snap, onChange, onClear }) {
  const part = snap.part || null
  const [from, setFrom] = useState(() => hhmm(part?.start || snap.start))
  const [to, setTo] = useState(() => hhmm(part?.end || snap.end))

  const anchor = snap.start || part?.start
  const computed = partOf(snap, { start: isoAt(anchor, from), end: isoAt(anchor, to) })

  return (
    <div className="wh-split">
      <div className="wh-splitrow">
        <label>
          <span>from</span>
          <input type="time" value={from} onChange={e => setFrom(e.target.value)} aria-label="This session started at" />
        </label>
        <label>
          <span>to</span>
          <input type="time" value={to} onChange={e => setTo(e.target.value)} aria-label="This session ended at" />
        </label>
        <span className="wh-splitmin">
          {computed ? `${computed.minutes} min` : '—'}
        </span>
      </div>

      {computed && computed.minutes === 0 && (
        <p className="wh-err">
          Those times do not overlap the workout at all ({span(snap.start, snap.end)}). Check them —
          saved as they are, this session gets none of it.
        </p>
      )}

      <div className="wh-splitbtns">
        <button type="button" className="wh-btn" disabled={!computed}
          onClick={() => computed && onChange(computed)}>
          <Icon name="Check" size={14} /> {part ? 'update this session\'s part' : 'save this session\'s part'}
        </button>
        {part && (
          <button type="button" className="wh-btn ghost" onClick={onClear}>
            use the whole workout
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- attach to a session */

/**
 * The day's WHOOP workouts, for one session.
 *
 * The session's own local date is the only bucket considered — a workout from
 * another day is not a candidate, however well it would fit.
 */
export function WhoopWorkouts({ session, entry, entries, onSave }) {
  const { cache, status, pulling, error, pull } = useWhoop()
  const out = entry?.data?.out || {}
  /*
   * A LIST since 2026-09-21: a combined workout can have several WHOOP or Strava
   * activities attached at once. See `attachedWhoop` in server/whoop.js
   * for where they are stored and why the first one stays where it always was.
   */
  const attachedList = attachedWhoop(out)
  const date = entry?.date || null

  // Nothing cached and nothing attached: the app looks exactly as it did before
  // WHOOP existed. An attached snapshot still renders with no cache at all — it
  // is their log by then, not WHOOP's copy.
  if (!cache && !attachedList.length) return null

  const onDay = workoutsOn(cache, date)
  const ranked = rankForSession({ workouts: onDay, entry, session, date, entries: entries || [] })

  /*
   * Attaching does two things: it saves the snapshot, and it answers the card's
   * blank questions from it. The second half exists because if WHOOP measured
   * the time, typing it in off a screen the user is looking at is a
   * chore the button should have removed. Only blanks are filled, what was
   * filled is remembered on the snapshot, and `pruneAttached` drops anything the
   * activity it just picked does not actually ask for. See server/whoop.js.
   */
  const put = (o) => onSave(pruneAttached(session, o, gateResolver(session)))

  const attach = (w) => put(attachTo(session, out, {
    ...snapshotOf(w, { maxHeartRate: cache?.maxHeartRate }),
    attachedAt: new Date().toISOString(),
    // Where the session was TIMED — workout mode stamped a start and measured a
    // length — the slice it occupied of the workout is already known, so the
    // split is offered pre-filled with it rather than as two empty boxes. The user
    // still has to press save: a suggested window is not a stated one.
    ...(suggestPart(w) ? { part: suggestPart(w) } : {}),
  }))
  const detach = (snap) => put(detachFrom(out, snap.id))

  /*
   * Setting or clearing the split re-runs the attach, because the workout's
   * length is one of the things it may have filled in and their SLICE of it is a
   * different number from the whole. Detach-then-attach rather than a patch:
   * detaching gives back only the blanks it took, so a duration the user typed themselves
   * survives the round trip untouched.
   */
  const reattach = (snap) => put(attachTo(session, detachFrom(out, snap.id), snap))
  const setPart = (snap, part) => reattach({ ...snap, part })
  const clearPart = (snap) => {
    const w = { ...snap }
    delete w.part
    reattach(w)
  }

  /*
   * A suggested slice, for a session the clock actually timed.
   *
   * Only offered when workout mode measured this session AND that window sits
   * inside the workout — the two facts that make it a real observation rather
   * than a guess. A hand-logged session has no time of day at all (see
   * `sessionWindow`), and inventing one is how the split would start lying.
   */
  function suggestPart(w) {
    const win = sessionWindow(entry)
    if (!win) return null
    const overlap = overlapMinutes(win, workoutWindow(w))
    if (!overlap) return null
    return partOf(w, { start: new Date(win[0]).toISOString(), end: new Date(win[1]).toISOString() })
  }

  // Everyone else holding this workout today. One gym visit split into two
  // sessions is the case this exists for; two sessions each claiming the WHOLE
  // workout is the mistake it exists to catch.
  const alsoOnFor = (snap) => ranked.find(c => c.workout.id === snap.id)?.attachedTo || null
  const attachedIdsHere = new Set(attachedList.map(w => w.id))
  // The candidates left to offer. One already on this session is not a candidate
  // for it a second time; one on ANOTHER session still is, which is the whole
  // point of the "attach here as well" route.
  const offers = ranked.filter(c => !attachedIdsHere.has(c.workout.id))

  // No bridge on this install: nothing to pull and nothing to offer. Anything
  // already attached still shows, because that is the log, not the integration.
  if (cache?.configured === false && !attachedList.length) return null

  return (
    <div className="wh">
      <div className="wh-head">
        <Icon name="HeartPulse" size={13} /> WHOOP
        <button type="button" className="wh-pull" onClick={pull} disabled={pulling}>
          {pulling ? 'pulling…' : 'pull'}
        </button>
      </div>

      {/* The fix, not the symptom — the bridge names the missing scope, and that
          sentence is carried through to here rather than flattened to "failed". */}
      {error && <p className="wh-err">{error}</p>}
      {!error && status?.ok === false && <p className="wh-err">{status.detail}</p>}

      {/*
        * Everything attached, each with its own detach and its own split.
        *
        * A list rather than a slot. Two measurements of one session is a real and
        * ordinary thing — the strap saw a lift and then a row — and the version of
        * this that held one silently replaced the first with the second.
        */}
      {attachedList.map(snap => {
        const filledKeys = Object.keys(snap.filled || {})
        const alsoOn = alsoOnFor(snap)
        const doubled = alsoOn && !isSplit(snap) && !alsoOn.part
        return (
          <div key={snap.id} className="wh-item attached">
            <div className="wh-item-top">
              <span className="wh-sport"><Icon name="CircleCheck" size={13} /> {snap.sport}</span>
              <span className="wh-when">
                {span(snap.start, snap.end)}
                {isSplit(snap) && <> · this session {span(snap.part.start, snap.part.end)}</>}
              </span>
              <button type="button" className="wh-btn ghost" onClick={() => detach(snap)}>detach</button>
            </div>
            <Numbers w={snap} minutes={attachedMinutes(snap)} />
            <p className="wh-note">
              Saved with this session — these numbers stay put whether or not WHOOP is reachable.
              {isSplit(snap) && (
                <> The minutes are this session&rsquo;s share; the strain, heart rates and zones are
                the whole workout&rsquo;s, because WHOOP publishes no way to recover them for part
                of one.</>
              )}
              {/* Named rather than silent: a field the app answered for them is one
                  the user has to be able to find and argue with. */}
              {filledKeys.length > 0 && (
                <> It filled in {filledKeys.join(', ')} above; detaching clears whichever you have
                not changed.</>
              )}
            </p>

            {alsoOn && (
              <p className={doubled ? 'wh-err' : 'wh-note'}>
                {doubled ? (
                  <>Also on <strong>{alsoOn.name}</strong>, and neither has been split — so this day
                  counts these {snap.minutes} minutes twice. Set the part below on both.</>
                ) : (
                  <>Shared with <strong>{alsoOn.name}</strong>{alsoOn.part
                    ? <> ({span(alsoOn.part.start, alsoOn.part.end)} there)</>
                    : null}.</>
                )}
              </p>
            )}

            {/* Optional, and the fold is the point: on the ordinary night when one
                workout is one session, this is a line of text you never open. */}
            <details className="wh-splitwrap" open={Boolean(doubled || isSplit(snap))}>
              <summary>
                {isSplit(snap)
                  ? `This session was ${attachedMinutes(snap)} min of it`
                  : 'Was this session only part of that workout?'}
              </summary>
              <SplitEditor snap={snap} onChange={(part) => setPart(snap, part)}
                onClear={() => clearPart(snap)} />
            </details>
          </div>
        )
      })}

      {/* The session's total, once there is more than one thing adding up to it —
          a number the load chart uses and nothing on screen was stating. */}
      {attachedList.length > 1 && (
        <p className="wh-note wh-total">
          <Icon name="Timer" size={13} /> {attachedList.length} workouts on this session,{' '}
          <strong>{attachedList.reduce((n, w) => n + (Number(attachedMinutes(w)) || 0), 0)} min</strong> in
          total. That is what the weekly load chart multiplies your RPE by.
        </p>
      )}

      {offers.length === 0 ? (
        attachedList.length === 0 && (
          <p className="wh-empty">
            {cache?.fetchedAt
              ? 'Nothing recorded on this day. If you have just finished, give the band a minute to sync and pull again.'
              : 'No WHOOP data yet.'}
          </p>
        )
      ) : (
        <div className="wh-list">
          {attachedList.length > 0 && (
            <p className="wh-more">Also on this day — attach as many as belong to this session:</p>
          )}
          {offers.map(c => {
            const w = { ...c.workout, ...snapshotOf(c.workout, { maxHeartRate: cache?.maxHeartRate }) }
            return (
              <div key={c.workout.id} className={`wh-item ${c.likely ? 'likely' : ''} ${c.attachedTo ? 'taken' : ''}`}>
                <div className="wh-item-top">
                  <span className="wh-sport">{c.workout.sport}</span>
                  <span className="wh-when">{span(c.workout.start, c.workout.end)}</span>
                  {c.likely && (
                    <span className="wh-tag" title={c.overlapMin
                      ? `overlaps this session by ${c.overlapMin} min`
                      : 'the only workout WHOOP recorded on this day'}>likely</span>
                  )}
                </div>
                <Numbers w={w} />
                {c.attachedTo ? (
                  /* Shown rather than hidden: a workout on the wrong session is
                     invisible if the list quietly drops it. Two readings of the
                     same tap, so both are offered as words rather than one being
                     assumed — it is either the same workout on two sessions of one
                     gym visit, or it is on the wrong session and should move. */
                  <p className="wh-note">
                    Already on <strong>{c.attachedTo.name}</strong>. Two sessions inside one gym
                    visit can share it — attach it here too, then say which part of it each
                    session was.{' '}
                    <button type="button" className="wh-btn ghost" onClick={() => attach(c.workout)}>
                      attach here as well
                    </button>
                  </p>
                ) : (
                  <button type="button" className="wh-btn" onClick={() => attach(c.workout)}>
                    <Icon name="Plus" size={14} /> attach to this session
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- how the user arrived */

/** Which way is good for this measure, and how far from baseline earns a colour. */
const tone = (delta, good) => {
  if (delta == null) return ''
  if (Math.abs(delta) < 5) return 'flat'
  return (delta > 0) === (good === 'up') ? 'good' : 'warn'
}

function Stat({ label, value, unit, sub, toneName = '' }) {
  if (value == null) return null
  return (
    <div className={`wh-stat ${toneName}`}>
      <span className="wh-stat-label">{label}</span>
      <span className="wh-stat-value">{value}<span className="wh-stat-unit">{unit}</span></span>
      {sub && <span className="wh-stat-sub">{sub}</span>}
    </div>
  )
}

/**
 * How recovered the user is today, read against their own recent median.
 *
 * A raw HRV of 42 ms says nothing without knowing their normal, which is why every
 * number carries its deviation and why the baseline is a median of the last
 * fortnight rather than a population figure. Fewer than four prior days and the
 * deviation is absent rather than shaky — see `baselineFor`.
 */
export function WhoopReadiness({ date }) {
  const { cache, status, pulling, error, pull } = useWhoop()
  const r = readinessFor(cache, date)

  // No reading is the ordinary case — not connected, band not worn, WHOOP still
  // calibrating — and it has to look like the app did before WHOOP existed. The
  // one exception is a real failure with a fix attached, which is worth saying.
  if (!r) {
    if (status?.ok !== false) return null
    return (
      <div className="card wh-card">
        <h2><Icon name="HeartPulse" size={16} /> WHOOP</h2>
        <p className="wh-err" style={{ margin: 0 }}>{error || status.detail}</p>
        <button className="btn ghost" onClick={pull} disabled={pulling} style={{ marginTop: 10 }}>
          {pulling ? 'Pulling…' : 'Try again'}
        </button>
      </div>
    )
  }

  const pct = (v) => (v == null ? null : `${v > 0 ? '+' : ''}${v}%`)

  return (
    <div className="card wh-card">
      <h2><Icon name="HeartPulse" size={16} /> How you arrived</h2>
      <div className="wh-stats">
        <Stat label="recovery" value={r.recovery} unit="%"
          toneName={r.recovery == null ? '' : r.recovery >= 67 ? 'good' : r.recovery >= 34 ? 'flat' : 'warn'} />
        <Stat label="HRV" value={r.hrv} unit=" ms"
          sub={r.hrvDeltaPct != null ? `${pct(r.hrvDeltaPct)} vs your ${r.hrvBaseline} ms` : null}
          toneName={tone(r.hrvDeltaPct, 'up')} />
        <Stat label="resting HR" value={r.restingHr} unit=" bpm"
          sub={r.restingHrDelta != null
            ? `${r.restingHrDelta > 0 ? '+' : ''}${r.restingHrDelta} vs your ${r.restingHrBaseline}`
            : null}
          toneName={tone(r.restingHrDelta == null ? null : -r.restingHrDelta, 'up')} />
        <Stat label="day strain" value={r.strain} unit="" />
      </div>
      <p className="sub wh-card-note">
        Against your own median over the last fortnight, not anyone else's. This nudges the ranking
        below and can never put a hard finger day next to another one.
        <button type="button" className="wh-pull" onClick={pull} disabled={pulling}>
          {pulling ? 'pulling…' : 'pull'}
        </button>
      </p>
    </div>
  )
}

/* -------------------------------------------------------------------- sleep */

/** 452 minutes as "7h32m": the label above a night's bar. */
const hmTight = (min) => {
  const t = Math.round(min)
  return Math.floor(t / 60) ? `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}m` : `${t}m`
}
/** 452 minutes as "7:32". */
const hm = (min) => (min == null ? null : `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`)

/** "2026-10-06T23:14" as the clock it was: "11:14 PM". Wall-clock, so no timezone maths. */
const wallClock = (stamp) => {
  const m = /T(\d{2}):(\d{2})/.exec(stamp || '')
  if (!m) return null
  const h = Number(m[1])
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

// Stage order and colours, deepest first. The validated series slots plus the
// muted grey, so the palette gate covers them (app/validate_palette.js).
const STAGES = [
  { key: 'deep', label: 'Deep', color: 'var(--series-1)' },
  { key: 'rem', label: 'REM', color: 'var(--series-3)' },
  { key: 'light', label: 'Light', color: 'var(--viz-muted)' },
  { key: 'awake', label: 'Awake', color: 'var(--series-2)' },
]

/* WHOOP's own recovery bands: red to 33, yellow to 66, green above. */
const recoveryColor = (v) => (v >= 67 ? 'var(--good)' : v >= 34 ? 'var(--warn)' : 'var(--bad)')

export const SLEEP_RANGES = [
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
]
const SLEEP_GOAL = 85

const isoShift = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const dayLabel = (iso, opts) => new Date(`${iso}T12:00:00`).toLocaleDateString([], opts)

/*
 * A night on the clock. Minutes are measured from noon of the night's own
 * evening, so 22:36 and 00:13 bedtimes sit on one continuous scale rather than
 * a day apart. Same anchoring as Totem's chart, for the same reason.
 */
function nightSpan(n) {
  const at = (stamp) => {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(stamp || '')
    return m ? { date: m[1], min: Number(m[2]) * 60 + Number(m[3]) } : null
  }
  const a = at(n?.bedtime)
  const b = at(n?.wake)
  if (!a || !b) return null
  const anchor = a.min < 12 * 60 ? isoShift(a.date, -1) : a.date
  const dayDiff = (iso) => Math.round((Date.parse(`${iso}T12:00:00Z`) - Date.parse(`${anchor}T12:00:00Z`)) / 86_400_000)
  const from = dayDiff(a.date) * 1440 + a.min - 12 * 60
  const to = dayDiff(b.date) * 1440 + b.min - 12 * 60
  return to > from ? { from, to } : null
}

/** The noon-anchored minute as a clock: 660 -> "11 PM". */
const spanClock = (mins) => {
  const mod = (((Math.round(mins) + 720) % 1440) + 1440) % 1440
  const h = Math.floor(mod / 60)
  const m = mod % 60
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}

/**
 * One row per calendar day in the range, oldest first, nights WHOOP has nothing
 * for included as gaps: a missed night has to read as missing, not be closed up.
 */
export function sleepSeries(cache, end, days) {
  const nights = new Map((cache?.sleep || []).filter(n => n?.date).map(n => [n.date, n]))
  const rec = new Map((cache?.recovery || []).filter(r => r?.date).map(r => [r.date, r]))
  const out = []
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
export function sleepStats(series) {
  const mean = (rows) => {
    const v = rows.map(r => r.score).filter(x => x != null)
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

const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`)

/**
 * Sleep over time: the graph that used to live on Totem's Habits tab.
 *
 * Two panels on one x-axis and one crosshair. On top, sleep performance (0–100,
 * a dashed line at the goal) and recovery coloured by WHOOP's bands. Beneath,
 * each night as a bar on a clock that runs top to bottom, bedtime to wake, split
 * into stages, with its length above it. A score and a clock time are different
 * units, so they get different panels rather than two y-scales in one frame.
 *
 * Nothing here is logged by hand: the Totem bridge fills sleep from WHOOP each
 * morning. Renders nothing when there are no nights at all, which keeps the app
 * looking as it did before sleep was here.
 */
export function WhoopSleep({ date }) {
  const { cache } = useWhoop()
  const [days, setDays] = useState(30)
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)
  const [ref, width] = useBoxWidth()

  const series = date ? sleepSeries(cache, date, days) : []
  if (!series.some(r => r.night)) return null
  const stats = sleepStats(series)
  const firstNight = (cache?.sleep || []).reduce((min, n) => (n?.date && n.date < min ? n.date : min), '9999')
  const shortHistory = firstNight > series[0].date

  const W = Math.max(width, 280)
  const padL = 44, padR = 10
  const innerW = W - padL - padR
  const slot = innerW / series.length
  const xAt = (i) => padL + (i + 0.5) * slot
  const barW = Math.max(1, Math.min(22, slot * 0.72))

  // Panel 1: scores, 0–100.
  const H1 = 150, t1 = 12, b1 = 8
  const y1 = (v) => t1 + (H1 - t1 - b1) * (1 - v / 100)
  const line = (key) => series.reduce((d, r, i) => (r[key] == null ? d : `${d}${d ? 'L' : 'M'}${xAt(i).toFixed(1)},${y1(r[key]).toFixed(1)}`), '')
  const dots = series.filter(r => r.score != null).length <= 60

  // Panel 2: the nights on a clock, snapped out to whole hours.
  const spans = series.map(r => r.span).filter(Boolean)
  const lo = spans.length ? Math.floor(Math.min(...spans.map(s => s.from)) / 60) * 60 : 600
  const hi = spans.length ? Math.ceil(Math.max(...spans.map(s => s.to)) / 60) * 60 : 1260
  const H2 = 190, t2 = 18, b2 = 22
  const y2 = (m) => t2 + ((m - lo) / (hi - lo || 1)) * (H2 - t2 - b2)
  const step = hi - lo > 900 ? 240 : hi - lo > 480 ? 120 : 60
  const clockTicks = []
  for (let m = lo; m <= hi; m += step) clockTicks.push(m)
  // Thin the duration labels to what fits, counting back from the newest night.
  const labelEvery = Math.max(1, Math.ceil(46 / slot))
  const dateTicks = [0, Math.floor((series.length - 1) / 2), series.length - 1]

  const onMove = (e) => {
    const pt = e.touches?.[0] ?? e
    if (pt.clientX == null) return
    const box = e.currentTarget.getBoundingClientRect()
    const x = ((pt.clientX - box.left) / box.width) * W
    setHover(Math.max(0, Math.min(series.length - 1, Math.floor((x - padL) / slot))))
  }
  const hoverProps = { onMouseMove: onMove, onMouseLeave: () => setHover(null), onTouchStart: onMove, onTouchMove: onMove }
  const cross = hover != null && (
    <rect x={xAt(hover) - slot / 2} width={slot} y={0} height="100%" fill="var(--viz-axis)" opacity="0.18" />
  )

  const good = stats.delta == null ? null : stats.delta > 0
  const flat = stats.delta != null && Math.abs(stats.delta) < 0.5
  const shown = hover != null ? series[hover] : null
  const hasRest = series.some(r => r.span && r.span.to - r.span.from - r.staged > 1)

  return (
    <div className="card wh-card sleep-card" ref={ref}>
      <div className="sleep-head">
        <h2><Icon name="Moon" size={16} /> Sleep</h2>
        <div className="seg sleep-range" role="group" aria-label="Range">
          {SLEEP_RANGES.map(r => (
            <button key={r.days} className={days === r.days ? 'on' : ''} aria-pressed={days === r.days}
              onClick={() => { setDays(r.days); setHover(null) }}>{r.label}</button>
          ))}
        </div>
      </div>

      <div className="sleep-stats">
        <span className="lead"><b>{pct(stats.latest?.score)}</b><small>latest</small></span>
        <span><b>{pct(stats.recent)}</b><small>7-day avg</small></span>
        {stats.delta != null && !flat && (
          <span className={good ? 'up' : 'down'}><b>{good ? '▲' : '▼'} {Math.round(Math.abs(stats.delta))}</b><small>vs prior week</small></span>
        )}
        <span className="faint"><b>{pct(stats.avg)}</b><small>average</small></span>
        <button className="viz-toggle" onClick={() => setShowTable(t => !t)} aria-pressed={showTable}>
          {showTable ? 'chart' : 'table'}
        </button>
      </div>

      {showTable ? (
        <table className="viz-table">
          <thead><tr><th>Night</th><th>Sleep</th><th>Recovery</th><th>Asleep</th><th>Bed</th></tr></thead>
          <tbody>
            {[...series].reverse().filter(r => r.night).map(r => (
              <tr key={r.date}>
                <td className="num">{dayLabel(r.date, { month: 'short', day: 'numeric' })}</td>
                <td className="num">{pct(r.score)}</td>
                <td className="num">{pct(r.recovery)}</td>
                <td className="num">{hm(r.night.asleepMin) || '—'}</td>
                <td className="num">{wallClock(r.night.bedtime) || '—'} → {wallClock(r.night.wake) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <svg width="100%" height={H1} viewBox={`0 0 ${W} ${H1}`} role="img" className="sleep-svg"
            aria-label={`Sleep performance over ${days} days, latest ${pct(stats.latest?.score)}`} {...hoverProps}>
            <defs>
              {/* Recovery's colour is a function of its value, so the gradient runs up the axis. */}
              <linearGradient id="sleep-recovery" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y1(0)} y2={y1(100)}>
                <stop offset="0.33" stopColor="var(--bad)" /><stop offset="0.34" stopColor="var(--warn)" />
                <stop offset="0.66" stopColor="var(--warn)" /><stop offset="0.67" stopColor="var(--good)" />
              </linearGradient>
            </defs>
            {cross}
            {[0, 25, 50, 75, 100].map(t => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y1(t)} y2={y1(t)} stroke="var(--viz-grid)" />
                <text x={padL - 8} y={y1(t) + 4} textAnchor="end" className="viz-tick">{t}</text>
              </g>
            ))}
            <line x1={padL} x2={W - padR} y1={y1(SLEEP_GOAL)} y2={y1(SLEEP_GOAL)} stroke="var(--viz-muted)" strokeDasharray="4 4" />
            <text x={W - padR} y={y1(SLEEP_GOAL) - 4} textAnchor="end" className="viz-tick">goal {SLEEP_GOAL}%</text>
            <path d={line('recovery')} fill="none" stroke="url(#sleep-recovery)" strokeWidth="2" strokeLinejoin="round" />
            <path d={line('score')} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
            {series.map((r, i) => (
              <g key={r.date}>
                {r.recovery != null && (dots || hover === i) && (
                  <circle cx={xAt(i)} cy={y1(r.recovery)} r={hover === i ? 4.5 : 3} fill={recoveryColor(r.recovery)} stroke="var(--panel)" strokeWidth="2" />
                )}
                {r.score != null && (dots || hover === i) && (
                  <circle cx={xAt(i)} cy={y1(r.score)} r={hover === i ? 4.5 : 3} fill="var(--ink)" stroke="var(--panel)" strokeWidth="2" />
                )}
              </g>
            ))}
          </svg>

          <svg width="100%" height={H2} viewBox={`0 0 ${W} ${H2}`} role="img" className="sleep-svg"
            aria-label="Each night from bedtime to wake, split into stages" {...hoverProps}>
            {cross}
            {clockTicks.map(m => (
              <g key={m}>
                <line x1={padL} x2={W - padR} y1={y2(m)} y2={y2(m)} stroke="var(--viz-grid)" />
                <text x={padL - 8} y={y2(m) + 4} textAnchor="end" className="viz-tick">{spanClock(m)}</text>
              </g>
            ))}
            {series.map((r, i) => {
              if (!r.span) return null
              let at = r.span.from
              const x = xAt(i) - barW / 2
              const segs = STAGES.map(s => {
                const len = Number(r.night.stages?.[s.key]) || 0
                const seg = len > 0 ? <rect key={s.key} x={x} width={barW} y={y2(at)} height={Math.max(y2(at + len) - y2(at), 0.5)} fill={s.color} /> : null
                at += len
                return seg
              })
              const rest = r.span.to - at
              const showLabel = (series.length - 1 - i) % labelEvery === 0
              return (
                <g key={r.date}>
                  {segs}
                  {rest > 1 && (
                    <rect x={x} width={barW} y={y2(at)} height={y2(r.span.to) - y2(at)} fill="var(--viz-muted)" opacity="0.3" />
                  )}
                  {showLabel && (
                    <text x={Math.min(Math.max(xAt(i), padL + 16), W - padR - 16)} y={Math.max(y2(r.span.from) - 4, 10)} textAnchor="middle" className="viz-tick sleep-len">
                      {hmTight(r.span.to - r.span.from)}
                    </text>
                  )}
                </g>
              )
            })}
            {dateTicks.map((i, k) => (
              <text key={k} x={xAt(i)} y={H2 - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} className="viz-tick">
                {dayLabel(series[i].date, { month: 'short', day: 'numeric' })}
              </text>
            ))}
          </svg>

          <div className="sleep-readout" aria-live="polite">
            {shown ? (
              <>
                <strong>{dayLabel(shown.date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong>
                {shown.night ? (
                  <>
                    <span>sleep {pct(shown.score)}</span>
                    {shown.recovery != null && <span style={{ color: recoveryColor(shown.recovery) }}>recovery {pct(shown.recovery)}</span>}
                    {shown.night.asleepMin != null && <span>{hm(shown.night.asleepMin)} asleep</span>}
                    {shown.night.bedtime && <span>{wallClock(shown.night.bedtime)} → {wallClock(shown.night.wake)}</span>}
                    {STAGES.filter(s => shown.night.stages?.[s.key] > 0).map(s => (
                      <span key={s.key}><i style={{ background: s.color }} />{s.label} {hm(shown.night.stages[s.key])}</span>
                    ))}
                  </>
                ) : <span>no night from WHOOP</span>}
              </>
            ) : <span className="faint">Touch a night for its numbers.</span>}
          </div>

          <div className="sleep-legend">
            <span><i className="line" style={{ background: 'var(--ink)' }} />Sleep performance</span>
            <span><i className="line sleep-rec-key" />Recovery · red 0–33 · yellow 34–66 · green 67–100</span>
            {STAGES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}
            {hasRest && <span><i style={{ background: 'var(--viz-muted)', opacity: 0.3 }} />In bed, unscored</span>}
          </div>
        </>
      )}
      <p className="sub wh-card-note">
        Bar ends are the real bedtime and wake; segment sizes are real minutes, not the order the
        stages came in.{shortHistory && ` History here starts ${dayLabel(firstNight, { month: 'short', day: 'numeric' })} and fills in as the app pulls from WHOOP.`}
      </p>
    </div>
  )
}

/**
 * The rendered width of an element, for drawing the SVG at its real size. A
 * callback ref, because the card mounts only once there are nights to show.
 */
function useBoxWidth() {
  const [w, setW] = useState(0)
  const observer = useRef(null)
  const ref = useCallback((el) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    observer.current.observe(el)
  }, [])
  return [ref, w]
}
