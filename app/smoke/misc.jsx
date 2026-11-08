/* Smoke cases: everything else: tabs, the acting banner, toasts, the + menu, Log a workout, content checks.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { ToastList } from '../src/toast.jsx'
import { pushToast, dismissToast, useToasts } from '../src/lib/toast.js'
import { Undo2 } from 'lucide-react'
import { FabMenu, ActingBanner, tabsFor } from '../src/App.jsx'
import { QuickLog } from '../src/quicklog.jsx'
import { ActivityPicker } from '../src/activitypicker.jsx'
import { recentActivities, quickEntry } from '../src/lib/quicklog.js'
import { ActivityChooser, activityGroups, activityFieldOf, climbingRows, climbingShortcut } from '../src/picker.jsx'
import { climbingFolders, folderOf } from '../src/lib/folders.js'
import {
  plan, starter, example, entries, noop, TODAY, back, text, LIFT_FIELD, QUICK_LOG,
} from './fixtures.jsx'

export default [
  /*
   * More than one person (lib/whoami.js). Everyone gets the same three tabs;
   * someone the AI is not set up for gets only "Build it myself". Pinned from
   * both sides, so a regression in either direction is a failure rather than a
   * quiet change.
   */
  ['tabsFor(three tabs, for everyone: Today, Log, Progress)', null, () => {
    for (const [features, owner] of [[{ ai: true }, true], [{ ai: false }, false], [{ ai: true }, false]]) {
      const ids = tabsFor(features, owner).map(t => t.id).join()
      if (ids !== 'today,log,progress') throw new Error(`tabs ${ids} for ${JSON.stringify(features)}, owner ${owner}`)
    }
  }],
  ['ActingBanner(says whose log is open, with the way back)', null, () => {
    const acting = { id: 'sam', name: 'Sam', acting: true, real: { id: 'owner', name: 'Alex', admin: true } }
    const t = text(renderToString(<ActingBanner me={acting} />))
    if (!/Logging for.*Sam/.test(t)) throw new Error('the banner does not name whose log this is')
    if (!/Back to Alex/.test(t)) throw new Error('no way back')
    if (renderToString(<ActingBanner me={{ ...acting, acting: false }} />) !== '') throw new Error('a banner on your own log')
  }],
  /* The toast (toast.jsx + lib/toast.js, mobile's API): "Removed …" with Undo. */
  ['ToastList(removed, with Undo; dismissed by its X)', null, () => {
    let undone = false
    const id = pushToast('Removed Run', 'info', { duration: 0, action: { label: 'Undo', onClick: () => { undone = true } } })
    const Probe = () => <ToastList toasts={useToasts()} />
    const html = renderToString(<Probe />)
    if (!/class="toast t-info"/.test(html) || !/Removed Run/.test(html)) throw new Error('the toast did not render')
    if (!/class="toast-act"[^>]*>.*Undo/.test(html)) throw new Error('no Undo on a removal toast')
    if (!/aria-label="Dismiss"/.test(html)) throw new Error('no way to dismiss it')
    // Repeats of one message join one toast rather than stacking.
    pushToast('Not saved', 'error', { duration: 0 })
    const again = pushToast('Not saved', 'error', { duration: 0 })
    if ((renderToString(<Probe />).match(/Not saved/g) || []).length !== 1) throw new Error('a repeated toast stacked')
    dismissToast(id)
    dismissToast(again)
    if (/Removed Run|Not saved/.test(renderToString(<Probe />))) throw new Error('dismissed, and still showing')
    if (undone) throw new Error('Undo ran without being pressed')
  }],
  /* Undo is a step BACK: its glyph turns back (lucide Undo2), not Retry's arrow forward. */
  ['ToastList(Undo turns back; Retry goes again)', null, () => {
    const html = renderToString(<ToastList toasts={[
      { id: 1, kind: 'info', text: 'Removed Run', count: 1, action: { label: 'Undo', icon: Undo2, onClick: noop } },
      { id: 2, kind: 'error', text: 'Not saved', count: 1, action: { label: 'Retry', onClick: noop } },
    ]} />)
    if (!/lucide-undo-2[\s\S]*?Undo/.test(html)) throw new Error('Undo is not drawn with the undo glyph')
    if (!/lucide-rotate-cw[\s\S]*?Retry/.test(html)) throw new Error('Retry lost its arrow')
    if ((html.match(/lucide-rotate-cw/g) || []).length !== 1) throw new Error('the redo arrow is on Undo too')
  }],
  /* ------------------------------------------- every session is REACHABLE
   *
   * The regression this exists for, in full: taking the swap list off Today on
   * 2026-09-17 left twenty-one climbing cards in plan.json — max hangs, the
   * board, the 4×4s, the load-cell tests — with their protocols, their timers
   * and the logged history all intact, and NOWHERE TO PRESS to put one on a day.
   * Every test passed. The app rendered. It was found within the hour of use.
   *
   * So the contract is not "the picker renders", it is "every startable card in
   * the plan appears in it". A card added to plan.json that this cannot reach is
   * a card that does not exist, and that is a thing a rendering test will never
   * notice on its own.
   */
  ['ActivityChooser(every startable card is in a folder)', null, () => {
    const startable = plan.dailyMenu.filter(m =>
      m.role !== 'adjunct' && m.role !== 'rest' && !m.retired)
    const listed = new Set(climbingFolders(plan)
      .flatMap(f => f.groups.flatMap(g => g.items.map(m => m.id))))
    // The two containers have their own doors (this screen IS the workout card's;
    // the planned card is Plan a workout's), so they are not in a folder.
    const missing = startable
      .filter(m => !listed.has(m.id) && !['plan', 'log'].includes(m.sched?.repeatVia))
      .map(m => m.id)
    if (missing.length) throw new Error(`unreachable: ${missing.join(', ')}`)

    // And nothing that should not be startable leaked in. An adjunct is ticked
    // inside the session it rides with; a retired card is kept only so the days
    // logged against it still resolve.
    const wrong = [...listed].filter(id => {
      const m = plan.dailyMenu.find(x => x.id === id)
      return !m || m.role === 'adjunct' || m.role === 'rest' || m.retired || m.sched?.repeatVia
    })
    if (wrong.length) throw new Error(`should not be startable: ${wrong.join(', ')}`)

    // Two folders on this plan, as asked: every card says which, so nothing falls
    // through to the catch-all.
    const keys = climbingFolders(plan).map(f => f.key)
    if (keys.join() !== 'bouldering,rock-climbing') throw new Error(`folders are ${keys.join(', ')}`)
    // A card that declares nothing still lands somewhere.
    const untagged = { ...plan, dailyMenu: [{ id: 'z', name: 'Zorbing', role: 'session', sched: {} }] }
    if (!climbingFolders(untagged).some(f => f.key === 'plan')) throw new Error('an untagged card vanished')
  }],
  /* The same screen, over the sports catalog: picking a session and logging a
   * workout are the same flow over two different catalogs. */
  ['ActivityChooser(every activity is reachable)', null, () => {
    const field = activityFieldOf(plan)
    if (!field) throw new Error('plan.json has no activity field')
    const listed = activityGroups(field, plan).flatMap(g => g.items.map(i => i.key))
    const missing = field.activities.filter(a => !listed.includes(a.key)).map(a => a.key)
    if (missing.length) throw new Error(`unreachable activities: ${missing.join(', ')}`)

    // An activity whose group the catalog no longer lists still has to land
    // somewhere. Same orphan rule as the sessions, same reason.
    const orphaned = activityGroups(
      { ...field, activities: [{ key: 'z', name: 'Zorbing', group: 'No Such Group' }], groups: field.groups },
      plan)
    if (!orphaned.flatMap(g => g.items).some(i => i.key === 'z')) {
      throw new Error('an activity with an unknown group vanished')
    }
  }],
  ['ActivityChooser(renders: search, Recent, the catalog, Climbing last)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop} onClose={noop}
      entries={QUICK_LOG} />,
    (html) => {
      const t = text(html)
      // The general ways to log lead; the plan's climbing cards follow as two
      // folders under Climbing (issue #31: a workout log first).
      for (const f of ['Bouldering', 'Rock climbing']) {
        if (!t.includes(f)) throw new Error(`no ${f} folder`)
      }
      if (t.indexOf('Recent') > t.indexOf('Bouldering')) throw new Error('the climbing folders lead the general sports')
      if (t.lastIndexOf('Climbing') < t.indexOf('Running')) throw new Error('the Climbing group is not after the activities')
      for (const name of ['Mountain bike', 'Swim', 'Run', 'Lift']) {
        if (!t.includes(name)) throw new Error(`${name} is not in the activity list`)
      }
      // Recent is the quick-log list: what was logged last, newest first.
      const recent = t.slice(t.indexOf('>Recent<'), t.indexOf('>Running<'))
      if (!(recent.indexOf('Rowing') > -1 && recent.indexOf('Rowing') < recent.indexOf('Mountain bike'))) {
        throw new Error('Recent does not lead with the newest logged activity')
      }
      // Each group is a section head over ONE card of rows (docs/DESIGN.md).
      if (!/class="section-head"><h3>Recent<\/h3>/.test(html)) throw new Error('Recent is not a section head')
      if (!/class="card spick-list list"/.test(html) || !/class="list-row spick-row"/.test(html)) {
        throw new Error('the groups are not a card of list rows')
      }
      // Gone, pinned absent: "Your usual" (Recent replaced it), the paragraph under the
      // search, the category echoed on every row, and small capitals as group titles.
      if (/Your usual/.test(t)) throw new Error('"Your usual" is back; Recent replaced it')
      if (/the form arrives the right shape|Something you already did/.test(t)) throw new Error('the paragraph is back')
      if (/91 activities/.test(t)) throw new Error('the header counts the catalog again')
      if (/spick-min|spick-grouphead/.test(html)) throw new Error('the old per-row card or category column is back')
      if (/<span class="list-row-meta">(Run|Bike|Swim|Lift)<\/span>/.test(html)) throw new Error('a row repeats its category')
    }],
  ['ActivityChooser(a fresh log: Recent is the catalog\'s pins)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      const recent = t.slice(t.indexOf('>Recent<'), t.indexOf('>Running<'))
      if (!/Run/.test(recent) || !/Treadmill run/.test(recent) || !/Bike/.test(recent)) {
        throw new Error('a fresh Recent is not the first pinned sports')
      }
    }],
  // The ones the user actually asked after, each in the folder it belongs in.
  // Named rather than counted, because "21 rows rendered" would have passed
  // while showing the wrong 21.
  ...[
    ['bouldering', ['Gym: board', 'Bouldering 4×4s', 'Limit bouldering', 'Bouldering with friends'],
      ['Max hangs', 'ARC laps']],
    ['rock-climbing', ['Max hangs', 'Repeaters', 'Sub-threshold hangs', 'ARC laps', 'Peak force test', 'Crag day'],
      ['Gym: board', 'Mountain bike']],
  ].map(([key, has, hasNot]) => [`ActivityChooser(the ${key} folder, by name)`,
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop}
      onClose={noop} initialFolder={key} />,
    (html) => {
      const t = text(html)
      for (const name of has) if (!t.includes(name)) throw new Error(`${name} is not in ${key}`)
      for (const name of hasNot) if (t.includes(name)) throw new Error(`${name} is in ${key}`)
      // It is a list, not the swap list that came out of this app.
      if (/Good swap|Not today|Works, with a caveat/.test(t)) {
        throw new Error('the picker is ranking sessions again')
      }
    }]),
  // A WHOOP climb is logged on a climbing card, never the catalog: the route from
  // the unlogged card shows the folders and no sport.
  /*
   * A plan written before `sched.discipline` existed (the owner's own is one):
   * no card declares a folder. The climbing cards must still be under Bouldering
   * and Rock climbing, filed by what they say about themselves, and every
   * startable card must still be somewhere (issue #81).
   */
  ['ActivityChooser(an untagged plan still has its climbing folders)', null, () => {
    const untagged = { ...plan, dailyMenu: plan.dailyMenu.map(m => ({ ...m, sched: { ...m.sched, discipline: undefined } })) }
    const keys = climbingFolders(untagged).map(f => f.key)
    if (!keys.includes('bouldering') || !keys.includes('rock-climbing')) throw new Error(`folders are ${keys.join(', ')}`)
    const where = (id) => folderOf(untagged.dailyMenu.find(m => m.id === id), untagged)
    for (const id of ['board', 'four-by-four', 'fun-boulder', 'limit-boulder']) {
      if (where(id) !== 'bouldering') throw new Error(`${id} is in ${where(id)}`)
    }
    for (const id of ['lead-laps', 'fun-sport', 'crag-day', 'max-hangs', 'arc']) {
      if (where(id) !== 'rock-climbing') throw new Error(`${id} is in ${where(id)}`)
    }
    // Not climbing by its own account: the catch-all, never guessed into a sport.
    if (where('core') !== 'plan') throw new Error('a support card was guessed into climbing')
    const startable = untagged.dailyMenu.filter(m => m.role !== 'adjunct' && m.role !== 'rest' && !m.retired && !m.sched?.repeatVia)
    const listed = new Set(climbingFolders(untagged).flatMap(f => f.groups.flatMap(g => g.items.map(m => m.id))))
    const missing = startable.filter(m => !listed.has(m.id)).map(m => m.id)
    if (missing.length) throw new Error(`unreachable: ${missing.join(', ')}`)
    // A declared folder always wins over what the card looks like.
    const declared = { ...plan.dailyMenu.find(m => m.id === 'board'), sched: { discipline: 'rock-climbing' } }
    if (folderOf(declared, plan) !== 'rock-climbing') throw new Error('a declared folder was second-guessed')
  }],
  // The Climbing door near the top: one row right after Recent, before the
  // catalog; the Climbing group itself still follows the sports (§10.8).
  ['ActivityChooser(a Climbing door right under Recent)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop} onClose={noop}
      entries={QUICK_LOG} />,
    (html) => {
      const t = text(html)
      const door = t.indexOf('Bouldering · Rock climbing')
      if (door < 0) throw new Error('no Climbing door')
      if (door < t.indexOf('Recent')) throw new Error('the Climbing door is above Recent')
      const firstGroup = activityGroups(activityFieldOf(plan), plan, QUICK_LOG).find(g => g.key !== '_recent').name
      if (door > t.indexOf(firstGroup)) throw new Error(`the Climbing door is below ${firstGroup}`)
      if (t.lastIndexOf('Climbing') < t.indexOf('Running')) throw new Error('the Climbing group is not after the activities')
    }],
  ['ActivityChooser(the Climbing door is absent on a plan with no climbing)', null, () => {
    if (climbingShortcut(example)) throw new Error('a Climbing door on the example plan')
    const t = text(renderToString(<ActivityChooser plan={example} field={activityFieldOf(example)} onPick={noop}
      onPickCard={noop} onClose={noop} entries={QUICK_LOG} />))
    if (t.includes('Bouldering · Rock climbing')) throw new Error('a Climbing door on the example plan')
  }],
  // Behind the door: every climbing card on one screen, by folder, each saying
  // its category, and found by the words a climber would type.
  ['ActivityChooser(Climbing: every climbing card, by folder)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop} onClose={noop}
      initialFolder="_climbing" />,
    (html) => {
      const t = text(html)
      if (!t.includes('Gym: board') || !t.includes('Doubled lead laps')) throw new Error('a climbing card is missing')
      if (t.indexOf('Bouldering') > t.indexOf('Rock climbing')) throw new Error('folders out of order')
      if (t.includes('Mountain bike')) throw new Error('a catalog sport behind the Climbing door')
      const rows = climbingRows(plan).flatMap(g => g.items)
      const board = rows.find(r => r.key === 'card:board')
      if (!/boulder/.test(board.search)) throw new Error('"boulder" does not find the board')
      if (!/route/.test(rows.find(r => r.key === 'card:lead-laps').search)) throw new Error('"route" does not find the lead laps')
      const listed = new Set(rows.map(r => r.key))
      for (const f of climbingFolders(plan).filter(x => x.key !== 'plan')) {
        for (const m of f.groups.flatMap(g => g.items)) if (!listed.has(`card:${m.id}`)) throw new Error(`${m.id} is not behind the door`)
      }
    }],
  ['ActivityChooser(a climb offers only the climbing cards)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop}
      onClose={noop} climbingOnly dayLabel="for Mon, Oct 12" />,
    (html) => {
      const t = text(html)
      if (!/Log the climb/.test(t) || !/Bouldering/.test(t)) throw new Error('no climbing folders')
      if (/Your usual|Recent|Mountain bike/.test(t)) throw new Error('a climb can be logged as a generic workout')
      if (!/for Mon, Oct 12/.test(t)) throw new Error('the day it lands on is not said')
    }],
  ['plan.json(every exercise knows what it works)', null, () => {
    const missing = LIFT_FIELD.exercises.filter(e => !e.muscles?.primary?.length).map(e => e.key)
    if (missing.length) throw new Error(`${missing.length} exercises have no muscles: ${missing.slice(0, 5).join(', ')}`)
    // And every muscle named is one the drawing actually has a region for.
    const KNOWN = new Set(['trapezius', 'upper-back', 'lower-back', 'chest', 'biceps', 'triceps',
      'forearm', 'back-deltoids', 'front-deltoids', 'abs', 'obliques', 'adductor', 'abductors',
      'hamstring', 'quadriceps', 'calves', 'gluteal', 'head', 'neck', 'knees'])
    const bad = new Set()
    for (const e of LIFT_FIELD.exercises) {
      for (const m of [...(e.muscles.primary || []), ...(e.muscles.secondary || [])]) {
        if (!KNOWN.has(m)) bad.add(`${e.key}:${m}`)
      }
    }
    if (bad.size) throw new Error(`muscles the body cannot draw: ${[...bad].slice(0, 5).join(', ')}`)
  }],
  /*
   * "And another one" for a CONTAINER card goes to the screen that asks the
   * question, not to a blank entry of that card.
   *
   * The "Plan another workout" button has to do what the other plan button does.
   * It did not — it minted an empty planned
   * session with no prescription and opened the sheet on it. The contract is a
   * declaration in plan.json, so this checks the declaration rather than trying
   * to simulate a click: a container that loses it silently goes back to minting
   * blanks.
   */
  ['plan.json(container cards route their repeat to a screen)', null, () => {
    for (const [id, via] of [['planned', 'plan'], ['log-workout', 'log']]) {
      const card = plan.dailyMenu.find(m => m.id === id)
      if (!card) throw new Error(`no ${id} card`)
      if (!card.sched?.repeatable) throw new Error(`${id} is not repeatable any more`)
      if (card.sched.repeatVia !== via) {
        throw new Error(`${id} should repeat via "${via}", got "${card.sched.repeatVia}"`)
      }
    }
    // And nothing that IS a session in its own right claims to need a screen —
    // a second hip block really is a second entry of the hip block.
    const wrong = plan.dailyMenu
      .filter(m => m.sched?.repeatVia && !['planned', 'log-workout'].includes(m.id))
      .map(m => m.id)
    if (wrong.length) throw new Error(`not container cards: ${wrong.join(', ')}`)
  }],
  // The rest day is a door of its own: as a footer link under the old session
  // picker it was technically reachable and the user could not find it. "Pick a
  // session" went on 2026-10-14: its cards are folders inside Log a workout.
  // "Plan the week" went with the quotas on 2026-10-25 (issue #31).
  ['FabMenu(four doors: log, rest, plan, the timer last; no week planner, no session picker)',
    <FabMenu onClose={noop} onPlan={noop} onLog={noop} onPlanWeek={noop} onRest={noop} onTimer={noop} />,
    (html) => {
      const t = text(html)
      const doors = ['Log a workout', 'Log a rest day', 'Plan a workout', 'Interval timer']
      for (const door of doors) {
        if (!t.includes(door)) throw new Error(`no "${door}" door`)
      }
      // Logging doors, then planning, then tools (docs/DESIGN.md, "The + menu, final shape").
      const at = doors.map(d => t.indexOf(d))
      if (at.some((x, i) => i && x < at[i - 1])) throw new Error(`the doors are out of order: ${doors.join(' < ')}`)
      if (/Plan the week/.test(t)) throw new Error('the week planner is back on the +')
      if (/Pick a session/.test(t)) throw new Error('the separate session door is back')
      // The common case leads (docs/DESIGN.md D7).
      if (t.indexOf('Log a workout') > t.indexOf('Plan a workout')) throw new Error('Log a workout is not the first door')
      if (/quota|Move Every Day/i.test(t)) throw new Error('the + still talks about quotas or a habit name')
    }],
  // With AI off the Plan door says only what is behind it (#55), as Plan a workout does.
  ['FabMenu(AI off: the Plan door does not mention the model)', null, () => {
    const off = text(renderToString(<FabMenu onClose={noop} onPlan={noop} onLog={noop} onRest={noop} ai={false} />))
    if (!/Build it yourself/.test(off) || /written for you|Sparkles/.test(off)) throw new Error('the Plan door offers the model with AI off')
    const on = text(renderToString(<FabMenu onClose={noop} onPlan={noop} onLog={noop} onRest={noop} ai />))
    if (!/have it written for you/.test(on)) throw new Error('the Plan door lost the model with AI on')
  }],
  /*
   * LOGGING IN TWO TAPS (quicklog.jsx, docs/DESIGN.md). + → Run: up to three recent
   * activities right under Log a workout, before every other door, each one tap that
   * places the workout and opens its sheet.
   */
  ['FabMenu(the quick-log rows sit under Log a workout, before the rest day)',
    <FabMenu onClose={noop} onPlan={noop} onLog={noop} onRest={noop} onTimer={noop}
      quick={<QuickLog plan={plan} entries={QUICK_LOG} upsertEntry={noop} onPlaced={noop} />} />,
    (html) => {
      const t = text(html)
      const order = ['Log a workout', 'Rowing', 'Run', 'Mountain bike', 'Log a rest day', 'Plan a workout', 'Interval timer']
      const at = order.map(d => t.indexOf(`>${d}<`))
      if (at.some(x => x < 0)) throw new Error(`missing: ${order.filter((d, i) => at[i] < 0).join(', ')}`)
      if (at.some((x, i) => i && x < at[i - 1])) throw new Error(`out of order: ${order.join(' < ')}`)
      if ((html.match(/class="list-row quicklog-row"/g) || []).length !== 3) throw new Error('not three quick rows')
      if (!/aria-label="Log Rowing"/.test(html)) throw new Error('a quick row does not say what it does')
    }],
  ['QuickLog(the newest distinct activities, then the pins; never tomorrow, never a climb)', null, () => {
    const field = activityFieldOf(plan)
    const keys = (es) => recentActivities(es, field, { today: TODAY }).map(a => a.key).join()
    if (keys([]) !== 'run,treadmill-run,bike') throw new Error(`a fresh log offers ${keys([])}`)
    if (keys(QUICK_LOG) !== 'rowing,run,mtb') throw new Error(`the log offers ${keys(QUICK_LOG)}`)
    const tomorrow = [{ id: 'f', kind: 'daily', date: '2999-01-01', data: { optId: 'log-workout', out: { activity: 'swim' } } }]
    if (keys(tomorrow).startsWith('swim')) throw new Error('a planned future workout counts as recent')
    const climbOnly = [{ id: 'c', kind: 'daily', date: TODAY, data: { optId: 'max-hangs', out: { hardFingers: true } } }]
    if (keys(climbOnly) !== 'run,treadmill-run,bike') throw new Error('a climbing card leaked into the quick rows')
    const gone = [{ id: 'g', kind: 'daily', date: TODAY, deleted: true, data: { optId: 'log-workout', out: { activity: 'swim' } } }]
    if (keys(gone).startsWith('swim')) throw new Error('a deleted workout counts as recent')
  }],
  ['QuickLog(one tap writes the workout card on the day, done, and hands back its id)', null, () => {
    const menu = plan.dailyMenu
    const e = quickEntry({ menu, entries: [], activity: 'run', date: '2026-10-20', today: '2026-10-25' })
    if (e.id !== 'daily-2026-10-20' || e.data.optId !== 'log-workout' || e.data.out.activity !== 'run') {
      throw new Error(`wrote ${JSON.stringify({ id: e.id, optId: e.data.optId, out: e.data.out })}`)
    }
    if (e.data.done !== true) throw new Error('a workout logged on a day that has arrived is not done (AGENTS.md §4)')
    // A second on the same day is an extra, with the id Log a workout would mint.
    const two = quickEntry({ menu, entries: [e], activity: 'bike', date: '2026-10-20', today: '2026-10-25' })
    if (two.id === e.id || two.data.slot !== 'extra') throw new Error('a second quick log overwrote the first')
    // Never tomorrow: you cannot have done it yet.
    const later = quickEntry({ menu, entries: [], activity: 'run', date: '2026-10-30', today: '2026-10-25' })
    if (later.date !== '2026-10-25') throw new Error('a quick log landed on a future day')
    // The component writes exactly that, and reports the id it wrote.
    let wrote = null
    let opened = null
    const html = renderToString(<QuickLog plan={plan} entries={[]} upsertEntry={(x) => { wrote = x }}
      onPlaced={(id) => { opened = id }} />)
    if (!/aria-label="Log Run"/.test(html)) throw new Error('no Run row on a fresh log')
    if (wrote || opened) throw new Error('rendering wrote something')
    if (renderToString(<QuickLog plan={{ ...plan, dailyMenu: plan.dailyMenu.filter(m => m.id !== 'log-workout') }}
      entries={[]} upsertEntry={noop} />) !== '') throw new Error('quick rows with no workout card to place')
  }],
  /*
   * The form's activity question (activitypicker.jsx). Picked, it is one row that
   * opens the picker again, with the word on it; the underlined "Change" link in a
   * box went (docs/DESIGN.md, session sheet). Unpicked, the pins are answer chips,
   * and nothing on it talks about plan.json.
   */
  ['ActivityPicker(picked: a row that opens the picker; unpicked: pins as answer chips)', null, () => {
    const field = activityFieldOf(plan)
    const picked = renderToString(<ActivityPicker field={field} value="run" onChange={noop} />)
    if (!/<button type="button" class="list-row actpick picked"/.test(picked)) throw new Error('the picked activity is not a row you can tap')
    if (!/>Change</.test(picked) || /actpick-change/.test(picked)) throw new Error('"Change" is not on the row, or the old link is back')
    // The row says its name once (#55): "Run" over "Activity", not over "Running".
    if (/>Running</.test(picked) || !/>Activity</.test(text(picked))) throw new Error('the picked row echoes its group instead of saying what it is')
    const open = renderToString(<ActivityPicker field={field} value={null} onChange={noop} />)
    if ((open.match(/class="out-chip /g) || []).length !== field.activities.filter(a => a.pinned).length) {
      throw new Error('the pinned sports are not answer chips')
    }
    if (/to choose from|plan\.json/.test(open)) throw new Error('the picker talks about its catalog again')
  }],
  ['starter: QuickLog offers the starter\'s pinned sports', <QuickLog plan={starter} entries={[]} upsertEntry={noop} />,
    (html) => { if ((html.match(/quicklog-row/g) || []).length !== 3) throw new Error('a fresh install has no quick rows') }],
  /*
   * The interval timer (timer.jsx, issue #32). It used to exist only inside
   * workout mode, which only the climbing cards with a declared timer reach.
   * Now any workout's sheet has the door, and the + menu has one of its own.
   */
  ['FabMenu(an interval timer door)', null, () => {
    const t = text(renderToString(<FabMenu onClose={noop} onPlan={noop} onLog={noop} onRest={noop} onPlanWeek={noop} onTimer={noop} />))
    if (!t.includes('Interval timer')) throw new Error('no timer in the + menu')
    if (text(renderToString(<FabMenu onClose={noop} onPlan={noop} onLog={noop} />)).includes('Interval timer')) {
      throw new Error('a timer door with nothing behind it')
    }
  }],
  ['starter: ActivityChooser', <ActivityChooser plan={starter} field={activityFieldOf(starter)} onPick={noop} onClose={noop} />,
    (html) => { if (!/Run/.test(text(html))) throw new Error('the activity catalog is missing from the starter') }],
  // The example has no climbing, so its cards sit in "From the plan", not under a sport they are not.
  ['example: ActivityChooser, From the plan', <ActivityChooser plan={example} field={activityFieldOf(example)}
    onPick={noop} onPickCard={noop} onClose={noop} initialFolder="plan" />,
    (html) => { if (!text(html).includes('Long run')) throw new Error('the example sessions are not offered') }],
]
