/*
 * Strava on screen: the day's activities, and the one the user attached.
 *
 * `StravaActivities` sits in the session log under the WHOOP block and does the
 * same job for rides, runs and walks: offers the day's activities, marks at most
 * ONE as likely, and attaches nothing by itself. The tap is their. What differs
 * from WHOOP is what the tap does — on the *Other training* card it also fills
 * the card's own blank fields (activity, time, distance, speed, elevation) from
 * the ride, because those are the numbers Strava measured and typing them off a
 * screen the user is looking at is the chore the button removes. See attachTo/detachFrom
 * in server/strava.js for the exact rules (blanks only; detach clears only what
 * it filled and the user left alone).
 *
 * Attaching fetches the activity in FULL first (laps, mile splits, calories,
 * description), so the snapshot is the whole ride and not the list row. If that
 * fetch fails the summary is attached instead — every headline number is on it.
 */

import { Icon } from './lib/icons.jsx'
import { gateResolver } from './lib/activities.js'
import { useState } from 'react'
import {
  useStrava, rankForSession, snapshotOf, attachedMinutes, attachTo, detachFrom, activitiesOn,
  attachedStrava,
} from './lib/strava.jsx'
import { pruneAttached } from './lib/outputs.js'

/* ---------------------------------------------------------------- formatting */

const clock = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
const span = (a, b) => (clock(b) ? `${clock(a)}–${clock(b)}` : clock(a))
const n1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10)

/**
 * The line of numbers under an activity. Distance first, because that is the
 * question a ride answers; pace for foot sports, speed for wheels; heart rate and
 * power only where a sensor recorded them.
 */
function Numbers({ a }) {
  const bits = []
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
  return <div className="wh-nums">{bits.join(' · ')}</div>
}

