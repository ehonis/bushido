/* Render smoke test: mounts every tab against the real plan.json and real-shaped
 * entries, so a bad property access fails here instead of on the phone in a basement.
 * Run: npm run smoke
 */
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { TodayTab, SessionSheet, DaySwitcher, dayWords } from './src/tabs.jsx'
import { ToastList } from './src/toast.jsx'
import { pushToast, dismissToast, useToasts } from './src/lib/toast.js'
import { Undo2 } from 'lucide-react'
import { TestingTab, WhyTab } from './src/testing.jsx'
import {
  PlanFlow, PrescriptionEditor, KeptStep, PlanTalk, BuildStep, groupedKinds, liftFieldOf,
  DraftList, Working, KindStep,
} from './src/planner.jsx'
import { draftStep, draftPres, draftLine } from './src/lib/drafts.js'
import { WorkoutRunner } from './src/runner.jsx'
import { FabMenu, RestPrompt, ActingBanner, tabsFor } from './src/App.jsx'
import { QuickLog } from './src/quicklog.jsx'
import { ActivityPicker } from './src/activitypicker.jsx'
import { recentActivities, quickEntry } from './src/lib/quicklog.js'
import { _setMe } from './src/lib/whoami.js'
import { hasIcon } from './src/lib/icons.jsx'
import { plannerContext, aiOffered, noteAiRefusal, resetAiRefusal } from './src/lib/plannerapi.js'
import { ScreenCard, describeScreen } from './src/screeninfo.jsx'
import { ActivityChooser, activityGroups, activityFieldOf } from './src/picker.jsx'
import { climbingFolders } from './src/lib/folders.js'
import {
  normalizePrescription, prescriptionSteps, emptyRun, markSet, blankPrescription, appendLift,
} from './src/lib/prescription.js'
import { LogTab } from './src/log.jsx'
import { GearSection } from './src/gear.jsx'
import { ProfileMenu, ProfilePanel, PeopleCard, homePages } from './src/profile.jsx'
import { TheirSide } from './src/sharedwith.jsx'
import { sharedCopy } from './src/lib/shared.js'
import { SidesWorkout, PeopleDays, PersonDay, MyAbout, ForChoice, ForLine, SideSwitch, DayHead } from './src/trainer.jsx'
import { planPeople } from './src/lib/trainer.js'
import { PlanProvider } from './src/lib/planctx.jsx'
import { PrefsProvider } from './src/lib/prefs.jsx'
import { ProgressView } from './src/progress.jsx'
import { SessionLog, NameField, SessionDetails } from './src/sessionlog.jsx'
import { ExercisePicker, STEP } from './src/exercises.jsx'
import { buildSections, SectionBody } from './src/session.jsx'
import { HowSheet, MovesList, HowRow } from './src/howto.jsx'
import { FIGURES, hasFigure } from './src/lib/figures.jsx'
import { localIso } from './src/lib/dates.js'
import { resolveCeiling } from './src/lib/force.js'
import { WorkoutMode, Face, Review } from './src/workout.jsx'
import { WhoopProvider } from './src/lib/whoop.jsx'
import { WhoopWorkouts, WhoopReadiness, WhoopSleep, sleepSeries, sleepStats } from './src/whoop.jsx'
import { StravaProvider } from './src/lib/strava.jsx'
import { StravaActivities } from './src/strava.jsx'
import { UnloggedWorkouts } from './src/unlogged.jsx'
import { hasWorkout, buildSteps } from './src/lib/workout.js'
import { TimerHost, TimerSetup, TimerRun, openTimer, closeTimer, timerRequestFor } from './src/timer.jsx'
import { compile, startRun, presetList, sessionTimer, buildTimerEntry, buildLastTimerEntry, BUILT_INS } from './src/lib/timer.js'

const plan = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
/* What a fresh install runs on: the catalogs, no programme. See app/starter.build.mjs. */
const starter = JSON.parse(readFileSync(new URL('../content/starter.json', import.meta.url), 'utf8'))
/* The invented example plan, as Settings → "Use the example plan" imports it. */
const example = JSON.parse(readFileSync(new URL('../examples/plan.json', import.meta.url), 'utf8'))

/*
 * An invented Strava cache: one bike, one pair of shoes, an athlete with a
 * picture. Fixed rather than read from data/, so every case runs the same way in
 * CI and on a machine that has a real cache, and nobody's data is in the output.
 */
const STRAVA_CACHE = {
  fetchedAt: '2026-09-20T12:00:00.000Z',
  athlete: { id: 1, name: 'Sam Rivera', firstname: 'Sam', profileMedium: 'https://example.com/avatar.png' },
  gear: {
    b1: { id: 'b1', name: 'Test Gravel Bike', kind: 'bike', distanceMi: 1234.5, primary: true, retired: false },
    g1: { id: 'g1', name: 'Test Trainers', kind: 'shoe', distanceMi: 210.2, primary: true, retired: false },
  },
  activities: [],
}

