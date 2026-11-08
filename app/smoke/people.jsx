/* Smoke cases: more than one person: shared workouts, sides, "Sam's day", For.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { TodayTab } from '../src/tabs.jsx'
import { SessionSheet } from '../src/sheet.jsx'
import { PrescriptionEditor } from '../src/editor.jsx'
import { PlanFlow, KeptStep, BuildStep } from '../src/planner.jsx'
import { WorkoutRunner } from '../src/runner.jsx'
import { _setMe } from '../src/lib/whoami.js'
import { normalizePrescription } from '../src/lib/prescription.js'
import { LogTab } from '../src/log.jsx'
import { TheirSide, SharePanel, PersonSwitch, SharedNote, copyReady } from '../src/sharedwith.jsx'
import { sharedCopy } from '../src/lib/shared.js'
import {
  SidesWorkout, PeopleDays, PersonDay, MyAbout, ForChoice, ForLine, SideSwitch, DayHead, PersonDayRow, PersonEntryView,
} from '../src/trainer.jsx'
import { planPeople, FOR_ME, forWords } from '../src/lib/trainer.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import { hasWorkout, buildSteps } from '../src/lib/workout.js'
import {
  plan, entries, noop, TODAY, back, rich, text, LIFT_FIELD, PRESCRIPTION, PLANNED_CARD,
  PLANNED_ENTRY, HELD_PLAN,
} from './fixtures.jsx'

export default [
  /*
   * SHARED WORKOUTS (sharedwith.jsx). "With …" is the owner's, on the owner's own
   * log, with someone else on the install. Its absences are pinned because an
   * absence still renders: a control that leaked into someone else's log, or
   * into an act-as session, would pass every presence test.
   */
  ...(() => {
    const people = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
    const ownerMe = { id: 'owner', acting: false, owner: true, real: { id: 'owner', name: 'Alex', admin: true }, people }
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Ride', minutes: 45, done: false,
        out: { activity: 'bike', distance: 21, rpe: 7 } } }
    const sharedEntry = { ...entry, data: { ...entry.data, sharedWith: [{ id: 'sam', entryId: entry.id }] } }
    const syncedEntry = { ...entry, data: { ...entry.data, sharedWith: [{ id: 'sam', entryId: entry.id, sync: true }] } }
    const sheet = (me, e = entry) => renderToString(
      <SessionSheet opt={opt} entry={e} tone="rec" entries={rich} isFuture={false} me={me}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onSaveEntry={noop} />)
    return [
      ['SessionSheet(no "With …" with one person, while acting as someone, or for anyone but the owner)', null, () => {
        if (/withrow|share-chip|Add Sam to this workout/.test(sheet({ ...ownerMe, people: [people[0]] }))) throw new Error('"With …" on a one-person install')
        if (/withrow|share-chip|to this workout/.test(sheet({ ...ownerMe, id: 'sam', acting: true }))) throw new Error('"With …" while acting as someone')
        if (/withrow|share-chip|to this workout/.test(sheet({ id: 'sam', acting: false, owner: false, real: { id: 'sam', name: 'Sam', admin: false }, people: [] }))) throw new Error('"With …" for someone who is not the owner')
      }],
      /*
       * #80: who is on a workout is ONE chip under the title, beside the done chip,
       * and everything that changes it is in the panel it opens. Pinned from both
       * sides: the chip in the header, no "With" section or sync card in the body.
       */
      ['SessionSheet(the sharing chip is under the title: "Add someone" for the owner when someone else is on the install)', null, () => {
        const html = sheet(ownerMe)
        const status = html.slice(html.indexOf('class="modal-status"'), html.indexOf('class="modal-body'))
        if (!/class="share-chip"[^>]*aria-label="Add someone to this workout"/.test(status)) throw new Error('no "Add someone" chip under the title')
        if (/class="withrow"|<h3>With<\/h3>/.test(html)) throw new Error('the old "With" section is back in the sheet')
        const panel = renderToString(<SharePanel entry={entry} on={[]} people={[people[1]]} onAdd={noop} onRemove={noop} onSync={noop} onClose={noop} />)
        if (!/aria-label="Add Sam to this workout"/.test(panel)) throw new Error('the panel has no way to add Sam')
        if (/Add Alex/.test(panel)) throw new Error('the owner was offered as someone to add')
      }],
      ['SessionSheet(on a shared workout the chip says who and whether in sync, in the header, before the person bar)', null, () => {
        const html = sheet(ownerMe, syncedEntry)
        const chip = html.indexOf('class="share-chip on"')
        if (chip < 0 || chip > html.indexOf('class="modal-body')) throw new Error('the sharing chip is not in the header')
        if (!/with Sam<span class="share-chip-sync"> · in sync<\/span>/.test(html)) throw new Error('the chip does not say "with Sam · in sync"')
        if (!/ · not in sync/.test(sheet(ownerMe, sharedEntry))) throw new Error('an older share does not say it is not in sync')
        // The done chip and the sharing chip share one row under the title.
        if (!/class="sheet-status"><button type="button" class="done-chip/.test(html)) throw new Error('the done chip is not first under the title')
      }],
      ['SessionSheet(the person switcher only on a shared entry)', null, () => {
        if (/personbar/.test(sheet(ownerMe))) throw new Error('a switcher on a workout nobody shares')
        const html = sheet(ownerMe, sharedEntry)
        if (!/personbar/.test(html)) throw new Error('no switcher on a shared workout')
        const t = text(html)
        if (!/You/.test(t) || !/Sam/.test(t)) throw new Error('the switcher does not name both logs')
        // Taking someone off moved into the panel (#80): never a × beside the workout.
        if (/Take Sam off/.test(html)) throw new Error('taking Sam off is back on the sheet itself')
        const panel = renderToString(<SharePanel entry={sharedEntry} on={[{ ...people[1], tone: 1 }]} people={[people[1]]} onAdd={noop} onRemove={noop} onSync={noop} onClose={noop} />)
        if (!/Take Sam off this workout/.test(text(panel))) throw new Error('no way to take Sam off')
        // And never for anyone else, even on an entry that names someone.
        if (/personbar|share-chip/.test(sheet({ ...ownerMe, id: 'sam', acting: true }, sharedEntry))) throw new Error('a switcher or sharing chip while acting as someone')
      }],
      ['SessionSheet(whose side it is stays pinned at the top: each person\'s initial and name, first thing in the sheet)', null, () => {
        const html = sheet(ownerMe, syncedEntry)
        const bar = html.indexOf('class="personbar"')
        if (bar < 0) throw new Error('no person bar')
        const first = ['withrow', 'synctoggle', 'sess', 'logform'].map(c => html.indexOf(`class="${c}`)).filter(i => i >= 0)
        if (first.some(i => i < bar)) throw new Error('something sits above the person bar')
        const btns = [...html.matchAll(/class="personbar-btn( on)?"[^>]*><span class="avatar"[^>]*>(.)<\/span><span class="personbar-name">([^<]*)</g)]
          .map(m => [Boolean(m[1]), m[2], m[3]])
        if (JSON.stringify(btns) !== JSON.stringify([[true, 'Y', 'You'], [false, 'S', 'Sam']])) throw new Error(`the bar reads ${JSON.stringify(btns)}`)
        // Pinned by CSS: the sheet body scrolls, and the bar sticks to its top.
        const css = readFileSync(new URL('../src/css/people.css', import.meta.url), 'utf8')
        const rule = (css.match(/\.personbar \{[^}]*\}/) || [''])[0]
        if (!/position: sticky/.test(rule) || !/top: -16px/.test(rule)) throw new Error(`the person bar is not pinned: ${rule}`)
      }],
      ['SessionSheet(reopens on the side last viewed on this device, while that person is still on it)', null, () => {
        const saved = {}
        const prev = globalThis.localStorage
        globalThis.localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v } }
        try {
          const onSide = (html) => (html.match(/class="personbar-btn on"[^>]*>.*?<span class="personbar-name">([^<]*)</) || [])[1]
          if (onSide(sheet(ownerMe, syncedEntry)) !== 'You') throw new Error('a sheet never opened before is not on your side')
          saved['bushido:shared-side'] = JSON.stringify({ [entry.id]: 'sam' })
          const html = sheet(ownerMe, syncedEntry)
          if (onSide(html) !== 'Sam') throw new Error('did not reopen on Sam\'s side')
          const words = text(html).replace(/<[^>]+>/g, ' ')
          if (!/Opening Sam.s log/.test(words) || /not in Sam/.test(words)) throw new Error(`reopened on Sam's tab but showed your form: ${words.slice(0, 400)}`)
          saved['bushido:shared-side'] = JSON.stringify({ [entry.id]: 'robin' })
          if (onSide(sheet(ownerMe, syncedEntry)) !== 'You') throw new Error('reopened on someone no longer on the workout')
        } finally { globalThis.localStorage = prev }
      }],
      ['SharePanel(one plain switch per person: "Keep exercises in step", on when added, off on an older share; none on the sheet)', null, () => {
        const panel = (e) => renderToString(<SharePanel entry={e} on={[{ ...people[1], tone: 1 }]} people={[people[1]]} onAdd={noop} onRemove={noop} onSync={noop} onCopy={noop} onClose={noop} />)
        const on = panel(syncedEntry)
        const toggles = [...on.matchAll(/class="synctoggle"/g)].length
        if (toggles !== 1) throw new Error(`${toggles} sync switches`)
        if (!/Keep exercises in step/.test(text(on))) throw new Error('the switch does not say what it does')
        if (!/Numbers stay each person.s own/.test(text(on))) throw new Error('the switch does not say that numbers stay each person\'s own')
        if (!/role="switch"[^>]*checked=""/.test(on)) throw new Error('sync is off on a workout someone was just added to')
        if (/role="switch"[^>]*checked=""/.test(panel(sharedEntry))) throw new Error('an older share reads as synced')
        // The sync card above the workout is gone (#80): pinned absent from the sheet.
        if (/synctoggle|Sync exercises with/.test(sheet(ownerMe, syncedEntry))) throw new Error('the sync card is back above the workout')
      }],
      ['SessionSheet(the header counts follow the side on screen, never the owner\'s over Sam\'s)', null, () => {
        const plannedOpt = plan.dailyMenu.find(m => m.id === 'planned')
        const pres = { title: 'Pull', blocks: [{ id: 'b0', name: 'Pull', items: [
          { id: 'b0i0', kind: 'lift', name: 'Row', sets: [{ id: 'b0i0s0', reps: 10, weight: 90 }] },
          { id: 'b0i1', kind: 'lift', name: 'Curl', sets: [{ id: 'b0i1s0', reps: 10, weight: 30 }] }] }] }
        const mine = { ...syncedEntry, data: { ...syncedEntry.data, optId: 'planned', plan: pres, out: {} } }
        const draw = () => renderToString(<PlanProvider plan={plan}><SessionSheet opt={plannedOpt} entry={mine} tone="rec" entries={[]} isFuture={false} me={ownerMe}
          onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onSaveEntry={noop} /></PlanProvider>)
        const head = (html) => text(html.slice(html.indexOf('class="modal-sub'), html.indexOf('class="modal-status')))
        if (!/2 exercises/.test(head(draw()))) throw new Error(`your side does not count your exercises: ${head(draw())}`)
        // One fact, so the line fits beside three header buttons at 390px; the block head says the sets.
        if (/sets/.test(head(draw()))) throw new Error(`the header carries the whole plan line again: ${head(draw())}`)
        const prev = globalThis.localStorage
        const saved = { 'bushido:shared-side': JSON.stringify({ [entry.id]: 'sam' }) }
        globalThis.localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v } }
        try {
          if (/exercises|sets/.test(head(draw()))) throw new Error(`Sam's side shows the owner's counts: ${head(draw())}`)
        } finally { globalThis.localStorage = prev }
      }],
      ['SessionSheet("Ask the model" only while the model is on offer (#55, #80))', null, () => {
        const plannedOpt = plan.dailyMenu.find(m => m.id === 'planned')
        // A day still to come is planning, where the panel sits on the sheet (#79 puts it
        // behind the pencil while doing); with the AI off it is nowhere, either way.
        const mine = (date) => ({ ...entry, id: `daily-${date}`, date, data: { ...entry.data, optId: 'planned', plan: PRESCRIPTION, out: {} } })
        const draw = (features, date = '2999-01-01') => text(renderToString(<PlanProvider plan={plan}><SessionSheet opt={plannedOpt} entry={mine(date)} tone="rec" entries={[]}
          isFuture={date > TODAY} me={{ ...ownerMe, features }} onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onSaveEntry={noop} /></PlanProvider>))
        for (const date of ['2999-01-01', TODAY]) {
          if (/plantalk|Ask the model|Why this session/.test(draw({ ai: false }, date))) throw new Error(`the model panel with the AI off (${date})`)
        }
        if (!/Why this session/.test(draw({ ai: true }))) throw new Error('no model panel with the AI on')
      }],
      ['copyReady(Copy my exercises waits for THEIR copy: never the last side\'s, never another person\'s with the same entry id)', null, () => {
        const sam = { id: 'sam', name: 'Sam', entryId: 'daily-x' }
        const jo = { id: 'jo', name: 'Jo', entryId: 'daily-x' }
        const copy = { id: 'daily-x', data: {} }
        if (!copyReady(sam, 'sam', { entry: copy, loading: false, of: 'sam\ndaily-x' })) throw new Error('Sam\'s own copy, read, is not ready')
        if (copyReady(sam, 'sam', { entry: copy, loading: false, of: 'jo\ndaily-x' })) throw new Error('Jo\'s copy under the same id was taken for Sam\'s')
        if (copyReady(sam, 'sam', { entry: copy, loading: true, of: null })) throw new Error('ready while Sam\'s copy is still being read')
        if (copyReady(jo, 'sam', { entry: copy, loading: false, of: 'sam\ndaily-x' })) throw new Error('ready for Jo on Sam\'s side')
      }],
      ['PersonSwitch(each side shows its own done state, with words, not colour alone)', null, () => {
        const html = renderToString(<PersonSwitch on={[{ ...people[1], tone: 1 }]} side={null} onSide={noop} done={{ '': false, sam: true }} />)
        if (!/aria-label="Sam: done"/.test(html) || !/aria-label="You: not done"/.test(html)) throw new Error('the tabs do not say each side\'s done state')
        const sam = html.slice(html.indexOf('aria-label="Sam: done"'))
        if (!/personbar-done/.test(sam.slice(0, sam.indexOf('</button>')))) throw new Error('no tick on Sam\'s tab')
        const you = html.slice(html.indexOf('aria-label="You: not done"'))
        if (/personbar-done/.test(you.slice(0, you.indexOf('</button>')))) throw new Error('a tick on a side that is not done')
        if (/aria-label="Sam/.test(renderToString(<PersonSwitch on={[{ ...people[1], tone: 1 }]} side={null} onSide={noop} />))) {
          throw new Error('a done state claimed with nothing read')
        }
      }],
      ['SessionSheet(a shared copy in someone else\'s own log says who it was with)', null, () => {
        const hers = { ...entry, data: { ...entry.data, sharedFrom: { id: 'owner', name: 'Alex' } } }
        const t = text(sheet({ id: 'sam', owner: false, acting: false, real: { id: 'sam', name: 'Sam', admin: false }, people: [] }, hers))
        if (!/with Alex/.test(t)) throw new Error('nothing says who it was done with')
      }],
      ['TheirSide(the owner\'s numbers are placeholders, never values)', null, () => {
        const copy = { ...entry, data: { ...entry.data, out: { activity: 'bike' }, sharedFrom: { id: 'owner', name: 'Alex' } } }
        const html = renderToString(<PlanProvider plan={plan}>
          <TheirSide session={opt} copy={copy} person={people[1]} ownerOut={entry.data.out} onSave={noop} />
        </PlanProvider>)
        if (!/placeholder="21"/.test(html)) throw new Error('the owner\'s distance is not the placeholder')
        if (/value="21"/.test(html)) throw new Error('the owner\'s distance was copied in as a value')
        if (!/you: 7/.test(text(html))) throw new Error('the owner\'s effort is not shown beside Sam\'s')
        if (!/goes in Sam.s log/.test(text(html))) throw new Error('nothing says whose log this is')
      }],
      ['TheirSide(a planned workout shows their plan: the owner\'s exercises, their own weights)', null, () => {
        const plannedOpt = plan.dailyMenu.find(m => m.id === 'planned')
        const pres = { title: 'Legs', blocks: [{ id: 'b0', items: [{ id: 'b0i0', kind: 'lift', name: 'Goblet squat',
          sets: [{ id: 'b0i0s0', reps: 10, weight: 55 }] }] }] }
        const mine = { ...entry, data: { ...entry.data, optId: 'planned', plan: pres, out: {} } }
        const copy = sharedCopy(mine, { session: plannedOpt, owner: { id: 'owner', name: 'Alex' } })
        const html = renderToString(<PlanProvider plan={plan}>
          <TheirSide session={plannedOpt} copy={copy} person={people[1]} ownerOut={mine.data.out} onSave={noop}
            plan={<PrescriptionEditor pres={copy.data.plan} liftField={liftFieldOf(plan)} onChange={noop} compact />} />
        </PlanProvider>)
        if (!/Goblet squat/.test(text(html))) throw new Error('the owner\'s exercise is not on their side')
        if (/value="55"/.test(html)) throw new Error('the owner\'s weight is in their plan')
        if (/Copy my exercises/.test(text(html))) throw new Error('a copy button with nothing to copy')
      }],
      ['SharePanel(copying your exercises over is in the panel, with sync off only; never under their log)', null, () => {
        const plannedOpt = plan.dailyMenu.find(m => m.id === 'planned')
        const pres = { title: 'Legs', blocks: [{ id: 'b0', items: [{ id: 'b0i0', kind: 'lift', name: 'Goblet squat', sets: [{ id: 'b0i0s0', reps: 10, weight: 55 }] }] }] }
        const mine = (sync) => ({ ...entry, data: { ...entry.data, optId: 'planned', plan: pres, out: {}, sharedWith: [{ id: 'sam', entryId: entry.id, ...(sync ? { sync: true } : {}) }] } })
        const panel = (e) => text(renderToString(<SharePanel entry={e} on={[{ ...people[1], tone: 1 }]} people={[people[1]]} onAdd={noop} onRemove={noop} onSync={noop} onCopy={noop} onClose={noop} />))
        if (!/Copy my exercises to Sam/.test(panel(mine(false)))) throw new Error('no way to copy your exercises over with sync off')
        if (/Copy my exercises/.test(panel(mine(true)))) throw new Error('a copy button while sync is on: the exercises are already the same')
        const bare = { ...mine(false), data: { ...mine(false).data, plan: { title: 'Legs', blocks: [] } } }
        if (/your exercises/i.test(panel(bare))) throw new Error('a workout with no exercises talks about copying them')
        const theirs = text(renderToString(<PlanProvider plan={plan}>
          <TheirSide session={plannedOpt} copy={sharedCopy(mine(false), { owner: { id: 'owner', name: 'Alex' } })} person={people[1]} ownerOut={{}} onSave={noop} />
        </PlanProvider>))
        if (/Copy my exercises|has all your exercises/.test(theirs)) throw new Error('the copy button is back under their log')
      }],
      ['TheirSide(each exercise shows THEIR last time, from their log, never yours)', null, () => {
        const lf = liftFieldOf(plan)
        const ex = lf.exercises[0]
        const plannedOpt = plan.dailyMenu.find(m => m.id === 'planned')
        const pres = { title: 'Legs', blocks: [{ id: 'b0', name: 'Main', items: [{ id: 'b0i0', uid: 'x1', kind: 'lift', name: ex.name, exercise: ex.key,
          sets: [{ id: 'b0i0s0', reps: 10, weight: 55 }] }] }] }
        const mine = { ...entry, data: { ...entry.data, optId: 'planned', plan: pres, out: {} } }
        const copy = sharedCopy(mine, { session: plannedOpt, owner: { id: 'owner', name: 'Alex' } })
        // Earlier goes at the same planned workout (lib/history.js matches a plan by its title or exercises).
        const lifted = (date, weight) => ({ id: `daily-${date}`, kind: 'daily', date, data: { optId: 'planned', done: true, plan: { title: 'Legs', blocks: [] },
          out: { lifts: [{ uid: `${ex.key}-1`, key: ex.key, name: ex.name, sets: [{ reps: '8', weight: String(weight) }] }] } } })
        const theirs = [lifted('2026-01-02', 40)]
        const yours = [lifted('2026-01-05', 100)]
        const draw = (log) => text(renderToString(<PlanProvider plan={plan}>
          <TheirSide session={plannedOpt} copy={copy} person={people[1]} ownerOut={{}} onSave={noop} entries={log}
            plan={<PrescriptionEditor pres={copy.data.plan} liftField={lf} entries={log} entryId={copy.id} onChange={noop} compact />} />
        </PlanProvider>))
        const t = draw(theirs).replace(/<[^>]+>/g, '')
        if (!/last time \(2026-01-02\): 1 × 8 @ 40 lb/.test(t)) throw new Error(`no last time from Sam's log: ${t.slice(0, 300)}`)
        if (/@ 100 lb/.test(t)) throw new Error('your weight shown as Sam\'s last time')
        if (!/Last time Sam did this/.test(t) || /Last time you did/.test(t)) throw new Error('the session history is not labelled as Sam\'s')
        // Plain words (#55): no "last 5 sessions", no "nothing written down yet".
        if (/last \d+ sessions?|nothing written down/i.test(t)) throw new Error('the history header is back to "sessions"')
        if (/last time \(/.test(draw([]).replace(/<[^>]+>/g, ''))) throw new Error('a last time with no history')
      }],
      ['SessionSheet(their own copy says it is in step with the owner\'s, and only while it is)', null, () => {
        const samMe = { id: 'sam', owner: false, acting: false, real: { id: 'sam', name: 'Sam', admin: false }, people: [] }
        const hers = (from) => ({ ...entry, data: { ...entry.data, sharedFrom: from } })
        const t = text(sheet(samMe, hers({ id: 'owner', name: 'Alex', sync: true })))
        if (!/with Alex/.test(t) || !/Exercises stay in step with Alex’s/.test(t)) throw new Error(`Sam is not told the copy is in step: ${t.slice(0, 300)}`)
        if (/in step/.test(text(sheet(samMe, hers({ id: 'owner', name: 'Alex', sync: false }))))) throw new Error('"in step" on a copy whose sync is off')
        if (/in step/.test(text(renderToString(<SharedNote entry={hers({ id: 'owner', name: 'Alex' })} />)))) throw new Error('"in step" on a copy shared before sync')
      }],
      ['SessionSheet(the person bar is a segmented control: the side on screen raised in its person\'s colour, the rule under the bar in it too)', null, () => {
        const html = sheet(ownerMe, syncedEntry)
        if (!/class="personbar" data-tone="0"><div class="seg whoseg" role="tablist"/.test(html)) throw new Error('the bar is not a segmented control in your colour')
        const prev = globalThis.localStorage
        const saved = { 'bushido:shared-side': JSON.stringify({ [entry.id]: 'sam' }) }
        globalThis.localStorage = { getItem: (k) => saved[k] ?? null, setItem: (k, v) => { saved[k] = v } }
        try {
          if (!/class="personbar" data-tone="1">/.test(sheet(ownerMe, syncedEntry))) throw new Error('on Sam\'s side the bar is not in Sam\'s colour')
        } finally { globalThis.localStorage = prev }
        const css = readFileSync(new URL('../src/css/people.css', import.meta.url), 'utf8')
        if (!/\.whoseg button\.on \{[^}]*var\(--who-soft\)/.test(css)) throw new Error('the picked side is not filled in its person\'s colour')
        if (!/\.personbar \{[^}]*border-bottom: 2px solid var\(--who/.test(css)) throw new Error('no rule in the person\'s colour under the bar')
      }],
      ['TodayTab(a shared workout says who it was with, small, on the row)', null, () => {
        _setMe(ownerMe)
        try {
          const t = text(renderToString(<TodayTab plan={plan} entries={[sharedEntry]} upsertEntry={noop} />))
          if (!/with Sam/.test(t)) throw new Error('the day row does not say who it was with')
        } finally { _setMe({}) }
      }],
    ]
  })(),
  /*
   * THE OWNER AS TRAINER (trainer.jsx, lib/trainer.js). "For: You / Sam", the side
   * switcher in a workout and "Sam's day" are the owner's, on the owner's own log, with
   * someone else on the install. Each absence is pinned: a control that leaked
   * into someone else's app, an act-as session or a one-person install would
   * pass every presence test.
   */
  ...(() => {
    const people = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
    const ownerMe = { id: 'owner', name: 'Alex', acting: false, owner: true, real: { id: 'owner', name: 'Alex', admin: true }, people,
      features: { ai: true, whoop: false, strava: false, goals: false, notifications: false } }
    const alone = { ...ownerMe, people: [people[0]] }
    const acting = { ...ownerMe, id: 'sam', name: 'Sam', owner: false, acting: true }
    const sam = { id: 'sam', name: 'Sam', acting: false, owner: false, real: { id: 'sam', name: 'Sam', admin: false }, people: [],
      features: { ai: true, whoop: false, strava: false, goals: false, notifications: false } }
    const FOR = /aria-label="Who this is for"/
    const flow = (me) => renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop}
      people={planPeople(me)} onKeepFor={async () => ({ ids: [], count: 0, first: null })} onShareWith={async () => ({ failed: [] })} />)
    const SAM = { id: 'sam', name: 'Sam' }
    const plannedForSam = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plannedBy: { id: 'owner', name: 'Alex' } } }
    const sharedPlanned = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, sharedWith: [{ id: 'sam', entryId: PLANNED_ENTRY.id }] } }
    const timed = plan.dailyMenu.find(o => hasWorkout(o) && buildSteps(o, {}).length)
    return [
      ['PlanFlow("For: You / Sam", one or several, only for the owner, with someone else on the install, not while acting)', null, () => {
        const html = flow(ownerMe)
        if (!FOR.test(html)) throw new Error('the owner cannot plan for Sam')
        const t = text(html)
        if (!/For/.test(t) || !/You/.test(t) || !/Sam/.test(t)) throw new Error('the choice does not name both')
        if (/>Alex</.test(html)) throw new Error('the owner is offered as someone to plan for')
        if (FOR.test(flow(alone))) throw new Error('"For:" on a one-person install')
        if (FOR.test(flow(acting))) throw new Error('"For:" while acting as someone')
        if (FOR.test(flow(sam))) throw new Error('"For:" for someone who is not the owner')
        // Several at once is the same control: none of its chips, nor a group's words, anywhere else (#59).
        for (const [label, m] of [['acting', acting], ['not the owner', sam], ['alone', alone]]) {
          const h = flow(m)
          if (/personchip|Planning for|shared with/.test(h)) throw new Error(`people to plan for, ${label}`)
        }
        // And never without somewhere to keep it.
        if (FOR.test(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} people={planPeople(ownerMe)} />))) {
          throw new Error('"For:" with no way to keep it in their log')
        }
      }],
      ['ForChoice(nothing with nobody to choose)', null, () => {
        if (renderToString(<ForChoice people={[]} who={FOR_ME} onChange={noop} />) !== '') throw new Error('a choice of one')
      }],
      ['ForChoice(the same person chips as "With …", You picked by default, no segmented control)', null, () => {
        const html = renderToString(<ForChoice people={planPeople(ownerMe)} who={FOR_ME} onChange={noop} />)
        const chips = [...html.matchAll(/class="chip personchip( on)?" data-tone="(\d)" aria-pressed="(true|false)"><span class="avatar sm"[^>]*>(.)<\/span><span class="personchip-name">([^<]*)</g)]
          .map(m => [Boolean(m[1]), m[2], m[4], m[5]])
        if (JSON.stringify(chips) !== JSON.stringify([[true, '0', 'Y', 'You'], [false, '1', 'S', 'Sam']])) throw new Error(`the choice reads ${JSON.stringify(chips)}`)
        if (/class="seg"/.test(html)) throw new Error('"For" is still a segmented control')
        const sam = renderToString(<ForChoice people={planPeople(ownerMe)} who={{ me: false, others: [SAM] }} onChange={noop} />)
        if (!/class="chip personchip on" data-tone="1"/.test(sam)) throw new Error('picking Sam does not light Sam\'s chip')
      }],
      /* #59: several at once. Each chip is a toggle, and You and Sam can both be on. */
      ['ForChoice(several at once: you and Sam both picked, each chip its own toggle)', null, () => {
        const html = renderToString(<ForChoice people={planPeople(ownerMe)} who={{ me: true, others: [SAM] }} onChange={noop} />)
        const on = [...html.matchAll(/class="chip personchip( on)?"[^>]*aria-pressed="(true|false)"/g)].map(m => [Boolean(m[1]), m[2]])
        if (JSON.stringify(on) !== JSON.stringify([[true, 'true'], [true, 'true']])) throw new Error(`the chips read ${JSON.stringify(on)}`)
        if (/role="radio"|class="seg"/.test(html)) throw new Error('"For" is a single choice again')
      }],
      ['ForLine(you and Sam: one workout, shared; Sam and Robin: a copy each)', null, () => {
        const both = text(renderToString(<ForLine who={{ me: true, others: [SAM] }} people={planPeople(ownerMe)} />)).replace(/<[^>]+>/g, '')
        if (!/You and Sam · one shared workout/.test(both)) throw new Error(`the line reads: ${both}`)
        if ((both.match(/Sam/g) || []).length !== 1) throw new Error(`the line names Sam twice: ${both}`)
        const others = text(renderToString(<ForLine who={{ me: false, others: [SAM, { id: 'robin', name: 'Robin' }] }} people={planPeople(ownerMe)} />))
        if (!/Planning for Sam and Robin · a copy goes in each of their logs/.test(others.replace(/<[^>]+>/g, ''))) throw new Error(`the line reads: ${others}`)
        if (renderToString(<ForLine who={FOR_ME} people={planPeople(ownerMe)} />) !== '') throw new Error('a line for your own plan')
      }],
      ['KeptStep(kept with Sam: on your day, shared, and a person it missed is said)', null, () => {
        const t = text(renderToString(<KeptStep pres={PRESCRIPTION} words={forWords({ me: true, others: [SAM] })} onStart={noop}
          onAnother={noop} onDone={noop} failed={[{ person: { id: 'robin', name: 'Robin' }, error: 'offline' }]} />))
        if (!t.includes(`${PRESCRIPTION.title} is on today, with Sam`)) throw new Error(`it says: ${t}`)
        if (!/each of you logs your own numbers/.test(t)) throw new Error('it does not say the numbers stay each person\'s')
        if (!/Not with Robin: offline/.test(t)) throw new Error('a person it could not be shared with is not said')
        if (!/Start it now/.test(t)) throw new Error('your side cannot be started')
      }],
      /* Others only, kept for Sam but not Robin: said as it is, with a retry here, not "With …". */
      ['KeptStep(others only, missed Robin: on Sam’s day, Try again for Robin, no "With …")', null, () => {
        const t = text(renderToString(<KeptStep pres={PRESCRIPTION} words={forWords({ me: false, others: [SAM] })} onStart={null}
          onAnother={noop} onDone={noop} onRetry={noop} failed={[{ person: { id: 'robin', name: 'Robin' }, error: 'read-only' }]} />))
        if (!t.includes(`${PRESCRIPTION.title} is on Sam’s day`)) throw new Error(`it says: ${t}`)
        if (/Robin’s days|Sam and Robin/.test(t)) throw new Error('it claims it is on Robin\'s day')
        if (!/Not on Robin’s day: read-only/.test(t) || !/Try again for Robin/.test(t)) throw new Error('the miss or its retry is not there')
        if (/With …/.test(t)) throw new Error('it sends you to "With …", which others-only has not got')
        // The retry is this screen's only: said, since the draft is gone once it is on anyone's day.
        if (!/If you close this, plan Robin’s again from Plan a workout/.test(t)) throw new Error('it does not say the retry goes when the screen does')
        const part = text(renderToString(<KeptStep pres={PRESCRIPTION} words={forWords({ me: false, others: [SAM] })} onStart={null}
          onAnother={noop} onDone={noop} onRetry={noop} failed={[{ person: { id: 'robin', name: 'Robin' }, error: 'offline', written: 1, of: 2 }]} />))
        if (!/Robin has part of it \(1 of 2\): offline/.test(part)) throw new Error(`a part-way keep reads: ${part}`)
        if (/Not on Robin’s day/.test(part)) throw new Error('Robin, who has the lift, is told it is not on Robin\'s day')
      }],
      ['BuildStep(the keep button says who it goes to)', null, () => {
        const t = text(renderToString(<PlanProvider plan={plan}><BuildStep pres={PRESCRIPTION} setPres={noop} liftField={LIFT_FIELD}
          onKeep={noop} words={forWords({ me: true, others: [SAM] })} /></PlanProvider>))
        if (!/Put it on today with Sam/.test(t)) throw new Error(`the button: ${t.match(/Put it on[^<]*/)?.[0]}`)
      }],
      ['ForLine(one line: whose plan this is, with their initial, no paragraph)', null, () => {
        const t = text(renderToString(<ForLine who={{ me: false, others: [SAM] }} people={planPeople(ownerMe)} />)).replace(/<[^>]+>/g, '')
        if (!/Planning for Sam · it goes in Sam’s log/.test(t)) throw new Error(`the line reads: ${t}`)
        if (/from you/.test(t)) throw new Error('the old explanatory sentence is back')
      }],
      ['SideSwitch(the same segmented control as the sheet\'s person bar)', null, () => {
        const html = renderToString(<SideSwitch sides={[{ id: null, name: 'You', tone: 0 }, { id: 'sam', name: 'Sam', tone: 1 }]} side="sam" onSide={noop} status={{ sam: 'rest 0:42' }} />)
        if (!/class="seg whoseg sideswitch"/.test(html)) throw new Error('the workout switcher is not the person segmented control')
        if (!/aria-selected="true" class="on" data-tone="1"><span class="avatar" data-tone="1"[^>]*>S<\/span><span class="side-name">Sam<\/span><span class="side-status">rest 0:42</.test(html)) {
          throw new Error('Sam\'s side does not read initial, name and what it is doing')
        }
      }],
      ['SidesWorkout(runner: both names in the switcher, whose side in the header, in their colour)', null, () => {
        const sides = [{ id: null, name: 'You', entryId: PLANNED_ENTRY.id, tone: 0 }, { id: 'sam', name: 'Sam', entryId: PLANNED_ENTRY.id, tone: 1 }]
        const html = renderToString(<PlanProvider plan={plan}>
          <SidesWorkout kind="runner" session={PLANNED_CARD} sides={sides} ownerEntry={sharedPlanned} entries={rich}
            onOwnerRun={noop} onExit={noop} />
        </PlanProvider>)
        if (!/aria-label="Whose side of the workout is showing"/.test(html)) throw new Error('no switcher in a shared workout')
        if (!/class="side-who" data-tone="0">You</.test(html)) throw new Error('the header does not say it is your side')
        if (!/role="tab" aria-selected="false" class="" data-tone="1"/.test(html)) throw new Error('Sam\'s side is not in the switcher, in Sam\'s colour')
        // Sam's side is mounted behind yours, hidden, so its own clock keeps running.
        if (!/aria-hidden="true"/.test(html)) throw new Error('the other side is not kept mounted')
      }],
      ['SidesWorkout(workout mode too)', null, () => {
        if (!timed) throw new Error('no timed card in the fixture to run')
        const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, data: { optId: timed.id, done: false, out: {}, sharedWith: [{ id: 'sam', entryId: `daily-${TODAY}` }] } }
        const sides = [{ id: null, name: 'You', entryId: entry.id, tone: 0 }, { id: 'sam', name: 'Sam', entryId: entry.id, tone: 1 }]
        const html = renderToString(<SidesWorkout kind="mode" session={timed} sides={sides} ownerEntry={entry} onOwnerSave={noop} onOwnerDone={noop} onExit={noop} />)
        if (!/sideswitch/.test(html) || !/class="side-who" data-tone="0">You</.test(html)) throw new Error('workout mode has no sides')
      }],
      ['WorkoutRunner(no switcher and no name on a workout nobody shares)', null, () => {
        const html = renderToString(<PlanProvider plan={plan}><WorkoutRunner session={PLANNED_CARD} entry={PLANNED_ENTRY} entries={rich} onRun={noop} onExit={noop} /></PlanProvider>)
        if (/sideswitch|side-who/.test(html)) throw new Error('a person switch on a workout nobody shares')
      }],
      ['TodayTab("Sam\'s day" for the owner; nothing with one person, while acting, or for anyone else)', null, () => {
        const today = (me) => { _setMe(me); try { return renderToString(<TodayTab plan={plan} entries={[]} upsertEntry={noop} />) } finally { _setMe({}) } }
        const owner = today(ownerMe)
        if (!/Sam’s day/.test(text(owner))) throw new Error('no way to see Sam\'s day')
        // A list row in a card (initial, "Sam's day", chevron), not the chip it used to be.
        if (!/class="card peopledays"[^>]*><div class="list"><button type="button" class="list-row peopleday" data-tone="1"><span class="avatar" data-tone="1"[^>]*>S<\/span>/.test(owner)) {
          throw new Error('"Sam\'s day" is not a list row with Sam\'s initial')
        }
        if (/class="chip peopleday"|side-dot/.test(owner)) throw new Error('"Sam\'s day" is still a chip with a dot')
        for (const [who, me] of [['one person', alone], ['acting', acting], ['someone else', sam]]) {
          if (/peopledays/.test(today(me))) throw new Error(`"Sam's day" with ${who}`)
        }
      }],
      ['TodayTab + LogTab(a session the owner planned says so, quietly, on Sam\'s own log)', null, () => {
        _setMe(sam)
        try {
          if (!/planned by Alex/.test(text(renderToString(<TodayTab plan={plan} entries={[plannedForSam]} upsertEntry={noop} />)))) {
            throw new Error('Today does not say who planned it')
          }
          const done = { ...plannedForSam, data: { ...plannedForSam.data, done: true } }
          if (!/planned by Alex/.test(text(renderToString(<LogTab plan={plan} entries={[done]} upsertEntry={noop} deleteEntry={noop} />)))) {
            throw new Error('the feed does not say who planned it')
          }
          if (/planned by/.test(text(renderToString(<TodayTab plan={plan} entries={[PLANNED_ENTRY]} upsertEntry={noop} />)))) {
            throw new Error('"planned by" on a session nobody else planned')
          }
        } finally { _setMe({}) }
      }],
      ['SessionSheet(a planned session names who planned it)', null, () => {
        const html = renderToString(<PlanProvider plan={plan}><SessionSheet opt={PLANNED_CARD} entry={plannedForSam} tone="rec" entries={[plannedForSam]}
          isFuture={false} me={sam} onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onSaveEntry={noop} /></PlanProvider>)
        if (!/planned by Alex/.test(text(html))) throw new Error('the sheet does not say who planned it')
      }],
      ['PersonDay(Sam\'s week, read from Sam\'s log, with About Sam)', null, () => {
        const t = text(renderToString(<PersonDay person={{ id: 'sam', name: 'Sam', tone: 1 }} date={TODAY} plan={plan} onClose={noop} />))
        if (!/Sam’s week/.test(t)) throw new Error('the view does not say whose week it is')
        if (!/About Sam/.test(t)) throw new Error('no way to edit Sam\'s About you')
        if (!/Everything you change here goes in Sam’s log/.test(t)) throw new Error('the week does not say whose log a change goes in')
        if (/What is on Sam/.test(t)) throw new Error('the old paragraph is back')
      }],
      ['DayHead(an empty day says "Nothing" the same way, today included)', null, () => {
        const head = (props) => text(renderToString(<DayHead date={TODAY} {...props} />)).replace(/<[^>]+>/g, '')
        if (!/Nothing$/.test(head({ empty: true }))) throw new Error('an empty day does not say "Nothing"')
        if (!/Today · Nothing$/.test(head({ today: true, empty: true }))) throw new Error(`an empty today reads: ${head({ today: true, empty: true })}`)
        if (/Nothing/.test(head({ today: true })) || !/Today$/.test(head({ today: true }))) throw new Error('today with something on it says "Nothing"')
        if (/Nothing|Today/.test(head({}))) throw new Error('a day with something on it has a note')
        if (/Nothing on today/.test(readFileSync(new URL('../src/trainer.jsx', import.meta.url), 'utf8'))) throw new Error('the separate "Nothing on today." line is back')
      }],
      ['ShareChip(32px to look at, a 44px target, like the done chip)', null, () => {
        const css = readFileSync(new URL('../src/css/people.css', import.meta.url), 'utf8')
        const chip = (css.match(/\.share-chip \{[^}]*\}/) || [''])[0]
        if (!/min-height: 32px/.test(chip)) throw new Error(`the chip is not 32px: ${chip}`)
        if (!/\.share-chip::after \{[^}]*inset: -6px/.test(css)) throw new Error('the chip\'s hit area is not grown to 44px')
        if (/personchip-x|\.withrow \{/.test(css)) throw new Error('the old "With" chips\' rules are back')
      }],
      ['PersonDayRow("Sam\'s day" says each session\'s done state, in words and a tick)', null, () => {
        const rows = [{ id: 'a', name: 'Pull', done: true }, { id: 'b', name: 'Core & hips', done: false }]
        const html = renderToString(<PersonDayRow person={people[1]} tone={1} date={TODAY} plan={plan} onOpen={noop} initial={rows} />)
        if (!/aria-label="Sam&#x27;s day: Pull, done; Core &amp; hips, not done yet"/.test(html)) throw new Error(`the row does not say what is done: ${html.slice(0, 400)}`)
        if (!/class="peopleday-item done"/.test(html) || !/class="peopleday-item"/.test(html)) throw new Error('no done state on each session')
      }],
      ['PersonEntryView(someone\'s session wears the owner\'s sheet parts: done chip under the title, Start or no footer)', null, () => {
        const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
        const done = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
          data: { optId: opt.id, name: 'Ride', done: true, out: { activity: 'bike' }, sharedFrom: { id: 'owner', name: 'Alex' } } }
        const draw = (props) => renderToString(<PlanProvider plan={plan}>
          <PersonEntryView person={{ id: 'sam', name: 'Sam', tone: 1 }} entry={done} opt={opt} onFlip={noop} onSave={noop} onClose={noop} today={TODAY} me={ownerMe} {...props} />
        </PlanProvider>)
        const html = draw({})
        const status = html.slice(html.indexOf('class="modal-status"'), html.indexOf('class="modal-body'))
        if (!/class="done-chip on" role="switch" aria-checked="true" aria-label="Sam: Done"/.test(status)) throw new Error('no done chip under the title')
        if (/Mark undone|Mark done for/.test(text(html).replace(/<[^>]+>/g, ' ')) || /aria-pressed/.test(html)) throw new Error('the old done button is back')
        if (/modal-foot|sheet-foot/.test(html)) throw new Error('a footer with nothing to start')
        const started = draw({ onStart: noop })
        if (!/class="sheet-foot"><button type="button" class="btn">.*Start for Sam/.test(started)) throw new Error('Start is not the one footer action')
        const later = { ...done, date: '2999-01-01' }
        if (/done-chip/.test(draw({ entry: later }))) throw new Error('a done chip on a day still to come')
      }],
      ['people.css(no small capitals, and every font size on the type scale)', null, () => {
        const css = readFileSync(new URL('../src/css/people.css', import.meta.url), 'utf8')
        if (/text-transform|letter-spacing/.test(css)) throw new Error('small capitals in the people screens')
        const raw = [...css.matchAll(/font-size: (?!var\(--fs-)([^;]+)/g)].map(m => m[1])
        if (raw.length) throw new Error(`font sizes off the scale: ${raw.join(', ')}`)
      }],
      ['MyAbout(About you in the app for anyone but the owner, whose is in Settings)', null, () => {
        if (!/About you/.test(text(renderToString(<MyAbout me={sam} />)))) throw new Error('Sam cannot edit Sam\'s About you')
        if (renderToString(<MyAbout me={ownerMe} />) !== '') throw new Error('a second About you for the owner')
      }],
      ['PeopleDays(nothing with nobody)', null, () => {
        if (renderToString(<PeopleDays people={[]} date={TODAY} plan={plan} />) !== '') throw new Error('an empty row')
      }],
    ]
  })(),
  /*
   * "Together with Sam" (the owner's ask, #68): on a workout shared with sync on,
   * a circuit waits on its start screen with one switch, on by default, so one
   * clock can log for both. Pinned absent: a workout nobody shares (it runs
   * straight away, as before) and one shared with sync off.
   */
  ['SidesWorkout(a shared circuit offers "Together with Sam"; unshared and unsynced do not)', null, () => {
    const pres = normalizePrescription({ title: 'Abs', blocks: [{ name: 'Core', circuit: { work: 40, rest: 20, rounds: 3 }, items: [
      { kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [] },
      { kind: 'lift', name: 'Plank', exercise: 'plank', sets: [] },
    ] }] }, { liftField: LIFT_FIELD })
    const mine = (sync) => ({ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: 'Abs', done: true, plan: pres, out: {},
        sharedWith: [{ id: 'sam', entryId: `daily-${TODAY}`, sync }] } })
    const sides = [{ id: null, name: 'You', entryId: `daily-${TODAY}`, tone: 0 }, { id: 'sam', name: 'Sam', entryId: `daily-${TODAY}`, tone: 1 }]
    const run = (entry) => renderToString(<PlanProvider plan={HELD_PLAN}>
      <SidesWorkout kind="runner" session={PLANNED_CARD} sides={sides} ownerEntry={entry} entries={[]} onOwnerRun={noop} onExit={noop} />
    </PlanProvider>)
    const synced = run(mine(true))
    if (!/Together with Sam/.test(text(synced))) throw new Error('a shared circuit does not offer to run together')
    if (!/<input type="checkbox" role="switch" class="switch" checked=""/.test(synced.slice(synced.indexOf('Together with Sam')))) throw new Error('"Together" is not a switch, on by default')
    if (!/One clock, logged for you and Sam/.test(text(synced))) throw new Error('the switch does not say what it does')
    if (/it-run/.test(synced)) throw new Error('a shared circuit started before Together was chosen')
    if (!/Start the circuit/.test(text(synced))) throw new Error('no Start under the switch')
    const unsynced = run(mine(false))
    if (/Together with/.test(text(unsynced))) throw new Error('"Together" offered with sync off')
    const alone = renderToString(<PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD}
      entry={{ ...mine(true), data: { ...mine(true).data, sharedWith: [] } }} entries={[]} onRun={noop} onExit={noop} /></PlanProvider>)
    if (/Together with/.test(text(alone))) throw new Error('"Together" offered on a workout nobody shares')
    if (!/it-circuit/.test(alone)) throw new Error('an unshared circuit no longer starts straight away')
  }],
]
