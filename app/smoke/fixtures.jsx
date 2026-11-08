/* Shared fixtures for the smoke cases (app/smoke/*.jsx): the test plan, the starter and
 * the example, real-shaped entries and planned workouts. Moved out of app/smoke.jsx in
 * #73, unchanged. Paths are relative to this directory: the bundle the runner builds
 * (app/smoke/.smoke.mjs) sits here too.
 */
import { readFileSync } from 'node:fs'
import {
  normalizePrescription, prescriptionSteps, emptyRun, markSet,
} from '../src/lib/prescription.js'
import { createRequire } from 'node:module'
import { buildSections } from '../src/session.jsx'
import { localIso } from '../src/lib/dates.js'

export const plan = JSON.parse(readFileSync(new URL('../../test/fixtures/plan.json', import.meta.url), 'utf8'))
/* What a fresh install runs on: the catalogs, no programme. See app/starter.build.mjs. */
export const starter = JSON.parse(readFileSync(new URL('../../content/starter.json', import.meta.url), 'utf8'))
/* The invented example plan, as Settings → "Use the example plan" imports it. */
export const example = JSON.parse(readFileSync(new URL('../../examples/plan.json', import.meta.url), 'utf8'))
/* A plan with no climbing cards: the example, less the starter's two (#97). */
export const noClimbing = { ...example, dailyMenu: example.dailyMenu.filter(m => m.discipline !== 'climbing') }

/*
 * An invented Strava cache: one bike, one pair of shoes, an athlete with a
 * picture. Fixed rather than read from data/, so every case runs the same way in
 * CI and on a machine that has a real cache, and nobody's data is in the output.
 */
export const STRAVA_CACHE = {
  fetchedAt: '2026-09-20T12:00:00.000Z',
  athlete: { id: 1, name: 'Sam Rivera', firstname: 'Sam', profileMedium: 'https://example.com/avatar.png' },
  gear: {
    b1: { id: 'b1', name: 'Test Gravel Bike', kind: 'bike', distanceMi: 1234.5, primary: true, retired: false },
    g1: { id: 'g1', name: 'Test Trainers', kind: 'shoe', distanceMi: 210.2, primary: true, retired: false },
  },
  activities: [],
}

export const entries = [
  { id: 'a', kind: 'maxhang', date: '2026-05-20', updatedAt: '2026-05-20T10:00:00Z', data: { edgeMm: 20, addedLb: 35, seconds: 10 } },
  { id: 'b', kind: 'maxhang', date: '2026-07-29', updatedAt: '2026-07-29T10:00:00Z', data: { edgeMm: 20, addedLb: 38, seconds: 10 } },
  { id: 'c', kind: 'bodyweight', date: '2026-05-20', updatedAt: '2026-05-20T10:00:00Z', data: { lb: 152 } },
  { id: 'd', kind: 'bodyweight', date: '2026-07-29', updatedAt: '2026-07-29T10:00:00Z', data: { lb: 150 } },
  { id: 'e', kind: 'daily', date: '2026-08-01', updatedAt: '2026-08-01T10:00:00Z', data: { level: 2, name: 'Long/density hangs', minutes: 14 } },
  { id: 'f', kind: 'test', date: '2026-08-03', updatedAt: '2026-08-03T10:00:00Z', data: { testId: 'mvc7', addedLb: 40, bodyweightLb: 150, pctBw: 127 } },
  { id: 'g', kind: 'test', date: '2026-09-07', updatedAt: '2026-09-07T10:00:00Z', data: { testId: 'mvc7', addedLb: 42, bodyweightLb: 149, pctBw: 128 } },
  { id: 'h', kind: 'gear', date: '2026-08-01', updatedAt: '2026-08-01T10:00:00Z', data: { item: 'x', bought: true } },
  { id: 'i', kind: 'note', date: '2026-08-01', updatedAt: '2026-08-01T10:00:00Z', data: { text: 'skin fine' } },
]

