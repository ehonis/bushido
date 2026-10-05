/*
 * The card for `lib/unlogged.js` — workouts your watch knows about and your log
 * does not. The rules, and why each one is there, are documented in that file.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { useWhoop } from './lib/whoop.jsx'
import { useStrava } from './lib/strava.jsx'
import {
  unloggedWorkouts, dismissedWorkouts, logCardOf, outWith, mergeTargets,
} from './lib/unlogged.js'
import { withCasualName, withWarmupName } from './lib/naming.js'
import { isDone } from './lib/store.js'

const SOURCE = { whoop: 'WHOOP', strava: 'Strava' }

/*
 * WHEN it happened, in the user's own timezone.
 *
 * Showing only a duration did not say when the workout was done. A duration is
 * the one thing on this row that does not
 * identify the workout — two rides of 22 minutes are the same row twice — and
 * the whole question the card raises is which of the day's efforts each one is.
 *
 * Formatted from the absolute instant on the item (both services publish UTC),
 * so the clock reads local wherever the user is. Same helper as `whoop.jsx` and
 * `strava.jsx`, which show the span on an attached workout for the same reason.
 */
const clock = (iso) => {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * "6:05–7:33 PM", or just the start where there is no end.
 *
 * The meridiem is written once where both ends share it, unlike the fuller span
 * in `whoop.jsx`: this row is three buttons wide on a phone, and "1:10 PM–1:45
 * PM · 35 min · WHOOP" wraps onto a second line to say PM twice.
 */
const span = (a, b) => {
  const start = clock(a)
  if (!start) return ''
  const end = clock(b)
  if (!end || end === start) return start
  const meridiem = /\s?[AP]M$/i.exec(start)?.[0]
  const same = meridiem && end.toUpperCase().endsWith(meridiem.trim().toUpperCase())
  return `${same ? start.slice(0, -meridiem.length) : start}–${end}`
}

export function UnloggedWorkouts({
  plan, entries, iso, onLog, onMerge = null,
  skipped = [], onDismiss, onRestore, split = [], onSplit,
}) {
  const { cache: whoop } = useWhoop()
  const { cache: strava } = useStrava()
  const [showGone, setShowGone] = useState(false)
  // Which row is asking "into which session?". One at a time — two open target
  // lists on a card this size is a card you cannot read.
  const [merging, setMerging] = useState(null)

  const args = { plan, entries, iso, whoop, strava, skipped, split }
  const items = useMemo(() => unloggedWorkouts(args),
    [plan, entries, iso, whoop, strava, skipped, split])
  const gone = useMemo(() => dismissedWorkouts(args),
    [plan, entries, iso, whoop, strava, skipped, split])

  if (!items.length && !gone.length) return null

  const card = logCardOf(plan)
  const targetsFor = (item) =>
    mergeTargets({ entries, iso, item, menu: plan?.dailyMenu || [] })

  /*
   * Log it, with the measurement already attached.
   *
   * Goes through the same `attachTo` the manual attach uses, so what lands is
   * indistinguishable from an entry the user built by hand: the same snapshot, the same
   * `filled` bookkeeping, and therefore the same ability to detach and put the
   * blanks back. The activity, time, distance and elevation come off the
   * measurement; everything else is their to fill in or leave.
   *
   * A merged pair takes the same path and lands as ONE entry carrying BOTH
   * snapshots — see `mergedOut`, which owns the question of who answers what.
   */
  const outFor = (item) => outWith(card, {}, item)

  const take = (item) => onLog(card, outFor(item))

  /*
   * Merge it into a session that is already on the day.
   *
   * The measurement is attached to the TARGET's own card, not to the generic
   * workout card — a planned lift and a *Log a workout* ride declare different
   * fields, and filling against the wrong one would put a distance on a session
   * that never asked for one. Both attach helpers only fill BLANKS, so a session
   * the user has already typed into keeps every number the user typed.
   */
  const mergeInto = (item, entry) => {
    const opt = (plan?.dailyMenu || []).find(m => m.id === entry.data?.optId) || card
    onMerge(entry, outWith(opt, entry.data?.out || {}, item))
    setMerging(null)
  }

  /*
   * "Just miles" — an activity, not a workout.
   *
   * A short commute ride is not really a workout, but its miles should still
   * count. Same entry, same snapshot, same everything, with
   * `training: false` on it — which keeps the miles on the bike and the day on
   * the streak, and keeps a commute out of the load chart, out of the week's
   * quotas and away from the recommender's sense
   * of a heavy week. See `isTraining`, and `weekDaily` in lib/quota.js.
   *
   * It is a second BUTTON rather than a checkbox inside the form, because the
   * whole value of this card is that logging a ride is one tap; making the cheap
   * case cost three would be the wrong way round.
   *
   * IT NAMES ITSELF "COMMUTE": a ride marked as just miles is named as a commute,
   * since a commute is the main reason the button exists, so the rename the user
   * would otherwise always make afterwards happens here. Content decides which disciplines get a name (`quickNames.casual`), and
   * the name is marked as the app's so renaming or unticking takes it back. See
   * lib/naming.js.
   */
  const takeAsMiles = (item) =>
    onLog(card, withCasualName(outFor(item), { plan, opt: card, on: true }), { training: false })

  /*
   * "Warm-up" — it happened, but it was the front of something else.
   *
   * Offered alongside "log it" and "just miles" so a warm-up can be labelled as
   * one. Ten minutes on the rower before a lift is a real measurement
   * on a real day and it is not a rowing workout, so it takes the SAME disposition
   * as a commute — `training: false`, which keeps the minutes, the gear and the
   * streak, and keeps it out of the week's quotas and out of sRPE — and differs
   * only in what it calls itself. Making it a third button rather than a rename
   * afterwards is the point: the whole value of this card is that the cheap case
   * costs one tap.
   */
  const takeAsWarmup = (item) =>
    onLog(card, withWarmupName(outFor(item), { plan, on: true }), { training: false })

  /*
   * With everything dismissed there is no headline to write.
   *
   * The card used to render "0 workouts you have not logged / Recorded by ." in
   * that state — a heading counting nothing and a sentence naming nobody —
   * because the early return only checked that SOMETHING was on the card, and
   * a dismissed-only card is something. The dismissed line stands on its own.
   */
  const heading = items.length === 1
    ? 'A workout you have not logged'
    : `${items.length} workouts you have not logged`
  const sources = [...new Set(items.flatMap(i => (i.merged ? i.sources : [i.source])))]

  return (
    <div className="card unlogged">
      {items.length > 0 && (
        <>
          <h2><Icon name="HeartPulse" size={15} /> {heading}</h2>
          <p className="sub">
            Recorded by {sources.map(k => SOURCE[k]).join(' and ')}.
            One tap logs it with the time and distance already filled in.
          </p>
        </>
      )}

      {items.map(item => {
        const when = span(item.start, item.end)
        return (
        <div key={item.id} className={`unlogrow ${item.merged ? 'merged' : ''}`}>
          <span className="unlogrow-ico"><Icon name={item.activity?.icon || 'Activity'} size={17} /></span>
          <span className="unlogrow-name">
            <strong>{item.activity?.name || item.label}</strong>
            <span className="sub">
              {item.merged
                ? <>
                    <span className="unlogrow-srcs">
                      {item.sources.map(k => <span key={k} className={`srcpip ${k}`}>{SOURCE[k]}</span>)}
                    </span>
                    {/* Say the claim out loud, with the evidence for it. The app is
                        asserting that two measurements are one activity, and an
                        assertion the user cannot see is one the user cannot correct. The clock
                        leads, because that is what tells them which effort it was. */}
                    <span className="unlogrow-why">
                      {when && `${when} · `}{item.overlap} min in common — logged as one
                    </span>
                  </>
                : <>
                    {when && `${when} · `}
                    {item.minutes ? `${item.minutes} min · ` : ''}{SOURCE[item.source]}
                  </>}
            </span>
          </span>
          <span className="unlogrow-acts">
            <button className="unlogrow-take" onClick={() => take(item)}>Log it</button>
            <button className="unlogrow-miles" onClick={() => takeAsMiles(item)}
              title="Counts the miles and the streak — not the quota, not as training">
              Just miles
            </button>
            <button className="unlogrow-miles" onClick={() => takeAsWarmup(item)}
              title="The front of another session — counts the minutes, not the quota">
              Warm-up
            </button>
            {/*
              * The route that did not exist until 2026-09-17. `pairUp` folds two
              * measurements into one offer only while BOTH are unlogged; when
              * Strava syncs first and the user logs the ride off it, WHOOP's copy
              * arrives with nothing left to pair with. See `mergeTargets`.
              */}
            {onMerge && targetsFor(item).length > 0 && (
              <button className="unlogrow-merge"
                onClick={() => setMerging(merging === item.id ? null : item.id)}
                aria-expanded={merging === item.id}>
                {merging === item.id ? 'Never mind' : 'Same as…'}
              </button>
            )}
            {item.merged && (
              <button className="unlogrow-split" onClick={() => onSplit(item.id)}>
                Not the same
              </button>
            )}
          </span>
          <button className="unlogrow-no" onClick={() => onDismiss(item.id)} aria-label="not this one">
            <Icon name="X" size={15} />
          </button>

          {merging === item.id && (
            <div className="mergepick">
              <p className="sub">
                Which session on today is this the same activity as? Its heart rate, time
                and distance get added to that one — nothing you have already typed is
                overwritten.
              </p>
              {targetsFor(item).map(e => (
                <button key={e.id} className="mergepick-row" onClick={() => mergeInto(item, e)}>
                  <span className="mergepick-name">
                    {e.data?.name || 'Session'}
                    {!isDone(e) && <em> · not done yet</em>}
                  </span>
                  <span className="mergepick-meta">
                    {e.data?.minutes ? `${e.data.minutes} min` : ''}
                  </span>
                  <Icon name="ChevronDown" size={14} style={{ transform: 'rotate(-90deg)' }} />
                </button>
              ))}
            </div>
          )}
        </div>
        )
      })}

      {/* Waved off, not gone. A dismissal means "not now" — and the only way to
          undo one used to be hand-editing a skip entry, which is not a thing
          anybody does. */}
      {gone.length > 0 && (
        <div className="unlogged-gone">
          <button className="unlogged-goneline" onClick={() => setShowGone(v => !v)}>
            <Icon name={showGone ? 'EyeOff' : 'Eye'} size={13} />
            <span>{gone.length} dismissed today</span>
            <Icon name="ChevronDown" size={13} className={showGone ? 'open' : ''} />
          </button>
          {showGone && gone.map(item => (
            <div key={item.id} className="unlogrow gone">
              <span className="unlogrow-ico"><Icon name={item.activity?.icon || 'Activity'} size={16} /></span>
              <span className="unlogrow-name">
                <strong>{item.activity?.name || item.label}</strong>
                <span className="sub">
                  {[span(item.start, item.end), item.minutes ? `${item.minutes} min` : '']
                    .filter(Boolean).join(' · ')}
                </span>
              </span>
              <button className="unlogrow-split" onClick={() => onRestore(item.id)}>Bring it back</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
