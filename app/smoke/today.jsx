/* Smoke cases: Today: the day list, the empty day, the day switcher, the rest-day door.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { TodayTab, DaySwitcher, EmptyDay } from '../src/tabs.jsx'
import { tickSet, setHasNumber, planProgress } from '../src/lib/prescription.js'
import { placedUndoText, placedToUndo } from '../src/lib/quicklog.js'
import { activityFieldOf } from '../src/picker.jsx'
import { readFileSync } from 'node:fs'
import { SessionSheet } from '../src/sheet.jsx'
import { RestPrompt } from '../src/App.jsx'
import { LogTab } from '../src/log.jsx'
import { dayWords } from '../src/lib/dates.js'
import {
  plan, starter, example, entries, noop, TODAY, back, rich, text, isoShift, PRESCRIPTION,
  QUICK_LOG, PLANNED_ENTRY, LEGACY, LEGACY_WORDS,
} from './fixtures.jsx'

export default [
  /*
   * A DAY STILL TO COME (#94, A F8): "Nothing planned yet" was a dead end; it now
   * offers the one way in, worded with the day the planner puts it on. A day
   * that has come keeps Log a workout and Rest day, and no planning button.
   */
  ['EmptyDay(a day still to come offers "Plan a workout for <day>"; one that has come does not)', null, () => {
    const later = isoShift(TODAY, 3)
    const future = text(renderToString(<EmptyDay isFuture viewIso={later} onPlan={noop} onLog={noop} onRest={noop} quick={null} />))
    if (!future.includes(`Plan a workout for ${dayWords(later)}`)) throw new Error('a day still to come offers no way to plan it')
    if (/Log a workout|Rest day/.test(future)) throw new Error('a day still to come offers logging')
    if (/Plan a workout for/.test(text(renderToString(<EmptyDay isFuture viewIso={later} onPlan={null} quick={null} />)))) throw new Error('a plan button with nothing to open')
    const tomorrow = text(renderToString(<EmptyDay isFuture viewIso={isoShift(TODAY, 1)} onPlan={noop} quick={null} />))
    if (!tomorrow.includes('Plan a workout for tomorrow')) throw new Error('"tomorrow" is not said as a word in the sentence')
    const now = text(renderToString(<EmptyDay isFuture={false} viewIso={TODAY} onPlan={noop} onLog={noop} onRest={noop} quick={null} />))
    if (/Plan a workout for/.test(now) || !/Log a workout/.test(now)) throw new Error('today\u2019s empty day changed')
  }],
  /*
   * A PLAN IN PROGRESS SAYS HOW FAR IT HAS GOT (#94, A F7): one ticked set read
   * "1 exercise · 1 set · 900 lb" over a plan of six exercises. Untouched it is
   * still "Planned", and its whole line.
   */
  ['TodayTab(a plan being done on its day: "k of n sets", not what is logged so far)', null, () => {
    const lift = PRESCRIPTION.blocks.flatMap(b => b.items).find(it => (it.sets || []).some(x => setHasNumber(x)))
    const set = lift.sets.find(x => setHasNumber(x))
    const ticked = tickSet(PRESCRIPTION, lift.id, set.id, true)
    const { done, total } = planProgress(ticked)
    const going = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plan: ticked } }
    const t = text(renderToString(<TodayTab plan={plan} entries={[going]} upsertEntry={noop} deleteEntry={noop} />))
    if (!t.includes(`${done} of ${total} sets`)) throw new Error(`no "${done} of ${total} sets" on the row`)
    if (/\d[\d,]* lb/.test((t.match(/list-row-meta[\s\S]*?<\/span><\/span>/) || [''])[0])) throw new Error('the row reports volume mid-workout')
    const fresh = text(renderToString(<TodayTab plan={plan} entries={[PLANNED_ENTRY]} upsertEntry={noop} deleteEntry={noop} />))
    if (/ of \d+ sets/.test(fresh) || !/Planned/.test(fresh)) throw new Error('an untouched plan does not read as Planned')
  }],
  /*
   * A WAY BACK FROM ONE TAP (#94, A F3). A quick-log row writes a done workout
   * and opens its sheet; closed with nothing on it, the sheet says what was
   * logged with Undo. `placedUndoText` is those words, or null once anything
   * was put on it. The closing itself is DaySessions' (an effect SSR cannot
   * run), so its wiring is pinned in the source on both platforms.
   */
  ['placedUndoText("Logged Walk" for a tap and nothing else; null once anything is on it)', null, () => {
    const field = activityFieldOf(plan)
    const card = plan.dailyMenu.find(m => m.id === 'log-workout')
    const tapped = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, data: { optId: card.id, name: 'Walk', done: true, out: { activity: 'walk' } } }
    const said = placedUndoText(tapped, card, field)
    if (!/^Logged \S/.test(said || '')) throw new Error(`a bare tap says "${said}"`)
    for (const out of [{ activity: 'walk', notes: 'nice' }, { activity: 'walk', rpe: 4 }, { activity: 'walk', minutesSpent: 30 }, { activity: 'walk', title: 'Dog' }]) {
      if (placedUndoText({ ...tapped, data: { ...tapped.data, out } }, card, field) !== null) throw new Error(`offered to undo a log with ${Object.keys(out).join(', ')} on it`)
    }
    if (placedUndoText({ ...tapped, data: { ...tapped.data, plan: PRESCRIPTION } }, card, field) !== null) throw new Error('offered to undo a plan')
    if (placedUndoText({ ...tapped, deleted: true }, card, field) !== null) throw new Error('offered to undo a removed workout')
    // Decided when Undo is PRESSED, from the entries then (#101 review): closed, reopened
    // within the six seconds and given a note, the workout is a log someone meant.
    if (placedToUndo([tapped], tapped.id, card, field) !== tapped) throw new Error('Undo does not remove a workout that is still only the tap')
    const noted = { ...tapped, data: { ...tapped.data, out: { activity: 'walk', notes: 'with the dog' } } }
    if (placedToUndo([noted], tapped.id, card, field) !== null) throw new Error('a stale Undo removes a workout written on since')
    if (placedToUndo([], tapped.id, card, field) !== null) throw new Error('Undo on a workout that is gone')
    for (const f of ['src/tabs.jsx', '../mobile/src/features/tabs.tsx']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      if (!/onClose=\{\(\) => closeSheet\(open\)\}/.test(src) || !/placedUndoText( as any\))?\(/.test(src)) {
        throw new Error(`${f}: closing a just-placed sheet offers no Undo`)
      }
      if (!/placed\.current = hit\.id/.test(src)) throw new Error(`${f}: a placed entry is not remembered as placed`)
      if (!/const now = \(placedToUndo( as any)?\)\(latest\.current, entry\.id/.test(src) || !/if \(now\) onUnplace\(now\)/.test(src)) {
        throw new Error(`${f}: Undo removes the entry as it was at close, not as it is now`)
      }
      if (!/useEffect\(\(\) => \{ if \(sheet\) dropUndo\(\) \}, \[sheet\]\)/.test(src)) throw new Error(`${f}: reopening the row leaves its Undo up`)
      if (!/useEffect\(\(\) => \(\) => dropUndo\(\), \[\]\)/.test(src)) throw new Error(`${f}: the Undo outlives Today`)
    }
    // The planner's "See it on Mon" is applied once, then cleared, so Today does not jump
    // back to that day every time it mounts again (#101 review).
    for (const [f, re] of [['src/App.jsx', /showDay=\{showDay\} onDayShown=\{\(\) => setShowDay\(null\)\}/],
      ['../mobile/src/features/screens/TodayScreen.tsx', /showDay=\{showDay\} onDayShown=\{\(\) => setShowDay\(null\)\}/]]) {
      if (!re.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))) throw new Error(`${f}: the asked-for day is never cleared`)
    }
    for (const f of ['src/tabs.jsx', '../mobile/src/features/tabs.tsx']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      if (!/if \(showDay\?\.date\) \{ setIso\(showDay\.date\); onDayShown\?\.\(\) \}/.test(src)) throw new Error(`${f}: Today does not hand the asked-for day back`)
    }
  }],
  ['TodayTab', <TodayTab plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      // Achievements and Totem goals left Today on 2026-09-15 and the app on
      // 2026-10-25 (issue #31), with the quota bars and the journal.
      if (/Achievements/.test(t)) throw new Error('the achievement card is back on Today')
      if (/Goals from Totem/.test(t)) throw new Error('the Totem goals card is back on Today')
      if (/role="progressbar"|class="qb-/.test(html)) throw new Error('the quota bars are back on Today')
      if (/Journal/.test(t)) throw new Error('the journal is back on Today')
      if (/class="tiles"/.test(html)) throw new Error('the stat tile row came back')
    }],
  // Empty state: a brand-new install must not crash before anything is logged.
  ['TodayTab(empty)', <TodayTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  /* An old log with quotas, a check-in, a journal day and an achievement in it:
     Today renders, empty, and none of it shows. */
  ['TodayTab(legacy entries are ignored)', <TodayTab plan={plan} entries={LEGACY}
    upsertEntry={noop} deleteEntry={noop} onPlan={noop} onLog={noop} onRest={noop} />,
    (html) => {
      const t = text(html)
      if (!/Nothing logged today/.test(t)) throw new Error('a legacy entry shows up as something on the day')
      if (LEGACY_WORDS.test(t)) throw new Error(`a removed feature's data is on screen: ${t.match(LEGACY_WORDS)}`)
    }],
  // Day navigator: the future-preview path hides logging and must still render.
  ['TodayTab(rich, nav)', <TodayTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />],
  // over-budget week: hard options must classify as "Not today"
  ['TodayTab(over budget)', <TodayTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />],
  // resting state: rest replaces the session card and must render standalone
  ['TodayTab(resting)', <TodayTab plan={plan}
    entries={[{ id: 'r', kind: 'daily', date: new Date().toISOString().slice(0,10), updatedAt: 'z',
      data: { optId: 'off', level: 1, name: 'Rest day', minutes: 0 } }]} upsertEntry={noop} deleteEntry={noop} />],
  // The headline case: a main session plus an extra, each with its own log.
  // The common scenario — 4x4s as the main, a social bouldering session on top.
  ['TodayTab(main + extra)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'four-by-four', level: 4, name: 'Bouldering 4×4s', minutes: 80,
        adjuncts: ['warmup'],
        out: { angle: 25, setRest: 300, falls: 1, rpe: 8, fingers: 3, skin: 3,
          sets: { circuits: [{reps:4},{reps:4},{reps:4},{reps:4}] } } } },
  { id: 'd12', kind: 'daily', date: '2026-09-17', updatedAt: 'z', data: { slot: 'extra', optId: 'lead-laps', level: 3, name: 'Doubled lead laps', minutes: 30, done: true, out: { shakeouts: true, rpe: 6, fingers: 2,
    // A grade per LAP, and the two laps of a set are not always the same route —
    // e.g. one double at 5.10 twice, one at 5.10− then 5.10.
    sets: { doubles: [{reps:2, grades:[10.2,10.2]},{reps:2, grades:[10.1,10.2]}] } } } },
    { id: `daily-${TODAY}-fun-boulder`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'fun-boulder', level: 3, name: 'Bouldering with friends', minutes: 90,
        out: { intensity: 3, hardest: 5, tried: true, rpe: 6, fingers: 3, skin: 3,
          sets: { problems: [{reps:14}] } } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  // An extra on a rest day still has to render — the rest branch returns early.
  ['TodayTab(rest + extra)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'off', level: 1, name: 'Rest day', minutes: 0 } },
    { id: `daily-${TODAY}-fun-sport`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'fun-sport', level: 1, name: 'Sport climbing for fun', minutes: 120,
        out: { intensity: 1, rpe: 3, fingers: 1 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  // The scenario the recommender was built for: the gym day moved to Wednesday,
  // so the template's Thursday pick is blocked and something else has to win.
  // The "why this" card must render, and must name what it ruled out.
  ['TodayTab(displaced hard day)', <TodayTab plan={plan} entries={[
    { id: 'm1', kind: 'daily', date: back(3), updatedAt: 'z',
      data: { slot: 'main', optId: 'hard-home', level: 4, done: true, out: { rpe: 7, fingers: 2, skin: 2 } } },
    { id: 'm2', kind: 'daily', date: back(2), updatedAt: 'z',
      data: { slot: 'main', optId: 'subthreshold', level: 1, done: true, out: { rpe: 3, fingers: 1 } } },
    { id: 'm3', kind: 'daily', date: back(1), updatedAt: 'z',
      data: { slot: 'main', optId: 'hard-gym', level: 4, done: true, out: { rpe: 8, fingers: 3, skin: 3 } } },
    { id: 'm4', kind: 'daily', date: back(1), updatedAt: 'z',
      data: { slot: 'extra', optId: 'fun-boulder', level: 3, done: true, out: { intensity: 3, rpe: 7, fingers: 3 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  // The free-form card: a run added on top of a session, naming itself from the
  // activity picked and carrying only some of its optional fields.
  ['TodayTab(other training)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'hips', level: 1, name: 'Hip Abduction Block', minutes: 13,
        done: true, out: { rpe: 3 } } },
    { id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'log-workout', level: 3, name: 'Run', minutes: 38, done: true,
        out: { activity: 'run', distance: 4.2, duration: 38, effort: 3, rpe: 6 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  /* Two of them in one day, which is the shape the card exists in now: a run
   * AND a lift on the same day, and one entry per session per day could only hold
   * the second on top of the first. Each names itself from its own activity and
   * carries its own effort and length. */
  ['TodayTab(other training, twice in a day)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 4, name: 'Run', minutes: 38, done: true,
        out: { activity: 'run', distance: 4.2, duration: 38, rpe: 8 } } },
    { id: `daily-${TODAY}-log-workout-2`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 52, done: true,
        out: { activity: 'lift', duration: 52, rpe: 5, lifts: [
          { uid: 'bench-press-1', key: 'bench-press', name: 'Bench press', implement: 'barbell',
            implementLabel: 'Barbell', sets: [{ reps: 5, weight: 165 }, { reps: 5, weight: 165 }] },
        ] } } },
  ]} upsertEntry={noop} deleteEntry={noop} />,
    html => {
      const t = text(html)
      // Two rows, named apart, with the numbers that differ between them.
      if (!/Run/.test(t) || !/Lift/.test(t)) throw new Error('the two workouts are not named apart')
      if (!/38 min/.test(t) || !/52 min/.test(t)) throw new Error('each one carries its own length')
      // One line each: time · distance, or what was lifted. Effort ("RPE") is in
      // the sheet, not on the row (#41).
      const plain = t.replace(/<[^>]+>/g, '')
      if (!/38 min · 4\.2 mi/.test(plain)) throw new Error('the run does not read time · distance')
      if (!/52 min · 1 exercise · 2 sets · 1,650 lb/.test(plain)) throw new Error('the lift day does not say what it was')
      if (/RPE/.test(t)) throw new Error('a bare "RPE" is on the day list')
    }],
  /*
   * "Log another workout" CAME OFF THE DAY on 2026-10-25 (#41). It was a dashed
   * full-width button under the list that looked like an empty slot, saying what
   * the + beside the dock already does in one tap. Pinned as an absence; the +
   * menu's own doors are pinned in the shell section (`FabMenu(four doors…)`).
   */
  ['TodayTab(no "Log another" under the day: the + is the way to a second one)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 4, name: 'Run', minutes: 38, done: true,
        out: { activity: 'run', duration: 38, rpe: 8 } } },
    { id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 52, done: true,
        out: { activity: 'lift', duration: 52, rpe: 5 } } },
  ]} upsertEntry={noop} deleteEntry={noop} onLog={noop} onPlan={noop} />,
    html => {
      const t = text(html)
      if (/Log another workout|on today/.test(t)) throw new Error('the dashed "Log another" button is back')
      if (/dl-add|dl-again/.test(html)) throw new Error('the dashed "Log another" button is back')
    }],
  // ...and with nothing but the activity picked, which has to be enough.
  ['TodayTab(other training, bare)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 2, name: 'Bike', minutes: 45,
        done: true, out: { activity: 'bike' } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  // Fingers at the top of the scale: rest has to be able to win outright.
  ['TodayTab(something hurts)', <TodayTab plan={plan} entries={[
    { id: 'h1', kind: 'daily', date: back(1), updatedAt: 'z',
      data: { slot: 'main', optId: 'hard-home', level: 4, done: true, out: { rpe: 9, fingers: 5, skin: 4 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  /* ------------------------------------------- the day, after the cull
   *
   * Today stopped recommending on 2026-09-17. These cases pin what that MEANS,
   * because the failure mode of putting it back is silent: the screen still
   * renders, it just starts arguing with them again. Each one asserts an ABSENCE,
   * which is exactly the kind of thing that regresses without anybody noticing.
   */
  ['TodayTab(empty day offers nothing)', <TodayTab plan={plan}
    entries={[]}
    upsertEntry={noop} deleteEntry={noop}
    onPlan={noop} onLog={noop} onRest={noop} />,
    (html) => {
      const t = text(html)
      if (!/Nothing logged today/.test(t)) throw new Error('an empty day does not say it is empty')
      // The ways in from an empty day (docs/DESIGN.md "Today, first run"): Log a
      // workout as the one primary, a rest day as a quiet button. Planning lives
      // behind the +, which is on screen.
      if (!/<button type="button" class="btn">Log a workout<\/button>/.test(html)) throw new Error('Log a workout is not the primary')
      if (!/<button type="button" class="btn quiet">Rest day<\/button>/.test(html)) throw new Error('no quiet rest-day button')
      if (/Plan a workout/.test(t)) throw new Error('Plan a workout is back on the empty day; it is the + menu\u2019s')
      // No paragraph above the buttons (#41).
      if (/arrives with the sets already written|also lives on the/.test(t)) throw new Error('the empty day\u2019s paragraph is back')
      // The plan's cards moved into Log a workout on 2026-10-14; a second door to
      // them is a second list to know about.
      if (/Pick from the plan/.test(t)) throw new Error('the separate session door is back')
      // The things that used to fill an empty day, and must not come back.
      if (/Also recommended/.test(t)) throw new Error('companion suggestions are back')
      if (/Swap your main session/.test(t)) throw new Error('the swap list is back')
      if (/Take a rest day instead/.test(t)) throw new Error('the rest-day suggestion is back')
      if (/still owes|Why .*? today/.test(t)) throw new Error('the recommendation card is back')
      if (/Not done/.test(t)) throw new Error('something he never chose reads as a missed session')
    }],
  /*
   * THE QUICK ROWS ON THE EMPTY DAY (#55). Batch A left a stub where batch B's
   * rows go; this pins the real ones there: the same three as the + menu, between
   * "Nothing logged" and Log a workout (a future day's "Nothing planned yet"
   * offers none: a quick row is "I did this"). (The tap itself, placing a done workout on the day shown and
   * opening its sheet, is quickEntry's case below and the #55 screenshot tour.)
   */
  ['TodayTab(the empty day offers the quick rows, between "Nothing logged" and Log a workout)', null, () => {
    const html = renderToString(<TodayTab plan={plan} entries={QUICK_LOG.filter(e => e.date < '2026-10-22')}
      upsertEntry={noop} deleteEntry={noop} onLog={noop} onRest={noop} />)
    const t = text(html)
    if ((html.match(/class="list-row quicklog-row"/g) || []).length !== 3) throw new Error('the empty day has no quick rows')
    if (/STUB|QuickLogSlot/.test(html)) throw new Error('the stub is back')
    const order = ['Nothing logged today', 'aria-label="Log Run"', 'aria-label="Log Mountain bike"', '>Log a workout<', '>Rest day<']
    const at = order.map(x => t.indexOf(x))
    if (at.some(x => x < 0)) throw new Error(`missing: ${order.filter((x, i) => at[i] < 0).join(', ')}`)
    if (at.some((x, i) => i && x < at[i - 1])) throw new Error(`out of order: ${order.join(' < ')}`)
    if (!/Nothing logged today/.test(t)) throw new Error('no empty title')
    // No workout card in the plan: no rows, and Log a workout still stands.
    const bare = renderToString(<TodayTab plan={{ ...plan, dailyMenu: plan.dailyMenu.filter(m => m.id !== 'log-workout') }}
      entries={[]} upsertEntry={noop} deleteEntry={noop} onLog={noop} />)
    if (/quicklog-row/.test(bare) || !/>Log a workout</.test(bare)) throw new Error('rows with no card, or Log a workout went with them')
    // A log with nothing in it has no calendar to show (one empty square under "0 days on").
    if (/Daily habit/.test(bare)) throw new Error('an empty log shows the habit calendar')
    if (!/Daily habit/.test(t)) throw new Error('a log with workouts lost its habit calendar')
  }],
  /*
   * THE DAY IS THE TITLE (#41). The day switcher used to be a whole card for two
   * arrows; now the day, in words, is the screen's heading with ‹ › beside it.
   */
  ['TodayTab(the day is the title, with ‹ › beside it)', <TodayTab plan={plan} entries={[]}
    upsertEntry={noop} deleteEntry={noop} onLog={noop} />,
    html => {
      if (!/class="daytitle[^"]*"><div class="daytitle-words"><h2>Today<\/h2>/.test(html)) throw new Error('the day is not the screen\u2019s title')
      if (!/aria-label="Previous day"/.test(html) || !/aria-label="Next day"/.test(html)) throw new Error('no ‹ › beside the day')
      if (/class="daynav/.test(html)) throw new Error('the boxed day switcher is back')
      // Already on today: no way "back to today" to offer.
      if (/class="btn quiet">Today</.test(html)) throw new Error('a "Today" button while on today')
    }],
  /*
   * START ALWAYS STARTS (#95, C N5). The planner's Start workout hands Today an
   * entry id; Today showing another day looked for it only there, and nothing
   * opened. Today goes to the entry's own day first. Pinned both ways: the day
   * an opened workout is on, and no move when nothing is being opened.
   */
  ['TodayTab(a workout opened from the planner is shown on its own day)', null, () => {
    const tomorrow = isoShift(TODAY, 1)
    const planned = { ...PLANNED_ENTRY, id: `daily-${tomorrow}`, date: tomorrow }
    const opened = renderToString(<TodayTab plan={plan} entries={[planned]} upsertEntry={noop} deleteEntry={noop}
      openEntryId={planned.id} onOpened={noop} />)
    if (!/<h2>Tomorrow<\/h2>/.test(opened)) throw new Error('Today stayed on another day, so the workout never opened')
    if (!text(opened).includes(PRESCRIPTION.title)) throw new Error('the opened workout is not on the day shown')
    const idle = renderToString(<TodayTab plan={plan} entries={[planned]} upsertEntry={noop} deleteEntry={noop} />)
    if (!/<h2>Today<\/h2>/.test(idle)) throw new Error('Today moved to another day with nothing being opened')
    const unknown = renderToString(<TodayTab plan={plan} entries={[planned]} upsertEntry={noop} deleteEntry={noop}
      openEntryId="daily-nowhere" onOpened={noop} />)
    if (!/<h2>Today<\/h2>/.test(unknown)) throw new Error('an id that is no entry moved the day')
    // Only one thing drives Today's day at a time: while a workout is being opened,
    // a day asked for ("See it on Mon", #101) is handed back, not applied (both platforms).
    for (const f of ['src/tabs.jsx', '../mobile/src/features/tabs.tsx']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
      if (!/if \(showDay\?\.date && opening\) \{ onDayShown\?\.\(\); return \}/.test(src)) throw new Error(`${f}: an asked-for day and an opening both drive Today`)
      if (!/if \(opening && followed !== opening\.id\)/.test(src)) throw new Error(`${f}: an opening is followed more than once`)
    }
  }],
  ['DaySwitcher(another day says which, offers the way back, and stops at max)', null, () => {
    const t = TODAY
    const y = isoShift(t, -1)
    const html = renderToString(<DaySwitcher value={y} today={t} max={t} onChange={noop} title />)
    if (!/<h2>Yesterday<\/h2>/.test(html)) throw new Error('yesterday is not in words')
    if (!/class="btn quiet">Today</.test(html)) throw new Error('no way back to today')
    const atMax = renderToString(<DaySwitcher value={t} today={t} max={t} onChange={noop} />)
    if (!/aria-label="Next day"[^>]*disabled|disabled=""[^>]*aria-label="Next day"/.test(atMax)) throw new Error('the switcher steps past max')
    const far = dayWords(isoShift(t, -9), t)
    if (/days ago|^\d{4}-/.test(far)) throw new Error(`a far day reads "${far}", not a date in words`)
  }],
  /*
   * ONE CARD OF ROWS (#41): the name, one meta line, and done said once, by the
   * leading icon. Gone, and pinned absent: the MAIN/ADDED pill, the second tick
   * beside the chevron, the "planned" chip, and the card's estimate posing as the
   * time (a typed 29 must not read 45).
   */
  ['TodayTab(one card of rows: name, time · distance, done by the leading icon)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 2, name: 'Run', minutes: 45, done: true,
        out: { activity: 'run', duration: 29, distance: 3.1, rpe: 4 } } },
    { id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 50, done: false, undone: true,
        out: { activity: 'lift' } } },
  ]} upsertEntry={noop} deleteEntry={noop} onLog={noop} />,
    html => {
      const t = text(html)
      if ((html.match(/class="card daylist"/g) || []).length !== 1) throw new Error('the day is not one card')
      if ((html.match(/class="list-row dl-row/g) || []).length !== 2) throw new Error('the rows are not list rows')
      if (!/29 min · 3\.1 mi/.test(t.replace(/<[^>]+>/g, ''))) throw new Error('the row does not read time · distance as typed')
      // Wraps between its pieces, never inside one ("45 / min").
      if (!/<span class="meta-bit">29 min ·<\/span>/.test(text(html))) throw new Error('the meta line can break inside a piece')
      if (/45 min/.test(t)) throw new Error('the card\u2019s estimate is on the row as if it were the time')
      if (!/aria-label="Done"/.test(html)) throw new Error('a done session does not say so by its icon')
      if (!/aria-label="Not done"/.test(html) || !/Not done/.test(t)) throw new Error('a session marked undone does not say so')
      if (/>Main<|>Added<|class="dl-tag"/.test(html)) throw new Error('the MAIN / ADDED pill is back')
      if (/class="dl-check/.test(html)) throw new Error('a second tick beside the chevron is back')
      if (/plannedchip/.test(html)) throw new Error('the "planned" chip is back')
      if (/Your day/.test(t)) throw new Error('the card title is back; the day is the screen\u2019s title')
    }],
  /*
   * ONE NUMBER FOR HOW LONG (#55). The same run said 45 min in the Log feed (the
   * card's estimate) and 30 on Today (what was typed). Today's row, the sheet's
   * header and the feed now read `loggedMinutes`: typed or measured, never the
   * estimate, and an old `minutesSource: 'typed'` correction still wins.
   */
  ['loggedMinutes(Today, the sheet and Log agree: typed or measured, never the estimate)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    const run = (out, extra = {}) => ({ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Run', minutes: 45, done: true, out: { activity: 'run', ...out }, ...extra } })
    const shown = (entry) => {
      const today = text(renderToString(<TodayTab plan={plan} entries={[entry]} upsertEntry={noop} deleteEntry={noop} />))
      const head = text(renderToString(<SessionSheet opt={opt} entry={entry} tone="rec" entries={[entry]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />))
      const log = text(renderToString(<LogTab plan={plan} entries={[entry]} upsertEntry={noop} deleteEntry={noop} />))
      const mins = (t) => (t.match(/(\d+) min\b/) || [])[1] || null
      return [mins(today), mins(head.slice(0, head.indexOf('Activity'))), mins(log)]
    }
    const typed = shown(run({ duration: 30, minutesSpent: 30, distance: 3.1 }))
    if (typed.join() !== '30,30,30') throw new Error(`a typed 30 reads ${typed.join(' / ')} on Today / sheet / Log`)
    const guess = shown(run({ distance: 3.1 }))
    if (guess.some(Boolean)) throw new Error(`the card's estimate shows as a time: ${guess.join(' / ')}`)
    const legacy = shown(run({}, { minutes: 25, minutesSource: 'typed' }))
    if (legacy.join() !== '25,25,25') throw new Error(`an old typed correction reads ${legacy.join(' / ')}`)
  }],
  // An extra whose optId no longer exists in the menu must be skipped, not crash.
  ['TodayTab(orphan extra)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}-gone`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'no-such-session', level: 2, name: 'Deleted session', minutes: 30, out: {} } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  // Whatever is put on the day IS the day's main session, log and all. There is
  // no "swapped" any more, because there is nothing left for it to be swapped FROM.
  ['TodayTab(main session, logged)', <TodayTab plan={plan}
    entries={[{ id: 's', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'unilateral', level: 2, name: 'Unilateral Sub-Threshold Block Set', minutes: 12,
        out: { targetKg: 16, rpe: 3 }, adjuncts: ['warmup'] } }]} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      if (/Swapped/.test(t)) throw new Error('the swap label survived the recommender')
      if (!/Unilateral Sub-Threshold Block Set/.test(t)) throw new Error('the logged session is not on the day')
    }],
  // A hard session on the day: the set log has to come from THAT session.
  ['TodayTab(hard session, logged)', <TodayTab plan={plan}
    entries={[{ id: 's2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, name: 'Bouldering 4×4s', minutes: 80,
        out: { angle: 25, falls: 1, sets: { circuits: [{reps:4},{reps:4}] } } } }]}
    upsertEntry={noop} deleteEntry={noop} />],
  /* The Monday split and the sessions added on 2026-08-10, with the logs their
   * charts actually read from. */
  ['TodayTab(the Monday pair)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'max-hangs', level: 4, name: 'Max hangs', minutes: 15, done: true,
        out: { maxLoad: 219, rpe: 7, fingers: 2, skin: 2,
          sets: { maxhang: [{ reps: 1, seconds: 7, weight: 45 }, { reps: 1, seconds: 7, weight: 45 }] },
          signs: { maxhang: '+' } } } },
    { id: `daily-${TODAY}-repeaters`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'repeaters', level: 4, name: 'Repeaters', minutes: 20, done: false,
        out: { repLoad: 20, sets: { repeaters: [{ reps: 12, weight: 20 }] }, signs: { repeaters: '-' } } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  ['TodayTab(crimp crawls logged)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'crawls', level: 3, name: 'Crimp crawls', minutes: 22, done: true,
        out: { stair: 2, pump: 4, rpe: 6, fingers: 2, skin: 3, draws: true,
          sets: { crawl: [{ seconds: 180, stair: 2 }, { seconds: 180, stair: 2 }], allout: [{ seconds: 145 }] },
          notes: 'All-out set fell apart at 2:25 — fumbled the second clip.' } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  ['TodayTab(peak force test day)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'mvc-test', level: 4, name: 'Peak force test', minutes: 20, done: true,
        out: { leftKg: 50.4, rightKg: 48.6, rpe: 7, fingers: 2,
          sets: { pullLeft: [{ seconds: 5, weight: 50.4 }], pullRight: [{ seconds: 5, weight: 48.6 }] } } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  // The retired pre-split card: nothing may offer it, and a day logged against
  // it years of entries ago must still render its name and its sets.
  ['TodayTab(retired session in history)', <TodayTab plan={plan} entries={[
    { id: 'old', kind: 'daily', date: back(120), updatedAt: 'z',
      data: { slot: 'main', optId: 'hard-home', level: 4, name: 'Max hangs + repeaters', minutes: 25, done: true,
        out: { maxLoad: 219, rpe: 7, fingers: 2 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
  /* The reasons and the notes box are two questions, with room between them. */
  ['RestPrompt(a gap between the reasons and Notes)',
    <RestPrompt opt={plan.dailyMenu.find(m => m.role === 'rest')} onSave={noop} onClose={noop} />,
    (html) => {
      if (!/class="out-field rest-why"[\s\S]*?notefield-label">Notes</.test(html)) throw new Error('the reasons run straight into Notes')
    }],
  ['TodayTab(a planned session on the day)', <TodayTab plan={plan} entries={[PLANNED_ENTRY]}
    upsertEntry={noop} deleteEntry={noop} onPlan={noop} onLog={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes(PRESCRIPTION.title)) throw new Error('the day names it "Planned workout" instead of its title')
      // What it holds says it has sets in it; the "planned" chip went (#41).
      if (!/\d+ sets/.test(t)) throw new Error('nothing marks it as a session with sets in it')
      if (/plannedchip/.test(html)) throw new Error('the "planned" chip is back')
      // The "and another one" button went with "Log another" (#41): the + plans another.
      if (/Plan another workout/.test(t)) throw new Error('the "Plan another" button is back under the day')
    }],
  // It asks WHY before it logs — the reasons are the rest card's own output, so
  // they must render here and the answer must be the same field the sheet edits.
  ['RestPrompt(asks why before logging)',
    <RestPrompt opt={plan.dailyMenu.find(m => m.role === 'rest')} onSave={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      for (const w of ['Why rest today?', 'Sick', 'Travelling', 'Planned recovery', 'Log the rest day']) {
        if (!t.includes(w)) throw new Error(`no "${w}"`)
      }
      if (!/<textarea/.test(html)) throw new Error('no box for his own words')
      if (!/notefield-label">Notes</.test(html)) throw new Error('the notes box is not labelled "Notes"')
      if (/In your own words/.test(t)) throw new Error('the second label for the notes box is back')
      // A forgotten rest day is logged after the fact, so the day is choosable,
      // with the day switcher rather than a browser date box (#41).
      if (!/class="dayswitch"/.test(html) || !/aria-label="Previous day"/.test(html)) throw new Error('a rest day can only be logged for today')
      if (/type="date"/.test(html)) throw new Error('the raw date input is back')
    }],
  ['RestPrompt(opens on the day it was asked from)',
    <RestPrompt opt={plan.dailyMenu.find(m => m.role === 'rest')} date="2026-09-20"
      entryFor={() => null} onSave={noop} onClose={noop} />,
    (html) => {
      if (!text(html).includes(dayWords('2026-09-20'))) throw new Error('the prompt ignored the day it was opened on')
    }],
  // What the user said about a rest day shows ON the rest day, in Your day and in the
  // log — not only inside the sheet (2026-09-25).
  ['TodayTab(a rest day says why)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'off', level: 1, name: 'Rest day', minutes: 0, done: true,
        out: { why: 'sick', notes: 'Head cold, stayed in bed' } } }]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes('Sick')) throw new Error('the reason is not on the row')
      if (!t.includes('Head cold, stayed in bed')) throw new Error('the note is not on the row')
    }],
  // A FRESH INSTALL. content/starter.json is the first thing a stranger's
  // install renders: the catalogs, the rest card and two plain climbing cards (#97).
  ['starter: TodayTab', <TodayTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['example: TodayTab', <TodayTab plan={example} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  // A climbing night's row says what was climbed, in the Log's own line (#97, F2):
  // it read "1 set", the set log's container.
  ['TodayTab(a climbing row says what was climbed, not "1 set")', <TodayTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, done: true, out: { minutesSpent: 40, sets: { routes: [{ reps: 5, climbs: [
        { grade: 10.2, outcome: 'send' }, { grade: 9.2, outcome: 'send' }, { grade: 10.3, outcome: 'fell' },
        { grade: 9.2, outcome: 'flash' }, { grade: 8.2, outcome: 'send' }] }] } } } },
  ]} />,
    (html) => {
      const t = text(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      if (!/40 min · 5 routes · hardest 5\.10/.test(t)) throw new Error(`the climbing row: ${t.slice(t.indexOf('Sport climbing'), t.indexOf('Sport climbing') + 120)}`)
      if (/1 set\b/.test(t)) throw new Error('the row counts the set log, not the climbs')
    }],
]