export const noop = () => {}
/* The free-form card, and one previous lifting day for the "last time" lookup. */
export const otherCard = JSON.parse(readFileSync(new URL('../../test/fixtures/plan.json', import.meta.url), 'utf8'))
  .dailyMenu.find(m => m.id === 'log-workout')
export const priorLifts = [{
  id: 'lift-prior', kind: 'daily', date: '2026-09-02', updatedAt: 'z',
  data: { optId: 'log-workout', name: 'Lift', level: 2, done: true, out: { activity: 'lift', lifts: [
    { uid: 'bent-over-row-1', key: 'bent-over-row', name: 'Bent-over row', implement: 'dumbbell',
      implementLabel: 'Dumbbell', sets: [{ reps: 5, weight: 175 }] },
  ] } },
}]
/*
 * TODAY, in the app's own terms.
 *
 * This was `new Date().toISOString().slice(0, 10)` — UTC — while every screen in
 * the app dates a day with `localIso()`. The two agree for most of the day and
 * disagree between evening and midnight local, so from 8pm EDT onward every
 * fixture dated "today" landed on TOMORROW and the day list rendered empty. The
 * suite failed three cases at 22:35 on 2026-09-17 with nothing having changed but
 * the clock.
 *
 * A training log is kept in local days — a session at 11pm is that evening's, not
 * the next morning's — so the app is right and the suite was wrong. Using the
 * same helper is the only way they cannot drift apart again.
 */
