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
import { useState } from 'react'
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