const entries = [
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

const noop = () => {}
/* The free-form card, and one previous lifting day for the "last time" lookup. */
const otherCard = JSON.parse(readFileSync(new URL('../test/fixtures/plan.json', import.meta.url), 'utf8'))
  .dailyMenu.find(m => m.id === 'log-workout')
const priorLifts = [{
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
const TODAY = localIso()
/** N days before today, for scenarios that have to sit relative to the real date. */
const back = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// A full season's worth of shapes, so every chart in ProgressView has data.
const rich = [
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
const noteHistory = [
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
const cfEntries = [
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
const text = (html) => html.replace(/<!--.*?-->/g, '')
const isoShift = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10) }

/** Just the first calibration day, with no later retest to supersede it. */
const augOnly = cfEntries.filter(e => e.date === '2026-08-08')

const uniWork = buildSections(plan.dailyMenu.find(m => m.id === 'unilateral'))
  .find(sec => sec.loadCeiling)

/* ------------------------------------------------ a planned workout fixture
 *
 * Built through `normalizePrescription` rather than written as a literal, so the
 * fixture cannot drift from the shape the real planner's output is forced
 * through — and so a change to the normaliser fails here rather than on a phone.
 */
const LIFT_FIELD = (() => {
  for (const opt of plan.dailyMenu) for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  return null
})()
const SQUAT = LIFT_FIELD.exercises.find(e => /squat/i.test(e.name)) || LIFT_FIELD.exercises[0]

const PRESCRIPTION = normalizePrescription({
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
const TRIP = normalizePrescription({
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
const QUICK_LOG = [
  ['2026-10-19', 'run'], ['2026-10-20', 'mtb'], ['2026-10-21', 'run'], ['2026-10-22', 'rowing'],
].map(([date, activity]) => ({
  id: `daily-${date}`, kind: 'daily', date, updatedAt: 'z',
  data: { optId: 'log-workout', name: activity, done: true, out: { activity } },
})).concat([{ id: 'daily-2026-10-22-max-hangs', kind: 'daily', date: '2026-10-22', updatedAt: 'z',
  data: { optId: 'max-hangs', slot: 'extra', done: true, out: {} } }])

/* One previous leg day, so "what did I do last time" has something to find. */
const PRIOR_LIFTS = [{
  id: 'prior-legs', kind: 'daily', date: '2026-09-10', updatedAt: 'z',
  data: { optId: 'log-workout', name: 'Lift', done: true, out: { activity: 'lift', lifts: [{
    uid: 'x', key: SQUAT.key, name: SQUAT.name, implement: 'barbell', implementLabel: 'Barbell',
    sets: [{ reps: 5, weight: 175 }, { reps: 5, weight: 175 }],
  }] } },
}]

const PLANNED_CARD = plan.dailyMenu.find(m => m.id === 'planned')
const PLANNED_ENTRY = {
  id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
  data: {
    slot: 'main', optId: 'planned', name: PRESCRIPTION.title, minutes: 45, level: 2,
    done: false, plan: PRESCRIPTION, out: { activity: 'lift', category: 'lift' },
  },
}

/* Mid-session, ninety seconds into a rest — the state the runner has to be able
   to rebuild from an entry alone after the app was closed. */
const RESTING_RUN = (() => {
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
const LEGACY = [
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
const LEGACY_WORDS = /quota|This week|no gym tonight|crimp crawls\.|Sauna|Run a 50k|Achievement|Journal|Check in/i

const cases = [
  /*
   * One section per owner (docs/DESIGN.md, "Wave 2: who owns which file"). A batch adds
   * and edits cases only in its own section, so parallel PRs do not touch the same
   * lines; a PR that has to change a case in another section says so. Within a section
   * the cases keep the order they had.
   */

  // ===== shell: header, dock, + menu frame, acting banner (#29) =====

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

  // ===== batch A: Today and the session sheet =====

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
   * ABSENCES, which are the only thing a render test can say about a removal.
   *
   * The add-on pills and the "MAIN SESSION" strap came off the sheet as unused
   * clutter that got in the way. Putting either back is a
   * change that still renders, so asserting they are gone is the only way to
   * catch it — same argument as `TodayTab(empty day offers nothing)`.
   */
  ['SessionSheet(no add-ons, no strap)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'hard-home')
    const t = text(renderToString(
      <SessionSheet opt={opt} entry={null} tone="rec" entries={[]}
        onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />))
    if (/Add-ons for this session/.test(t)) throw new Error('the add-on pills are back')
    if (/Main session|Added session/.test(t)) throw new Error('the tone strap is back')
    if (!t.includes(opt.name)) throw new Error('the sheet is not about the session it was handed')
  }],
  /*
   * The pencil and the bin, beside the X: delete sits at the top near the close
   * button, behind a confirmation screen, with an edit pencil next to it. The
   * thing they replaced was two text links at the very bottom of the form, which
   * is a long scroll to do something irreversible.
   *
   * The pencil grew from "rename" to the whole of `SessionDetails`: everything
   * below the WHOOP and Strava blocks, except the notes and "how hard was it",
   * moved into the edit modal.
   */
  ['SessionSheet(edit and remove live in the header)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Ride', minutes: 45, out: { activity: 'bike' } } }
    const html = renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rec" entries={rich} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />)
    if (!/aria-label="Edit this workout"/.test(html)) throw new Error('no pencil beside the X')
    if (!/aria-label="Remove from today"/.test(html)) throw new Error('no remove button beside the X')
    // And the old footer link is gone, so there is exactly one way to do it.
    if (/Remove from today<\/button>/.test(html.replace(/aria-label="Remove from today"[^>]*>/, '')) &&
        /linkbtn extra-rm/.test(html)) {
      throw new Error('the footer remove link survived')
    }
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
  // Every menu entry has to survive being read in all three viewers: the picker
  // dialog, the day-list sheet, and the fullscreen page. These are where a bad
  // property access in hand-written plan.json content actually shows up.
  ...plan.dailyMenu
    .filter(m => m.role !== 'adjunct' && m.role !== 'rest')
    .flatMap(m => {
      const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: m.id, level: m.level, name: m.name, minutes: m.minutes, out: {} } }
      return [
        [`Sheet(${m.id})`,
          <SessionSheet opt={m} entry={entry} tone="rec" entries={rich} isFuture={false}
            onLog={noop} onSave={noop} onClose={noop} />],
      ]
    }),
  /*
   * "Log another workout today" came OFF the sheet on 2026-09-21. The day list's
   * own button (pinned separately, below) and the + button are
   * both one tap from here, and a third route at the foot of a form was part of
   * what made this screen read as a maze.
   *
   * Pinned as an absence, and pinned NEXT TO the day-list route deliberately: the
   * mistake to avoid is not "this button came back", it is removing a door and
   * leaving no door, which is exactly what happened to the climbing cards when
   * the swap list went.
   */
  ['Sheet(no second route to a second session)',
    <SessionSheet opt={otherCard} tone="extra" entries={rich} isFuture={false}
      entry={{ id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 52,
          done: true, out: { activity: 'lift', duration: 52, rpe: 5 } } }}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />,
    html => {
      if (/Log another workout today/.test(text(html))) {
        throw new Error('the sheet\u2019s "and another one" link is back')
      }
    }],
  /*
   * A rename is the HEADER's name too, not just a line inside the form.
   *
   * `titleFor` puts their words over the planner's title over the card's, and this
   * case is the wiring rather than the ordering (which `naming.test.js` pins):
   * every one of these headers used to read `pres?.title || nameFor(...)`, so a
   * renamed planned session would have kept announcing itself as "Legs".
   */
  ['Sheet(renamed, and the header says so)',
    <SessionSheet opt={otherCard} tone="extra" entries={rich} isFuture={false}
      entry={{ id: 'nm3', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Bike', minutes: 22,
          done: true, plan: { title: 'Zone 2 ride' },
          out: { activity: 'bike', duration: 22, title: 'Commute' } } }}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />,
    html => {
      const t = text(html)
      if (!/Commute/.test(t)) throw new Error('the header ignored the rename')
      if (/>Zone 2 ride</.test(t)) throw new Error('the plan\'s title outranked his own words')
    }],
  // An unlogged main and an add-on both reach the sheet by different paths.
  ['Sheet(unlogged)', <SessionSheet opt={plan.dailyMenu[0]} entry={null} tone="rec" entries={rich}
    isFuture={false} onLog={noop} onSave={noop} onClose={noop} />],
  ['Sheet(adjunct, no log)', <SessionSheet opt={plan.dailyMenu.find(m => m.role === 'adjunct')} entry={null}
    tone="adj" entries={rich} isFuture={false} onLog={null} onSave={noop} onClose={noop} />],
  ['Sheet(extra, removable)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'x', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'fun-boulder', level: 3, name: 'Bouldering with friends', minutes: 90,
        out: { intensity: 3, rpe: 6 } } }}
    tone="extra" entries={rich} isFuture={false} onLog={noop} onSave={noop} onRemove={noop}
    onClose={noop} />],
  /* Workout mode is offered per SESSION, and the sessions that lost it must lose
   * only the timer — the set log, the done button and the notes are the whole
   * point of opening the sheet and are untouched. */
  ['Sheet(a session with no timer to run)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'lead-laps')}
      entry={{ id: 'll2', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'lead-laps', level: 3, minutes: 30, done: false, out: {} } }}
      tone="extra" entries={rich} isFuture={false} onLog={noop} onSave={noop}
      onStartWorkout={noop} onSetDone={noop} onClose={noop} />,
    html => {
      // Nobody stands at a wall driving a timer through doubled laps.
      if (/Start workout/.test(text(html))) throw new Error('doubled lead laps must not offer a timer')
      if (!/Doubles/.test(text(html))) throw new Error('but it still logs set by set')
    }],
  ['Sheet(a session that does run a clock)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'max-hangs')}
      entry={{ id: 'mh', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: 'max-hangs', level: 4, minutes: 25, done: false, out: {} } }}
      tone="rec" entries={rich} isFuture={false} onLog={noop} onSave={noop}
      onStartWorkout={noop} onSetDone={noop} onClose={noop} />,
    html => {
      if (!/Start workout/.test(text(html))) throw new Error('a 7-second hang needs the countdown')
    }],
  // Per-session notes, and the repeat lookup that surfaces the previous one.
  ['SessionLog(notes + history)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'cur', kind: 'daily', date: '2026-10-01', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    entries={noteHistory} onSave={noop} bare />],
  /* Time spent is on EVERY session, and the estimate is a placeholder rather than
   * a pre-filled value — a pre-filled 150 is a number you confirm without
   * reading, and confirming the plan is what the field exists to stop. */
  ['SessionDetails(time spent, nothing said)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts', kind: 'daily', date: '2026-10-06', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      const est = plan.dailyMenu.find(m => m.id === 'four-by-four').minutes
      if (!/aria-label="Time spent, in minutes"/.test(html)) throw new Error('no time-spent field')
      if (!new RegExp(`placeholder="${est}"`).test(html)) throw new Error('the estimate is not the placeholder')
      if (new RegExp(`aria-label="Time spent, in minutes"[^>]*value="${est}"`).test(html)) {
        throw new Error('the estimate was pre-filled into the field')
      }
    }],
  ['SessionDetails(time spent, typed over everything)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts2', kind: 'daily', date: '2026-10-07', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80,
        out: { minutesSpent: 65, elapsedMin: 71, whoop: { minutes: 96 } } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      if (!/value="65"/.test(html)) throw new Error('the typed number is not in the field')
      // What the user typed has settled it, so nothing is being offered instead.
      const t = text(html)
      if (/use \d+ from/.test(t)) throw new Error('a typed number should not be second-guessed')
      // No jargon under it ("RPE", "training load"): the typed number needs no sentence (#41).
      if (/RPE|training-load/.test(t)) throw new Error('jargon under the time box')
    }],
  /* Attaching a WHOOP workout SETS the length — the whole point of the ordering.
   * Nothing to confirm, and the number in use is on screen rather than implied. */
  ['SessionDetails(time spent, from WHOOP)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts4', kind: 'daily', date: '2026-10-09', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80,
        out: { elapsedMin: 71, whoop: { minutes: 96, sport: 'rock-climbing' } } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      const t = text(html)
      if (!/Using the 96 min WHOOP recorded/.test(t)) throw new Error('the number in use is not stated')
      if (!/placeholder="96"/.test(html)) throw new Error("the field should show WHOOP's number")
      // Never pre-FILLED — a value the user did not give must not look like one the user did.
      if (/aria-label="Time spent, in minutes"[^>]*value="96"/.test(html)) {
        throw new Error('pre-filled a number he never typed')
      }
      // The losing measurement is the one thing the user cannot see, so it is a tap.
      if (!/use 71 from the timer instead/.test(t)) throw new Error("workout mode's clock is not offered")
    }],
  // Log a workout already asks for its own duration, so it must not grow a second box.
  ['SessionDetails(asks its own duration)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'log-workout')}
    entry={{ id: 'ts3', kind: 'daily', date: '2026-10-08', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, minutes: 38, out: { activity: 'run', duration: 38 } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('two boxes for one fact: it already asks for its duration')
      }
    }],
  /* ------------------------------------------------ the free-form card's form
   *
   * *Log a workout* is one card covering a run, a bike ride and a lift, so what
   * it ASKS follows what was picked — originally it asked a lifting day
   * for its distance and incline, and had nowhere at all to put six exercises.
   * These cases pin the three states, because a gate that stops matching renders
   * as a field silently missing rather than as an error.
   */
  ['SessionLog(other training, nothing picked yet)', <SessionLog session={otherCard}
    entry={{ id: 'ot0', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: {} } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/What did you do\?/.test(t)) throw new Error('the one question that is always a question')
      // Everything else is noise until it knows what the workout was.
      if (/Distance/.test(t)) throw new Error('an empty card is asking for a distance')
      if (/Incline/.test(t)) throw new Error('an empty card is asking for an incline')
      if (/search \d+ of them/.test(t)) throw new Error('an empty card is offering the lift catalog')
      if (/How hard was it/.test(t)) throw new Error('an empty card is asking how hard nothing was')
    }],
  ['SessionLog(other training, a run)', <SessionLog session={otherCard}
    entry={{ id: 'ot1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 3, out: { activity: 'run', duration: 38, distance: 3.1 } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/Distance/.test(t)) throw new Error('a run has no distance field')
      if (!/Elevation/.test(t)) throw new Error('an outdoor run records no elevation')
      // Incline is a treadmill setting. The old card gated it on `activity:
      // ["run", "walk"]`, so a road run was asked its incline and a treadmill was
      // asked its elevation gain — exactly backwards, for both.
      if (/Incline/.test(t)) throw new Error('a road run is being asked for its incline')
      if (/What did you lift/.test(t)) throw new Error('a run is being asked for its exercises')
      // Average speed is distance over time — arithmetic the user must never be asked
      // to do. Offered as a PLACEHOLDER, never as a value the user did not give.
      if (!/placeholder="4\.9"/.test(html)) throw new Error('the pace was not worked out for him')
      if (/aria-label[^>]*speed[^>]*value="4\.9"/i.test(html)) throw new Error('a computed number was pre-filled')
      if (!/Worked out from your distance and time/.test(t)) throw new Error('the derived number is unlabelled')
      // The card's example numbers ("450 ft") are not shown: in a number box they
      // read as guesses the app had made, and it had made none (#41).
      if (/placeholder="450"|placeholder="45"|placeholder="14\.2"/.test(html)) throw new Error('a content example is posing as a guess')
      // The activity is a row that opens the picker, not a "Change" link in a box.
      if (!/class="list-row actrow"/.test(html)) throw new Error('the activity is not a row')
      if (/actpick-change/.test(html)) throw new Error('the underlined "Change" link is back')
      // The form is open: no fold title over it.
      if (/Session logged|How did it go/.test(t)) throw new Error('the form is folded behind a title again')
    }],
  /*
   * RENAMING ONE WORKOUT.
   *
   * A single workout can be renamed, with quick-entry names as taps so typing is
   * only needed for a genuinely specific name. Three things are pinned here and
   * each has a way of failing silently. The box must be EMPTY with the session's
   * current name as its placeholder — a pre-filled "Bike" is a string the user
   * confirms without reading,
   * and clearing the box is how the default comes back. Every name the content
   * declares for the discipline has to be IN THE PAGE, folded or not, or a chip
   * is unreachable and no rendering test would notice. And a name the user gave has
   * to read back in the box rather than as a placeholder they might type over.
   *
   * Rendered as `NameField` directly, because that is where it
   * lives now: the box left the log form for a layer of its own behind the
   * pencil in the sheet's header, and a render suite cannot press a pencil. That
   * the pencil EXISTS is pinned separately, in SessionSheet.
   */
  ['NameField(an empty box, and every chip in the page)',
    <PlanProvider plan={plan}>
      <NameField session={otherCard} out={{ activity: 'bike', duration: 22 }} onChange={noop} />
    </PlanProvider>,
    html => {
      const t = text(html)
      if (!/class="out-name-box"[^>]*placeholder="Bike"/.test(html)) {
        throw new Error('the name it already has should be the box\'s placeholder')
      }
      if (/class="out-name-box"[^>]*value="Bike"/.test(html)) {
        throw new Error('a name he did not type must never be pre-filled')
      }
      for (const n of [...plan.quickNames.byDiscipline.bike, ...plan.quickNames.any]) {
        if (!t.includes(n)) throw new Error(`no chip for "${n}" — an unreachable quick name`)
      }
      if (!/Commute/.test(t)) throw new Error('the commute chip is the whole point')
      if (/Long run/.test(t)) throw new Error('a ride is being offered running names')
    }],
  ['NameField(his own name reads back)',
    <PlanProvider plan={plan}>
      <NameField session={otherCard} out={{ activity: 'bike', title: 'Lunch ride with the club' }} onChange={noop} />
    </PlanProvider>,
    html => {
      if (!/class="out-name-box"[^>]*value="Lunch ride with the club"/.test(html)) {
        throw new Error('a name he typed belongs in the box, not in the placeholder')
      }
      // The way back to the default, in the card's own words.
      if (!/use “Bike”/.test(text(html))) throw new Error('no way back to what the card calls it')
    }],
  /*
   * WHAT THE LOG FORM NO LONGER HOLDS, which is the only thing a render test can
   * say about the split. Everything below the WHOOP and Strava blocks, except the
   * notes and "how hard was it", moved to the edit modal. So the name, the gear,
   * "just miles" and time spent are all in
   * `SessionDetails` behind the pencil — and what STAYED is asserted here too,
   * because moving one field too many is the easy mistake and it renders fine.
   */
  ['SessionLog(the details moved out, the notes and the effort stayed)',
    <PlanProvider plan={plan}><SessionLog session={otherCard}
      entry={{ id: 'nm3', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, out: { activity: 'bike', duration: 22 } } }}
      entries={[]} onSave={noop} bare /></PlanProvider>,
    html => {
      const t = text(html)
      if (/out-name-box/.test(html)) throw new Error('the name box is back in the log form')
      if (/class="gear/.test(html)) throw new Error('the gear picker is back in the log form')
      if (/Just miles — not a workout/.test(t)) throw new Error('the just-miles box is back in the log form')
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('time spent is back in the log form')
      }
      // And what is meant to STAY there.
      if (!/Notes<\/span>/.test(html)) throw new Error('no plain notes box')
      if (!/What to improve next time/.test(t)) throw new Error('the improve box went with it')
      // The notes and the effort question are the two things that stay.
      if (!/How hard was it\?/.test(t)) {
        throw new Error('"how hard was it" was supposed to stay on the form')
      }
    }],
  /* And every one of them IS in the panel behind the pencil. A field that left
   * one screen and arrived on no other is indistinguishable from a deletion. */
  ['SessionDetails(name, gear, just miles and time spent, all in one place)',
    <PlanProvider plan={plan}><SessionDetails session={otherCard}
      entry={{ id: 'nm4', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, minutes: 22,
          out: { activity: 'bike', duration: 22 } } }}
      entries={[]} onSave={noop} training={undefined} onTraining={noop} /></PlanProvider>,
    html => {
      const t = text(html)
      if (!/out-name-box/.test(html)) throw new Error('no name box')
      if (!/Just miles, not a workout/.test(t)) throw new Error('no just-miles box')
      // This card asks for its own duration, so it must NOT also get the generic
      // box — two boxes for one fact is two answers. See asksItsOwnDuration.
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('a card that asks its own duration grew a second box')
      }
    }],
  /* The lift form: the exercise search, and a logged session reading back with
   * its implement, its sets and what the user lifted last time. */
  ['SessionLog(other training, a lift)', <SessionLog session={otherCard}
    entry={{ id: 'ot2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', duration: 52, lifts: [
        { uid: 'bent-over-row-1', key: 'bent-over-row', name: 'Bent-over row', group: 'Back',
          implement: 'dumbbell', implementLabel: 'Dumbbell',
          sets: [{ reps: 10, weight: 30 }, { reps: 10, weight: 30 }, { reps: 8, weight: 30 }] },
        { uid: 'external-rotation-1', key: 'external-rotation', name: 'Shoulder external rotation',
          group: 'Shoulders', implement: 'cable', implementLabel: 'Cable',
          sets: [{ reps: 15, weight: 7.5 }] },
      ] } } }}
    entries={priorLifts} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (/Distance/.test(t)) throw new Error('a lift day is being asked for its distance')
      if (/Elevation|Incline/.test(t)) throw new Error('a lift day is being asked about hills')
      if (!/Bent-over row/.test(t) || !/Shoulder external rotation/.test(t)) {
        throw new Error('the logged exercises did not render')
      }
      /*
       * THE SAME CARD THE PLANNER USES, because planning a workout and logging
       * one should look exactly the same. So: one card open (the
       * first), every other collapsed to its name and its summary line, implement
       * CHIPS rather than a native select, and steppers rather than a table of
       * bare inputs. `Sheet(a planned session)` pins the same shape from the other
       * side; if these two ever disagree, one of them has grown its own copy.
       */
      if ((html.match(/class="presc-sets"/g) || []).length !== 1) {
        throw new Error('exactly one exercise should open, as on the plan side')
      }
      if (/<select/.test(html)) throw new Error('the implement select survived the merge')
      if (!/class="stepper/.test(html)) throw new Error('the weight box is not a stepper')
      // What it was loaded with, and what the weight column therefore MEANS. The
      // cable's card is folded, so only the open one states its units.
      if (!/lb per hand/.test(t)) throw new Error('a dumbbell weight column must say per hand')
      if (!/class="implchip on"/.test(html)) throw new Error('the chosen implement is not marked')
      // Unequal sets read as themselves — the point of logging per set is that a
      // last set that dropped off shows up as one. On the HEADER now, so a folded
      // card still says what it was.
      if (!/10 @ 30 lb, 10 @ 30 lb, 8 @ 30 lb/.test(t)) throw new Error('the set summary is missing')
      if (!/1 × 15 @ 7\.5 lb/.test(t)) throw new Error('equal sets should collapse')
      // Spacing is at the mercy of how SSR splits the text nodes, so assert the
      // facts rather than the punctuation between them.
      if (!/last time/.test(t) || !/2026-09-02/.test(t) || !/1 × 5 @ 175 lb/.test(t)) {
        throw new Error("last time's numbers are not on screen")
      }
      if (!/4 sets/.test(t)) throw new Error('the session line is missing')
      // And the way in to the next exercise — behind the same dashed button the
      // plan side uses, rather than a search box always taking up the page.
      if (!/Add an exercise/.test(t)) throw new Error('no way to add an exercise')
    }],
  /* A number a service measured says so. Attaching is the whole point — time
   * should not need entering when WHOOP already measured it — and a value the
   * user did not type must never look like one they did. */
  ['SessionLog(other training, filled from WHOOP)', <SessionLog session={otherCard}
    entry={{ id: 'ot3', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: {
        activity: 'run', duration: 38, distance: 5, elevation: 210,
        whoop: { id: 'w', sport: 'running', minutes: 38, attachedAt: 'z',
          filled: { activity: 'run', duration: 38, distance: 5, elevation: 210 } } } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if ((t.match(/from WHOOP/g) || []).length < 3) throw new Error('the filled fields are not attributed')
      if (!/value="38"/.test(html)) throw new Error('the filled duration is not in the field')
    }],
  // A grade is entered from the ladder, per REP, and both of those are things a
  // rendered form can silently stop doing: a select whose value is off its own
  // option list goes blank, and a per-rep field is one `Array.isArray` away from
  // rendering nothing at all.
  ['SessionLog(a grade per lap)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'lead-laps')}
    entry={{ id: 'll', kind: 'daily', date: '2026-10-03', updatedAt: 'z',
      data: { optId: 'lead-laps', level: 3, minutes: 30,
        out: { sets: { doubles: [{ reps: 2, grades: [10.2, 10.2] }, { reps: 2, grades: [10.1, 10.2] }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      // One picker per lap across two sets, each one showing its own rung.
      const selected = [...html.matchAll(/<option value="([\d.]+)" selected=""/g)].map(m => m[1])
      if (selected.join() !== '10.2,10.2,10.1,10.2') {
        throw new Error(`the per-lap grades did not render as themselves: ${selected.join() || 'none'}`)
      }
      if (!text(html).includes('5.10−')) throw new Error('the ladder is not labelled')
      if (!/lap 1|rep 1/.test(text(html))) throw new Error('the laps are not numbered')
    }],
  // A session-level grade: same ladder, same control, one value.
  ['SessionLog(hardest route from the ladder)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    entry={{ id: 'fs', kind: 'daily', date: '2026-10-04', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, minutes: 120, out: { intensity: 3, hardestYds: 11.1, rpe: 6 } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/<option value="11.1" selected=""/.test(html)) throw new Error('the logged rung is not selected')
      if (/enter as/.test(text(html))) throw new Error('still asking him to encode a grade as a decimal')
    }],
  // An old hand-written value that is not on the ladder keeps its own option, so
  // opening the picker cannot silently relabel what the user climbed.
  ['SessionLog(off-ladder grade survives)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    entry={{ id: 'fs2', kind: 'daily', date: '2026-10-05', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, minutes: 120, out: { hardestYds: 10.4 } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/<option value="10.4" selected="">10.4</.test(html)) {
        throw new Error('an off-ladder grade was dropped or relabelled')
      }
    }],
  // The fun days' per-climb option: OFF is the default and a button offers it —
  // ten selects nobody asked for is how a twenty-second form stops being filled in.
  ['SessionLog(fun day, option off)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'fb0', kind: 'daily', date: '2026-10-06', updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 2, minutes: 90, out: { sets: { problems: [{ reps: 10 }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/log each problem/.test(text(html))) throw new Error('the per-problem option is not offered')
      if (/climblog/.test(html)) throw new Error('per-climb detail rendered before he asked for it')
      // With the detail off the count is an ordinary typed number, not a stepper.
      if (/repstep/.test(html)) throw new Error('the stepper belongs to the detail, not the plain log')
      const reps = html.match(/<input[^>]*aria-label="set 1 reps"[^>]*>/)?.[0] || ''
      if (/readonly/i.test(reps)) throw new Error('the plain reps box must stay typeable')
    }],
  // ...and ON, each climb is a grade off its own ladder (V for boulders), a
  // style, a fell mark, and a felt-for-the-grade slider that speaks in words.
  ['SessionLog(fun day, per-problem detail)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'fb1', kind: 'daily', date: '2026-10-07', updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 3, minutes: 90,
        out: { sets: { problems: [{ reps: 3, climbs: [
          { grade: 4, fell: true, felt: 1, style: 'roof' },
          { grade: 5, fell: false, felt: '', style: '' },
          { grade: '', fell: false, felt: '', style: '' },
        ] }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      const t = text(html)
      const selected = [...html.matchAll(/<option value="([^"]*)" selected=""[^>]*>([^<]*)</g)].map(m => m[2])
      if (!selected.includes('V4') || !selected.includes('V5')) {
        throw new Error(`the per-problem V grades did not render as themselves: ${selected.join() || 'none'}`)
      }
      if (!selected.includes('roof')) throw new Error('the style did not render as picked')
      if (!/problem 1/.test(t)) throw new Error('the problems are not numbered in the plan’s own word')
      if (!/a touch stiff/.test(t)) throw new Error('felt must speak in words, not a bare number')
      if (!/fell on 1/.test(t)) throw new Error('the footer must count the falls')
      // Two graded problems, two felt sliders: "hard for the grade" is not a
      // question until a climb has a grade.
      const sliders = [...html.matchAll(/felt for the grade/g)].length
      if (sliders !== 2) throw new Error(`expected 2 felt sliders, saw ${sliders}`)
      if (!/for the grade: —/.test(t)) throw new Error('an untouched felt must read as unanswered, never "spot on"')
      // While the detail is on, the count is stepped and never typed — a typed
      // edit passes through states that truncate the list and delete climbs.
      const reps = html.match(/<input[^>]*aria-label="set 1 reps"[^>]*>/)?.[0] || ''
      if (!/readonly/i.test(reps)) throw new Error('a typeable count can still delete filled-in climbs')
      if (!/one more problem/.test(html)) throw new Error('no way to add a problem without retyping the count')
      if (!/one fewer problem/.test(html)) throw new Error('no way to remove one without retyping the count')
    }],
  ['SessionLog(a rest day)', <SessionLog session={plan.dailyMenu.find(m => m.role === 'rest')}
    entry={{ id: 'r', kind: 'daily', date: '2026-10-02', updatedAt: 'z',
      data: { optId: 'off', level: 1, minutes: 0, out: {} } }}
    entries={noteHistory} onSave={noop} bare />],
  ['Sheet(with prior note)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'cur', kind: 'daily', date: '2026-10-01', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    tone="rec" entries={noteHistory} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // A suggestion opened from the day list: no entry behind it yet, so it offers
  // "add to today" and "not doing this today" rather than a log.
  ['Sheet(also recommended)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'lead-laps')} entry={null} tone="also"
      entries={rich} isFuture={false} recWhy="Not done yet this week."
      onLog={noop} onSave={noop} onDismiss={noop} onClose={noop} />],
  // The unilateral block resolves its dose from the ceiling — with a test...
  ['Sheet(unilateral, dose resolved)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'unilateral')}
    entry={{ id: 'u1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'unilateral', level: 2, minutes: 12, out: {} } }}
    tone="rec" entries={cfEntries} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // ...and without one, where it must say so rather than invent a number.
  ['Sheet(unilateral, never tested)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'unilateral')}
    entry={{ id: 'u2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'unilateral', level: 2, minutes: 12, out: {} } }}
    tone="rec" entries={[]} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // The dose line itself. The sheet opens on the setup section, so this is the
  // only place the resolved kilograms actually render.
  ['SectionBody(dose from Aug 8)',
    <SectionBody section={uniWork} max={null} ceiling={resolveCeiling(augOnly)} />,
    html => {
      // CF 18.2 -> ceiling 12.2 -> target 10.2, the fixture's first result.
      if (!text(html).includes('10.2 kg on the gauge')) throw new Error('the resolved target is missing')
      if (!text(html).includes('12.2 kg')) throw new Error('the ceiling is missing')
    }],
  ['SectionBody(newest test wins)',
    <SectionBody section={uniWork} max={null} ceiling={resolveCeiling(cfEntries)} />,
    html => {
      // The September retest supersedes August: CF 20.4, CFmin 19.1 -> 14.4 -> 12.4.
      if (!text(html).includes('12.4 kg on the gauge')) throw new Error('did not use the newest test')
    }],
  ['SectionBody(never tested)',
    <SectionBody section={uniWork} max={null} ceiling={null} />,
    html => {
      if (!/run the 4-min all-out test/i.test(html)) throw new Error('no prompt to test')
      if (/\d+(\.\d+)? kg on the gauge/.test(text(html))) throw new Error('invented a number with no test')
    }],
  ['SectionBody(CFmin binds)',
    <SectionBody section={uniWork} max={null}
      ceiling={resolveCeiling([{ id: 'x', kind: 'test', date: '2026-08-08', updatedAt: 'z',
        data: { testId: 'critical-force', cfKg: 18.2, cfMinKg: 11.5, mvcKg: 48.6 } }])} />,
    html => {
      if (!text(html).includes('9.5 kg on the gauge')) throw new Error('CFmin did not bind (expected 11.5 - 2)')
      if (!/CFmin from/.test(text(html))) throw new Error('did not say which rule bound')
    }],
  /* The how-to layer. A figure name that plan.json can write but the app cannot
   * draw renders as an empty box, which on a phone in a basement is worse than
   * no picture at all — it reads as "this is broken" mid-set. */
  ['every figure the plan names exists', null, () => {
    const missing = []
    for (const m of plan.dailyMenu) {
      for (const ex of m.logSpec?.exercises || []) {
        if (ex.how && !hasFigure(ex.how.figure)) missing.push(`${m.id}/${ex.key} → ${ex.how.figure}`)
      }
    }
    if (missing.length) throw new Error(`no such figure: ${missing.join(', ')}`)
  }],
  ['no figure is drawn that nothing uses', null, () => {
    const used = new Set(plan.dailyMenu.flatMap(m => (m.logSpec?.exercises || []).map(e => e.how?.figure)))
    const spare = Object.keys(FIGURES).filter(k => !used.has(k))
    if (spare.length) throw new Error(`unused figures: ${spare.join(', ')}`)
  }],
  // Every figure has to survive being drawn, including the ones a rarely-picked
  // session owns. They are hand-written SVG; a stray undefined renders blank.
  ...Object.keys(FIGURES).map(name => [`Figure(${name})`,
    <HowRow exercise={{ name, how: { figure: name, gist: 'x' } }} open onToggle={noop} />,
    html => { if (!html.includes('<svg')) throw new Error('drew nothing') }]),
  // The moves list on every session that has one, and the mid-set sheet.
  ...plan.dailyMenu.filter(m => m.logSpec?.exercises?.length)
    .map(m => [`Moves(${m.id})`, <MovesList session={m} />]),
  ['HowSheet(eccentrics)', <HowSheet
    exercise={plan.dailyMenu.find(m => m.id === 'eccentrics').logSpec.exercises[0]}
    onClose={noop} />,
    html => {
      // The specific confusion this whole layer was built for: the free hand
      // lifts, the working hand only lowers. If that sentence stops reaching
      // the screen, the card is decoration.
      if (!/free hand/i.test(text(html))) throw new Error('lost the free-hand instruction')
    }],
  // An exercise with no how-to written yet must degrade, not crash.
  ['HowRow(no card)', <HowRow exercise={{ key: 'x', name: 'Something new' }} open onToggle={noop} />],
  ['HowSheet(nothing to show)',
    <div className="probe"><HowSheet exercise={{ name: 'x' }} onClose={noop} /></div>,
    html => { if (html.includes('how-sheet')) throw new Error('opened a sheet with nothing in it') }],
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
  /* The planned session, read from the day rather than run: the sheet shows the
   * prescription instead of the card's protocol, because the card has none. */
  ['Sheet(a planned session)',
    <SessionSheet opt={PLANNED_CARD} entry={PLANNED_ENTRY} tone="rec" entries={rich} isFuture={false}
      onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
      onClose={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes(PRESCRIPTION.title)) throw new Error('the sheet is not titled by the plan')
      // This one has a bike piece in it, so there is a clock to run.
      if (!/Start the workout/.test(t)) throw new Error('no way into the runner from the sheet')
      // The reasoning is one tap away rather than on screen — see PlanTalk above.
      if (!/Why this session/.test(t)) throw new Error('no way to reach the reasoning')
      // Every exercise open at once is four screens of steppers before the one the user
      // is about to do. Only the first opens.
      if ((html.match(/class="presc-sets"/g) || []).length > 1) {
        throw new Error('more than one exercise opened')
      }
    }],
  /*
   * A LIFT-ONLY session gets no runner: workout mode makes no sense for lifting,
   * which has no timed parts. Once rest came off a lift set there is nothing for a
   * clock to run, so the sheet is the whole screen — and it must not grow a start
   * button back, which is the only thing a render test can say about it.
   */
  ['Sheet(a lift-only session offers no clock)', null, () => {
    const pres = normalizePrescription({
      title: 'Push day', category: 'lift', minutes: 45, why: 'w',
      blocks: [{ name: 'Main', category: 'lift', items: [{
        kind: 'lift', name: 'squat', exercise: SQUAT.key, implement: 'barbell',
        sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }],
      }] }],
    }, { liftField: LIFT_FIELD })
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: pres.title, minutes: 45, level: 2,
        done: false, plan: pres, out: {} } }
    const t = text(renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>))
    if (/Start the workout/.test(t)) throw new Error('a lift session is offering a clock again')
    if (!/Mark undone/.test(t)) throw new Error('with no runner, the sheet has to say it is done and offer to undo it')
    // And no rest box anywhere in the editor.
    if (/rest sec/.test(t)) throw new Error('lifting grew a rest interval back')
  }],
  /*
   * DONE BY DEFAULT (AGENTS.md §4), and THE FOOTER (#41). Every field saves as
   * typed, so the footer's primary is Close (or Start, where there is a workout
   * to run); beside it, quiet, "Mark undone" on a session done by default, "Mark
   * done" on one marked undone, and neither on a later day. Pinned absent: the old
   * toggles that put a state and an action in one label ("Done · Mark undone").
   */
  ['SessionSheet(Close is the primary; Mark undone quiet beside it; Mark done once undone; neither later)', null, () => {
    const sheet = (entry, isFuture = false, opt = PLANNED_CARD) => renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={opt} entry={entry} tone="rec" entries={rich} isFuture={isFuture}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>)
    const foot = (html) => (html.match(/<footer class="modal-foot">([\s\S]*?)<\/footer>/) || [])[1] || ''
    const today = foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false } }))
    if (!/class="btn quiet"[^>]*>Mark undone</.test(today)) throw new Error('a session planned for today has no quiet "Mark undone"')
    if (/Done · Mark undone|tap to undo|Mark as done/.test(text(today))) throw new Error('an old done toggle is back')
    // This one has a clock to run, so Start is the primary rather than Close.
    if (!/class="btn"[^>]*>.*Start the workout/.test(today)) throw new Error('a done-by-default session lost its Start')
    const undone = text(foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false, undone: true } })))
    if (!/Mark done/.test(undone) || /Mark undone/.test(undone)) throw new Error('a session marked undone does not offer "Mark done"')
    const finished = foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: true, run: { startedAt: 1, endedAt: 2 } } }))
    if (/Start the workout/.test(finished)) throw new Error('a finished run offers Start again')
    if (!/<button type="button" class="btn">Close<\/button>/.test(finished)) throw new Error('Close is not the primary once nothing is left to start')
    const later = foot(sheet({ ...PLANNED_ENTRY, date: '2999-01-01', data: { ...PLANNED_ENTRY.data, done: false } }, true))
    if (/Mark (un)?done/.test(later)) throw new Error('a session on a later day offers a done control')
    if (!/>Close</.test(later)) throw new Error('a later day has no way to close its sheet')
    if (/Preview only/.test(text(later))) throw new Error('the explanatory preview line is back')
  }],
  /*
   * THE HEADER (#41): the name, then the day and the time as typed. It used to
   * say the card's "45 min · any sport · counts anyway" over a typed 29.
   */
  ['SessionSheet(header: day · time as typed, no tier, no estimate)', null, () => {
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 2, name: 'Run', minutes: 45, done: true,
        out: { activity: 'run', duration: 29, distance: 3.1 } } }
    const html = renderToString(<SessionSheet opt={otherCard} entry={entry} entries={rich} isFuture={false}
      onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />)
    const sub = text((html.match(/<div class="modal-sub">(.*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '')
    if (sub !== 'Today · 29 min') throw new Error(`the header reads "${sub}"`)
    if (/any sport|counts anyway/.test(text(html))) throw new Error('the card\u2019s tier is back in the header')
    // The form is open, and the timer is a row at the foot rather than a big button.
    if (/Session logged|How did it go/.test(text(html))) throw new Error('the form is folded behind a title again')
    if (!/class="list sheet-tools"/.test(html) || !/Interval timer/.test(html)) throw new Error('the interval timer is not a row in the sheet')
    if (/wo-cta|done-btn/.test(html)) throw new Error('the old footer buttons are back')
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
  /* An unanswered slider is a placeholder (AGENTS.md §6.4): nothing lit, until moved or tapped. */
  ['SessionLog(an unanswered slider looks unanswered)', null, () => {
    const entry = (out) => ({ id: 'sl', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'log-workout', out } })
    const blank = renderToString(<SessionLog session={otherCard} entry={entry({ activity: 'run' })} entries={[]} onSave={noop} bare />)
    if (!/class="slider unset"/.test(blank)) throw new Error('an unanswered slider is drawn lit, as if answered')
    if (!/class="out-value guess"/.test(blank)) throw new Error('its number is not a placeholder')
    const set = renderToString(<SessionLog session={otherCard} entry={entry({ activity: 'run', rpe: 4 })} entries={[]} onSave={noop} bare />)
    if (/slider unset|out-value guess/.test(set)) throw new Error('an answered slider still reads as unanswered')
  }],
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
  ['SessionSheet(an ordinary workout opens the interval timer)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    if (hasWorkout(opt)) throw new Error('the test card is supposed to have no timer of its own')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      // Done, as today's entries are by default since #34: the timer must not hang off `!done`.
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Run', minutes: 30, done: true, out: { activity: 'run' } } }
    const sheet = text(renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rec" entries={[]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onStartWorkout={noop} />))
    if (!sheet.includes('Interval timer')) throw new Error('no timer on an ordinary workout\'s sheet')
    // What the button asks for, answered by the host the app mounts.
    const req = timerRequestFor(opt, entry)
    if (req.title !== 'Run') throw new Error(`the timer is titled ${req.title}`)
    if (req.presets.some(Boolean)) throw new Error('an ordinary card invented a plan timer')
    openTimer(req)
    try {
      const html = renderToString(<TimerHost entries={[]} upsertEntry={noop} deleteEntry={noop} />)
      const t = text(html)
      for (const w of ['Interval timer', 'Run', 'Start', 'Work', 'Rest', 'Rounds', BUILT_INS[0].name]) {
        if (!t.includes(w)) throw new Error(`the timer opened without "${w}"`)
      }
    } finally { closeTimer() }
    if (renderToString(<TimerHost entries={[]} upsertEntry={noop} deleteEntry={noop} />) !== '') {
      throw new Error('the host shows a timer nobody asked for')
    }
  }],
  ['SessionSheet(no interval timer on a rest day)', null, () => {
    const opt = plan.dailyMenu.find(m => m.role === 'rest')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 1, name: 'Rest day', minutes: 0, done: true, out: {} } }
    const t = text(renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rest" entries={[]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />))
    if (t.includes('Interval timer')) throw new Error('a timer for resting')
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
  // install renders: no climbing cards, the catalogs only.
  ['starter: TodayTab', <TodayTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['example: TodayTab', <TodayTab plan={example} entries={[]} upsertEntry={noop} deleteEntry={noop} />],

  // ===== batch B: logging and planning =====

  /*
   * The picker itself, which the log used to own and now shares. Its group chips
   * had to survive the merge: tapping one SEARCHES for the group, so browsing and
   * searching are one mechanism, and the planner's version never had them.
   */
  ['ExercisePicker(search, and groups to browse without typing)',
    <ExercisePicker field={LIFT_FIELD} onPick={noop} onClose={noop} />,
    html => {
      if (!/aria-label="Search for an exercise"/.test(html)) throw new Error('no exercise search')
      if (!/Forearms & grip|Forearms &amp; grip/.test(html)) throw new Error('no group to browse by')
    }],
  // Workout mode, in every state it can be left in. It owns the whole screen
  // and runs with chalky hands mid-set, so a bad property access here is the
  // worst possible time to find one.
  ...plan.dailyMenu
    .filter(m => hasWorkout(m))
    .map(m => [`Workout(${m.id})`,
      <WorkoutMode session={m}
        entry={{ id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
          data: { slot: 'main', optId: m.id, level: m.level, name: m.name, minutes: m.minutes, out: {} } }}
        onSave={noop} onSetDone={noop} onExit={noop} />]),
  // Part-way through: some sets logged, a counterweight sign set, a clock running.
  ['Workout(part done)', <WorkoutMode session={plan.dailyMenu.find(m => m.id === 'hard-home')}
    entry={{ id: 'w1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'hard-home', level: 4, minutes: 25, out: {
        startedAt: '2026-08-08T18:00:00.000Z',
        sets: { maxhang: [{ reps: 1, seconds: 7, weight: 43 }, { reps: 1, seconds: 7, weight: 43 }] },
        signs: { repeaters: '-' } } } }}
    onSave={noop} onSetDone={noop} onExit={noop} />],
  // Every set already logged — the finish screen has to be reachable.
  ['Workout(all done)', <WorkoutMode session={plan.dailyMenu.find(m => m.id === 'subthreshold')}
    entry={{ id: 'w2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'subthreshold', level: 1, minutes: 10, out: {
        elapsedMin: 11,
        sets: { hangs: Array.from({ length: 5 }, () => ({ seconds: 25, weight: 30 })) } } } }}
    onSave={noop} onSetDone={noop} onExit={noop} />],
  /* The running clock itself.
   *
   * Every WorkoutMode case above renders the intro, because that is the phase a
   * fresh one opens in — so the screen the user actually spends the session
   * looking at had no render coverage at all, and shipped twice with an
   * instruction to tap something that was not a button. These cases pin the
   * three shapes it takes: a countdown, a set with no target, and a rest with
   * no target. The last two must offer something to press.
   *
   * The count-up cases use the BOARD session on purpose: it is a real one that
   * counts up (its intervals are timed by finishing them, not by a countdown), and
   * it is one the app still offers workout mode for. The bodyweight circuits it
   * used to use no longer get the mode at all — see hasWorkout. */
  ...(() => {
    const face = (phase, id, exIndex, extra = {}) => {
      const step = buildSteps(plan.dailyMenu.find(m => m.id === id), {})[exIndex]
      return <Face phase={phase} counted={42} rep={1} left={null} step={step} timing={step.timing}
        paused={false} onPause={noop} onBump={noop} onSkip={noop} onEndSet={noop} onHow={noop} {...extra} />
    }
    const pressable = (html) => {
      if (!/<button[^>]*class="[^"]*wo-clock[^"]*tappable/.test(html)) {
        throw new Error('the clock says to tap it and is not a button')
      }
    }
    return [
      ['Face(counting down)', face('work', 'repeaters', 0, { left: 7 }),
        html => {
          if (/tap the clock/i.test(text(html))) throw new Error('a countdown must not invite a tap')
          if (/class="[^"]*wo-clock[^"]*tappable/.test(html)) throw new Error('a countdown clock is not a button')
        }],
      ['Face(count-in)', face('countin', 'max-hangs', 0, { left: 3 })],
      ['Face(set with no target)', face('work', 'board', 0), pressable],
      ['Face(rest with no target)', face('setrest', 'board', 1), pressable],
      // The crimp crawls' third set: the one set in a basement session that
      // counts UP, because it ends when their fingers open. Same shape as the
      // board's intervals, and the screen the user taps with the pump peaking.
      ['Face(the all-out crawl)', face('work', 'crawls', 2), pressable],
      ['Face(paused)', face('work', 'board', 0, { paused: true })],
    ]
  })(),
  /* The review screen — the one that writes the set down. Lead laps are the only
   * session whose set carries a LIST (a grade per lap), and a per-rep field that
   * renders nothing here loses the grades on every set the user marks off. */
  ...(() => {
    const step = buildSteps(plan.dailyMenu.find(m => m.id === 'lead-laps'), {})[0]
    return [
      ['Review(a grade per lap)',
        <Review step={step} draft={{ reps: 2, grades: [10.1, 10.2] }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          const selected = [...html.matchAll(/<option value="([\d.]+)" selected=""/g)].map(m => m[1])
          if (selected.join() !== '10.1,10.2') {
            throw new Error(`the review screen lost the per-lap grades: ${selected.join() || 'none'}`)
          }
          // The list must not also appear as a number field — Number([10.1,10.2]) is NaN.
          if (/aria-label="[^"]*grades"|>grades</.test(html)) throw new Error('the grade list rendered as a number input')
        }],
      ['Review(an ordinary set)',
        <Review step={buildSteps(plan.dailyMenu.find(m => m.id === 'repeaters'), {})[0]}
          draft={{ reps: 1, seconds: 7, weight: 43 }} onDraft={noop} onCommit={noop} isLastSet />,
        html => {
          if (/gradesel/.test(html)) throw new Error('a session with no grade field grew a grade picker')
          if (/log each/.test(text(html))) throw new Error('a session the plan makes no offer on grew the per-climb toggle')
        }],
    ]
  })(),
  /* The board's optional per-climb detail, ON THE REVIEW SCREEN.
   *
   * The board is the first session with both a clock and this offer, and the
   * reason it is offered mid-session is that the twenty seconds after an
   * interval is the only moment anyone honestly knows which problem the fall
   * was on. Three states, because each one has its own way of being wrong:
   * the offer must be visible when off, the records must render when on, and a
   * set that already carries climbs must not lose them to the review screen —
   * `writeSet` replaces the row with exactly what this screen is handed. */
  ...(() => {
    const boardStep = (out = {}) => buildSteps(plan.dailyMenu.find(m => m.id === 'board'), out)[0]
    const climbed = [
      { grade: 4, fell: false, felt: '', style: 'crimpy' },
      { grade: 5, fell: true, felt: 1, style: 'powerful' },
      { grade: 4, fell: false, felt: '', style: '' },
    ]
    return [
      ['Review(the board, detail off)',
        <Review step={boardStep()} draft={{ reps: 3, seconds: 104 }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          if (!/log each problem/.test(text(html))) throw new Error('the per-climb offer is missing')
          if (/climblog/.test(html)) throw new Error('the detail rendered without being switched on')
          // Off, reps is an ordinary number field you can type into.
          if (/readonly/i.test(html)) throw new Error('the reps box is read-only with the detail off')
        }],
      ['Review(the board, logging each problem)',
        <Review step={boardStep()} draft={{ reps: 3, seconds: 104, climbs: climbed }}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          const t = text(html)
          if (!/logging each problem/.test(t)) throw new Error('the toggle does not read as on')
          if ((html.match(/class="climb"/g) || []).length !== 3) throw new Error('one line per problem, three problems')
          if (!/>V4</.test(html) || !/>V5</.test(html)) throw new Error('the V ladder is not offered')
          if (!/fell on 1/.test(t)) throw new Error('the falls count is missing')
          if (!/crimpy/.test(html)) throw new Error("the board's own style list is missing")
          // While the detail is on the list is the count: typing was the bug.
          if (!/readonly/i.test(html)) throw new Error('the reps box is typeable while the detail is on')
        }],
      // Entered in the set log after the session, then the set is re-marked in
      // workout mode: the records have to arrive on this screen or committing
      // deletes them.
      // Lead laps already logged a grade per lap before this detail existed, so
      // switching it on there must not put a second ladder next to the first.
      ['SessionLog(one grade per lap, not two)',
        <SessionLog session={plan.dailyMenu.find(m => m.id === 'lead-laps')} bare
          entry={{ id: 'll', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'lead-laps', out: {
            sets: { doubles: [{ reps: 2, grades: [10.1, 10.2], climbs: [
              { grade: '', fell: true, felt: '', style: 'overhang' },
              { grade: '', fell: false, felt: '', style: '' },
            ] }] } } } }}
          entries={[]} onSave={noop} />,
        html => {
          // Two laps, two grade pickers — the per-lap ladder — and no more.
          const pickers = (html.match(/class="gradesel"/g) || []).length
          if (pickers !== 2) throw new Error(`expected 2 grade pickers, got ${pickers}`)
          if ((html.match(/class="climb"/g) || []).length !== 2) throw new Error('the climb rows are missing')
          if (!/fell on 1/.test(text(html))) throw new Error('the fall was not counted')
        }],
      /* Down-climbing, on a route card. A lap climbed and reversed is two lengths
       * of wall, and the total under the table is where that shows up — the
       * number the user actually reads after a session. */
      ['SessionLog(a down-climbed lap counts twice)',
        <SessionLog session={plan.dailyMenu.find(m => m.id === 'arc')} bare
          entry={{ id: 'arc1', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'arc', out: {
            sets: { bout: [{ reps: 3, seconds: 1200, climbs: [
              { grade: 8.2, fell: false, felt: '', style: '', down: '' },
              { grade: 8.2, fell: false, felt: '', style: '', down: 'both' },
              { grade: 7.2, fell: false, felt: '', style: '', down: 'only' },
            ] }] } } } }}
          entries={[]} onSave={noop} />,
        html => {
          const t2 = text(html)
          if (!/3 reps/.test(t2)) throw new Error('the rep count must be untouched')
          if (!/4 lengths/.test(t2)) throw new Error('a reversed lap should read as two lengths')
          if (!/2 down-climbed/.test(t2)) throw new Error('the down-climb count is missing')
          // Three pickers per climb on a route card: grade, style, up/down.
          if ((html.match(/class="climb-style climb-down"/g) || []).length !== 3) {
            throw new Error('the up/down picker is missing from a route card')
          }
          if (!/up \+ down/.test(t2) || !/down only/.test(t2)) throw new Error('both states must be offerable')
        }],
      // The same detail on a BOULDER card offers no down-climb picker, and its
      // total stays a plain rep count.
      ['SessionLog(no down-climbing on a boulder card)',
        <SessionLog session={plan.dailyMenu.find(m => m.id === 'four-by-four')} bare
          entry={{ id: 'ff1', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'four-by-four', out: {
            sets: { circuits: [{ reps: 2, climbs: [
              { grade: 4, fell: false, felt: '', style: '' },
              { grade: 5, fell: true, felt: '', style: '' },
            ] }] } } } }}
          entries={[]} onSave={noop} />,
        html => {
          if (/climb-down/.test(html)) throw new Error('a boulder card grew a down-climb picker')
          if (/lengths/.test(text(html))) throw new Error('and it should not talk about lengths')
        }],
      ['Review(a set that already carried climbs)',
        <Review step={boardStep({ sets: { intervals: [{ reps: 3, seconds: 104, climbs: climbed }] } })}
          draft={boardStep({ sets: { intervals: [{ reps: 3, seconds: 104, climbs: climbed }] } }).values}
          onDraft={noop} onCommit={noop} isLastSet={false} />,
        html => {
          if ((html.match(/class="climb"/g) || []).length !== 3) throw new Error('the logged climbs never reached the review screen')
          if (!/fell on 1/.test(text(html))) throw new Error('the logged fall was dropped')
        }],
    ]
  })(),
  // A session with no per-set prescription must say so rather than crash.
  ['Workout(nothing to step through)', <WorkoutMode session={plan.dailyMenu.find(m => m.role === 'rest')}
    entry={{ id: 'w3', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'off', level: 1, minutes: 0, out: {} } }}
    onSave={noop} onSetDone={noop} onExit={noop} />],
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
  ['ActivityChooser(a climb offers only the climbing cards)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onPickCard={noop}
      onClose={noop} climbingOnly dayLabel="for Mon, Oct 12" />,
    (html) => {
      const t = text(html)
      if (!/Log the climb/.test(t) || !/Bouldering/.test(t)) throw new Error('no climbing folders')
      if (/Your usual|Recent|Mountain bike/.test(t)) throw new Error('a climb can be logged as a generic workout')
      if (!/for Mon, Oct 12/.test(t)) throw new Error('the day it lands on is not said')
    }],
  /* ============================================ plan a workout, and run it
   *
   * The whole route the + button opens, rendered at every step. These are the
   * screens with the least test surface anywhere else in the app: the model is
   * covered as arithmetic in `prescription.test.js`, but nothing there would
   * catch a runner that renders a set with no number on it.
   */
  ['PlanFlow(pick what)', <PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      // The kinds are CONTENT — adding "Shoulders" must be an edit to plan.json
      // and not a rebuild, so the screen has to be rendering that list.
      // `&` comes back as `&amp;` out of the serialiser — "Core & hips" is one
      // of the kinds, so the comparison has to read through the escaping.
      const plain = t.replace(/&amp;/g, '&')
      for (const k of plan.plannerKinds.kinds) {
        if (!plain.includes(k.label)) throw new Error(`${k.label} is not on the picker`)
      }
      // The dividers, and the reason for them: "Power" and "Endurance" are
      // climbing categories in this app and ordinary words everywhere else, so
      // ungrouped they were a coin flip. Hence a heading per group.
      for (const g of plan.plannerKinds.groups) {
        if (!plain.includes(g.name)) throw new Error(`the "${g.name}" divider is missing`)
      }
      if (!/Something else/.test(t)) throw new Error('no way to ask for something not on the list')
    }],
  // The discipline travels onto the ask screen too — "Power endurance" alone is
  // the same ambiguity one step later, on the screen the user presses go from.
  ['PlanFlow(the discipline follows the kind)', null, () => {
    const pe = plan.plannerKinds.kinds.find(k => k.key === 'pe')
    const group = plan.plannerKinds.groups.find(g => g.key === pe.group)
    if (!group) throw new Error('the power-endurance kind names no group')
    if (group.name !== 'Climbing') throw new Error(`power endurance is grouped under ${group.name}`)
  }],
  // Same reachability rule as the session picker: a kind in plan.json that no
  // group claims must still land on screen, not vanish into a gap.
  ['PlanFlow(every kind is in a group)', null, () => {
    const listed = groupedKinds(plan).flatMap(g => g.items.map(k => k.key))
    const missing = plan.plannerKinds.kinds.filter(k => !listed.includes(k.key)).map(k => k.key)
    if (missing.length) throw new Error(`ungrouped and unreachable: ${missing.join(', ')}`)
    if (listed.length !== new Set(listed).size) throw new Error('a kind is listed in two groups')

    // And an orphan really does fall through rather than disappear.
    const orphaned = groupedKinds({ plannerKinds: {
      groups: plan.plannerKinds.groups,
      kinds: [{ key: 'weird', label: 'Weird', group: 'no-such-group' }],
    } })
    if (!orphaned.flatMap(g => g.items).some(k => k.key === 'weird')) {
      throw new Error('a kind with an unknown group vanished')
    }
  }],
  /* Keeping a workout and starting it are two decisions: after keeping one, the
   * user chooses between going back to the main menu, planning another workout,
   * or starting it. The screen that asks is `KeptStep`. */
  /* Multi-select, and the conversation that follows a plan: several workouts can
   * be selected to plan a full day at the gym, and a created plan can be followed
   * up on with the AI rather than being a dead end. */
  ['PlanFlow(more than one kind at a time, numbered in the order picked)',
    <KindStep plan={plan} custom="" setCustom={noop} setPicked={noop} onNext={noop} onBuild={noop} ai
      picked={[plan.plannerKinds.kinds[2], plan.plannerKinds.kinds[0]]} />,
    (html) => {
      // Every row is a toggle, and the fork is what commits — a row that navigates
      // on tap cannot be the second of three.
      if (!/aria-pressed="false"/.test(html) || !/aria-pressed="true"/.test(html)) throw new Error('the kind rows are not toggles')
      // The check carries the order: the planner writes the blocks in it.
      const marks = [...html.matchAll(/class="kindrow-check"[^>]*>(\d*)</g)].map(m => m[1]).filter(Boolean)
      if (marks.join() !== '2,1') throw new Error(`the picks are numbered ${marks.join()}, not in the order tapped`)
      if (!/Write it for me/.test(text(html))) throw new Error('no way to commit a selection')
    }],
  /*
   * TWO ROUTES (docs/DESIGN.md, Plan a workout). Kinds are rows with a check under
   * section heads, no prose; the footer appears once a kind is picked, with "Write it
   * for me" as the primary and "Build it myself" as the secondary when AI is on.
   */
  ['PlanFlow(nothing picked: no footer, no paragraph, rows not cards)', <PlanFlow plan={plan} entries={[]} iso={TODAY}
    onKeep={noop} onStart={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      if (/Build it myself|Write it for me/.test(t)) throw new Error('the fork shows before anything is picked')
      if (/as many as you like|sends nothing anywhere|Pick what you are doing/i.test(t)) throw new Error('the paragraphs are back')
      if (/kindcard|kindgrid|kindgroup-head/.test(html)) throw new Error('the kinds are cards in a grid again')
      if (!/class="list-row kindrow/.test(html)) throw new Error('the kinds are not list rows')
      if (!/class="section-head"><h3>Lifting<\/h3>/.test(html)) throw new Error('the groups are not section heads')
      // A group's blurb is content, and is no longer printed.
      const blurb = plan.plannerKinds.groups.find(g => g.blurb)?.blurb
      if (blurb && t.includes(blurb.slice(0, 30))) throw new Error('a group blurb paragraph is on screen')
    }],
  ['PlanFlow(picked, AI on: Write it for me primary, Build it myself secondary)',
    <KindStep plan={plan} custom="" setCustom={noop} setPicked={noop} onNext={noop} onBuild={noop} ai
      picked={[plan.plannerKinds.kinds[0]]} />,
    (html) => {
      const btns = [...html.matchAll(/<button class="(btn big[^"]*)"[^>]*>.*?<\/button>/g)].map(m => [m[1], text(m[0])])
      const write = btns.find(([, t]) => /Write it for me/.test(t))
      const build = btns.find(([, t]) => /Build it myself/.test(t))
      if (!write || write[0].trim() !== 'btn big') throw new Error(`"Write it for me" is ${write?.[0]}, not the primary`)
      if (!build || !/secondary/.test(build[0])) throw new Error(`"Build it myself" is ${build?.[0]}, not the secondary`)
      if (/Write me \d+ in one/.test(text(html))) throw new Error('the button changes its words with the count')
    }],
  /*
   * The hand-built route, opened empty.
   *
   * The thing this has to pin is that it is the SAME editor: one block per kind
   * the user picked, each carrying its own quota, and a way in to both catalogues —
   * the two hundred lifts and the pieces that are not lifts. A builder that
   * could only add lifts would dead-end every swim, ride and 4x4 session, which
   * is most of the kinds on the screen before it.
   */
  ['BuildStep(his own, block by block)',
    <PlanProvider plan={plan}>
      <BuildStep
        pres={blankPrescription({
          title: 'Legs + Ride',
          blocks: [
            { name: 'Legs', category: 'lift', activity: 'lift' },
            { name: 'Ride', category: 'bike', activity: 'bike' },
          ],
        })}
        setPres={noop} liftField={LIFT_FIELD} entries={[]}
        categories={plan.quotaCategories} onKeep={noop} />
    </PlanProvider>,
    (html) => {
      const t = text(html)
      for (const name of ['Legs', 'Ride']) {
        if (!t.includes(name)) throw new Error(`the ${name} block is not on the screen`)
      }
      if (!/Add an exercise here/.test(t)) throw new Error('no way into the exercise catalogue')
      if (!/Add a piece/.test(t)) throw new Error('no way to add work that is not a lift')
      if (!/its own workout|part of the workout beside it/.test(t)) throw new Error('a block does not say whether it is its own workout')
      if (!/Put it on today/.test(t)) throw new Error('no way to keep it')
      // Nothing in it yet is not a workout, and the button says so by being off.
      if (!/<button class="btn big" disabled=""/.test(html)) {
        throw new Error('an empty session can be kept')
      }
      // No model wrote this, so nothing on the screen may claim one did.
      if (/Why this session/.test(t)) throw new Error('a hand-built session offers reasoning nobody wrote')
    }],
  /* A pool length is 25 of something and a mile is not. Stepping a 3 mi run by
     25 walks it to 78 in three presses, which is what every distance box did
     before the hand-built route started writing rides by hand. */
  ['Stepper(the distance step follows the unit)', null, () => {
    if (STEP.distance({ unit: 'yd' }, { unit: 'yd' }).step !== 25) throw new Error('a pool set no longer steps by a length')
    // And a clock steps by what the clock is for: five seconds on a hang, half a
    // minute on a ride, because 45 minutes is 540 presses at five.
    if (STEP.seconds({}, { seconds: 45 }).step !== 5) throw new Error('a short interval no longer steps by five')
    if (STEP.seconds({}, { seconds: 2700 }).step !== 30) throw new Error('a long piece steps five seconds at a time')
    for (const u of ['mi', 'km']) {
      const s = STEP.distance({ unit: u }, { unit: u })
      if (s.step !== 0.5) throw new Error(`${u} steps by ${s.step}`)
      if (s.label !== u) throw new Error('the box does not say what it is measuring')
    }
  }],
  /* And with something in it, the same card the log form and the review step
     render — one open, steppers, the body map, and the keep button live. */
  ['BuildStep(one exercise in, and it is the same card)',
    <PlanProvider plan={plan}>
      <BuildStep
        pres={appendLift(
          blankPrescription({ title: 'Legs', blocks: [{ name: 'Legs', category: 'lift' }] }),
          LIFT_FIELD, SQUAT.key, { blockId: 'b0' })}
        setPres={noop} liftField={LIFT_FIELD} entries={[]}
        categories={plan.quotaCategories} onKeep={noop} />
    </PlanProvider>,
    (html) => {
      const t = text(html)
      if (!t.includes(SQUAT.name)) throw new Error('the exercise he added is not there')
      if (!/stepper/.test(html)) throw new Error('the numbers are not steppers')
      if (/<select/.test(html)) throw new Error('a native select is back on the plan side')
      if (/<button class="btn big" disabled=""/.test(html)) {
        throw new Error('a session with an exercise in it cannot be kept')
      }
    }],
  /*
   * COLLAPSED BY DEFAULT: the AI reasoning at the top of a planned session is a
   * collapsible section that starts collapsed. It used to open
   * with the reasoning showing, on the argument that a section you have to open
   * first shows you nothing; what that missed is that it sat between the user and
   * the first set of the session they were standing there to do.
   *
   * What the fold must NOT do is hide that there is something to read, which is
   * why the header keeps the turn count. A revision the user cannot see is the problem
   * the old coach's silent plan edits had.
   */
  ['PlanTalk(folded, and says so)',
    <PlanTalk pres={PRESCRIPTION} onChange={noop} />,
    (html) => {
      const t = text(html)
      if (!/Why this session/.test(t)) throw new Error('nothing says there is reasoning to read')
      if (!/aria-expanded="false"/.test(html)) throw new Error('it is not collapsed')
      if (t.includes(PRESCRIPTION.why.slice(0, 40))) throw new Error('the paragraph is still on screen')
      if (/Make it shorter/.test(t)) throw new Error('the prompt row is still on screen')
    }],
  ['PlanTalk(a revised plan carries its count on the fold)',
    <PlanTalk onChange={noop} pres={{ ...PRESCRIPTION, thread: [
      { role: 'you', text: 'Make it shorter', at: 'z' },
      { role: 'coach', text: 'Dropped the third squat set and the calf work — 32 minutes now.', at: 'z' },
    ] }} />,
    (html) => {
      if (!/class="plantalk-n"/.test(html)) throw new Error('nothing marks that it has been revised')
      if (!/aria-expanded="false"/.test(html)) throw new Error('a revised plan should still open folded')
    }],
  /*
   * AI WORKOUT DRAFTS (#28). "Write it for me" is a draft the server keeps, and
   * the run is the draft's, not the screen's. What SSR can pin: the list says
   * what each draft is doing and offers a retry only where there is something to
   * retry; the wait no longer says leaving cancels it; a revision being written
   * when the page was left is still shown as being written; and each draft
   * reopens at the step it is on.
   */
  ['DraftList(being written, ready and failed, each says which)',
    <DraftList now={Date.parse('2026-10-25T12:01:00Z')} onOpen={noop} onRetry={noop} onDiscard={noop} drafts={[
      { id: 'da', status: 'working', ask: { label: 'Legs', minutes: 45 }, run: { kind: 'write', startedAt: '2026-10-25T12:00:20Z' }, createdAt: '3' },
      { id: 'db', status: 'ready', ask: { label: 'Swim', minutes: 30 }, pres: { title: '2,000 yd threshold', minutes: 30 }, updatedAt: '2026-10-25T11:00:00Z', createdAt: '2', for: { id: 'sam', name: 'Sam' } },
      { id: 'dc', status: 'failed', error: 'the planner took too long', ask: { label: 'Core', minutes: 20 }, pres: null, createdAt: '1' },
    ]} />,
    (html) => {
      const t = text(html)
      // Drafts first, as list rows in one card (docs/DESIGN.md, Plan a workout).
      if (!/class="section-head"><h3>Drafts<\/h3>/.test(html)) throw new Error('drafts have no section head')
      if ((html.match(/class="list-row plandraft /g) || []).length !== 3) throw new Error('the drafts are not list rows')
      for (const want of ['Not on your day yet', 'Legs', 'Being written… 40s', '2,000 yd threshold',
        'For Sam · Ready · 30 min · 1 h ago', 'Core', 'Did not finish: the planner took too long']) {
        if (!t.includes(want)) throw new Error(`no "${want}"`)
      }
      if ((t.match(/Try again/g) || []).length !== 1) throw new Error('a retry is offered on a draft that did not fail, or not on the one that did')
      if ((html.match(/aria-label="Discard /g) || []).length !== 3) throw new Error('not every draft can be thrown away')
    }],
  ['DraftList(no drafts, no list)', <DraftList drafts={[]} onOpen={noop} onRetry={noop} onDiscard={noop} />,
    (html) => { if (html) throw new Error('an empty list rendered something') }],
  ['PlanFlow(no draft list until there is a draft)', <PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />,
    (html) => { if (/plandrafts|Not on your day yet/.test(html)) throw new Error('a draft list with nothing in it') }],
  ['Working(leaving the wait cancels nothing, and it says so)',
    <Working label="Legs" minutes={45} since={null} onDiscard={noop} />,
    (html) => {
      const t = text(html)
      if (/cancels it/.test(t)) throw new Error('the wait still says leaving cancels the run')
      if (!/You can leave/.test(t)) throw new Error('the wait does not say the draft carries on')
      if (!/Stop and throw it away/.test(t)) throw new Error('no way to stop a draft from the wait')
    }],
  ['PlanTalk(a draft\'s revision still being written is open and says so)',
    <PlanTalk pres={{ ...PRESCRIPTION, thread: [{ role: 'you', text: 'Make it shorter', at: 'z' }] }} onChange={noop}
      draft={{ busy: true, error: null, onAsk: noop }} />,
    (html) => {
      const t = text(html)
      if (!/aria-expanded="true"/.test(html)) throw new Error('a revision in progress is folded away')
      if (!/Rewriting it…/.test(t)) throw new Error('it does not say it is rewriting')
      if (!t.includes('Make it shorter')) throw new Error('the message is not on the thread')
    }],
  ['PlanTalk(a draft\'s failed revision shows its error)',
    <PlanTalk pres={PRESCRIPTION} onChange={noop} draft={{ busy: false, error: 'box busy', failedMessage: 'More volume', onAsk: noop }} />,
    (html) => {
      if (!/box busy — your session is unchanged/.test(text(html))) throw new Error('the failure is not shown')
    }],
  ['drafts(each reopens at the step it is on)', null, () => {
    const pres = { title: 'Legs', minutes: 40, blocks: PRESCRIPTION.blocks, thread: [{ role: 'you', text: 'x' }], ask: { kinds: ['Legs'] } }
    const table = [
      [{ status: 'working', run: { kind: 'write' }, pres: null }, 'working'],
      [{ status: 'working', run: { kind: 'revise' }, pres }, 'review'],
      [{ status: 'ready', pres }, 'review'],
      [{ status: 'failed', run: { kind: 'write' }, pres: null }, 'failed'],
      [{ status: 'failed', run: { kind: 'revise' }, pres }, 'review'],
      [null, 'kind'],
    ]
    for (const [d, want] of table) {
      if (draftStep(d) !== want) throw new Error(`${JSON.stringify(d?.status)}/${d?.run?.kind} reopened at ${draftStep(d)}, not ${want}`)
    }
    const shown = draftPres({ pres }, liftFieldOf(plan))
    if (!shown || shown.thread.length !== 1 || shown.ask?.kinds?.[0] !== 'Legs') throw new Error('the thread or the ask was lost on the way to the editor')
    if (!/Rewriting it/.test(draftLine({ status: 'working', run: { kind: 'revise', startedAt: new Date().toISOString() } }))) {
      throw new Error('a revision in progress reads as a new draft')
    }
  }],
  ['KeptStep(three doors, and nothing started)',
    <KeptStep pres={PRESCRIPTION} onStart={noop} onAnother={noop} onDone={noop} />,
    (html) => {
      const t = text(html)
      for (const door of ['Start it now', 'Plan another workout', 'Back to today']) {
        if (!t.includes(door)) throw new Error(`no "${door}" door`)
      }
      if (!t.includes(PRESCRIPTION.title)) throw new Error('it does not say what landed')
      // The promise this screen makes. If the flow ever auto-starts again, this
      // sentence becomes a lie and the test is the only thing that would say so.
      if (!/Nothing has started/.test(t)) throw new Error('it does not say the clock is not running')
    }],
  ['KeptStep(kept, but nothing to start)',
    <KeptStep pres={PRESCRIPTION} onStart={null} onAnother={noop} onDone={noop} />,
    (html) => {
      const t = text(html)
      // A write that did not come back with an id still has to leave two doors
      // rather than a dead end.
      if (/Start it now/.test(t)) throw new Error('offering to start something it cannot open')
      if (!/Back to today/.test(t)) throw new Error('no way out')
    }],
  ['PrescriptionEditor(a lift day)',
    <PrescriptionEditor pres={PRESCRIPTION} liftField={LIFT_FIELD} onChange={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes(PRESCRIPTION.blocks[1].items[0].name)) throw new Error('the movement is not named')
      // Every set is a row of steppers, because editing everything, as the log
      // already allows, is the thing this screen exists for.
      const steppers = (html.match(/class="stepper/g) || []).length
      if (steppers < 6) throw new Error(`only ${steppers} editable numbers on a four-set workout`)
      if (!/lb on the bar/.test(t)) throw new Error('the weight column does not say what it means')
    }],
  /* ===================================== 2026-09-17, the last three asks ===
   *
   * A body diagram against every lifting movement, what the user lifted last time while
   * the user is still choosing the weight, and a quota per BLOCK rather than per
   * session. All three land on the same screen, so they are checked on one.
   */
  ['PrescriptionEditor(body map, last time, and a category per block)',
    <PrescriptionEditor pres={TRIP} liftField={LIFT_FIELD} entries={PRIOR_LIFTS}
      categories={plan.quotaCategories} onChange={noop} />,
    (html) => {
      const t = text(html)

      // 1. The body. Two views per movement — a press lights the front and a row
      //    the back, so one view would render half the catalog as an empty body.
      const bodies = (html.match(/class="bodymap"/g) || []).length
      if (!bodies) throw new Error('no body diagram against the movement')
      if (!/muscle|<svg/.test(html)) throw new Error('the body did not render as SVG')

      // 2. What the user did last time, on the screen where the weight is CHOSEN.
      if (!/last time \(2026-09-10\)/.test(t)) throw new Error('no previous session on the planning screen')
      if (!/175/.test(t)) throw new Error('the previous weight is not shown')

      // 3. A category per block, not per session: where the session splits into
      //    workouts. Said in plain words; the quotas it used to fill are gone.
      if (!/its own workout/i.test(t)) throw new Error('no per-block split control')
      if (!/Lift/.test(t) || !/Run/.test(t)) throw new Error('the two blocks do not name their own categories')
      // The warm-up is not a workout in its own right.
      if (!/part of the workout beside it/.test(t)) throw new Error('the warm-up claims to be a workout')
      if (/counts toward|quota/i.test(html.replace(/<[^>]*>/g, ' '))) throw new Error('quota language is back on the planner')
    }],
  ['BodyMap(a movement the catalog has no muscles for renders nothing)', null, () => {
    const html = renderToString(
      <PrescriptionEditor liftField={LIFT_FIELD} categories={[]} onChange={noop}
        pres={normalizePrescription({
          title: 'x', minutes: 10, why: '',
          blocks: [{ name: 'M', items: [{ kind: 'interval', name: 'Row 500m', sets: [{ distance: 500 }] }] }],
        }, { liftField: LIFT_FIELD })} />)
    // An interval is not a catalog movement, so there is nothing honest to draw.
    if (/class="bodymap"/.test(html)) throw new Error('drew a body for something with no muscle data')
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
  ['WorkoutRunner(first set)', <WorkoutRunner session={PLANNED_CARD} entry={PLANNED_ENTRY}
    entries={rich} onRun={noop} onExit={noop} />,
    (html) => {
      const t = text(html)
      if (!/Done set/.test(t)) throw new Error('no way to mark the set he is on')
      // One primary on the screen (docs/DESIGN.md D7), and the old label is gone.
      if (/Mark set \d/.test(t)) throw new Error('"Mark set N" is back; the primary is "Done set"')
      if ((html.match(/class="btn big run-done"/g) || []).length !== 1) throw new Error('not exactly one primary')
      if (!/Planned/.test(t)) throw new Error('the target is not on screen')
      if (/run-target-label|text-transform/.test(html)) throw new Error('the target is a small-caps label again')
      // The two things that make it usable one-handed.
      if (!/class="bigstep-in"/.test(html)) throw new Error('the numbers are not thumb-sized')
      if (!/run-done/.test(html)) throw new Error('the mark button is not the big one')
      // "If you add another set, you have to type in the weight every single time."
      // The runner has to offer one more set of this, and the box has to take a
      // decimal — a number input would eat the dot in "37.5".
      if (!/One more set of/.test(html)) throw new Error('no way to add a set from the runner')
      if (!/class="bigstep-in"[^>]*type="text"|type="text"[^>]*class="bigstep-in"/.test(html)) {
        throw new Error('the weight box is not a text box, so a decimal point will not survive typing')
      }
    }],
  ['WorkoutRunner(resting)', <WorkoutRunner session={PLANNED_CARD}
    entry={{ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, run: RESTING_RUN } }}
    entries={rich} onRun={noop} onExit={noop} />,
    (html) => {
      const t = text(html)
      if (!/rest/i.test(t)) throw new Error('a rest does not say it is one')
      if (!/Next:/.test(t)) throw new Error('the rest screen does not say what is coming')
      if (/class="btn big run-done"/.test(html)) throw new Error('a primary on the rest screen; skipping the rest is the quiet one')
    }],
  ['WorkoutRunner(no plan on the entry)', <WorkoutRunner session={PLANNED_CARD}
    entry={{ id: 'x', kind: 'daily', date: TODAY, data: { optId: 'planned', out: {} } }}
    entries={[]} onRun={noop} onExit={noop} />,
    (html) => {
      if (!/no plan on it/.test(text(html))) throw new Error('an empty runner should say so, not crash')
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
  /* ============================================================= endurance
   *
   * Instead of one bike/swim/run section, endurance is a set of workout kinds —
   * speed, power, endurance and so on — that the app selects workouts from, with
   * zone-two and low-intensity volume as the default emphasis.
   */
  ['PlanFlow(the endurance kinds let the planner pick the sport)', null, () => {
    const kinds = plan.plannerKinds.kinds
    const endurance = kinds.filter(k => k.group === 'endurance')
    if (endurance.length < 6) throw new Error(`only ${endurance.length} endurance kinds — he asked for a lot`)
    if (!endurance.some(k => /zone 2/i.test(k.label))) throw new Error('zone 2 is not a kind, and it is the bread and butter')
    if (!/zone 2/i.test(endurance[0].label)) throw new Error('zone 2 does not lead the endurance group')
    for (const k of endurance) {
      // Naming no sport is what tells the planner to choose one from the week.
      if (k.category || k.activity) throw new Error(`${k.key} names a sport; the endurance group is for kinds that let the planner pick`)
      if (!/swim|bike|run|sport/i.test(k.prompt)) throw new Error(`${k.key}'s prompt does not tell the planner to pick a sport`)
    }
    // The three sport catalogs: each has a catch-all, and every kind in it is
    // that sport's category.
    for (const g of ['swim', 'bike', 'run']) {
      const items = kinds.filter(k => k.group === g)
      if (items.length < 5) throw new Error(`only ${items.length} ${g} kinds`)
      if (!items.some(k => k.key === g)) throw new Error(`no catch-all "${g}" kind`)
      for (const k of items) if (k.category !== g) throw new Error(`${k.key} in the ${g} group fills ${k.category}`)
    }
    // Every sport and category a kind names is real. A typo here is a form of the
    // wrong shape and a category nothing files under.
    const acts = new Set(activityFieldOf(plan).activities.map(a => a.key))
    const cats = new Set(plan.quotaCategories.map(c => c.key))
    for (const k of kinds) {
      if (k.activity && !acts.has(k.activity)) throw new Error(`${k.key}: activity "${k.activity}" is not in the catalog`)
      if (k.category && !cats.has(k.category)) throw new Error(`${k.key}: category "${k.category}" is not a category`)
    }
    // The bread and butter is not folded away; the catalogs are.
    const groups = plan.plannerKinds.groups
    if (groups.find(g => g.key === 'endurance')?.collapsed) throw new Error('the endurance group is folded')
    for (const g of ['swim', 'bike', 'run']) {
      if (!groups.find(x => x.key === g)?.collapsed) throw new Error(`the ${g} catalog is not folded, and thirty cards bury the climbing section`)
    }
  }],
  ['PlanFlow(every icon the content names is registered)', null, () => {
    // An unknown name renders as a dot, which looks like a bug the user caused.
    for (const k of plan.plannerKinds.kinds) if (!hasIcon(k.icon)) throw new Error(`${k.key}: icon "${k.icon}" is not registered`)
    for (const g of plan.plannerKinds.groups) if (!hasIcon(g.icon)) throw new Error(`group ${g.key}: icon "${g.icon}" is not registered`)
    for (const c of plan.quotaCategories) if (!hasIcon(c.icon)) throw new Error(`category ${c.key}: icon "${c.icon}" is not registered`)
  }],
  ['PlanFlow(folded catalogs are still in the page)', <PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />,
    (html) => {
      if (!/<details class="kindgroup folded"/.test(html)) throw new Error('nothing folds')
      const t = text(html).replace(/&amp;/g, '&')
      // Folded is not gone: every ride variant is rendered, one tap away.
      for (const k of plan.plannerKinds.kinds.filter(k => k.group === 'bike')) {
        if (!t.includes(k.label)) throw new Error(`${k.label} is not in the page`)
      }
      if (!/<summary class="section-head"><h3>[^<]+<\/h3><span class="sub">\d+<\/span>/.test(html)) {
        throw new Error('a folded group is not a section head saying how many are in it')
      }
      // The endurance group's paragraph ("These let the model pick swim, bike or run…") is
      // content and stays in the file, but the screen no longer prints it (D7).
      if (/pick swim, bike or run/i.test(t)) throw new Error('the endurance paragraph is back on the screen')
    }],
  /* The planner picks a sport from what was LOGGED lately, not from a quota (issue #31). */
  ['plannerContext(hands over the last week\'s workouts, not quotas)', null, () => {
    const s = plannerContext({
      iso: '2026-09-19', plan,
      entries: [
        { id: 'q', kind: 'quota', date: '2026-09-14', updatedAt: 'z', data: { counts: { bike: 3, pe: 2 } } },
        { id: 'r1', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Mountain bike', level: 2, done: true, out: { activity: 'mtb' } } },
        { id: 'r2', kind: 'daily', date: '2026-09-16', updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Run', level: 2, done: false, undone: true, out: { activity: 'run' } } },
        { id: 'r3', kind: 'daily', date: '2026-09-01', updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Swim', level: 2, done: true, out: { activity: 'swim' } } },
      ],
    })
    if (!/2026-09-15: Mountain bike/.test(s)) throw new Error(`the recent ride is missing: ${s}`)
    if (/2026-09-16|2026-09-01/.test(s)) throw new Error(`an unfinished or old workout leaked in: ${s}`)
    if (/quota|owe|0\/2/i.test(s)) throw new Error(`quota language reached the planner: ${s}`)
    if (!/Nothing logged/.test(plannerContext({ iso: '2026-09-19', plan, entries: [] }))) {
      throw new Error('an empty week does not say so')
    }
  }],
  ['PlanFlow(no AI: building it yourself is the only button, primary, and nothing mentions a model)', null, () => {
    const one = [plan.plannerKinds.kinds[0]]
    _setMe({ id: 'sam', owner: false, features: { ai: false, goals: false, whoop: false, strava: false, notifications: false } })
    try {
      // Read from whoami, as PlanFlow does, with something picked.
      const html = renderToString(<KindStep plan={plan} custom="" setCustom={noop} setPicked={noop}
        onNext={noop} onBuild={noop} picked={one} />)
      const t = text(html)
      if (!/Build it myself/.test(t)) throw new Error('no way to build a workout without the AI')
      if (/Write it for me|Write me \d/.test(t)) throw new Error('the model is offered to someone it is not set up for')
      if (/model|Sparkles/i.test(t.replace(/<[^>]*>/g, ' '))) throw new Error('the screen mentions a model')
      const btns = html.match(/<button class="btn big[^"]*"/g) || []
      if (btns.length !== 1 || /secondary|ghost/.test(btns[0])) throw new Error(`the only button is ${btns.join(' / ')}, not one primary`)
      const flow = text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
      if (/Write it for me|Drafts/.test(flow)) throw new Error('the flow offers the model or its drafts')
    } finally { _setMe({}) }
    // The server's ai-not-configured has the same effect (`ai={false}` is what PlanFlow passes then).
    const refused = text(renderToString(<KindStep plan={plan} custom="" setCustom={noop} setPicked={noop}
      onNext={noop} onBuild={noop} picked={one} ai={false} />))
    if (/Write it for me/.test(refused)) throw new Error('after ai-not-configured the model is still offered')
    const owner = text(renderToString(<KindStep plan={plan} custom="" setCustom={noop} setPicked={noop}
      onNext={noop} onBuild={noop} picked={one} />))
    if (!/Write it for me/.test(owner)) throw new Error('the owner lost "Write it for me"')
  }],
  /*
   * A refusal lasts the session (#55). Once a run comes back `ai-not-configured`,
   * closing Plan a workout and opening it again must not offer the model a second
   * time, whatever the cached features said; the next page load asks the server.
   */
  ['PlanFlow(after ai-not-configured, reopening offers Build it myself alone)', null, () => {
    const one = [plan.plannerKinds.kinds[0]]
    const kind = () => text(renderToString(<KindStep plan={plan} custom="" setCustom={noop} setPicked={noop}
      onNext={noop} onBuild={noop} picked={one} />))
    try {
      if (!aiOffered({ ai: true }) || !/Write it for me/.test(kind())) throw new Error('the model is not offered before any refusal')
      if (noteAiRefusal({ code: 'not-shared' })) throw new Error('another error counted as a refusal')
      if (!noteAiRefusal(Object.assign(new Error('x'), { code: 'ai-not-configured' }))) throw new Error('the refusal was not noted')
      if (aiOffered({ ai: true })) throw new Error('a refused session still offers the model')
      if (/Write it for me/.test(kind())) throw new Error('reopening Plan a workout offers the model again')
      const flow = text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
      if (/Write it for me|Drafts/.test(flow)) throw new Error('the reopened flow offers the model or its drafts')
    } finally { resetAiRefusal() }
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
  ['example: no climbing folders', null, () => {
    const keys = climbingFolders(example).map(f => f.key)
    if (keys.join() !== 'plan') throw new Error(`the example is foldered as ${keys.join(', ')}`)
  }],

  // ===== batch C: Log and Progress =====

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
  ['ProgressView(critical force)', <ProgressView plan={plan} entries={[...rich, ...cfEntries]} />],
  // An old log's check-ins, journal days, quotas and achievements are history the
  // app no longer reads (issue #31): the Log renders, and none of them is a workout.
  ['LogTab(legacy entries are not workouts)', <LogTab plan={plan} entries={[...LEGACY, ...entries]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      if (LEGACY_WORDS.test(t)) throw new Error(`a removed feature's data is in the log: ${t.match(LEGACY_WORDS)}`)
    }],
  ['ProgressView(legacy entries are not workouts)', <ProgressView plan={plan} entries={LEGACY} />,
    (html) => {
      const t = text(html)
      if (!/Nothing logged yet/.test(t)) throw new Error('a legacy entry was counted as a workout')
      if (/Achievement/.test(t)) throw new Error('the achievement filter is back')
    }],
  ['ProgressView(rich)', <ProgressView plan={plan} entries={rich} />,
    html => {
      const t = text(html)
      /*
       * The three per-session grade charts — lead laps, fun bouldering, fun sport
       * — became TWO charts on 2026-09-15: hardest route and hardest boulder,
       * across whatever is in scope. What survives is the property those
       * assertions protected: a grade chart reads its axis off the LADDER, not
       * off the stored decimal. A hero that says "10.2" is a chart asking them
       * to decode their own log.
       */
      const hero = (title) => t.match(new RegExp(`${title}</h3>(?:<p class="viz-help">[^<]*</p>)?<div class="viz-hero">([^<]*)`))?.[1]
      if (!/Hardest route/.test(t)) throw new Error('the route-grade chart is missing')
      if (!/^5\.\d/.test(hero('Hardest route') || '')) throw new Error(`the route headline read "${hero('Hardest route')}", not a rung`)
      if (!/Hardest boulder/.test(t)) throw new Error('the boulder-grade chart is missing')
      if (!/^V\d/.test(hero('Hardest boulder') || '')) throw new Error(`the boulder headline read "${hero('Hardest boulder')}", not a V grade`)
    }],
  /*
   * Wave 2 (issue #43): Progress LEADS with the answer. Workouts and time for the
   * period, two numbers in one card, with the period as a segmented control
   * under them; the filter card, the "Since" row and the tiles went.
   */
  ['ProgressView(leads with workouts and time, the period under them)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      const head = t.indexOf('class="card proghead"')
      if (head < 0) throw new Error('no headline card')
      if (t.indexOf('<svg') >= 0 && t.indexOf('<svg') < head) throw new Error('a chart comes before the headline')
      const card = t.slice(head, t.indexOf('class="filters', head) > 0 ? t.indexOf('class="filters', head) : undefined)
      for (const w of ['Workouts', 'Time']) if (!card.includes(`>${w}<`)) throw new Error(`the headline has no ${w}`)
      if ((card.match(/class="proghead-value"/g) || []).length !== 2) throw new Error('the headline is two numbers')
      const seg = card.match(/class="seg proghead-seg"[^]*?<\/div>/)?.[0] || ''
      const segs = [...seg.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m => m[1])
      if (segs.join('|') !== '4 wk|8 wk|6 mo|All') throw new Error(`the period should be 4 wk · 8 wk · 6 mo · All, got ${segs}`)
      if (!/aria-pressed="true"[^>]*>8 wk</.test(seg)) throw new Error('8 weeks is the default')
      // Gone from the old address: the filter card, its labels and the tiles.
      if (/scopebar|scoperow|class="tiles"|class="tile /.test(html)) throw new Error('the old filter card or tiles are back')
      if (/>Since<|>Category<|>Load<|RPE × minutes|Hours</.test(t)) throw new Error('an old label is back')
    }],
  // "Just one thing" moved from a labelled select in the filter card to a row.
  ['ProgressView("Just one thing" is a row that opens a list)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      const row = t.match(/<label class="list-row progpick-row">[^]*?<\/label>/)?.[0] || ''
      if (!/Just one thing/.test(row)) throw new Error('"Just one thing" is not a row')
      if (!/Any workout/.test(row)) throw new Error('the row should say what is picked')
      if (!/<select[^>]*aria-label="Just one thing"/.test(row)) throw new Error('the row opens no list')
      if (/scopesel/.test(html)) throw new Error('the old select is back')
    }],
  ['ProgressView(category chips only when more than one is logged)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const chips = [...text(html).matchAll(/<button type="button" class="chip[^"]*"[^>]*>([^<]*)<\/button>/g)].map(m => m[1])
      if (chips[0] !== 'All' || chips.length < 3) throw new Error(`expected All and the categories: ${chips}`)
      if (chips.some(c => /\d/.test(c))) throw new Error(`a count in a chip: ${chips}`)
    }],
  ['ProgressView(one category, no chips)', <ProgressView plan={plan} entries={[
    { id: 'p1', kind: 'daily', date: isoShift(TODAY, -2), updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 30, distance: 3, rpe: 5 } } },
    { id: 'p2', kind: 'daily', date: isoShift(TODAY, -9), updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 45, distance: 5, rpe: 6 } } },
  ]} />,
    (html) => {
      const t = text(html)
      if (/class="filters/.test(t)) throw new Error('a chip row with one category in it')
      if (!/>2<\/span><span class="proghead-label">Workouts/.test(t)) throw new Error('two runs should read as 2 workouts')
      if (!/>1\.3<span class="proghead-unit">h</.test(t)) throw new Error('75 minutes should read 1.3 h')
    }],
  // Charts titled in plain words; each still declares when it applies, keeps its
  // table view, and the critical-force chart keeps its noise band.
  ['ProgressView(charts in plain words, a table each, the noise band kept)', <ProgressView plan={plan} entries={[...rich, ...cfEntries]} />,
    (html) => {
      const t = text(html)
      for (const w of ['Workouts per week', 'Time per week', 'Effort per week']) {
        if (!t.includes(`>${w}</h3>`)) throw new Error(`no "${w}" chart`)
      }
      for (const w of ['Training load', 'Session RPE', 'Hours per week', 'sRPE', 'Volume —']) {
        if (t.includes(w)) throw new Error(`jargon back on Progress: ${w}`)
      }
      const charts = (t.match(/class="viz"/g) || []).length
      const toggles = (t.match(/class="viz-toggle"[^>]*>Table</g) || []).length
      if (!charts || toggles !== charts) throw new Error(`${charts} charts but ${toggles} table switches`)
      if (/\d{4}-\d{2}-\d{2}<\/text>/.test(t)) throw new Error('a bar is labelled with a raw date')
    }],
  ['ProgressView(no paragraph explaining the page)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      if (/Why these charts|blurb|progress-how/.test(t)) throw new Error('the explanatory blurb is back on Progress')
      if (/text-transform/.test(t)) throw new Error('small capitals on Progress')
    }],
  // The max hang series has to survive the split: two entries under the old id,
  // one under the new, and one continuous line.
  ['ProgressView(across the split)', <ProgressView plan={plan} entries={[
    ...rich,
    { id: 'sp1', kind: 'daily', date: '2026-08-17', updatedAt: 'z',
      data: { optId: 'max-hangs', level: 4, name: 'Max hangs', minutes: 15, done: true,
        out: { rpe: 7, fingers: 2, sets: { maxhang: [{ reps: 1, seconds: 7, weight: 47 }] }, signs: { maxhang: '+' } } } },
    { id: 'sp2', kind: 'daily', date: '2026-08-17', updatedAt: 'z',
      data: { slot: 'extra', optId: 'repeaters', level: 4, name: 'Repeaters', minutes: 20, done: true,
        out: { rpe: 7, fingers: 3, sets: { repeaters: [{ reps: 12, weight: 18 }] }, signs: { repeaters: '-' } } } },
  ]} />],
  ['ProgressView(empty)', <ProgressView plan={plan} entries={[]} />,
    (html) => {
      if (!/class="empty"/.test(html) || !/Nothing logged yet/.test(text(html))) throw new Error('an empty log should say so')
      if (/proghead/.test(html)) throw new Error('zeros and a period switch over nothing')
    }],
  ['ProgressView(one point)', <ProgressView plan={plan} entries={rich.slice(0, 3)} />],
  // A window with nothing in it offers the one way out, as a button.
  ['ProgressView(nothing in the period offers all time)', <ProgressView plan={plan} entries={[
    { id: 'old', kind: 'daily', date: '2024-01-08', updatedAt: 'z', data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 30 } } },
  ]} />,
    (html) => {
      const t = text(html)
      if (!/Nothing logged in these weeks/.test(t)) throw new Error('an empty period should say so')
      if (!/class="btn secondary"[^>]*>Show all time</.test(t)) throw new Error('no way out of an empty period')
    }],
  // Review of #46: the y-axis gutter is sized from its widest label, so "3000"
  // keeps its first digit, and a count axis never ticks at 0.5.
  ['ProgressView(axis numbers fit, counts tick in whole numbers)', <ProgressView plan={plan} entries={[...rich,
    ...[0, 1, 2, 3].map(i => ({ id: `big${i}`, kind: 'daily', date: isoShift(TODAY, -i), updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'run', duration: 300, rpe: 9 } } }))]} />,
    (html) => {
      const t = text(html)
      const chart = (title) => t.slice(t.indexOf(`>${title}</h3>`), t.indexOf('</svg>', t.indexOf(`>${title}</h3>`)))
      const effort = chart('Effort per week')
      const ticks = [...effort.matchAll(/text-anchor="end" class="viz-tick">([^<]+)</g)].map(m => m[1])
      const widest = Math.max(...ticks.map(x => x.length))
      const padL = Number(effort.match(/<line x1="([\d.]+)"/)?.[1])
      if (widest < 4) throw new Error(`expected a four-digit effort axis, got ${ticks}`)
      if (!(padL >= widest * 6.6 + 12)) throw new Error(`a ${widest}-digit label in a ${padL}px gutter is clipped`)
      for (const title of ['Workouts per week', 'Hard finger days per week']) {
        const c = chart(title)
        if (!c) throw new Error(`no ${title} chart`)
        const bad = [...c.matchAll(/text-anchor="end" class="viz-tick">([^<]+)</g)].map(m => m[1]).filter(x => !/^\d+$/.test(x))
        if (bad.length) throw new Error(`${title} ticks at ${bad}: a count has no fractions`)
      }
    }],
  // Narrowed from the row, the page says so: no chip claims "All", and the
  // headline names the pick beside a Clear. Unnarrowed, no such line.
  ['ProgressView(narrowed: the pick is named in the headline, with Clear, and All is not lit)', <ProgressView plan={plan} entries={rich}
    initialScope={{ category: null, session: 'subthreshold', exercise: null, weeks: null }} />,
    (html) => {
      const t = text(html)
      const scope = t.match(/<div class="proghead-scope">([^]*?)<\/div>/)?.[1] || ''
      const what = scope.match(/proghead-scope-what">([^<]*)</)?.[1]
      const picked = t.match(/progpick-value on">([^<]*)</)?.[1]
      if (!what || what === 'subthreshold' || what !== picked) throw new Error(`the headline does not name the pick: "${what}" vs the row's "${picked}"`)
      if (!/Clear<\/button>/.test(scope)) throw new Error('no way back from a narrowed page')
      if (/class="chip on"[^>]*>All</.test(t)) throw new Error('All is lit while one workout is picked')
    }],
  ['ProgressView(not narrowed: All lit, no scope line)', <ProgressView plan={plan} entries={rich} />,
    (html) => {
      const t = text(html)
      if (/proghead-scope/.test(t)) throw new Error('a "narrowed to" line over the whole log')
      if (!/class="chip on"[^>]*>All</.test(t)) throw new Error('All should be lit when nothing is picked')
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
  ['starter: ProgressView', <ProgressView plan={starter} entries={[]} />],

  // ===== batch D: profile and connections =====

  ['TestingTab', <TestingTab plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} />],
  ['GearSection(empty)', <GearSection plan={plan} entries={[]} strava={null} upsertEntry={noop} deleteEntry={noop} />],
  ['GearSection(strava bikes and shoes)', <GearSection plan={plan} entries={[]}
    strava={STRAVA_CACHE} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      if (!/Strava/.test(text(html))) throw new Error('synced gear is not labelled as synced')
    }],
  ['GearSection(local gear with use on it)', <GearSection plan={plan}
    strava={STRAVA_CACHE}
    entries={[
      { id: 'gear-rope', kind: 'gear', data: { name: 'Mammut 9.5', kind: 'rope', primary: true, acquired: '2025-03-01' } },
      { id: 'gear-plates', kind: 'gear', data: { name: 'Cast iron', kind: 'weights' } },
      { id: `daily-${TODAY}-board`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'board', level: 4, done: true, minutes: 120, out: { gear: ['gear-rope'] } } },
    ]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      if (!/Mammut/.test(t)) throw new Error('local gear is missing')
      // Two units on one page, which is the point: the metric belongs to the KIND,
      // so a bike reads in miles and a rope reads in hours without either
      // item having to declare it.
      if (!/\bhr\b/.test(t)) throw new Error('a rope should read in hours')
      if (!/\bmi\b/.test(t)) throw new Error('a bike should still read in miles')
    }],
  ['GearSection(retired gear keeps its hours)', <GearSection plan={plan} strava={null}
    entries={[{ id: 'g1', kind: 'gear', data: { name: 'Worn rope', kind: 'rope', retired: true, priorMinutes: 12000 } }]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      if (!/200/.test(text(html))) throw new Error('the hours on a retired rope are why you retired it')
    }],
  ['ProfileMenu(with a picture)', <StravaProvider initial={{ cache: STRAVA_CACHE, status: 'ok' }}>
    <ProfileMenu plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced" />
  </StravaProvider>,
    (html) => {
      if (!/Sam/.test(text(html))) throw new Error('the header does not say who the athlete is')
      // Closed by default: the panel is a menu, not a page, and mounting it open
      // would put a gear editor over the app on every load.
      if (/Connections|Add gear/.test(text(html))) throw new Error('the menu should start closed')
      // On a phone the button is a face and nothing else, so it needs a name.
      if (!/class="mebtn"[^>]*aria-label="Profile: [^"]+"/.test(html)) throw new Error('the avatar button has no accessible name')
    }],
  ['ProfileMenu(no strava at all)', <ProfileMenu plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} status="offline" />,
    (html) => {
      if (!/You/.test(text(html))) throw new Error('a header saying null is worse than one saying nothing')
    }],
  /*
   * The profile is a list of sections (#44), not six tabs in a strip that cut
   * off on a phone. Pinned from both sides: the list and its order at the new
   * address, and Testing and Why gone from the top level (they are under
   * Climbing, where a climbing plan fills them).
   */
  ...(() => {
    const owner = { id: 'owner', name: 'Alex', owner: true, acting: false,
      real: { id: 'owner', name: 'Alex', admin: true }, people: [],
      features: { ai: true, whoop: true, strava: true, stravaConnect: true, whoopConnect: true, notifications: true } }
    const nobody = { ...owner, features: { ...owner.features, whoop: false, strava: false, stravaConnect: false, whoopConnect: false } }
    const panel = (props) => renderToString(
      <ProfilePanel plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} status="synced"
        who={owner} onClose={noop} {...props} />)
    const rowTitles = (html) => [...html.matchAll(/class="list-row-title">([^<]+)</g)].map(m => m[1])
    return [
      ['ProfilePanel(a list of sections, Climbing holding Testing and Why)', null, () => {
        const home = rowTitles(panel({}))
        const want = ['You', 'Gear', 'Notifications', 'Connections', 'Climbing', 'Settings']
        if (home.join() !== want.join()) throw new Error(`home rows: ${home.join(', ')}`)
        if (/>Alerts</.test(panel({}))) throw new Error('the old "Alerts" tab is back')
        if (/role="tablist"|pop-rail/.test(panel({}))) throw new Error('the sideways strip of tabs is back')
        for (const gone of ['Testing', 'Why']) {
          if (home.includes(gone)) throw new Error(`${gone} is at the top level again; it lives under Climbing`)
        }
        const climbing = panel({ initialPage: 'climbing' })
        const sub = rowTitles(climbing)
        if (!sub.includes('Testing') || !sub.includes('Why')) throw new Error(`Climbing should open Testing and Why: ${sub.join(', ')}`)
        if (!/Your grades/.test(text(climbing))) throw new Error('the climbing numbers moved here from You')
        if (!/aria-label="Back to your profile"/.test(climbing)) throw new Error('no way back from a page')
        if (!/aria-label="Back to Climbing"/.test(panel({ initialPage: 'testing' }))) throw new Error('Testing goes back to Climbing')
        // You keeps the body numbers and nothing about climbing.
        const you = text(panel({ initialPage: 'you' }))
        if (!/Bodyweight/.test(you)) throw new Error('bodyweight is missing from You')
        if (/Redpoint grade/.test(you)) throw new Error('climbing grades are still on You')
      }],
      ['ProfilePanel(nothing to connect, nothing behind Testing)', null, () => {
        // No Strava or WHOOP app on the server: no Connections row at all, as before.
        if (homePages(nobody).includes('connections')) throw new Error('a Connections row with nothing to connect')
        if (homePages({ ...owner, acting: true }).includes('connections')) throw new Error('acting as someone offers their connections')
        // The starter defines no tests and no evidence: Climbing has the grades and no empty doors.
        const starterClimb = rowTitles(renderToString(
          <ProfilePanel plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced"
            who={owner} onClose={noop} initialPage="climbing" />))
        if (starterClimb.length) throw new Error(`the starter's Climbing offers empty pages: ${starterClimb.join(', ')}`)
      }],
      ['ProfilePanel(connections: one service, one action)', null, () => {
        const on = text(panel({ initialPage: 'connections', who: { ...owner, features: { ...owner.features, whoop: false } } }))
        if (!/Strava/.test(on) || !/Disconnect/.test(on)) throw new Error('a connected Strava can be disconnected')
        if (!/WHOOP.*Not connected.*Connect/.test(on)) throw new Error('an unconnected WHOOP offers to connect')
        // Two services, neither connected: two Connect buttons, and neither is the accent.
        const both = panel({ initialPage: 'connections', who: { ...nobody, features: { ...nobody.features, stravaConnect: true, whoopConnect: true } } })
        if ((both.match(/>Connect</g) || []).length !== 2) throw new Error('each service offers to connect')
        if (/class="btn"[ >]/.test(both)) throw new Error('two primaries on one page')
        const someone = text(panel({ initialPage: 'connections', who: { ...owner, owner: false, real: { id: 'sam', admin: false } } }))
        if (/WHOOP/.test(someone)) throw new Error('WHOOP is the owner\'s grant, not everyone\'s')
      }],
      ['ProfilePanel(settings: sync, explanations, the server page)', null, () => {
        const t = text(panel({ initialPage: 'settings' }))
        if (!/Synced/.test(t)) throw new Error('the sync state is not shown')
        if (!/Show explanations/.test(t)) throw new Error('the explanations switch is missing')
        if (!/Server settings/.test(t)) throw new Error('the owner has no way to the server Settings page')
        if (/This is what the header used to say/.test(t)) throw new Error('the explanatory paragraph came back')
        const someone = text(panel({ initialPage: 'settings', who: { ...owner, owner: false, real: { id: 'sam', admin: false } } }))
        if (/Server settings/.test(someone)) throw new Error('only the owner opens server Settings')
      }],
    ]
  })(),
  ['WhyTab', <WhyTab plan={plan} />],
  ['TestingTab(empty)', <TestingTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  // Trip mode: the four days the whole block points at.

  // Critical force: the ceiling readout, the charts, and the resolved dose on
  // the session it drives, from the calibration-day fixture above.
  ['TestingTab(critical force)', <TestingTab plan={plan} entries={cfEntries} upsertEntry={noop} />],
  ['TestingTab(CF, no max logged)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[{ id: 'cf1', kind: 'test', date: '2026-08-08', updatedAt: 'z',
      data: { testId: 'critical-force', cfKg: 18.2 } }]} />],
  ['TestingTab(CF, CFmin binds)', <TestingTab plan={plan} upsertEntry={noop}
    entries={[{ id: 'cf2', kind: 'test', date: '2026-08-08', updatedAt: 'z',
      data: { testId: 'critical-force', cfKg: 18.2, cfMinKg: 11.5, mvcKg: 48.6 } }]} />],
  /* WHOOP.
   *
   * The state that matters most is the EMPTY one: with no band, no grant or no
   * cache, every one of these must render nothing at all, because "the app behaves
   * exactly as it did before WHOOP existed" is the whole safety argument for
   * letting an external service near a training log. After that, the risk is a
   * wrong match written into the log, so the suggestion rules are pinned on screen
   * as well as in server/whoop.test.js.
   */
  ...(() => {
    const day = '2026-08-20'
    const t = (hhmm, mins) => {
      const start = Date.parse(`${day}T${hhmm}:00.000Z`)
      return { start: new Date(start).toISOString(), end: new Date(start + mins * 60000).toISOString(), minutes: mins }
    }
    const climb = { id: 'w-climb', sport: 'rock-climbing', date: day, ...t('18:05', 88),
      strain: 11.4, avgHr: 132, maxHr: 168, calories: 640, percentRecorded: 98,
      zones: { zero: 6, one: 22, two: 34, three: 18, four: 7, five: 1 } }
    const lift = { id: 'w-lift', sport: 'Weightlifting', date: day, ...t('17:10', 35),
      strain: 4.1, avgHr: 118, maxHr: 141, calories: 210, percentRecorded: 71,
      zones: { zero: 9, one: 15, two: 8, three: 3, four: 0, five: 0 } }
    const cache = {
      fetchedAt: `${day}T20:00:00.000Z`, maxHeartRate: 195,
      workouts: [climb, lift],
      recovery: [
        { date: day, recovery: 31, hrv: 42, restingHr: 58, strain: 8.2 },
        { date: '2026-08-19', recovery: 62, hrv: 55, restingHr: 52 },
        { date: '2026-08-18', recovery: 58, hrv: 51, restingHr: 53 },
        { date: '2026-08-17', recovery: 70, hrv: 58, restingHr: 51 },
        { date: '2026-08-16', recovery: 49, hrv: 47, restingHr: 54 },
      ],
    }
    const session = plan.dailyMenu.find(m => m.id === 'four-by-four')
    const entryOf = (out) => ({
      id: `daily-${day}`, kind: 'daily', date: day, updatedAt: 'z',
      data: { optId: 'four-by-four', name: 'Bouldering 4×4s', minutes: 96, out },
    })
    const wrap = (initial, el) => <WhoopProvider initial={initial}>{el}</WhoopProvider>
    const workouts = (out, initial = { cache }) =>
      wrap(initial, <WhoopWorkouts session={session} entry={entryOf(out)} entries={[]} onSave={noop} />)

    return [
      // The timed session: workout mode stamped startedAt, so the overlap is real
      // and the climb — not the lift before it — is the one marked.
      ['Whoop(timed session, overlap)',
        workouts({ startedAt: `${day}T18:00:00.000Z`, elapsedMin: 96 }),
        html => {
          const t2 = text(html)
          if (!/rock-climbing/.test(t2) || !/Weightlifting/.test(t2)) throw new Error('both workouts should be listed')
          // Exactly one suggestion, and it is the climb.
          const tags = (html.match(/class="wh-tag"/g) || []).length
          if (tags !== 1) throw new Error(`expected one likely tag, got ${tags}`)
          const climbFirst = t2.indexOf('rock-climbing') < t2.indexOf('Weightlifting')
          if (!climbFirst) throw new Error('the overlapping workout should rank first')
          // Why, as text on the row: a tooltip is invisible on a phone.
          if (!/class="list-row-meta wh-why">Overlaps this session by \d+ min</.test(html)) throw new Error('the reason for Likely is not on the row')
          if (/class="wh-tag" title=/.test(html)) throw new Error('the reason went back into a tooltip')
          // Heart rate against their own max, and the partial recording called out.
          if (!/avg 132 \(68%\)/.test(t2)) throw new Error('no percentage of max heart rate')
          if (!/26 min zone 3\+/.test(t2)) throw new Error('hard minutes missing')
          if (!/only 71% recorded/.test(t2)) throw new Error('a partly-recorded workout must say so')
          if (!/>Attach</.test(html)) throw new Error('nothing to tap')
        }],
      /* No clock on the session at all — logged by hand — and the sport decides it:
       * four-by-four declares `whoopSport: climbing` in plan.json, one of the two
       * workouts is titled rock-climbing, and that is two sources agreeing about
       * what happened rather than a coincidence of length. */
      ['Whoop(untimed session, the sport decides)', workouts({}),
        html => {
          const tags = (html.match(/class="wh-tag"/g) || []).length
          if (tags !== 1) throw new Error(`expected the climb to be picked, got ${tags} tags`)
          const t2 = text(html)
          if (t2.indexOf('rock-climbing') > t2.indexOf('Weightlifting')) {
            throw new Error('the mismatched sport should sink below the climb')
          }
          // The sport decided it, so that is the reason given, not "the only workout today".
          if (!/The only workout of this sport today/.test(t2)) throw new Error('the reason does not name the sport')
          if ((html.match(/>Attach</g) || []).length !== 2) throw new Error('both should still be attachable')
        }],
      // Two climbs is ambiguous again, and the app goes quiet rather than guessing.
      ['Whoop(two climbs, no claim)',
        wrap({ cache: { ...cache, workouts: [climb, { ...climb, id: 'w-b', sport: 'bouldering', ...t('19:40', 50) }] } },
          <WhoopWorkouts session={session} entry={entryOf({})} entries={[]} onSave={noop} />),
        html => {
          if (/class="wh-tag"/.test(html)) throw new Error('"the only climb tonight" stopped being true')
        }],
      // Attached: the snapshot renders from the entry, and detaching is offered.
      ['Whoop(attached)', workouts({ whoop: {
        id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), strain: 11.4,
        avgHr: 132, maxHr: 168, pctAvgHr: 68, pctMaxHr: 86, calories: 640, percentRecorded: 98,
        maxHeartRate: 195, zones: { three: 18, four: 7, five: 1 }, attachedAt: 'z' } }),
        html => {
          const t2 = text(html)
          if (!/Detach/.test(t2)) throw new Error('no way to undo a wrong attachment')
          if (!/Saved with this session, so it stays if WHOOP goes away/.test(t2)) {
            throw new Error('the snapshot has to say it is durable')
          }
          /*
           * AND IT STILL OFFERS THE OTHERS. Reversed later: several Strava and
           * WHOOP activities can be attached to one session at once.
           * One session can be two measured pieces — a lift and then a row —
           * and the version that stopped offering after the first made the
           * second unreachable rather than merely unattached.
           */
          if (!/>Attach</.test(html)) {
            throw new Error('a second workout must still be attachable')
          }
          if (!/Also on this day/.test(t2)) throw new Error('the rest of the day is unlabelled')
          // The already-attached one must not be offered to itself.
          if ((t2.match(/rock-climbing/g) || []).length > 1) {
            throw new Error('the attached workout is still in the candidate list')
          }
        }],
      /* TWO workouts on one session, which is the case the list exists for. The
       * minutes are the SUM — that is what the weekly load chart multiplies. */
      ['Whoop(two on one session)', workouts({
        whoop: { id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), strain: 11.4, attachedAt: 'z' },
        whoopMore: [{ id: 'w-lift', sport: 'Weightlifting', ...t('19:45', 30), strain: 6.1, attachedAt: 'z' }],
      }),
        html => {
          const t2 = text(html)
          if ((html.match(/wh-item attached/g) || []).length !== 2) {
            throw new Error('both attached workouts should render')
          }
          if (!/2 workouts on this session/.test(t2)) throw new Error('the total is not stated')
          if (/load chart multiplies/.test(t2)) throw new Error('the jargon about the load chart is back')
          if (!/118 min/.test(t2)) throw new Error('the minutes should add up, not replace each other')
        }],
      /* ONE GYM VISIT, TWO SESSIONS.
       *
       * WHOOP records the evening as a single climb; the board and the laps are
       * two logged sessions inside it. The failure this pins is silent and
       * arithmetical: the same 88-minute workout sitting whole on both makes the
       * day read as 176 minutes, and the weekly load chart is RPE x minutes. */
      ...(() => {
        const snap = {
          id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), strain: 11.4,
          avgHr: 132, maxHr: 168, pctAvgHr: 68, pctMaxHr: 86, calories: 640,
          percentRecorded: 98, maxHeartRate: 195, zones: { three: 18, four: 7, five: 1 },
          attachedAt: 'z',
        }
        const other = (whoop) => ({
          id: 'e-laps', kind: 'daily', date: day, updatedAt: 'z',
          data: { optId: 'arc', name: 'ARC laps', minutes: 55, out: { whoop } },
        })
        const shared = (mine, theirs) => wrap({ cache },
          <WhoopWorkouts session={session} entry={entryOf({ whoop: mine })}
            entries={[entryOf({ whoop: mine }), other(theirs)]} onSave={noop} />)
        return [
          // Both sessions claiming the whole workout: the day is being counted twice
          // and the card has to SAY so rather than quietly adding it up.
          ['Whoop(same workout on two sessions, unsplit)', shared(snap, snap),
            html => {
              const t2 = text(html)
              if (!/ARC laps/.test(t2)) throw new Error('it must name the other session')
              if (!/counts these 88 minutes twice/.test(t2)) throw new Error('the double count is not called out')
              if (!/class="wh-err"/.test(html)) throw new Error('and it should read as a problem, not a note')
              // The row and its editor open themselves when there is something to fix.
              if (!/<details class="wh-item attached" open/.test(html)) throw new Error('the row should be open')
              if (!/<details class="wh-splitwrap" open/.test(html)) throw new Error('the fix should be open')
            }],
          // Split: this session shows ITS minutes, says which numbers are the whole
          // workout's, and names what the rest of the evening was.
          ['Whoop(split across two sessions)',
            shared({ ...snap, part: { start: t('18:05', 0).start, end: t('19:00', 0).start, minutes: 55 } },
              { ...snap, part: { start: t('19:05', 0).start, end: t('19:33', 0).start, minutes: 28 } }),
            html => {
              const t2 = text(html)
              if (!/55 min/.test(t2)) throw new Error("the session's own share is missing")
              if (/counts these/.test(t2)) throw new Error('a split day is not double counted')
              if (!/whole workout/.test(t2)) throw new Error('the borrowed numbers must be labelled')
              if (!/Shared with/.test(t2)) throw new Error('it should name the other session')
              if (!/type="time"/.test(html)) throw new Error('no way to change the times')
            }],
          // The ordinary night — one workout, one session — must be untouched by
          // all of the above: the split is folded away and nothing warns.
          ['Whoop(attached, split offered but folded away)', workouts({ whoop: snap }),
            html => {
              if (!/Was this session only part of that workout\?/.test(text(html))) {
                throw new Error('the offer should exist')
              }
              if (/<details class="wh-splitwrap" open/.test(html)) throw new Error('...but stay shut')
              if (/<details class="wh-item attached" open/.test(html)) throw new Error('...and so does the row')
              if (/wh-err/.test(html)) throw new Error('nothing is wrong on an ordinary night')
            }],
        ]
      })(),
      // An attached snapshot with NO cache at all: it is their log by then, so it
      // must still render with WHOOP unplugged.
      ['Whoop(attached, WHOOP gone)', workouts({ whoop: {
        id: 'w-climb', sport: 'rock-climbing', ...t('18:05', 88), avgHr: 132, minutes: 88 } }, { cache: null }),
        html => {
          if (!/rock-climbing/.test(text(html))) throw new Error('an attached snapshot must survive the cache going away')
        }],
      // Nothing configured: not a word on screen.
      ['Whoop(no data at all)', workouts({}, { cache: null }),
        html => { if (html.length > 0) throw new Error(`expected nothing, got ${html.length} chars`) }],
      ['Whoop(nothing recorded that day)', workouts({}, { cache: { ...cache, workouts: [] } }),
        html => {
          if (!/Nothing recorded on this day/.test(text(html))) throw new Error('should say the day is empty')
        }],
      // A stale grant: the FIX is on screen, not "failed".
      ['Whoop(scope not granted)', workouts({}, { cache: null,
        status: { ok: false, detail: 'this WHOOP connection was authorized without read:workout — click Connect WHOOP again to grant it' } }),
        html => { if (html.length > 0) throw new Error('with no cache the session log stays silent') }],
      /* The failure the tunnel caused once: there is a Cloudflare Access gate in
       * front of this app, so a restart mid-pull answers with someone else's HTML
       * and the status code is THEIR opinion, not a reason. The server remembers
       * the real one, and it is the real one that has to be on screen. */
      ['Whoop(a remembered failure states its fix)',
        workouts({}, { cache: { ...cache, workouts: [] },
          status: { ok: false, detail: 'click Connect WHOOP again to grant it' } }),
        html => {
          const t2 = text(html)
          if (!/click Connect WHOOP again to grant it/.test(t2)) {
            throw new Error('the remembered reason is not shown')
          }
          if (/HTTP \d\d\d/.test(t2)) throw new Error('a status code is not a reason')
        }],

      /* STRAVA. Same contract as WHOOP — nothing on screen when there is nothing,
       * one likely at most, the tap is their — plus the thing that is new: on the
       * Other-training card the attach fills the card's own fields, and the
       * attached snapshot carries the whole ride (laps included). */
      ...(() => {
        const ride = { id: 1234, name: 'Example loop', sport: 'GravelRide', family: 'ride', date: day,
          ...t('14:47', 95), movingMin: 82, distanceMi: 18.3, elevationFt: 512, avgMph: 13.9, avgHr: 142, avgWatts: 156, sufferScore: 61, gearId: 'b1' }
        const walk = { id: 5678, name: 'Evening walk', sport: 'Walk', family: 'walk', date: day,
          ...t('21:00', 40), movingMin: 38, distanceMi: 3, paceLabel: '12:40 /mi' }
        const scache = { fetchedAt: `${day}T22:00:00.000Z`, activities: [ride, walk], gear: { b1: { id: 'b1', name: 'Test Gravel Bike', distanceMi: 1234.5 } } }
        const other = plan.dailyMenu.find(m => m.id === 'log-workout')
        if (!other) throw new Error('plan.json has no log-workout card')
        const sEntry = (out) => ({ id: `daily-${day}-x`, kind: 'daily', date: day, updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Log a workout', minutes: 45, out } })
        const swrap = (initial, el) => <StravaProvider initial={initial}>{el}</StravaProvider>
        const acts = (out, initial = { cache: scache }) =>
          swrap(initial, <StravaActivities session={other} entry={sEntry(out)} entries={[]} onSave={noop} />)
        return [
          ['Strava(no data at all)', acts({}, { cache: null }),
            html => { if (html.length > 0) throw new Error(`expected nothing, got ${html.length} chars`) }],
          ['Strava(two activities, nothing picked: no claim)', acts({}),
            html => {
              const t2 = text(html)
              if (!/Example loop/.test(t2) || !/Evening walk/.test(t2)) throw new Error('both should be listed')
              if (/class="wh-tag"/.test(html)) throw new Error('with nothing declared there is no likely')
              if (!/18\.3 mi/.test(t2) || !/13\.9 mph/.test(t2) || !/512 ft/.test(t2)) throw new Error('the ride\'s numbers are missing')
              if (!/12:40 \/mi/.test(t2)) throw new Error('a walk shows pace, not speed')
              if ((html.match(/>Attach</g) || []).length !== 2) throw new Error('one action per row')
            }],
          ['Strava(picked Bike: the ride is likely, the walk sinks)', acts({ activity: 'bike' }),
            html => {
              const tags = (html.match(/class="wh-tag"/g) || []).length
              if (tags !== 1) throw new Error(`expected one likely tag, got ${tags}`)
              const t2 = text(html)
              if (!/The sport you picked/.test(t2)) throw new Error('the reason for Likely is not on the row')
              if (t2.indexOf('Towpath') > t2.indexOf('Evening walk')) throw new Error('the ride should rank first')
            }],
          ['Strava(attached, with laps and the bike)', acts({ activity: 'bike', duration: 82, distance: 18.3, strava: {
            id: 1234, name: 'Example loop', sport: 'GravelRide', family: 'ride', ...t('14:47', 95), minutes: 82, elapsedMinutes: 95,
            distanceMi: 18.3, elevationFt: 512, avgMph: 13.9, avgHr: 142, avgWatts: 156, calories: 812, sufferScore: 61,
            gear: { id: 'b1', name: 'Test Gravel Bike', distanceMi: 1234.5 }, url: 'https://www.strava.com/activities/1234',
            laps: [{ index: 1, distanceMi: 10, movingMin: 40, avgMph: 15, avgHr: 140 }, { index: 2, distanceMi: 10.1, movingMin: 42, avgMph: 14.4, avgHr: 145 }],
            attachedAt: 'z', filled: { activity: 'bike', duration: 82, distance: 18.3 } } }),
            html => {
              const t2 = text(html)
              if (!/Detach/.test(t2)) throw new Error('no way to undo a wrong attachment')
              // Still offers the rest of the day — a brick is a ride and a run
              // and one session. See the WHOOP case above.
              if (!/>Attach</.test(html)) {
                throw new Error('a second activity must still be attachable')
              }
              if (!/Saved with this session, so it stays if Strava goes away/.test(t2)) throw new Error('the snapshot has to say it is durable')
              if (!/Test Gravel Bike/.test(t2)) throw new Error('the bike should be named')
              if (!/812 cal/.test(t2)) throw new Error('the detail\'s calories are missing')
              if (!/2 laps/.test(t2)) throw new Error('laps should be offered')
              if (!/filled in activity, duration, distance/.test(t2)) throw new Error('it must say what it filled')
              if (!/Open on Strava/.test(t2)) throw new Error('a link back to the source')
            }],
          // An attached snapshot with no cache: their log by then.
          ['Strava(attached, Strava gone)', acts({ strava: { id: 1234, name: 'Example loop', sport: 'GravelRide', ...t('14:47', 95), minutes: 82, distanceMi: 18.3 } }, { cache: null }),
            html => { if (!/Example loop/.test(text(html))) throw new Error('an attached snapshot must survive the cache going away') }],
          ['Strava(nothing that day)', acts({}, { cache: { ...scache, activities: [] } }),
            html => { if (!/Nothing on Strava for this day/.test(text(html))) throw new Error('should say the day is empty') }],
          ['Strava(a remembered failure states its fix)',
            acts({}, { cache: { ...scache, activities: [] }, status: { ok: false, detail: 'Strava is not connected yet — connect it from Settings → Connections' } }),
            html => {
              const t2 = text(html)
              if (!/connect it from Settings/.test(t2)) throw new Error('the remembered reason is not shown')
              if (/HTTP \d\d\d/.test(t2)) throw new Error('a status code is not a reason')
            }],
          // The Other-training sheet as a whole, with a ride attached: the field
          // the attach filled reads back, and time spent names Strava as its source
          // only where the card does not ask for its own duration (it does), so
          // the declared field wins and the sentence says so.
          ['SessionLog(other training, ride attached)',
            swrap({ cache: scache }, <SessionLog session={other} entries={[]} onSave={noop} bare entry={sEntry({
              activity: 'bike', duration: 82, distance: 18.3, speed: 13.9, elevation: 512,
              strava: { id: 1234, name: 'Example loop', sport: 'GravelRide', ...t('14:47', 95), minutes: 82, distanceMi: 18.3, attachedAt: 'z', filled: { duration: 82 } } })} />),
            html => {
              if (!/value="18\.3"/.test(html)) throw new Error('the filled distance should be in the field')
              if (!/Example loop/.test(text(html))) throw new Error('the attached ride should render inside the sheet')
            }],

          /*
           * The card that offers what neither service's log has an entry for.
           *
           * Pinned here for two things. The row says WHEN, not only how long —
           * a duration does not identify a workout, so a clock is the only thing
           * that tells two 22-minute rides apart. And "Just miles" never mentions
           * a quota, because there are none any more; the button's own
           * words are the only place the user ever
           * reads what it means, so the copy is worth a test.
           *
           * The expected clock is COMPUTED with the same locale call the row
           * makes, so the case pins the instant rather than the runner's
           * timezone — this suite runs wherever it is run.
           */
          ...(() => {
            const bothWrap = (el) => (
              <WhoopProvider initial={{ cache }}>
                <StravaProvider initial={{ cache: scache }}>{el}</StravaProvider>
              </WhoopProvider>
            )
            const at = (iso) => new Date(Date.parse(iso))
              .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
            return [
              ['UnloggedWorkouts(when it happened, not only how long)',
                bothWrap(<UnloggedWorkouts plan={plan} entries={[]} iso={day} onLog={noop}
                  skipped={[]} onDismiss={noop} onRestore={noop} split={[]} onSplit={noop} />),
                html => {
                  const t2 = text(html)
                  // The strap's climb resolves to no catalog activity on purpose,
                  // so the strava ride, the strava walk and the whoop lift is all
                  // there is to offer.
                  if (!/3 workouts not logged yet/.test(t2)) {
                    throw new Error(`expected three offers, got: ${t2.slice(0, 120)}`)
                  }
                  // The start without its meridiem, because the row writes that
                  // once for a span that does not cross noon — asserting the
                  // clock, not the formatting.
                  for (const iso of [ride.start, walk.start, lift.start]) {
                    const hhmm = at(iso).replace(/\s?[AP]M$/, '')
                    if (!t2.includes(hhmm)) throw new Error(`no start time for ${iso} (${hhmm})`)
                  }
                  if (!t2.includes(at(ride.end))) throw new Error('a row should say when it ended too')
                  if (!/82 min/.test(t2)) throw new Error('the duration should still be there')
                  if (/quota/i.test(html)) {
                    throw new Error('"just miles" still talks about a quota, which the app no longer has')
                  }
                  /*
                   * One action per row (#44): "Log it" on every row, and the rest
                   * behind the row rather than four small buttons beside it. A
                   * warm-up takes the same disposition as a commute — it happened,
                   * it is not a workout of its own — so the only thing that
                   * distinguishes them is what they are called, which is why it
                   * is a button and not a rename.
                   */
                  if ((html.match(/>Log it</g) || []).length !== 3) throw new Error('every row has its one action')
                  for (const label of ['Just miles', 'Warm-up', 'Dismiss']) {
                    if (t2.includes(label)) throw new Error(`"${label}" should be behind the row, not on it`)
                  }
                  if (/aria-label="not this one"/.test(html)) throw new Error('the unlabelled dismiss X is back')
                }],
              ['UnloggedWorkouts(the rest is behind the row)',
                bothWrap(<UnloggedWorkouts plan={plan} entries={[]} iso={day} onLog={noop}
                  skipped={[]} onDismiss={noop} onRestore={noop} split={[]} onSplit={noop}
                  initialOpen={`strava:${ride.id}`} />),
                html => {
                  const t2 = text(html)
                  if (!/aria-expanded="true"/.test(html)) throw new Error(`the row did not open: check the item id`)
                  for (const label of ['Just miles', 'Warm-up', 'Dismiss']) {
                    if (!t2.includes(label)) throw new Error(`no "${label}" behind the row`)
                  }
                  // Only the opened row's: one at a time.
                  if ((t2.match(/Just miles/g) || []).length !== 1) throw new Error('more than one row is open')
                }],
            ]
          })(),
        ]
      })(),

      ['WhoopReadiness(a bad day)', wrap({ cache }, <WhoopReadiness date={day} />),
        html => {
          const t2 = text(html)
          // Read against the user's own median (HRV 42 vs median 53 = -21%), never a population.
          if (!/-21%/.test(t2)) throw new Error('no deviation from his own baseline')
          if (!/vs your 53 ms/.test(t2)) throw new Error('the baseline itself should be shown')
          if (!/\+5\.5 vs your 52\.5/.test(t2)) throw new Error('resting heart rate delta missing')
          // The recommender this card once nudged is gone (2026-10-25), and so is the
          // paragraph about it.
          if (/hard finger day|nudges the ranking/.test(t2)) throw new Error('the card talks about a ranking that no longer exists')
          if (!/Refresh/.test(t2)) throw new Error('no way to pull again')
        }],
      // Not enough history for a baseline: the raw numbers, no invented trend.
      ['WhoopReadiness(no baseline yet)',
        wrap({ cache: { ...cache, recovery: cache.recovery.slice(0, 2) } }, <WhoopReadiness date={day} />),
        html => {
          const t2 = text(html)
          if (!/42/.test(t2)) throw new Error('the raw HRV should still show')
          if (/vs your/.test(t2)) throw new Error('two days is not a baseline and must not read as one')
        }],
      ['WhoopReadiness(WHOOP still calibrating)',
        wrap({ cache: { ...cache, recovery: [{ date: day, recovery: 44, hrv: 40, calibrating: true }] } },
          <WhoopReadiness date={day} />),
        html => {
          if (html.length > 0) throw new Error('WHOOP saying it does not trust its own number is taken at its word')
        }],
      /*
       * Sleep over time, as Totem drew it (2026-10-07): a range to choose, the
       * score and recovery on one panel, each night on a clock beneath. The old
       * last-night breakdown is gone on purpose; the absence is pinned.
       */
      ['WhoopSleep(over time, not last night in depth)',
        wrap({ cache: {
          sleep: [
            { date: day, score: 88, asleepMin: 452, neededMin: 480, efficiency: 91, debtMin: 28,
              stages: { deep: 95, rem: 110, light: 247, awake: 31 }, bedtime: `${isoShift(day, -1)}T23:14`, wake: `${day}T07:16` },
            { date: isoShift(day, -1), score: 70, asleepMin: 400,
              stages: { deep: 80, rem: 90, light: 230 }, bedtime: `${isoShift(day, -2)}T22:40`, wake: `${isoShift(day, -1)}T06:10` },
          ],
          recovery: [{ date: day, recovery: 74 }, { date: isoShift(day, -1), recovery: 30 }],
        } }, <WhoopSleep date={day} />),
        html => {
          const t2 = text(html)
          for (const r of ['30d', '90d', '1y']) if (!t2.includes(r)) throw new Error(`no ${r} range`)
          if (!/88%.*latest/.test(t2)) throw new Error('the latest score is not the headline')
          if (!/7-day avg/.test(t2) || !/average/.test(t2)) throw new Error('no averages')
          if (!/goal 85%/.test(t2)) throw new Error('no goal line')
          if (!/8h02m/.test(t2)) throw new Error('a night is not labelled with its length')
          if (!/Recovery · red 0–33/.test(t2)) throw new Error('recovery is not on the graph')
          for (const st of ['Deep', 'REM', 'Light', 'Awake']) if (!t2.includes(st)) throw new Error(`no ${st} in the legend`)
          if (/of 8:00 needed|efficiency/.test(t2)) throw new Error('the in-depth last-night block came back')
          if (!/11 PM|10 PM/.test(t2)) throw new Error('the clock axis is not labelled')
          if ((html.match(/class="sleep-today"/g) || []).length !== 2) throw new Error('the viewed day is not marked on both panels')
          if (!/sleep-today-tick/.test(html)) throw new Error('the viewed day\'s date is not marked on the axis')
          if (!/sleep-readout[^>]*><strong class="sleep-today-tick">/.test(html) || !/88%/.test(text(html.split('sleep-readout')[1]))) throw new Error('the readout does not open on the viewed night')
        }],
      ['WhoopSleep(series keeps the gaps, stats compare weeks)', null, () => {
        const nights = []
        for (let i = 0; i < 14; i++) if (i !== 3) nights.push({ date: isoShift(day, -i), score: i < 7 ? 90 : 70, bedtime: `${isoShift(day, -i - 1)}T23:00`, wake: `${isoShift(day, -i)}T07:00` })
        const series = sleepSeries({ sleep: nights }, day, 30)
        if (series.length !== 30) throw new Error('one row per day of the range')
        if (series[series.length - 1].date !== day) throw new Error('the range does not end on the day viewed')
        if (series.find(r => r.date === isoShift(day, -3)).night) throw new Error('a missed night was filled in')
        const span = series[series.length - 1].span
        if (!span || span.to - span.from !== 480) throw new Error(`an 11 PM to 7 AM night is not eight hours: ${JSON.stringify(span)}`)
        const midnight = sleepSeries({ sleep: [{ date: day, bedtime: `${day}T00:30`, wake: `${day}T08:00` }] }, day, 1)[0].span
        if (!midnight || midnight.from <= span.from) throw new Error('a 12:30 AM bedtime is not later than an 11 PM one')
        const st = sleepStats(series)
        if (Math.round(st.recent) !== 90 || Math.round(st.prior) !== 70 || Math.round(st.delta) !== 20) throw new Error(`week on week: ${JSON.stringify(st)}`)
      }],
      ['WhoopSleep(nothing)', wrap({ cache: { sleep: [] } }, <WhoopSleep date={day} />),
        html => { if (html.length > 0) throw new Error('no nights must render nothing') }],
      ['WhoopReadiness(nothing)', wrap({ cache: null }, <WhoopReadiness date={day} />),
        html => { if (html.length > 0) throw new Error('no reading must render nothing') }],
      ['WhoopReadiness(broken, with the fix)',
        wrap({ cache: null, status: { ok: false, detail: 'click Connect WHOOP again to grant it' } },
          <WhoopReadiness date={day} />),
        html => {
          if (!/Connect WHOOP again/.test(text(html))) throw new Error('a failure has to carry its fix')
          if (!/Try again/.test(text(html))) throw new Error('and something to press')
        }],
    ]
  })(),
  // Blurbs collapsed: the stub path must render everywhere the full card does.
  ['TestingTab(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <TestingTab plan={plan} entries={entries} upsertEntry={noop} />
    </PrefsProvider>],
  ['GearSection(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <GearSection plan={plan} entries={[]} strava={null} upsertEntry={noop} deleteEntry={noop} />
    </PrefsProvider>],
  ['WhyTab(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <WhyTab plan={plan} />
    </PrefsProvider>],
  ['ScreenCard(renders before it can measure)', <ScreenCard />,
    (html) => { if (!/Measuring/.test(text(html))) throw new Error('no placeholder before measurement') }],
  ['describeScreen(names the iOS 26 short viewport)', null, () => {
    // An installed iOS 26.0 web app: page 806 on an 874 screen, top inset 68.
    const bug = describeScreen({ standalone: true, inner: { w: 402, h: 806 }, screen: { w: 402, h: 874 },
      insets: { top: 68, bottom: 34 }, ua: '' })
    if (!/iOS 26 bug/.test(bug)) throw new Error(`not diagnosed: ${bug}`)
    if (!/68px shorter/.test(bug)) throw new Error('the gap is not sized')
    const fine = describeScreen({ standalone: true, inner: { w: 402, h: 874 }, screen: { w: 402, h: 874 },
      insets: { top: 68, bottom: 34 }, ua: '' })
    if (!/fills the screen/.test(fine)) throw new Error('a full page reads as a bug')
    const tab = describeScreen({ standalone: false, inner: { w: 402, h: 700 }, screen: { w: 402, h: 874 },
      insets: { top: 0, bottom: 0 }, ua: '' })
    if (!/Home Screen/.test(tab)) throw new Error('a browser tab is not told to install')
  }],
  ['PeopleCard(the owner can open anyone\'s log; nobody else sees it)', null, () => {
    const people = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
    const owner = { id: 'owner', real: { id: 'owner', admin: true }, people }
    const html = renderToString(<PeopleCard who={owner} />)
    const t = text(html)
    if (!/Log for Sam/.test(t)) throw new Error('no door into Sam\'s log')
    if (!/Your log<\/span><\/span><span class="list-row-meta">Open</.test(html)) throw new Error('the open log is not marked')
    const acting = text(renderToString(<PeopleCard who={{ ...owner, id: 'sam' }} />))
    if (!/Back to your log/.test(acting)) throw new Error('no way back from Sam\'s log')
    if (renderToString(<PeopleCard who={{ id: 'sam', real: { id: 'sam', admin: false }, people: [] }} />) !== '') throw new Error('someone who is not the owner can switch logs')
    if (renderToString(<PeopleCard who={{ ...owner, people: [people[0]] }} />) !== '') throw new Error('a switcher with nobody to switch to')
  }],
  ['starter: TestingTab', <TestingTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['starter: WhyTab', <WhyTab plan={starter} />],
  ['starter: ProfileMenu', <ProfileMenu plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced" />],
  ['example: TestingTab', <TestingTab plan={example} entries={[]} upsertEntry={noop} deleteEntry={noop} />,
    (html) => { if (!text(html).includes('5 km time trial')) throw new Error('the example test does not render') }],

  // ===== batch E: people =====

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
        if (/withrow|Add Sam to this workout/.test(sheet({ ...ownerMe, people: [people[0]] }))) throw new Error('"With …" on a one-person install')
        if (/withrow|to this workout/.test(sheet({ ...ownerMe, id: 'sam', acting: true }))) throw new Error('"With …" while acting as someone')
        if (/withrow|to this workout/.test(sheet({ id: 'sam', acting: false, owner: false, real: { id: 'sam', name: 'Sam', admin: false }, people: [] }))) throw new Error('"With …" for someone who is not the owner')
      }],
      ['SessionSheet("With …" for the owner when someone else is on the install)', null, () => {
        const html = sheet(ownerMe)
        if (!/aria-label="Add Sam to this workout"/.test(html)) throw new Error('no way to add Sam')
        if (/aria-label="Add Alex to this workout"/.test(html)) throw new Error('the owner was offered as someone to add')
      }],
      ['SessionSheet(the person switcher only on a shared entry)', null, () => {
        if (/personbar/.test(sheet(ownerMe))) throw new Error('a switcher on a workout nobody shares')
        const html = sheet(ownerMe, sharedEntry)
        if (!/personbar/.test(html)) throw new Error('no switcher on a shared workout')
        const t = text(html)
        if (!/You/.test(t) || !/Sam/.test(t)) throw new Error('the switcher does not name both logs')
        if (!/aria-label="Take Sam off this workout"/.test(html)) throw new Error('no way to take Sam off')
        // And never for anyone else, even on an entry that names someone.
        if (/personbar/.test(sheet({ ...ownerMe, id: 'sam', acting: true }, sharedEntry))) throw new Error('a switcher while acting as someone')
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
        const css = readFileSync(new URL('./src/css/people.css', import.meta.url), 'utf8')
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
      ['SessionSheet(one plain switch: "Sync exercises with Sam", on when added, off on an older share)', null, () => {
        const on = sheet(ownerMe, syncedEntry)
        const toggles = [...on.matchAll(/class="synctoggle"/g)].length
        if (toggles !== 1) throw new Error(`${toggles} sync switches`)
        if (!/Sync exercises with Sam/.test(text(on))) throw new Error('the switch does not say what it does')
        if (!/Exercises and sets stay the same on both sides; your numbers stay yours/.test(text(on))) throw new Error('the switch does not say that numbers stay each person\'s own')
        if (!/role="switch"[^>]*checked=""/.test(on)) throw new Error('sync is off on a workout someone was just added to')
        if (/role="switch"[^>]*checked=""/.test(sheet(ownerMe, sharedEntry))) throw new Error('an older share reads as synced')
        if (/synctoggle/.test(sheet(ownerMe))) throw new Error('a sync switch on a workout nobody shares')
        if (/synctoggle/.test(sheet({ ...ownerMe, id: 'sam', acting: true }, syncedEntry))) throw new Error('a sync switch while acting as someone')
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
      ['TheirSide(copying your exercises over is a button under their log, and says when there is nothing to copy)', null, () => {
        const draw = (props) => text(renderToString(<PlanProvider plan={plan}>
          <TheirSide session={plannedOpt()} copy={sharedCopy(entry, { owner: { id: 'owner', name: 'Alex' } })}
            person={people[1]} ownerOut={{}} onSave={noop} {...props} />
        </PlanProvider>))
        const plannedOpt = () => plan.dailyMenu.find(m => m.id === 'planned')
        if (!/Copy my exercises to Sam/.test(draw({ onCopyMine: noop, ownerHasExercises: true }))) throw new Error('no way to copy your exercises over')
        const done = draw({ onCopyMine: null, ownerHasExercises: true })
        if (/Copy my exercises/.test(done) || !/Sam has all your exercises/.test(done)) throw new Error('nothing to copy still offers a copy')
        if (/your exercises/i.test(draw({ onCopyMine: null, ownerHasExercises: false }))) throw new Error('a workout with no exercises talks about copying them')
      }],
      ['TheirSide(no "Copy my exercises" while synced: the exercises are already the same)', null, () => {
        const draw = (props) => text(renderToString(<PlanProvider plan={plan}>
          <TheirSide session={plan.dailyMenu.find(m => m.id === 'planned')} copy={sharedCopy(entry, { owner: { id: 'owner', name: 'Alex' } })}
            person={people[1]} ownerOut={{}} onSave={noop} onCopyMine={noop} ownerHasExercises {...props} />
        </PlanProvider>))
        if (/Copy my exercises|has all your exercises/.test(draw({ synced: true }))) throw new Error('a copy button while sync is on')
        if (!/Copy my exercises to Sam/.test(draw({ synced: false }))) throw new Error('no copy button with sync off')
      }],
      ['TheirSide(each exercise shows THEIR last time, from their log, never yours)', null, () => {
        const lf = liftFieldOf(plan)
        const ex = lf.exercises[0]
        const plannedOpt = plan.dailyMenu.find(m => m.id === 'planned')
        const pres = { title: 'Legs', blocks: [{ id: 'b0', name: 'Main', items: [{ id: 'b0i0', uid: 'x1', kind: 'lift', name: ex.name, exercise: ex.key,
          sets: [{ id: 'b0i0s0', reps: 10, weight: 55 }] }] }] }
        const mine = { ...entry, data: { ...entry.data, optId: 'planned', plan: pres, out: {} } }
        const copy = sharedCopy(mine, { session: plannedOpt, owner: { id: 'owner', name: 'Alex' } })
        const lifted = (date, weight) => ({ id: `daily-${date}`, kind: 'daily', date, data: { optId: 'planned', done: true,
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
        if (!/Sam’s last 1 session/.test(t) || /Your last/.test(t)) throw new Error('the session history is not labelled as Sam\'s')
        if (/last time \(/.test(draw([]).replace(/<[^>]+>/g, ''))) throw new Error('a last time with no history')
      }],
      ['SessionSheet("With" is a section head, and each person on the workout a person chip with their initial)', null, () => {
        const html = sheet(ownerMe, syncedEntry)
        const withRow = html.slice(html.indexOf('class="withrow"'))
        if (!/^class="withrow"[^>]*><div class="section-head"><h3>With<\/h3>/.test(withRow)) throw new Error(`"With" is not a section head: ${withRow.slice(0, 200)}`)
        if (!/class="chip personchip on" data-tone="1"><span class="avatar sm" data-tone="1"[^>]*>S<\/span><span class="personchip-name">Sam</.test(html)) {
          throw new Error('Sam is not a person chip with an initial in Sam\'s colour')
        }
        // The old small "👥 With" lead in front of the chips is gone.
        if (/withrow-lead/.test(html)) throw new Error('the old "With" lead is back')
        const open = sheet(ownerMe)
        if (!/class="chip ghost personchip"[^>]*aria-label="Add Sam to this workout"/.test(open)) throw new Error('adding Sam is not a dashed person chip')
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
        const css = readFileSync(new URL('./src/css/people.css', import.meta.url), 'utf8')
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
      people={planPeople(me)} onKeepFor={async () => ({ ids: [], count: 0, first: null })} />)
    const plannedForSam = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, plannedBy: { id: 'owner', name: 'Alex' } } }
    const sharedPlanned = { ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, sharedWith: [{ id: 'sam', entryId: PLANNED_ENTRY.id }] } }
    const timed = plan.dailyMenu.find(o => hasWorkout(o) && buildSteps(o, {}).length)
    return [
      ['PlanFlow("For: You / Sam" only for the owner, with someone else on the install, not while acting)', null, () => {
        const html = flow(ownerMe)
        if (!FOR.test(html)) throw new Error('the owner cannot plan for Sam')
        const t = text(html)
        if (!/For/.test(t) || !/You/.test(t) || !/Sam/.test(t)) throw new Error('the choice does not name both')
        if (/>Alex</.test(html)) throw new Error('the owner is offered as someone to plan for')
        if (FOR.test(flow(alone))) throw new Error('"For:" on a one-person install')
        if (FOR.test(flow(acting))) throw new Error('"For:" while acting as someone')
        if (FOR.test(flow(sam))) throw new Error('"For:" for someone who is not the owner')
        // And never without somewhere to keep it.
        if (FOR.test(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} people={planPeople(ownerMe)} />))) {
          throw new Error('"For:" with no way to keep it in their log')
        }
      }],
      ['ForChoice(nothing with nobody to choose)', null, () => {
        if (renderToString(<ForChoice people={[]} target={null} onTarget={noop} />) !== '') throw new Error('a choice of one')
      }],
      ['ForChoice(the same person chips as "With …", You picked by default, no segmented control)', null, () => {
        const html = renderToString(<ForChoice people={planPeople(ownerMe)} target={null} onTarget={noop} />)
        const chips = [...html.matchAll(/class="chip personchip( on)?" data-tone="(\d)" aria-pressed="(true|false)"><span class="avatar sm"[^>]*>(.)<\/span><span class="personchip-name">([^<]*)</g)]
          .map(m => [Boolean(m[1]), m[2], m[4], m[5]])
        if (JSON.stringify(chips) !== JSON.stringify([[true, '0', 'Y', 'You'], [false, '1', 'S', 'Sam']])) throw new Error(`the choice reads ${JSON.stringify(chips)}`)
        if (/class="seg"/.test(html)) throw new Error('"For" is still a segmented control')
        const sam = renderToString(<ForChoice people={planPeople(ownerMe)} target={{ id: 'sam', name: 'Sam' }} onTarget={noop} />)
        if (!/class="chip personchip on" data-tone="1"/.test(sam)) throw new Error('picking Sam does not light Sam\'s chip')
      }],
      ['ForLine(one line: whose plan this is, with their initial, no paragraph)', null, () => {
        const t = text(renderToString(<ForLine person={{ id: 'sam', name: 'Sam' }} people={planPeople(ownerMe)} />)).replace(/<[^>]+>/g, '')
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
        if (/Nothing on today/.test(readFileSync(new URL('./src/trainer.jsx', import.meta.url), 'utf8'))) throw new Error('the separate "Nothing on today." line is back')
      }],
      ['WithControl(the × that takes someone off is a 44px target)', null, () => {
        const css = readFileSync(new URL('./src/css/people.css', import.meta.url), 'utf8')
        const x = (css.match(/\.personchip-x \{[^}]*\}/) || [''])[0]
        if (!/width: var\(--tap\)/.test(x) || !/height: var\(--tap\)/.test(x)) throw new Error(`the × is smaller than 44px: ${x}`)
        if (!/\.withrow \.personchip\.on \{[^}]*min-height: var\(--tap\)/.test(css)) throw new Error('the chip does not grow to hold a 44px ×')
      }],
      ['people.css(no small capitals, and every font size on the type scale)', null, () => {
        const css = readFileSync(new URL('./src/css/people.css', import.meta.url), 'utf8')
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

  // ===== the interval timer (#36) =====

  ['TimerSetup(the default first, saved presets after, a climbing card\'s timer offered as one)', null, () => {
    const card = plan.dailyMenu.find(m => m.id === 'max-hangs')
    const entries = [
      { ...buildLastTimerEntry('Tabata', BUILT_INS[1].config), updatedAt: 'z' },
      { ...buildTimerEntry('timer-a', 'Hill reps', { work: 45, rest: 15, rounds: 6 }), updatedAt: 'z' },
    ]
    const plain = text(renderToString(<TimerSetup presets={presetList(entries)} onStart={noop} onClose={noop} onSave={noop} onDelete={noop} />))
    if (plain.indexOf('Last used') < 0 || plain.indexOf('Last used') > plain.indexOf('Hill reps')) {
      throw new Error('the last timer run is not the one-tap default')
    }
    if (!plain.includes('Hill reps')) throw new Error('a saved preset is missing')
    const climbing = text(renderToString(<TimerSetup title={card.name}
      presets={presetList(entries, timerRequestFor(card).presets)} onStart={noop} onClose={noop} />))
    if (!climbing.includes(card.name) || climbing.indexOf(card.name) > climbing.indexOf('Last used')) {
      throw new Error('the card\'s own timer is not offered first')
    }
    if (!sessionTimer(card)) throw new Error('the climbing card has no timer preset')
  }],
  ['TimerRun(huge time, phase, round, next up)', null, () => {
    const config = { countIn: 0, work: 30, rest: 15, rounds: 8, sets: 2, setRest: 60 }
    const t0 = Date.parse('2026-10-25T09:00:00Z')
    const run = startRun(compile(config), t0)
    const html = renderToString(<TimerRun name="30 on, 15 off" config={config} initialRun={run}
      now={t0 + 37_000} onAgain={noop} onClose={noop} />)
    const t = text(html)
    for (const w of ['Rest', '0:08', 'Round 1 of 8', 'Set 1 of 2', 'Next:', 'Work', 'Pause', 'Skip', 'Back']) {
      if (!t.includes(w)) throw new Error(`no "${w}" on the run screen`)
    }
    if (!/class="it it-run k-rest"/.test(html)) throw new Error('the screen is not coloured for rest')
  }],
]


let failed = 0
for (const [name, el, assert] of cases) {
  try {
    // A case with no element is a pure check on the content — that plan.json
    // and the app still agree about something — and has nothing to render.
    const html = el == null ? '' : renderToString(el)
    // The generic guard catches a component that silently rendered nothing. A case
    // that brought its own assertion has stated its contract already, and several
    // must render EMPTY — "no WHOOP data changes nothing on screen" is only
    // testable if a zero-length render can be the expected answer.
    if (el != null && !assert && html.length < 20) {
      throw new Error(`suspiciously empty output (${html.length} chars)`)
    }
    // A stray `)}` left behind in JSX is not a syntax error — it is TEXT, and it
    // rendered on a phone under the Strava block. Every case checks.
    if (/\)\}|\}\)/.test(text(html))) throw new Error('stray JSX brackets rendered as text')
    // Some cases care about WHAT rendered, not just that something did — a
    // training load that silently renders the wrong number still renders.
    if (assert) assert(html)
    console.log(`  PASS  ${name.padEnd(20)} ${el == null ? 'checked' : `${html.length} chars`}`)
  } catch (err) {
    failed++
    console.error(`  FAIL  ${name.padEnd(20)} ${err.message}`)
  }
}

console.log(failed ? `\n${failed} tab(s) failed to render` : '\nall tabs render')
process.exit(failed ? 1 : 0)