export const TODAY = localIso()
/** N days before today, for scenarios that have to sit relative to the real date. */
export const back = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// A full season's worth of shapes, so every chart in ProgressView has data.
export const rich = [
  ...entries,
  { id: 'd1', kind: 'daily', date: '2026-08-03', updatedAt: 'z', data: { optId: 'hard-home', level: 4, name: 'Max hangs + repeaters', minutes: 25, out: { maxLoad: 219, rpe: 8, fingers: 3, skin: 2,
    sets: { maxhang: [{reps:1,seconds:7,weight:43},{reps:1,seconds:7,weight:43},{reps:1,seconds:7,weight:38}],
            repeaters: [{reps:12,weight:20},{reps:8,weight:20}] },
    signs: { maxhang: '+', repeaters: '-' } }, adjuncts: ['warmup','walk-rest'] } },
  { id: 'd2', kind: 'daily', date: '2026-08-04', updatedAt: 'z', data: { optId: 'subthreshold', level: 1, name: 'Sub-threshold hangs', minutes: 10, out: { load: 104, rpe: 3, fingers: 1 } } },
  { id: 'd3', kind: 'daily', date: '2026-08-06', updatedAt: 'z', data: { optId: 'hard-gym', level: 4, name: 'Gym: board + laps', minutes: 150, out: { angle: 25, problems: 9, doubles: 3, rpe: 9, fingers: 4, skin: 3 } } },
  { id: 'd4', kind: 'daily', date: '2026-08-07', updatedAt: 'z', data: { optId: 'economy', level: 2, name: 'Grip economy drill', minutes: 12, out: { laps: 5, openHand: true, rpe: 4, fingers: 2 } } },
  { id: 'd5', kind: 'daily', date: '2026-08-09', updatedAt: 'z', data: { optId: 'off', level: 1, name: 'Deliberate rest' } },
  // deliberately over the cap, to exercise the 'over' tone and the warn tile
  { id: 'd6', kind: 'daily', date: '2026-08-10', updatedAt: 'z', data: { optId: 'hard-home', level: 4, name: 'Max hangs + repeaters', minutes: 25, out: { rpe: 8, fingers: 3, skin: 2,
    sets: { maxhang: [{reps:1,seconds:7,weight:45},{reps:1,seconds:7,weight:45},{reps:1,seconds:7,weight:43},{reps:1,seconds:7,weight:40}],
            repeaters: [{reps:12,weight:15},{reps:11,weight:15},{reps:9,weight:15}] },
    signs: { maxhang: '+', repeaters: '-' } } } },
  { id: 'd7', kind: 'daily', date: '2026-08-12', updatedAt: 'z', data: { optId: 'hard-gym', level: 4, name: 'Gym: board + laps', minutes: 150, out: { angle: 25, problems: 9, doubles: 3, rpe: 9, fingers: 4, skin: 3 } } },
  { id: 'd8', kind: 'daily', date: '2026-08-14', updatedAt: 'z', data: { optId: 'hard-home', level: 4, name: 'Max hangs + repeaters', minutes: 25, out: { maxLoad: 219, repLoad: 185, totalReps: 31, rpe: 8, fingers: 3, skin: 2 } } },
  { id: 't1', kind: 'test', date: '2026-08-10', updatedAt: 'z', data: { testId: 'mvc-block', leftKg: 47, rightKg: 49, avgKg: 48 } },
  { id: 't2', kind: 'test', date: '2026-08-31', updatedAt: 'z', data: { testId: 'mvc-block', leftKg: 49, rightKg: 51, avgKg: 50 } },
  { id: 't3', kind: 'test', date: '2026-08-06', updatedAt: 'z', data: { testId: 'lap-test', laps: 7, rpe: 8 } },
  { id: 't4', kind: 'test', date: '2026-09-10', updatedAt: 'z', data: { testId: 'lap-test', laps: 9, rpe: 8 } },
  { id: 't5', kind: 'test', date: '2026-08-06', updatedAt: 'z', data: { testId: 'rep60', seconds: 150, reps: 15 } },
  { id: 't6', kind: 'test', date: '2026-09-10', updatedAt: 'z', data: { testId: 'rep60', seconds: 158, reps: 16 } },
  { id: 't7', kind: 'test', date: '2026-08-06', updatedAt: 'z', data: { testId: 'boulder-repeat', ascents: 6, angle: 25 } },
  // The two new sessions, with the outputs their charts read from.
  { id: 'd9', kind: 'daily', date: '2026-09-17', updatedAt: 'z', data: { optId: 'four-by-four', level: 4, name: 'Bouldering 4×4s', minutes: 80, out: { angle: 25, setRest: 300, falls: 1, rpe: 8, fingers: 3, skin: 3,
    sets: { circuits: [{reps:4},{reps:4},{reps:4},{reps:3}] } } } },
  { id: 'd10', kind: 'daily', date: '2026-09-24', updatedAt: 'z', data: { optId: 'four-by-four', level: 4, name: 'Bouldering 4×4s', minutes: 80, out: { angle: 25, setRest: 270, falls: 0, rpe: 8, fingers: 3, skin: 4,
    sets: { circuits: [{reps:4},{reps:4},{reps:4},{reps:4}] } } } },
  { id: 'd12', kind: 'daily', date: '2026-09-17', updatedAt: 'z', data: { slot: 'extra', optId: 'lead-laps', level: 3, name: 'Doubled lead laps', minutes: 30, done: true, out: { shakeouts: true, rpe: 6, fingers: 2,
    // A grade per LAP, and the two laps of a set are not always the same route —
    // e.g. one double at 5.10 twice, one at 5.10− then 5.10.
    sets: { doubles: [{reps:2, grades:[10.2,10.2]},{reps:2, grades:[10.1,10.2]}] } } } },
  { id: 'd11', kind: 'daily', date: '2026-09-18', updatedAt: 'z', data: { optId: 'abrahangs', level: 1, name: 'Abrahangs — low-intensity no-hangs', minutes: 12, out: { loadKg: 15, twoFingerKg: 7, noPump: true, rpe: 2, fingers: 1,
    sets: { fourFinger: [{reps:6}], frontThree: [{reps:6}], twoFinger: [{reps:8}] } } } },
  // The fun days chart the hardest thing climbed WHICHEVER way it was logged —
  // one entry per pair uses the session-level field, one the per-climb detail,
  // so turning the detail on must not restart either series.
  { id: 'd13', kind: 'daily', date: '2026-09-19', updatedAt: 'z', data: { slot: 'extra', optId: 'fun-boulder', level: 2, name: 'Bouldering with friends', minutes: 90, done: true,
    out: { intensity: 2, hardest: 4, rpe: 5, fingers: 2, sets: { problems: [{ reps: 8 }] } } } },
  { id: 'd14', kind: 'daily', date: '2026-09-26', updatedAt: 'z', data: { slot: 'extra', optId: 'fun-boulder', level: 3, name: 'Bouldering with friends', minutes: 90, done: true,
    out: { intensity: 3, rpe: 6, fingers: 2,
      sets: { problems: [{ reps: 3, climbs: [
        { grade: 5, fell: false, felt: 1, style: 'overhang' },
        { grade: 3, fell: true, felt: '', style: 'slab' },
        { grade: '', fell: false, felt: '', style: '' },
      ] }] } } } },
  { id: 'd15', kind: 'daily', date: '2026-09-20', updatedAt: 'z', data: { slot: 'extra', optId: 'fun-sport', level: 2, name: 'Sport climbing for fun', minutes: 120, done: true,
    out: { intensity: 2, hardestYds: 10.2, rpe: 5, fingers: 2 } } },
  { id: 'd16', kind: 'daily', date: '2026-09-27', updatedAt: 'z', data: { slot: 'extra', optId: 'fun-sport', level: 2, name: 'Sport climbing for fun', minutes: 120, done: true,
    out: { intensity: 2, rpe: 5, fingers: 2,
      sets: { routes: [{ reps: 2, climbs: [
        { grade: 10.3, fell: true, felt: 2, style: 'vert' },
        { grade: 10.1, fell: false, felt: 0, style: 'dihedral' },
      ] }] } } } },
]
// Two earlier runs of the same session, each with notes, so the repeat lookup has
// something to find. A tombstoned entry and a different session are in here too:
// neither may leak into the history.
export const noteHistory = [
  { id: 'n1', kind: 'daily', date: '2026-09-17', updatedAt: 'z', data: { optId: 'four-by-four', level: 4, minutes: 80,
    out: { rpe: 8, fingers: 3, notes: 'Grip opened on circuit 4; first two felt easy.',
           improve: 'Start the timer before chalking. Drop a grade on problem 3.' } } },
  { id: 'n2', kind: 'daily', date: '2026-09-24', updatedAt: 'z', data: { optId: 'four-by-four', level: 4, minutes: 80,
    out: { rpe: 7, fingers: 2, notes: 'Much better with the longer rest.', improve: 'Try 4:30 between circuits.' } } },
  { id: 'n3', kind: 'daily', date: '2026-09-30', updatedAt: 'z', deleted: true,
    data: { optId: 'four-by-four', out: { notes: 'tombstoned, must not appear' } } },
  { id: 'n4', kind: 'daily', date: '2026-09-20', updatedAt: 'z',
    data: { optId: 'hard-home', out: { notes: 'different session, must not appear' } } },
]

