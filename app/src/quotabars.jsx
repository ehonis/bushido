/*
 * The week, as bars.
 *
 * This is what leads Today since 2026-09-17, and it is what replaced the quota
 * BOARD — eleven lanes, each of them an offer, ranked by what the week still
 * owed. The board answered "what should I do", and the answer turned out to be
 * that the app should not have one: a set schedule or recommended workouts do
 * not get followed.
 *
 * So this says where the week stands and stops. Nothing here is pressable into a
 * session, nothing is dismissible, and there is no ranking — a bar is a reading,
 * and a reading that also tries to be a recommendation is how the last version of
 * this screen ended up with three cards arguing about the same day.
 *
 * Three rules it keeps from the board that were right:
 *
 *   - Categories the user ASKED for lead, in the order plan.json declares them. Sorting
 *     by what is outstanding makes the list reorder itself under their thumb every
 *     time the user logs something, which is exactly the wrong behaviour for a thing
 *     you glance at.
 *   - What the user did that nothing asked for still shows, quietly. Three rides in a
 *     week with no bike quota is a real and uninteresting state, and a screen
 *     that hides it is a screen that disagrees with the log.
 *   - Over-quota is shown as over, not clipped at full. A week the user beat is worth
 *     seeing.
 */

import { useMemo, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { progress as quotaProgress, mondayOf, weekDays } from './lib/quota.js'
import { fromIso } from './lib/dates.js'
import { optFor } from './lib/menu.js'
import { sessionStats } from './lib/stats.js'

/*
 * `onOpenEntry(date, entryId)` replaced `onOpenDay(date)` on 2026-09-21.
 *
 * The row's button went nowhere, when it should open the workout and show more
 * about it. Both halves were the same bug. The row called `onOpenDay(e.date)`, which was wired
 * to `setIso` — so pressing a workout from TODAY set the date to today and
 * nothing moved at all, and pressing one from Tuesday landed on Tuesday's day
 * list with the entry somewhere in it, unopened. What the row is FOR is the
 * session it names, so it opens it.
 */
export function QuotaBars({ plan, entries, iso, onSetWeek = null, onOpenEntry = null }) {
  const week = useMemo(() => quotaProgress({ plan, entries, iso }), [plan, entries, iso])
  /*
   * Which bar is open, if any.
   *
   * Tapping a quota opens the workouts already done that filled it.
   *
   * This does NOT undo the rule at the top of this file. A bar that opens onto
   * what the user already did is still a reading — the thing that was removed was a
   * lane that offered them a session to do next. Looking at "6 of 6 bike" and
   * being unable to ask WHICH six is the screen refusing to answer a question
   * about its own number.
   *
   * One at a time: two open panels on a card with eleven rows is a card you
   * scroll rather than read.
   */
  const [open, setOpen] = useState(null)

  const asked = week.categories.filter(c => c.planned > 0)
  // Logged into a category the week never asked for. Kept, quiet, at the bottom.
  const extra = week.categories.filter(c => c.planned === 0 && c.done > 0)

  const left = weekDays(week.monday).filter(d => d >= iso).length
  const owed = week.plannedTotal - week.doneTotal

  if (!week.isSet) {
    return (
      <div className="card quotabars empty">
        <div className="qb-head">
          <h2>This week</h2>
          <span className="qb-count">nothing set</span>
        </div>
        <p className="sub">
          No quotas for the week of {fromIso(week.monday).toLocaleDateString([], { month: 'long', day: 'numeric' })} yet.
          A quota is a count of workouts, not days, and nothing is assigned to a weekday —
          set them on the Week tab and they fill in here as you log.
        </p>
        {extra.length > 0 && (
          <div className="qb-rows">
            {extra.map(c => (
              <Bar key={c.key} cat={c} open={open === c.key} plan={plan}
                onToggle={() => setOpen(open === c.key ? null : c.key)}
                onOpenEntry={onOpenEntry} />
            ))}
          </div>
        )}
        {onSetWeek && (
          <button className="qb-set" onClick={onSetWeek}>
            <Icon name="CalendarDays" size={15} /> <span>Set this week&rsquo;s quotas</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card quotabars">
      <div className="qb-head">
        <h2>This week</h2>
        <span className="qb-count">
          <strong>{week.doneTotal}</strong> of {week.plannedTotal}
        </span>
      </div>

      <p className="qb-sub">
        {owed > 0
          ? <>
              {owed} workout{owed === 1 ? '' : 's'} still asked for, with {left} day{left === 1 ? '' : 's'} left
              in the week.
              {/* What the dotted part of the bars is. Said once here rather than
                  legended on every row. Agreement is on the PLANNED count, not on
                  what is owed — "1 of them are" was keyed off the wrong number. */}
              {week.pendingTotal > 0 && (owed === 1
                ? <> It is already on a day — the dotted part of the bar.</>
                : <> {week.pendingTotal} of them {week.pendingTotal === 1 ? 'is' : 'are'} already
                    on a day — the dotted part of the bars.</>)}
            </>
          : <>Everything this week asked for is done. Anything else is extra, and extra is allowed.</>}
      </p>

      <div className="qb-rows">
        {asked.map(c => (
          <Bar key={c.key} cat={c} open={open === c.key} plan={plan}
            onToggle={() => setOpen(open === c.key ? null : c.key)}
            onOpenEntry={onOpenEntry} />
        ))}
      </div>

      {extra.length > 0 && (
        <>
          <div className="qb-extrahead">Not asked for this week</div>
          <div className="qb-rows">
            {extra.map(c => (
              <Bar key={c.key} cat={c} open={open === c.key} plan={plan}
                onToggle={() => setOpen(open === c.key ? null : c.key)}
                onOpenEntry={onOpenEntry} />
            ))}
          </div>
        </>
      )}

      {onSetWeek && (
        <button className="qb-set" onClick={onSetWeek}>
          <Icon name="CalendarDays" size={15} /> <span>Change what this week asks for</span>
        </button>
      )}
    </div>
  )
}

/**
 * One category: the bar, and what filled it.
 *
 * The bar is `done / planned` clamped at full, with anything past it shown as a
 * separate `+n` rather than a bar that overflows its own track — a 150% bar reads
 * as a rendering bug, and "3/2 +1" reads as a good week. A planned session that is
 * not done yet carries on from the solid fill as a dotted segment.
 *
 * A category with no quota gets no track at all. There is nothing to be a
 * fraction OF, and drawing an empty one implies a target of zero that the user missed.
 *
 * PRESSING IT opens what filled it. A row with nothing on it either side is not
 * pressable — an empty panel is a worse answer than no panel, and "0/1" already
 * says everything there is to say about a quota nothing has touched.
 */
function Bar({ cat, open = false, plan = null, onToggle = null, onOpenEntry = null }) {
  const { planned, done, over, complete, pendingShown } = cat
  const pct = planned > 0 ? Math.min(1, done / planned) : 0
  const soon = planned > 0 ? Math.min(1 - pct, pendingShown / planned) : 0

  const filled = [
    ...(cat.entries || []).map(e => ({ e, done: true })),
    ...(cat.pendingEntries || []).map(e => ({ e, done: false })),
  ].sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)))

  const label = [
    `${done} of ${planned} done`,
    pendingShown > 0 ? `${pendingShown} planned` : null,
  ].filter(Boolean).join(', ')

  const body = (
    <>
      <span className="qb-ico"><Icon name={cat.icon} size={16} /></span>
      <span className="qb-name">{cat.name}</span>
      {planned > 0 ? (
        <span className="qb-track" role="progressbar"
          aria-valuenow={done} aria-valuemax={planned} aria-label={`${cat.name}: ${label}`}>
          <span className="qb-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
          {soon > 0 && <span className="qb-soon" style={{ width: `${Math.round(soon * 100)}%` }} />}
        </span>
      ) : (
        <span className="qb-track ghost" aria-hidden="true" />
      )}
      <span className="qb-n">
        {planned > 0 ? `${done}/${planned}` : `${done}`}
        {over > 0 && <em className="qb-over">+{over}</em>}
        {complete && !over && <Icon name="Check" size={14} className="qb-tick" />}
      </span>
    </>
  )

  const cls = `qb-row ${complete ? 'done' : ''} ${planned === 0 ? 'unasked' : ''}`

  if (!filled.length || !onToggle) {
    return <div className={cls} title={planned > 0 ? label : undefined}>{body}</div>
  }

  return (
    <>
      <button className={`${cls} pressable ${open ? 'open' : ''}`} onClick={onToggle}
        aria-expanded={open} title={label}>
        {body}
        <span className="qb-chev"><Icon name="ChevronDown" size={14} /></span>
      </button>

      {open && (
        <div className="qb-what">
          {filled.map(({ e, done }) => {
            const opt = optFor(plan?.dailyMenu || [], e.data?.optId)
            // Everything the day list would say about it, minus the minutes,
            // which have their own column on this row. "45 min" alone does not
            // tell them which of the day's rides the user is looking at.
            const stats = sessionStats(e, opt).filter(b => !/^\d+ min$/.test(b))
            return (
              <button key={e.id} className={`qb-did ${done ? '' : 'planned'}`}
                onClick={() => onOpenEntry?.(e.date, e.id)}
                disabled={!onOpenEntry}>
                <span className="qb-did-day">{dayLabel(e.date)}</span>
                <span className="qb-did-main">
                  <span className="qb-did-name">
                    {e.data?.name || 'Session'}
                    {opt?.icon && <Icon name={opt.icon} size={12} className="qb-did-ico" />}
                  </span>
                  {stats.length > 0 && <span className="qb-did-stats">{stats.join(' · ')}</span>}
                </span>
                <span className="qb-did-meta">
                  {e.data?.minutes ? `${e.data.minutes} min` : ''}
                  {!done && <em> · planned</em>}
                </span>
                {onOpenEntry && (
                  <Icon name="ChevronDown" size={13} style={{ transform: 'rotate(-90deg)' }} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

/** "Mon 15" — enough to find the day, short enough for a narrow column. */
const dayLabel = (iso) => {
  try {
    return fromIso(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric' })
  } catch { return iso }
}

export { mondayOf }