/** Laps or mile splits, folded away — the detail that makes a snapshot the whole ride. */
function Laps({ rows, label }) {
  if (!rows?.length) return null
  const pace = rows.some(r => r.paceMinPerMi)
  return (
    <details className="wh-splitwrap sv-laps">
      <summary>{rows.length} {label}</summary>
      <table>
        <thead>
          <tr><th>#</th><th>mi</th><th>min</th><th>{pace ? 'pace' : 'mph'}</th><th>bpm</th><th>W</th><th>ft</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.index ?? i}>
              <td>{r.index ?? i + 1}</td>
              <td>{n1(r.distanceMi) ?? ''}</td>
              <td>{n1(r.movingMin) ?? ''}</td>
              <td>{pace ? (r.paceMinPerMi ? `${Math.floor(r.paceMinPerMi)}:${String(Math.round((r.paceMinPerMi % 1) * 60)).padStart(2, '0')}` : '') : (n1(r.avgMph) ?? '')}</td>
              <td>{r.avgHr ?? ''}</td>
              <td>{r.avgWatts ?? ''}</td>
              <td>{r.elevationFt ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/* ------------------------------------------------------- attach to a session */

export function StravaActivities({ session, entry, entries, onSave }) {
  const { cache, status, pulling, error, pull, detail } = useStrava()
  const [attaching, setAttaching] = useState(null)
  const out = entry?.data?.out || {}
  /*
   * A LIST since 2026-09-21: a combined workout can have several Strava
   * activities. A brick is a ride and a run
   * and one session; attaching the run used to throw the ride away.
   */
  const attachedList = attachedStrava(out)
  const date = entry?.date || null

  // Nothing cached and nothing attached: the app looks exactly as it did before
  // Strava existed. An attached snapshot renders with no cache — it is their log.
  if (!cache && !attachedList.length) return null

  const onDay = activitiesOn(cache, date)
  const ranked = rankForSession({ activities: onDay, entry, session, date, entries: entries || [] })

  const attach = async (a) => {
    setAttaching(a.id)
    try {
      const full = await detail(a.id)
      const snap = snapshotOf(a, { detail: full, gear: cache?.gear || null })
      // Pruned after filling: the fill works off the fields the card DECLARES,
      // because picking the activity is what turns the rest of them into
      // questions, and this is what then keeps a lift day from acquiring a
      // distance off a mislabelled activity. See lib/outputs.js.
      onSave(pruneAttached(session, attachTo(session, out, snap), gateResolver(session)))
    } finally {
      setAttaching(null)
    }
  }
  const detach = (snap) =>
    onSave(pruneAttached(session, detachFrom(out, snap.id), gateResolver(session)))

  const alsoOnFor = (snap) => ranked.find(c => c.activity.id === snap.id)?.attachedTo || null
  const here = new Set(attachedList.map(a => a.id))
  const offers = ranked.filter(c => !here.has(c.activity.id))
  const totalMin = attachedList.reduce((n, a) => n + (Number(attachedMinutes(a)) || 0), 0)

  // No bridge on this install. Attached snapshots are the log and still show.
  if (cache?.configured === false && !attachedList.length) return null

  return (
    <div className="wh sv">
      <div className="wh-head">
        <Icon name="Bike" size={13} className="sv-ico" /> Strava
        <button type="button" className="wh-pull" onClick={pull} disabled={pulling}>
          {pulling ? 'pulling…' : 'pull'}
        </button>
      </div>

      {error && <p className="wh-err">{error}</p>}
      {!error && status?.ok === false && <p className="wh-err">{status.detail}</p>}

      {/* Everything attached, each detachable on its own. A brick is two rides
          and a run; a slot that held one lost whichever landed first. */}
      {attachedList.map(snap => {
        const alsoOn = alsoOnFor(snap)
        const filledKeys = Object.keys(snap.filled || {})
        return (
          <div key={snap.id} className="wh-item attached">
            <div className="wh-item-top">
              <span className="wh-sport"><Icon name="CircleCheck" size={13} /> {snap.name || snap.sport}</span>
              <span className="wh-when">{snap.sport} · {span(snap.start, snap.end)}</span>
              <button type="button" className="wh-btn ghost" onClick={() => detach(snap)}>detach</button>
            </div>
            <Numbers a={snap} />
            {snap.gear?.name && (
              <div className="wh-nums">on {snap.gear.name}{snap.gear.distanceMi ? ` · ${Math.round(snap.gear.distanceMi).toLocaleString()} mi on it` : ''}</div>
            )}
            {snap.description && <p className="wh-note sv-desc">&ldquo;{snap.description}&rdquo;</p>}
            <Laps rows={snap.laps} label="laps" />
            {!snap.laps?.length && <Laps rows={snap.splits} label="mile splits" />}
            <p className="wh-note">
              Saved with this session — these numbers stay put whether or not Strava is reachable.
              {filledKeys.length > 0 && (
                <> It filled in {filledKeys.join(', ')} above; detaching clears whichever you have not changed.</>
              )}
              {' '}<a href={snap.url} target="_blank" rel="noopener noreferrer">open on Strava</a>
            </p>
            {alsoOn && (
              <p className="wh-err">Also on <strong>{alsoOn.name}</strong> — a ride is one session, so one of these is wrong.</p>
            )}
          </div>
        )
      })}

      {attachedList.length > 1 && (
        <p className="wh-note wh-total">
          <Icon name="Timer" size={13} /> {attachedList.length} activities on this session,{' '}
          <strong>{totalMin} min</strong> moving in total. That is what the weekly load chart
          multiplies your RPE by.
        </p>
      )}

      {offers.length === 0 ? (
        attachedList.length === 0 && (
          <p className="wh-empty">
            {cache?.fetchedAt
              ? 'Nothing on Strava for this day. If you have just finished, give the upload a minute and pull again.'
              : 'No Strava data yet.'}
          </p>
        )
      ) : (
        <div className="wh-list">
          {attachedList.length > 0 && (
            <p className="wh-more">Also on this day — attach as many as belong to this session:</p>
          )}
          {offers.map(c => {
            const a = c.activity
            return (
              <div key={a.id} className={`wh-item ${c.likely ? 'likely' : ''} ${c.attachedTo ? 'taken' : ''}`}>
                <div className="wh-item-top">
                  <span className="wh-sport sv-name">{a.name || a.sport}</span>
                  <span className="wh-when">{a.sport} · {span(a.start, a.end)}</span>
                  {c.likely && (
                    <span className="wh-tag" title={c.overlapMin
                      ? `overlaps this session by ${c.overlapMin} min`
                      : c.fit === true ? 'the sport you picked' : 'the only activity on Strava this day'}>likely</span>
                  )}
                </div>
                <Numbers a={a} />
                {c.attachedTo ? (
                  <p className="wh-note">Already on <strong>{c.attachedTo.name}</strong>.{' '}
                    <button type="button" className="wh-btn ghost" onClick={() => attach(a)} disabled={attaching !== null}>attach here instead</button>
                  </p>
                ) : (
                  <button type="button" className="wh-btn" onClick={() => attach(a)} disabled={attaching !== null}>
                    <Icon name="Plus" size={14} /> {attaching === a.id ? 'attaching…' : 'attach to this session'}
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