/* A first calibration day — peak force both arms, then
 * the 4-min all-out critical force test on the right. Plus a later retest, so
 * the charts have a series rather than a single point. */
export const cfEntries = [
  { id: 'mvc-0808', kind: 'test', date: '2026-08-08', updatedAt: '2026-08-09T03:45:14.214Z',
    data: { testId: 'mvc-block', leftKg: 50.4, rightKg: 48.6 } },
  { id: 'cf-0808', kind: 'test', date: '2026-08-08', updatedAt: '2026-08-09T03:50:00.000Z',
    data: { testId: 'critical-force', cfKg: 18.2, mvcKg: 48.6 } },
  { id: 'cf-0919', kind: 'test', date: '2026-09-19', updatedAt: 'z',
    data: { testId: 'critical-force', cfKg: 20.4, cfMinKg: 19.1, impulseKgS: 168, mvcKg: 49.0 } },
  { id: 'bw-0803', kind: 'bodyweight', date: '2026-08-03', updatedAt: 'z', data: { lb: 186 } },
]

/* React SSR splits adjacent text nodes with <!-- -->, so assertions that care
 * about rendered wording have to read through it. */
export const text = (html) => html.replace(/<!--.*?-->/g, '')
export const isoShift = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }

/** Just the first calibration day, with no later retest to supersede it. */
export const augOnly = cfEntries.filter(e => e.date === '2026-08-08')

