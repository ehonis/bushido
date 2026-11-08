/* Smoke cases: the Log tab.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { LogTab } from '../src/log.jsx'
import {
  plan, starter, entries, noop, TODAY, back, rich, text, isoShift, LEGACY, LEGACY_WORDS,
} from './fixtures.jsx'

export default [
  ['LogTab', <LogTab plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} />],
  ['LogTab(empty)', <LogTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      if (!/class="empty"/.test(html) || !/Nothing logged yet/.test(text(html))) throw new Error('an empty log should say so in an .empty')
      if (/class="filters/.test(html)) throw new Error('filters over an empty log filter nothing')
    }],
  /* The feed reads the rename too — it computes each row's name live rather than
     trusting `data.name`, which is what makes a rename land on every surface at
     once. A commute also wears its "just miles" tag here. */
  ['LogTab(a renamed commute)', <LogTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: 'lc1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 1, name: 'Bike', minutes: 22, done: true,
        training: false, out: { activity: 'bike', duration: 22, title: 'Commute', titleFrom: 'casual' } } },
  ]} />,
    html => {
      const t = text(html)
      if (!/Commute/.test(t)) throw new Error('the feed row ignored the rename')
      if (!/just miles/.test(t)) throw new Error('a commute should still say what it is')
      // Its category differs from its name, so the row says it once: "Bike · 22 min · just miles".
      if (!/Bike · 22 min · just miles/.test(t)) throw new Error(`the commute's line read wrong: ${t.match(/list-row-meta">([^<]*)/)?.[1]}`)
    }],
  /*
   * Wave 2 (issue #43): one card per day, the workouts as rows. Pinned from both
   * sides: the day is a sentence-case section head with no count, the rows live
   * in ONE card per day, and the old shape (a card per workout under a
   * capitalised date with "N workouts", and a down chevron as if the row opened
   * in place) is gone.
   */
  ['LogTab(one card per day, workouts as rows, a header like "Fri 23 Oct")', <LogTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: 'r1', kind: 'daily', date: isoShift(TODAY, -3), updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 32, distance: 3.1, rpe: 5 } } },
    { id: 'r2', kind: 'daily', date: isoShift(TODAY, -3), updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike', duration: 60, distance: 18, rpe: 6 } } },
    { id: 'r3', kind: 'daily', date: isoShift(TODAY, -5), updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 40, distance: 4, rpe: 6 } } },
  ]} />,
    (html) => {
      const t = text(html)
      const heads = [...t.matchAll(/<div class="section-head"><h3>([^<]*)<\/h3>/g)].map(m => m[1])
      if (heads.length !== 2) throw new Error(`expected two day heads, got ${heads}`)
      for (const h of heads) {
        if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)( \d{4})?$/.test(h)) {
          throw new Error(`a day head read "${h}", not like "Fri 23 Oct"`)
        }
      }
      if ((t.match(/class="card list logday-list"/g) || []).length !== 2) throw new Error('not one card per day')
      if ((t.match(/class="list-row logrow/g) || []).length !== 3) throw new Error('each workout should be one row')
      if (/\d workouts?</.test(t)) throw new Error('the day head still counts its workouts')
      if (/logcard|logday-head|logday-n/.test(html)) throw new Error('the card-per-workout feed is back')
      if (/lucide-chevron-down|aria-expanded/.test(html)) throw new Error('a row looks like it opens in place; it opens the sheet')
      if (!/lucide-chevron-right/.test(html)) throw new Error('a row has no chevron to say it opens')
      // A row says its name once and its time and distance after it, nothing in capitals.
      if (/>Run<\/span><span class="list-row-meta">Run/.test(t)) throw new Error('the category echoes the name')
      if (!/32 min · 3\.1 mi/.test(t)) throw new Error('the row line should be time · distance')
      if (/RPE/.test(t)) throw new Error('a bare "RPE" is on a row')
      if (/text-transform|logcard-cat/.test(html)) throw new Error('small capitals on the feed')
    }],
  /* Untitled free-form workouts used to be named after the button that made them
     ("Log a workout"). A row is named by its activity, and with none yet it is a
     workout. */
  ['LogTab(an untitled workout is named by its activity)', <LogTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: 'u1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, name: 'Log a workout', out: { activity: 'swim', duration: 30 } } },
    { id: 'u2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, name: 'Log a workout', out: { duration: 20 } } },
  ]} />,
    (html) => {
      const titles = [...text(html).matchAll(/list-row-title">([^<]*)</g)].map(m => m[1])
      if (titles.includes('Log a workout')) throw new Error(`a row is named after the button: ${titles}`)
      if (!titles.includes('Swim')) throw new Error(`the swim is not named by its activity: ${titles}`)
      if (!titles.includes('Workout')) throw new Error(`a workout with no activity yet should read "Workout": ${titles}`)
    }],
  // Filters: "All" and the categories actually logged, no counts, and none at all
  // when there is only one thing to show.
  ['LogTab(filters are All plus what you log, chips that fit)', <LogTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      const chips = [...t.matchAll(/<button class="chip[^"]*"[^>]*>([^<]*)<\/button>/g)].map(m => m[1])
      if (chips[0] !== 'All') throw new Error(`the first filter should be All: ${chips}`)
      if (chips.length < 2) throw new Error('more than one category is logged, so there is something to filter')
      if (/<em>/.test(t) || chips.some(c => /\d/.test(c))) throw new Error(`a count rides in a chip: ${chips}`)
      const named = (plan.quotaCategories || []).map(c => c.name)
      for (const c of chips.slice(1)) if (!named.includes(c)) throw new Error(`"${c}" is not a category`)
    }],
  ['LogTab(one category, no filters)', <LogTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: 'o1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 30 } } },
  ]} />,
    (html) => { if (/class="filters/.test(html)) throw new Error('a filter with one choice is not a choice') }],
  // The split gym night, which is the shape per-session minutes exist for: two
  // workouts on one date, each with its own time, adding up to the day.
  ['LogTab(two sessions, one day)', <LogTab plan={plan} entries={[
    { id: 'g1', kind: 'daily', date: '2026-08-13', updatedAt: 'z',
      data: { slot: 'main', optId: 'board', level: 4, name: 'Gym: board', done: true,
        minutes: 105, minutesSource: 'typed', out: { rpe: 8, fingers: 3 } } },
    { id: 'g2', kind: 'daily', date: '2026-08-13', updatedAt: 'z',
      data: { slot: 'main', optId: 'lead-laps', level: 3, name: 'Doubled lead laps', done: true,
        minutes: 25, minutesSource: 'typed', out: { rpe: 6, fingers: 2 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />,
    (html) => { if ((text(html).match(/class="card list logday-list"/g) || []).length !== 1) throw new Error('one day, one card') }],
  // An old log's check-ins, journal days, quotas and achievements are history the
  // app no longer reads (issue #31): the Log renders, and none of them is a workout.
  ['LogTab(legacy entries are not workouts)', <LogTab plan={plan} entries={[...LEGACY, ...entries]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      if (LEGACY_WORDS.test(t)) throw new Error(`a removed feature's data is in the log: ${t.match(LEGACY_WORDS)}`)
    }],
  // The empty log holds the one button that fills it, when the shell hands it over.
  ['LogTab(the empty log offers "Log a workout")', <LogTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} onLog={noop} />,
    (html) => {
      const empty = text(html).match(/<div class="empty">[^]*?<\/div>/)?.[0] || ''
      if (!/<button type="button" class="btn">Log a workout<\/button>/.test(empty)) throw new Error('the empty log has no way to fill it')
    }],
  // Row icons wear the list row's own ink; the accent is the +'s on this screen.
  ['LogTab(row icons are the row\'s own ink)', <LogTab plan={plan} entries={rich} upsertEntry={noop} deleteEntry={noop} />,
    (html) => { if (/logrow-ico/.test(html)) throw new Error('a local override is colouring the row icons again') }],
  ['LogTab(a rest day says why)', <LogTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: 'daily-2026-09-20', kind: 'daily', date: '2026-09-20', updatedAt: 'z',
      data: { slot: 'main', optId: 'off', level: 1, name: 'Rest day', minutes: 0, done: true,
        out: { why: 'travel', notes: 'Flight to Denver' } } }]} />,
    (html) => {
      const t = text(html)
      if (!t.includes('Travelling')) throw new Error('the reason is not on the log row')
      if (!t.includes('Flight to Denver')) throw new Error('the note is not on the log row')
    }],
  ['starter: LogTab', <LogTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
]