export const uniWork = buildSections(plan.dailyMenu.find(m => m.id === 'unilateral'))
  .find(sec => sec.loadCeiling)

/* ------------------------------------------------ a planned workout fixture
 *
 * Built through `normalizePrescription` rather than written as a literal, so the
 * fixture cannot drift from the shape the real planner's output is forced
 * through — and so a change to the normaliser fails here rather than on a phone.
 */
export const LIFT_FIELD = (() => {
  for (const opt of plan.dailyMenu) for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  return null
})()
export const SQUAT = LIFT_FIELD.exercises.find(e => /squat/i.test(e.name)) || LIFT_FIELD.exercises[0]

export const PRESCRIPTION = normalizePrescription({
  title: 'Legs', category: 'lift', activity: 'lift', minutes: 45,
  why: 'Your last two leg days both sat at RPE 6 with the same load, so this adds five pounds.',
  notes: ['Stop a rep short on the last set if the bar speed drops.'],
  blocks: [
    { name: 'Warm-up', note: 'Ten minutes, nothing heavy.',
      items: [{ kind: 'interval', name: 'Bike easy', sets: [{ seconds: 600, restSec: 0 }] }] },
    { name: 'Main', items: [{
      kind: 'lift', name: 'squat', exercise: SQUAT.key, implement: 'barbell',
      note: 'Drive through the heel.',
      sets: [
        { reps: 8, weight: 135, restSec: 90 },
        { reps: 8, weight: 135, restSec: 90 },
        { reps: 6, weight: 155, restSec: 120 },
      ],
    }] },
  ],
}, { liftField: LIFT_FIELD })

/* A gym trip: legs, then a run home. One session, two quotas, and a movement the
 * catalog knows the muscles for — every one of 2026-09-17's last three asks. */
export const TRIP = normalizePrescription({
  title: 'Legs + run home', category: 'lift', activity: 'lift', minutes: 60, why: 'w',
  blocks: [
    { name: 'Warm-up', note: 'Five easy minutes.', items: [] },
    { name: 'Legs', category: 'lift', items: [{
      kind: 'lift', name: 'squat', exercise: SQUAT.key, implement: 'barbell',
      sets: [{ reps: 5, weight: 185, restSec: 150 }, { reps: 5, weight: 185, restSec: 150 }],
    }] },
    { name: 'Run home', category: 'run', items: [{
      kind: 'interval', name: '3 miles easy', unit: 'mi', sets: [{ distance: 3 }],
    }] },
  ],
}, { liftField: LIFT_FIELD })

/* Three days of the log, for the quick-log rows: a run, a ride, then a row, plus a
 * second run and a climb that must not count. Newest distinct first: row, run, ride. */
export const QUICK_LOG = [
  ['2026-10-19', 'run'], ['2026-10-20', 'mtb'], ['2026-10-21', 'run'], ['2026-10-22', 'rowing'],
].map(([date, activity]) => ({
  id: `daily-${date}`, kind: 'daily', date, updatedAt: 'z',
  data: { optId: 'log-workout', name: activity, done: true, out: { activity } },
})).concat([{ id: 'daily-2026-10-22-max-hangs', kind: 'daily', date: '2026-10-22', updatedAt: 'z',
  data: { optId: 'max-hangs', slot: 'extra', done: true, out: {} } }])

/* One previous leg day, so "what did I do last time" has something to find. */
export const PRIOR_LIFTS = [{
  id: 'prior-legs', kind: 'daily', date: '2026-09-10', updatedAt: 'z',
  data: { optId: 'log-workout', name: 'Lift', done: true, out: { activity: 'lift', lifts: [{
    uid: 'x', key: SQUAT.key, name: SQUAT.name, implement: 'barbell', implementLabel: 'Barbell',
    sets: [{ reps: 5, weight: 175 }, { reps: 5, weight: 175 }],
  }] } },
}]

export const PLANNED_CARD = plan.dailyMenu.find(m => m.id === 'planned')
export const PLANNED_ENTRY = {
  id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
  data: {
    slot: 'main', optId: 'planned', name: PRESCRIPTION.title, minutes: 45, level: 2,
    done: false, plan: PRESCRIPTION, out: { activity: 'lift', category: 'lift' },
  },
}

/* ------------------------------------------- the shared exercise library (#63)
 *
 * The fixture plan with the test library merged in, as /api/content serves it:
 * holds (`measure: "time"`), how-tos, a video, a library-only exercise with no
 * how-to at all.
 */
// The server's own merge, required at run time: it is CommonJS and reads files.
export const { mergeLibrary } = createRequire(import.meta.url)('../../server/library.js')
export const LIBRARY = JSON.parse(readFileSync(new URL('../../test/fixtures/exercises.json', import.meta.url), 'utf8'))
export const HELD_PLAN = mergeLibrary(plan, LIBRARY)
export const HELD_CARD = HELD_PLAN.dailyMenu.find(m => m.id === 'log-workout')
export const HELD_FIELD = HELD_CARD.outputs.find(f => f.type === 'lifts')
export const HELD_ENTRY = {
  ...PLANNED_ENTRY,
  data: { ...PLANNED_ENTRY.data, plan: normalizePrescription({
    title: 'Core', blocks: [{ name: 'Main', items: [
      { kind: 'lift', exercise: 'plank', implement: 'bodyweight', sets: [{ seconds: 45 }, { seconds: 45 }, { seconds: 45 }] },
      { kind: 'lift', exercise: 'dead-bug', implement: 'bodyweight', sets: [{ reps: 10 }] },
    ] }],
  }, { liftField: HELD_FIELD }) },
}

/* Mid-session, ninety seconds into a rest — the state the runner has to be able
   to rebuild from an entry alone after the app was closed. */
export const RESTING_RUN = (() => {
  const steps = prescriptionSteps(PRESCRIPTION)
  return markSet(emptyRun(Date.now() - 600_000), steps[1], { reps: 8, weight: 135, restSec: 90 },
    { at: Date.now() - 30_000, steps })
})()

/*
 * What an old log still carries from the features removed on 2026-10-25 (issue
 * #31): a week's quotas, a check-in, a journal day, an achievement. Stored data is
 * never rewritten, so every screen has to render with these in the log and show
 * none of them as a workout.
 */
export const LEGACY = [
  { id: `quota-${TODAY}`, kind: 'quota', date: TODAY, updatedAt: 'z', data: { counts: { pe: 2, bike: 3, swim: 1 } } },
  { id: `checkin-${TODAY}`, kind: 'checkin', date: TODAY, updatedAt: 'z', data: {
    fields: { weightLb: 150, feeling: 4 },
    messages: [{ role: 'you', at: 'z', text: 'no gym tonight' },
               { role: 'coach', at: 'z', text: 'Then it is the crimp crawls.' }] } },
  { id: `journal-${TODAY}`, kind: 'journal', date: TODAY, updatedAt: 'z', data: { values: { caffeine: true, alcohol: 2 } } },
  { id: 'journal-custom', kind: 'journal-custom', updatedAt: 'z', data: { metrics: [{ key: 'x-1', label: 'Sauna', type: 'toggle' }] } },
  { id: 'achievement-run-a-50k', kind: 'achievement', date: null, updatedAt: 'z',
    data: { id: 'run-a-50k', name: 'Run a 50k', categories: ['run'] } },
  // Not legacy: an interval-timer preset (#36), undated. It rides along to pin that
  // nothing #31 removed filters it out or trips over an entry with no date.
  { id: 'timer-last', kind: 'timer', updatedAt: 'z', data: { name: 'Last', work: 30, rest: 15, rounds: 8 } },
]
/** Words any of those would put on screen if a reader still rendered them. */
export const LEGACY_WORDS = /quota|This week|no gym tonight|crimp crawls\.|Sauna|Run a 50k|Achievement|Journal|Check in/i
