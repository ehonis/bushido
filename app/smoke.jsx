/* Render smoke test: mounts every tab against the real plan.json and real-shaped
 * entries, so a bad property access fails here instead of on the phone in a basement.
 * Run: npm run smoke
 */
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { TodayTab, WeekTab, TestingTab, WhyTab, SessionSheet } from './src/tabs.jsx'
import { QuotaBars } from './src/quotabars.jsx'
import {
  PlanFlow, PrescriptionEditor, KeptStep, PlanTalk, BuildStep, groupedKinds,
} from './src/planner.jsx'
import { WorkoutRunner } from './src/runner.jsx'
import { WeekPlanFlow, defaultMonday } from './src/weekplanner.jsx'
import { FabMenu, RestPrompt, ActingBanner, tabsFor } from './src/App.jsx'
import { _setMe } from './src/lib/whoami.js'
import { hasIcon } from './src/lib/icons.jsx'
import { weekContext } from './src/lib/plannerapi.js'
import { ScreenCard, describeScreen } from './src/screeninfo.jsx'
import { SessionPicker, ActivityChooser, groupedSessions, activityGroups, activityFieldOf } from './src/picker.jsx'
import {
  normalizePrescription, prescriptionSteps, emptyRun, markSet, blankPrescription, appendLift,
} from './src/lib/prescription.js'
import { LogTab } from './src/log.jsx'
import { GearSection } from './src/gear.jsx'
import { ProfileMenu, PeopleCard } from './src/profile.jsx'
import { AchievementsTab } from './src/achievements.jsx'
import { TotemGoals } from './src/goals.jsx'
import { PlanProvider } from './src/lib/planctx.jsx'
import { PrefsProvider } from './src/lib/prefs.jsx'
import { ProgressView } from './src/progress.jsx'
import { SessionLog, NameField, SessionDetails } from './src/sessionlog.jsx'
import { ExercisePicker, STEP } from './src/exercises.jsx'
import { buildSections, SectionBody } from './src/session.jsx'
import { HowSheet, MovesList, HowRow } from './src/howto.jsx'
import { FIGURES, hasFigure } from './src/lib/figures.jsx'
import { buildQuotaEntry, mondayOf } from './src/lib/quota.js'
import { localIso } from './src/lib/dates.js'
import { resolveCeiling } from './src/lib/force.js'
import { WorkoutMode, Face, Review } from './src/workout.jsx'
import { CheckIn } from './src/checkin.jsx'
import { WhoopProvider } from './src/lib/whoop.jsx'
import { WhoopWorkouts, WhoopReadiness, WhoopSleep, sleepSeries, sleepStats } from './src/whoop.jsx'
import { StravaProvider } from './src/lib/strava.jsx'
import { StravaActivities } from './src/strava.jsx'
import { UnloggedWorkouts } from './src/unlogged.jsx'
import { hasWorkout, buildSteps } from './src/lib/workout.js'

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

const cases = [
  ['TodayTab', <TodayTab plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      // Both the achievement card and the Totem goals card left Today on
      // 2026-09-15 for tabs of their own — see App.jsx TABS.
      if (/Achievements/.test(t)) throw new Error('the achievement card is back on Today')
      if (/Goals from Totem/.test(t)) throw new Error('the Totem goals card is back on Today')
      // The three tiles — this week, week of, streak — went the same day. Two
      // restated the quota board below them and the streak moved to the header.
      if (/class="tiles"/.test(html)) throw new Error('the stat tile row came back')
    }],
  ['WeekTab', <WeekTab plan={plan} entries={[]} upsertEntry={() => {}} />],
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
  ['AchievementsTab(the two seeds)',
    <AchievementsTab plan={plan} entries={[]} upsertEntry={noop} />,
    (html) => {
      const t = text(html)
      if (!/Climb 5\.12a/.test(t) || !/Half Ironman/.test(t)) {
        throw new Error('the seeded achievements are missing')
      }
      if (!/Add an achievement/.test(t)) throw new Error('no way to add one — which was the ask')
      if (!/Came with the app/.test(t)) throw new Error('a seeded one should say it came back if deleted')
    }],
  ['AchievementsTab(one he added, and one he deleted)',
    <AchievementsTab plan={plan} upsertEntry={noop} entries={[
      { id: 'achievement-run-a-50k', kind: 'achievement', date: null,
        updatedAt: '2026-09-15T12:00:00.000Z',
        data: { id: 'run-a-50k', name: 'Run a 50k', short: '50k', icon: 'Footprints',
          date: '2027-05-01', blurb: '', categories: ['run'],
          createdAt: '2026-09-15T12:00:00.000Z' } },
      { id: 'achievement-half-iron', kind: 'achievement', date: null, deleted: true,
        updatedAt: '2026-09-15T12:00:00.000Z', data: { id: 'half-iron', deleted: true } },
    ]} />,
    (html) => {
      const t = text(html)
      if (!/Run a 50k/.test(t)) throw new Error('his own achievement is not listed')
      if (/Half Ironman/.test(t)) throw new Error('a deleted seed came back')
      if (!/2027-05-01/.test(t)) throw new Error('the target date is not shown')
    }],
  ['AchievementsTab(what this week asks of each)',
    <AchievementsTab plan={plan} upsertEntry={noop}
      entries={[buildQuotaEntry(mondayOf(TODAY), { pe: 2, fingers: 1 })]} />,
    (html) => {
      const t = text(html)
      // The bars are the half that used to live on Today, and they are the reason
      // this is a tab rather than a settings page. Only the climbing achievement
      // has a quota here, so the other has to say plainly that it has none.
      if (!/0\/2/.test(t)) throw new Error('the power-endurance bar is not showing what the week asked for')
      if (!/0\/1/.test(t)) throw new Error('the fingers bar is not showing what the week asked for')
      if (!/nothing asked for/.test(t)) throw new Error('an achievement with no quota should say so')
      if (!/2026-11-30|2027-10-31|No date/.test(t)) throw new Error('the target date line is missing')
    }],
  ['TotemGoals(its own tab never renders blank)', <TotemGoals full />,
    (html) => {
      // As a card it stayed silent with nothing to say. A tab cannot: one you
      // tapped that rendered nothing is indistinguishable from a broken one.
      // Server-side the fetch never resolves, so this is the loading state.
      if (!text(html).trim()) throw new Error('the Goals tab rendered nothing at all')
    }],
  ['TotemGoals(as a card, still silent while loading)', <TotemGoals />,
    (html) => {
      if (text(html).trim()) throw new Error('the card should say nothing until it has something')
    }],
  ['ProfileMenu(with a picture)', <StravaProvider initial={{ cache: STRAVA_CACHE, status: 'ok' }}>
    <ProfileMenu plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced" />
  </StravaProvider>,
    (html) => {
      if (!/Sam/.test(text(html))) throw new Error('the header does not say who the athlete is')
      // Closed by default: the panel is a menu, not a page, and mounting it open
      // would put a gear editor over the app on every load.
      if (/Your gear/.test(text(html))) throw new Error('the menu should start closed')
    }],
  ['ProfileMenu(no strava at all)', <ProfileMenu plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} status="offline" />,
    (html) => {
      if (!/You/.test(text(html))) throw new Error('a header saying null is worse than one saying nothing')
    }],
  ['WhyTab', <WhyTab plan={plan} />],
  ['LogTab', <LogTab plan={plan} entries={entries} upsertEntry={noop} deleteEntry={noop} />],
  // Empty state: a brand-new install must not crash before anything is logged.
  ['TodayTab(empty)', <TodayTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  // Today is Aug 2; the block opens Aug 3. The before-it-starts state ships first.
  // A week nobody has set quotas for. The commonest state there is — every
  // Monday starts here — so it must render without nagging or crashing.
  ['TodayTab(no quotas set)', <TodayTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['TodayTab(quotas set, part done)', <TodayTab plan={plan}
    entries={[buildQuotaEntry(mondayOf(TODAY), { pe: 2, bike: 3, swim: 1 })]}
    upsertEntry={noop} deleteEntry={noop} />],
  ['WeekTab(no quotas declared)', <WeekTab plan={{ ...plan, quotaCategories: [] }} entries={[]} upsertEntry={() => {}} />],
  ['TestingTab(empty)', <TestingTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['LogTab(empty)', <LogTab plan={plan} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
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
    }],
  // The split gym night, which is the shape per-session minutes exist for: two
  // workouts on one date, each with its own time, adding up to the day.
  //
  // so going through it would have exercised the charts and none of this.
  ['LogTab(two sessions, one day)', <LogTab plan={plan} entries={[
    { id: 'g1', kind: 'daily', date: '2026-08-13', updatedAt: 'z',
      data: { slot: 'main', optId: 'board', level: 4, name: 'Gym: board', done: true,
        minutes: 105, minutesSource: 'typed', out: { rpe: 8, fingers: 3 } } },
    { id: 'g2', kind: 'daily', date: '2026-08-13', updatedAt: 'z',
      data: { slot: 'main', optId: 'lead-laps', level: 3, name: 'Doubled lead laps', done: true,
        minutes: 25, minutesSource: 'typed', out: { rpe: 6, fingers: 2 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />],
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
      if (!/RPE 8/.test(t) || !/RPE 5/.test(t)) throw new Error('each one carries its own effort')
      if (!/1 exercise · 2 sets · 1,650 lb/.test(t)) throw new Error('the lift day does not say what it was')
    }],
  /* The route that was missing.
   *
   * A run logged as the day's MAIN, and no second one yet. There was no way to
   * add the lift: "Add another session" opened the swap list, and the swap list
   * hid whatever was currently your main — so the card was absent from the one
   * list anyone would think to look in. Both
   * of these have to be true from the day list alone, with nothing opened. */
  ['TodayTab(other training as main: the way to a second one)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 4, name: 'Run', minutes: 38, done: true,
        out: { activity: 'run', distance: 4.2, duration: 38, rpe: 8 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />,
    html => {
      const t = text(html)
      // One tap, on the day, in the card's own words (`sched.repeatLabel`). The
      // other half of this case checked that the card was still in the swap list,
      // which is where users went looking — there is no swap list any more, and the
      // + button is the other way in. This is the route that has to keep working.
      if (!/Log another workout/.test(t)) throw new Error('no one-tap way to log a second workout')
    }],
  // Two already on the day: the button says how many, and does not stop working.
  ['TodayTab(other training twice: still another)', <TodayTab plan={plan} entries={[
    { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 4, name: 'Run', minutes: 38, done: true,
        out: { activity: 'run', duration: 38, rpe: 8 } } },
    { id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 52, done: true,
        out: { activity: 'lift', duration: 52, rpe: 5 } } },
  ]} upsertEntry={noop} deleteEntry={noop} />,
    html => {
      const t = text(html)
      if (!/Log another workout/.test(t)) throw new Error('a third one should still be possible')
      if (!/2 on today/.test(t)) throw new Error('the count of what is already on the day is missing')
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
    entries={[buildQuotaEntry(mondayOf(TODAY), { pe: 2, fingers: 1, bike: 2, swim: 1 })]}
    upsertEntry={noop} deleteEntry={noop}
    onPlan={noop} onLog={noop} onPickSession={noop} onRest={noop} />,
    (html) => {
      const t = text(html)
      if (!/Nothing on today yet/.test(t)) throw new Error('an empty day does not say it is empty')
      // Every way in, from the screen that has nothing on it — the rest day
      // included, because "Your day" is where users look for it.
      for (const route of ['Plan a workout', 'Log a workout', 'Pick from the plan', 'Log a rest day']) {
        if (!t.includes(route)) throw new Error(`no route to "${route}" from an empty day`)
      }
      // The things that used to fill an empty day, and must not come back.
      if (/Also recommended/.test(t)) throw new Error('companion suggestions are back')
      if (/Swap your main session/.test(t)) throw new Error('the swap list is back')
      if (/Take a rest day instead/.test(t)) throw new Error('the rest-day suggestion is back')
      if (/still owes|Why .*? today/.test(t)) throw new Error('the recommendation card is back')
      if (/not done yet/.test(t)) throw new Error('something he never chose reads as a missed session')
    }],
  /* The bars themselves: the one thing Today now leads with. */
  ['TodayTab(the quota bars)', <TodayTab plan={plan}
    entries={[
      buildQuotaEntry(mondayOf(TODAY), { pe: 2, fingers: 1, bike: 2, swim: 1 }),
      { id: `daily-${TODAY}-b`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: 'board', level: 4, done: true, minutes: 90, out: { rpe: 7 } } },
    ]}
    upsertEntry={noop} deleteEntry={noop} />,
    (html) => {
      const t = text(html)
      for (const name of ['Power endurance', 'Fingers', 'Bike', 'Swim']) {
        if (!t.includes(name)) throw new Error(`${name} has no bar`)
      }
      if (!/This week/.test(t)) throw new Error('the bars do not say what week they are')
      if (!/role="progressbar"/.test(html)) throw new Error('the bars are not bars')
      if (!/of 6/.test(t)) throw new Error('the week total is wrong or missing')
    }],
  /* Tapping a quota bar opens the workouts that filled it this week. */
  ['QuotaBars(a bar opens onto what filled it)', <QuotaBars plan={plan} iso={TODAY}
    entries={[
      buildQuotaEntry(mondayOf(TODAY), { bike: 2, swim: 1 }),
      { id: 'r1', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', name: 'Mountain bike', minutes: 74, level: 3, done: true,
          out: { activity: 'mtb' } } },
      { id: 'r2', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', name: 'Commute', minutes: 12, level: 1,
          done: false, out: { activity: 'bike' } } },
    ]} />,
    (html) => {
      const t = text(html)
      // A bar with something behind it is pressable and says so.
      if (!/class="qb-row[^"]*pressable/.test(html)) throw new Error('a filled bar is not pressable')
      if (!/aria-expanded="false"/.test(html)) throw new Error('the bar does not announce that it opens')
      // A quota nothing has touched must NOT be — an empty panel is a worse
      // answer than no panel, and "0/1" already says everything there is to say.
      const rows = html.split('class="qb-row').length - 1
      const pressable = html.split('pressable').length - 1
      if (pressable >= rows) throw new Error('an untouched quota is offering to open onto nothing')
      void t
    }],
  ['QuotaBars(no quotas set)', <QuotaBars plan={plan} entries={[]} iso={TODAY} />,
    (html) => {
      if (!/No quotas for the week/.test(text(html))) throw new Error('an unset week does not say so')
    }],
  /* Planned, not done — the dotted continuation. */
  ['QuotaBars(a planned workout draws dotted)', <QuotaBars plan={plan} iso={TODAY}
    entries={[
      buildQuotaEntry(mondayOf(TODAY), { bike: 2 }),
      { id: 'p1', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } } },
    ]} />,
    (html) => {
      if (!/class="qb-soon"/.test(html)) throw new Error('a planned workout draws no dotted segment')
      // The one thing it must not do: count as progress.
      if (!/>1<\/strong> of 2|0\/2/.test(text(html))) {
        throw new Error('a plan is being counted as done')
      }
      if (!/1 of them are already\s+on a day|already\s*on a day/.test(text(html))) {
        throw new Error('nothing says what the dotted part is')
      }
    }],
  ['QuotaBars(nothing planned draws no dots)', <QuotaBars plan={plan} iso={TODAY}
    entries={[buildQuotaEntry(mondayOf(TODAY), { bike: 2 })]} />,
    (html) => {
      if (/class="qb-soon"/.test(html)) throw new Error('drawing a dotted segment for nothing')
    }],
  ['QuotaBars(over quota)', <QuotaBars plan={plan} iso={TODAY}
    entries={[
      buildQuotaEntry(mondayOf(TODAY), { bike: 1 }),
      { id: 'r1', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike' } } },
      { id: 'r2', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, done: true, out: { activity: 'bike' } } },
    ]} />,
    (html) => {
      // Shown as over rather than clipped at full: a week the user beat is worth seeing.
      if (!/\+1/.test(text(html))) throw new Error('going past a quota is not shown')
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
      if (!/class="dl-tag">Main</.test(t)) throw new Error('the logged session is not the day\u2019s main')
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
   * own button (pinned separately, below) and the + beside the coach bubble are
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
      if (!/multiplies your RPE by/.test(t)) throw new Error('no hint about what the number does')
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
      if (!/worked out from your distance and time/.test(t)) throw new Error('the derived number is unlabelled')
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
      if (!/Just miles — not a workout/.test(t)) throw new Error('no just-miles box')
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
  ['ProgressView(critical force)', <ProgressView plan={plan} entries={[...rich, ...cfEntries]} />],
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

  /*
   * The morning coach's card left Today on 2026-09-17, with the rest of the
   * things that told them what to do. The coach it belonged to has been off since
   * the pivot (see App.jsx), the conversation is its own tab and a bubble, and a
   * card that renders a model's overnight edits to a plan makes no sense on a
   * screen with no plan to edit. `lib/coach.js` and its tests are untouched.
   */
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

  // A check-in is history too — a new entry kind reaching the Log tab, which
  // renders anything nothing claims as raw JSON.
  ['LogTab(a check-in)', <LogTab plan={plan} entries={[
    { id: `checkin-${TODAY}`, kind: 'checkin', date: TODAY, updatedAt: 'z', data: {
      fields: { weightLb: 150, feeling: 4 },
      messages: [{ role: 'you', at: 'z', text: 'no gym tonight' },
                 { role: 'coach', at: 'z', text: 'Then it is the crimp crawls.' }] } },
  ]} upsertEntry={noop} deleteEntry={noop} />,
    ],

  /* The check-in. It is the card the user touches first every day and the only place
   * a model's words land in the middle of the training screen, so every state
   * it can be in is pinned: nothing said yet, a thread with a reply that changed
   * the day, a turn that failed, and a plan that never loaded its fields. */
  ['CheckIn(fresh)', <CheckIn plan={plan} entries={[]} iso={TODAY} upsertEntry={noop} />,
    html => {
      const t = text(html)
      if (!t.includes('Bodyweight')) throw new Error('the hard fields are missing')
      if (!/textarea/.test(html)) throw new Error('nowhere to say anything')
    }],
  ['CheckIn(filled in, mid-conversation)', <CheckIn plan={plan} iso={TODAY} upsertEntry={noop}
    onPlaceSession={noop} onUndoPlacement={noop}
    entries={[{ id: `checkin-${TODAY}`, kind: 'checkin', date: TODAY, updatedAt: 'z', data: {
      fields: { weightLb: 150, feeling: 4, sleep: 3, fingers: 2, minutes: 25, where: 'home' },
      messages: [
        { role: 'you', at: `${TODAY}T17:02:00.000Z`, text: "can't get to the gym tonight — going Sunday instead" },
        { role: 'coach', at: `${TODAY}T17:02:20.000Z`, model: 'claude-sonnet-5',
          text: 'Then tonight is the crimp crawls: 22 minutes, at home, and it is the pump work your own notes keep asking for.',
          // Three cards, covering every state one can be in: a live offer with
          // buttons, one the day cannot take, and a nudge alongside them. NOTHING
          // here has happened to the day — that is the whole point of the card.
          suggested: [
            { action: 'main', optId: 'crawls', why: 'at home, 22 minutes, and the pump work is owed' },
            { action: 'add', optId: 'board', why: 'if you get out after all' },
          ],
          applied: [{ optId: 'hard-gym', points: -18, why: 'not at the gym tonight' }] },
      ] } }]} />,
    html => {
      const t = text(html)
      if (!t.includes('going Sunday instead')) throw new Error('what he said is missing')
      if (!t.includes('Crimp crawls')) throw new Error('the offered session is not named')
      if (!t.includes('Swap in as main')) throw new Error('an offer he cannot act on is just a claim')
      if (!t.includes('Add as extra')) throw new Error('both buttons belong on an offer')
      // The board needs the gym and the user said the user is home, so that card must lose
      // its buttons and say so rather than offering an impossible evening.
      if (!/needs|at the gym/.test(t)) throw new Error('a refused offer must say why')
      if (!t.includes('nudged')) throw new Error('a nudge landed with no label on it')
      if (!/150 lb/.test(t)) throw new Error('the fields summary is missing')
    }],
  // The same thread after the user pressed one. It reads as done, and can go back.
  ['CheckIn(offer taken)', <CheckIn plan={plan} iso={TODAY} upsertEntry={noop}
    onPlaceSession={noop} onUndoPlacement={noop}
    entries={[{ id: `checkin-${TODAY}`, kind: 'checkin', date: TODAY, updatedAt: 'z', data: {
      fields: {}, messages: [
        { role: 'you', at: `${TODAY}T17:02:00.000Z`, text: 'no gym tonight' },
        { role: 'coach', at: `${TODAY}T17:02:20.000Z`, text: 'Crimp crawls then.', applied: [],
          suggested: [{ action: 'main', optId: 'crawls', why: 'home tonight',
            taken: { action: 'main', optId: 'crawls', prevOptId: 'board' } }] },
      ] } }]} />,
    html => {
      const t = text(html)
      if (!t.includes('now your main')) throw new Error('a taken offer does not say it was taken')
      if (!t.includes('undo')) throw new Error('a tap he cannot take back is a decision he did not make')
      if (t.includes('Swap in as main')) throw new Error('a taken offer still shows its buttons')
    }],
  // A card with no buttons at all: the user is at home and the coach offered the gym.
  ['CheckIn(offer the day cannot take)', <CheckIn plan={plan} iso={TODAY} upsertEntry={noop}
    onPlaceSession={noop} onUndoPlacement={noop}
    entries={[{ id: `checkin-${TODAY}`, kind: 'checkin', date: TODAY, updatedAt: 'z', data: {
      fields: { where: 'home', minutes: 20 }, messages: [
        { role: 'you', at: `${TODAY}T17:02:00.000Z`, text: 'what about the board' },
        { role: 'coach', at: `${TODAY}T17:02:20.000Z`, text: 'Not tonight.', applied: [],
          suggested: [{ action: 'main', optId: 'board', why: 'the week wants it' }] },
      ] } }]} />,
    html => {
      const t = text(html)
      if (t.includes('Swap in as main')) throw new Error('a button that would build an illegal day')
      if (!/at home|20 minutes/.test(t)) throw new Error('a card that silently loses its buttons reads as broken')
    }],
  // The tailnet was down. What the user typed still has to be on the screen.
  ['CheckIn(coach unreachable)', <CheckIn plan={plan} iso={TODAY} upsertEntry={noop}
    entries={[{ id: `checkin-${TODAY}`, kind: 'checkin', date: TODAY, updatedAt: 'z', data: {
      fields: {}, messages: [
        { role: 'you', at: `${TODAY}T17:02:00.000Z`, text: 'fingers feel wrecked' },
        { role: 'coach', at: `${TODAY}T17:02:05.000Z`, text: '', failed: true },
      ] } }]} />,
    html => {
      const t = text(html)
      if (!t.includes('fingers feel wrecked')) throw new Error('a failed turn ate what he said')
      // SSR escapes the apostrophe, so match the half of the sentence that survives.
      if (!/Saved, but the coach/.test(t)) throw new Error('a failed turn pretended to succeed')
    }],
  // No plan yet: the card still has to take a bodyweight and a message.
  ['CheckIn(no plan loaded)', <CheckIn plan={null} entries={[]} iso={TODAY} upsertEntry={noop} />],

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
          // Heart rate against their own max, and the partial recording called out.
          if (!/avg 132 \(68%\)/.test(t2)) throw new Error('no percentage of max heart rate')
          if (!/26 min zone 3\+/.test(t2)) throw new Error('hard minutes missing')
          if (!/only 71% recorded/.test(t2)) throw new Error('a partly-recorded workout must say so')
          if (!/attach to this session/.test(t2)) throw new Error('nothing to tap')
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
          if (!/attach to this session/.test(t2)) throw new Error('both should still be attachable')
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
          if (!/detach/.test(t2)) throw new Error('no way to undo a wrong attachment')
          if (!/stay put whether or not WHOOP is reachable/.test(t2)) {
            throw new Error('the snapshot has to say it is durable')
          }
          /*
           * AND IT STILL OFFERS THE OTHERS. Reversed later: several Strava and
           * WHOOP activities can be attached to one session at once.
           * One session can be two measured pieces — a lift and then a row —
           * and the version that stopped offering after the first made the
           * second unreachable rather than merely unattached.
           */
          if (!/attach to this session/.test(t2)) {
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
              // The editor opens itself when there is something to fix.
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
              if (!/attach to this session/.test(t2)) throw new Error('nothing to tap')
            }],
          ['Strava(picked Bike: the ride is likely, the walk sinks)', acts({ activity: 'bike' }),
            html => {
              const tags = (html.match(/class="wh-tag"/g) || []).length
              if (tags !== 1) throw new Error(`expected one likely tag, got ${tags}`)
              const t2 = text(html)
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
              if (!/detach/.test(t2)) throw new Error('no way to undo a wrong attachment')
              // Still offers the rest of the day — a brick is a ride and a run
              // and one session. See the WHOOP case above.
              if (!/attach to this session/.test(t2)) {
                throw new Error('a second activity must still be attachable')
              }
              if (!/stay put whether or not Strava is reachable/.test(t2)) throw new Error('the snapshot has to say it is durable')
              if (!/Test Gravel Bike/.test(t2)) throw new Error('the bike should be named')
              if (!/812 cal/.test(t2)) throw new Error('the detail\'s calories are missing')
              if (!/2 laps/.test(t2)) throw new Error('laps should be offered')
              if (!/filled in activity, duration, distance/.test(t2)) throw new Error('it must say what it filled')
              if (!/open on Strava/.test(t2)) throw new Error('a link back to the source')
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
           * that tells two 22-minute rides apart. And "Just miles" no longer
           * claims to fill a quota, because it no longer does; the button's own
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
                  if (!/3 workouts you have not logged/.test(t2)) {
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
                  if (!/not the quota/.test(html)) {
                    throw new Error('"just miles" must not still claim to fill a quota')
                  }
                  /*
                   * Three doors per row: a measured activity such as a short row
                   * can be labelled a warm-up, alongside "Log it" and "Just
                   * miles". A warm-up takes the same disposition as a
                   * commute — it happened, it is not a workout of its own — so the
                   * only thing that distinguishes them is what they are called,
                   * which is exactly why it had to be a button and not a rename.
                   */
                  for (const label of ['Log it', 'Just miles', 'Warm-up']) {
                    if (!t2.includes(label)) throw new Error(`no "${label}" button on the row`)
                  }
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
          if (!/can never put a hard finger day next to another one/.test(t2)) {
            throw new Error('the card must say what it cannot do')
          }
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

  ['ProgressView(rich)', <ProgressView plan={plan} entries={rich} />,
    html => {
      const t = text(html)
      /*
       * The three per-session grade charts — lead laps, fun bouldering, fun sport
       * — became TWO charts on 2026-09-15: hardest route and hardest boulder,
       * across whatever is in scope. Three charts of the same measurement split by
       * which card recorded it is precisely the "so specific" problem the rebuild
       * was for.
       *
       * What survives unchanged is the property those assertions were really
       * protecting: a grade chart reads its axis off the LADDER, not off the
       * stored decimal. A hero that says "10.2" is a chart asking them to decode
       * their own log.
       */
      if (!/Hardest route/.test(t)) throw new Error('the route-grade chart is missing')
      const hero = t.match(/Hardest route<\/div><div class="viz-hero">([^<]*)/)
      if (!/^5\.\d/.test(hero?.[1] || '')) {
        throw new Error(`the route headline read "${hero?.[1]}", not a rung`)
      }
      if (!/Hardest boulder/.test(t)) throw new Error('the boulder-grade chart is missing')
      const vHero = t.match(/Hardest boulder<\/div><div class="viz-hero">([^<]*)/)
      if (!/^V\d/.test(vHero?.[1] || '')) {
        throw new Error(`the boulder headline read "${vHero?.[1]}", not a V grade`)
      }
      // And the filter bar itself, which is the whole point of the rebuild.
      if (!/Everything/.test(t)) throw new Error('the scope bar does not say what it is showing')
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
  ['ProgressView(empty)', <ProgressView plan={plan} entries={[]} />],
  ['ProgressView(one point)', <ProgressView plan={plan} entries={rich.slice(0, 3)} />],
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
  ['SessionPicker(every startable session is in it)', null, () => {
    const startable = plan.dailyMenu.filter(m =>
      m.role !== 'adjunct' && m.role !== 'rest' && !m.retired)
    const listed = new Set(groupedSessions(plan).flatMap(g => g.items.map(m => m.id)))
    const missing = startable.filter(m => !listed.has(m.id)).map(m => m.id)
    if (missing.length) throw new Error(`unreachable: ${missing.join(', ')}`)

    // And nothing that should not be startable leaked in. An adjunct is ticked
    // inside the session it rides with; a retired card is kept only so the days
    // logged against it still resolve.
    const wrong = [...listed].filter(id => {
      const m = plan.dailyMenu.find(x => x.id === id)
      return !m || m.role === 'adjunct' || m.role === 'rest' || m.retired
    })
    if (wrong.length) throw new Error(`should not be startable: ${wrong.join(', ')}`)
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
  ['ActivityChooser(renders, pinned first)',
    <ActivityChooser plan={plan} field={activityFieldOf(plan)} onPick={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      for (const name of ['Mountain bike', 'Swim', 'Run', 'Lift']) {
        if (!t.includes(name)) throw new Error(`${name} is not in the activity list`)
      }
      if (!/Your usual/.test(t)) throw new Error('his six pinned sports are not led with')
      // The right-hand column says which quota it fills, which is the question
      // the group heading above the row cannot answer.
      if (!/Anything else|Bike|Run/.test(t)) throw new Error('no quota category on the rows')
      // Same screen as the session picker, literally — if this diverges, one of
      // them has grown a second implementation.
      if (!/class="spick-row"/.test(html)) throw new Error('the two pickers are not the same screen')
    }],
  ['SessionPicker(the climbing cards, by name)',
    <SessionPicker plan={plan} onPick={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      // The ones the user actually asked after. Named rather than counted, because
      // "21 rows rendered" would have passed while showing the wrong 21.
      for (const name of ['Max hangs', 'Repeaters', 'Sub-threshold hangs', 'Gym: board',
        'Bouldering 4×4s', 'ARC laps', 'Limit bouldering', 'Peak force test', 'Crag day']) {
        if (!t.includes(name)) throw new Error(`${name} is not in the picker`)
      }
      // Resting is still something the user does on purpose, and its button went with
      // the recommendation it used to sit under.
      if (!/Take a rest day/.test(t)) throw new Error('no way to take a rest day')
      // It is a list, not the swap list that came out of this app.
      if (/Good swap|Not today|Works, with a caveat/.test(t)) {
        throw new Error('the picker is ranking sessions again')
      }
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
  ['PlanFlow(more than one kind at a time)', <PlanFlow plan={plan} entries={[]} iso={TODAY}
    onKeep={noop} onStart={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      if (!/as many as you like/i.test(t)) throw new Error('nothing says you can pick several')
      // Every card is a toggle, and Next is what commits — a card that navigates
      // on tap cannot be the second of three.
      if (!/aria-pressed="false"/.test(html)) throw new Error('the kind cards are not toggles')
      // What commits a selection is the FORK, since 2026-09-22 — either button
      // takes the picks on, one to the model and one to the editor.
      if (!/Write it for me|Write me \d+ in one/.test(t)) throw new Error('no way to commit a selection')
    }],
  /*
   * TWO ROUTES, and the choice is on the screen the user is already looking at.
   *
   * A workout can be planned by hand from picked exercises, or written by the AI.
   * A fork whose halves are
   * not both visible is not a fork, so this asserts both buttons and the sentence
   * that says what the difference costs — the model's route is a minute of
   * waiting and the user's own is none.
   */
  ['PlanFlow(his own route, or the model\'s)', <PlanFlow plan={plan} entries={[]} iso={TODAY}
    onKeep={noop} onStart={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      if (!/Build it myself/.test(t)) throw new Error('no way to plan it himself')
      if (!/Write it for me/.test(t)) throw new Error('no way to ask the model')
      if (!/build it yourself/i.test(t)) throw new Error('the lead does not say there are two ways')
      if (!/sends nothing anywhere/i.test(t)) throw new Error('nothing says what the two routes cost')
      // Both are real buttons of the same size — one of them being a text link
      // would be the app having an opinion it was asked not to have.
      const buttons = html.match(/class="btn big[^"]*"/g) || []
      if (buttons.length < 2) throw new Error('the two routes are not the same kind of control')
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
      if (!/counts toward/.test(t)) throw new Error('a block does not say which quota it fills')
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
  ['PrescriptionEditor(body map, last time, and a quota per block)',
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

      // 3. A quota per block, not per session. This is the one that reverses an
      //    earlier decision, so it is the one most likely to be undone by accident.
      if (!/counts toward/i.test(t)) throw new Error('no per-block quota control')
      if (!/Lift/.test(t) || !/Run/.test(t)) throw new Error('the two blocks do not name their own quotas')
      // The warm-up is not a workout in its own right and must not fill anything.
      if (!/counts toward nothing/.test(t)) throw new Error('the warm-up claims a quota')
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
      if (!/Mark set 1/.test(t)) throw new Error('no way to mark the set he is on')
      if (!/planned/.test(t)) throw new Error('the target is not on screen')
      // The two things that make it usable one-handed.
      if (!/class="bigstep-in"/.test(html)) throw new Error('the numbers are not thumb-sized')
      if (!/class="run-done"/.test(html)) throw new Error('the mark button is not the big one')
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
      if (!/next:/.test(t)) throw new Error('the rest screen does not say what is coming')
    }],
  ['WorkoutRunner(no plan on the entry)', <WorkoutRunner session={PLANNED_CARD}
    entry={{ id: 'x', kind: 'daily', date: TODAY, data: { optId: 'planned', out: {} } }}
    entries={[]} onRun={noop} onExit={noop} />,
    (html) => {
      if (!/no plan on it/.test(text(html))) throw new Error('an empty runner should say so, not crash')
    }],
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
    if (!/Mark as done/.test(t)) throw new Error('with no runner, the sheet has to be able to finish it')
    // And no rest box anywhere in the editor.
    if (/rest sec/.test(t)) throw new Error('lifting grew a rest interval back')
  }],
  ['TodayTab(a planned session on the day)', <TodayTab plan={plan} entries={[PLANNED_ENTRY]}
    upsertEntry={noop} deleteEntry={noop} onPlan={noop} onLog={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes(PRESCRIPTION.title)) throw new Error('the day names it "Planned workout" instead of its title')
      if (!/planned/.test(t)) throw new Error('nothing marks it as a session with sets in it')
      // Its "and another one" button appears once one is on the day.
      if (!/Plan another workout/.test(t)) throw new Error('no way to plan a second one from the day')
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
  ['WeekTab(blurbs hidden)',
    <PrefsProvider settings={{ blurbs: { allHidden: true, hidden: {}, shown: {} } }} saveSettings={noop}>
      <WeekTab plan={plan} entries={[]} upsertEntry={() => {}} />
    </PrefsProvider>],

  /* ======================================================= endurance + the week
   *
   * Instead of one bike/swim/run section, endurance is a set of workout kinds —
   * speed, power, endurance and so on — that the app selects workouts from, with
   * zone-two and low-intensity volume as the default emphasis. And the + screen
   * has a mode for quota / week planning as a back-and-forth with the AI.
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
    // The three sport catalogs: each has a catch-all, and every kind in it fills
    // that sport's quota.
    for (const g of ['swim', 'bike', 'run']) {
      const items = kinds.filter(k => k.group === g)
      if (items.length < 5) throw new Error(`only ${items.length} ${g} kinds`)
      if (!items.some(k => k.key === g)) throw new Error(`no catch-all "${g}" kind`)
      for (const k of items) if (k.category !== g) throw new Error(`${k.key} in the ${g} group fills ${k.category}`)
    }
    // Every sport and category a kind names is real. A typo here is a form of the
    // wrong shape and a quota nothing can fill.
    const acts = new Set(activityFieldOf(plan).activities.map(a => a.key))
    const cats = new Set(plan.quotaCategories.map(c => c.key))
    for (const k of kinds) {
      if (k.activity && !acts.has(k.activity)) throw new Error(`${k.key}: activity "${k.activity}" is not in the catalog`)
      if (k.category && !cats.has(k.category)) throw new Error(`${k.key}: category "${k.category}" is not a quota category`)
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
      if (!/\d+ kinds/.test(t)) throw new Error('a folded group does not say how many are in it')
      if (!/pick swim, bike or run/i.test(t)) throw new Error('nothing says the sportless kinds choose the sport')
    }],
  ['WeekPlanFlow(opens on the numbers, asks nothing, writes nothing)',
    <WeekPlanFlow plan={plan} entries={[buildQuotaEntry(mondayOf(TODAY), { bike: 3, pe: 2 })]} iso={TODAY}
      upsertEntry={() => { throw new Error('the week planner wrote an entry on mount') }}
      onClose={noop} onPlan={noop} />,
    (html) => {
      const t = text(html)
      // Every quota category has a stepper — this is the Week tab's numbers with an
      // agent beside them, not a subset.
      for (const c of plan.quotaCategories) if (!t.includes(c.name)) throw new Error(`${c.name} has no row`)
      if (!/Draft the week for me/.test(t)) throw new Error('no quick prompt')
      if (!/Set the week|Update the week/.test(t)) throw new Error('no way to keep it')
      if (!/This week/.test(t) || !/Next week/.test(t)) throw new Error('cannot choose which week')
      // The first turn is their. A model call the user did not ask for is a dollar spent
      // on a question the user may not have had.
      if (/Reading your last few weeks/.test(t)) throw new Error('it is asking the model on open')
      if (!/aria-label="one more Bike"/.test(html)) throw new Error('the steppers are not steppers')
    }],
  ['weekContext(hands over set-vs-did so the agent need not parse the log)', null, () => {
    const monday = '2026-09-21'
    const s = weekContext({
      monday, iso: '2026-09-19', plan,
      entries: [
        buildQuotaEntry('2026-09-14', { bike: 3, pe: 2 }),
        { id: 'r1', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
          data: { optId: 'log-workout', level: 2, done: true, out: { activity: 'bike' } } },
        { id: 'r2', kind: 'daily', date: '2026-09-16', updatedAt: 'z',
          data: { optId: 'log-workout', level: 2, done: false, out: { activity: 'bike' } } },
      ],
    })
    if (!/week of 2026-09-14: .*bike 1\/3/.test(s)) throw new Error(`done/set is wrong or missing: ${s}`)
    if (!/power endurance 0\/2/.test(s)) throw new Error('a quota with nothing done is not listed')
  }],
  ['WeekPlanFlow(a weekend plans the coming week)', null, () => {
    const want = (iso, monday) => {
      const got = defaultMonday(iso)
      if (got !== monday) throw new Error(`${iso} opens on ${got}, expected ${monday}`)
    }
    want('2026-09-19', '2026-09-21')  // Saturday → next week
    want('2026-09-20', '2026-09-21')  // Sunday → next week
    want('2026-09-16', '2026-09-14')  // Wednesday → this week
    want('2026-09-21', '2026-09-21')  // Monday → this week
  }],
  ['WeekTab(a week planned with the AI shows its reasoning)',
    <WeekTab plan={plan} upsertEntry={noop}
      entries={[buildQuotaEntry(mondayOf(TODAY), { bike: 3 }, { why: 'Three rides because the log says you ride.', title: 'Bike-heavy, fingers light' })]} />,
    (html) => {
      const t = text(html)
      if (!/Three rides because/.test(t)) throw new Error('the reasoning is not shown under the week it explains')
      if (!/Bike-heavy, fingers light/.test(t)) throw new Error('the week is not named')
    }],
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
  /*
   * More than one person (lib/whoami.js). The owner sees every tab and both
   * planner routes; someone the AI is not set up for sees no Coach tab, no Goals
   * tab, and only "Build it myself". Pinned from both sides, so a regression in
   * either direction is a failure rather than a quiet change.
   */
  ['tabsFor(the owner sees all seven, bridge or not; someone else loses Coach and Goals)', null, () => {
    const all = tabsFor({ ai: true, goals: false }, true).map(t => t.id)
    if (all.length !== 7 || !all.includes('coach') || !all.includes('goals')) throw new Error(`the owner's tabs: ${all}`)
    const hers = tabsFor({ ai: false, goals: false }, false).map(t => t.id)
    if (hers.includes('coach') || hers.includes('goals')) throw new Error(`a tab for a feature that is off: ${hers}`)
    for (const keep of ['today', 'week', 'log', 'progress', 'achievements']) {
      if (!hers.includes(keep)) throw new Error(`no ${keep} tab without AI`)
    }
  }],
  ['PlanFlow(no AI: building it yourself is the only route)', null, () => {
    _setMe({ id: 'sam', owner: false, features: { ai: false, goals: false, whoop: false, strava: false, notifications: false } })
    try {
      const t = text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
      if (!/Build it myself/.test(t)) throw new Error('no way to build a workout without the AI')
      if (/Write it for me|Write me \d/.test(t)) throw new Error('the model is offered to someone it is not set up for')
    } finally { _setMe({}) }
    const owner = text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
    if (!/Write it for me/.test(owner)) throw new Error('the owner lost "Write it for me"')
  }],
  ['ActingBanner(says whose log is open, with the way back)', null, () => {
    const acting = { id: 'sam', name: 'Sam', acting: true, real: { id: 'owner', name: 'Alex', admin: true } }
    const t = text(renderToString(<ActingBanner me={acting} />))
    if (!/Logging for.*Sam/.test(t)) throw new Error('the banner does not name whose log this is')
    if (!/Back to Alex/.test(t)) throw new Error('no way back')
    if (renderToString(<ActingBanner me={{ ...acting, acting: false }} />) !== '') throw new Error('a banner on your own log')
  }],
  ['PeopleCard(the owner can open anyone\'s log; nobody else sees it)', null, () => {
    const people = [{ id: 'owner', name: 'Alex' }, { id: 'sam', name: 'Sam' }]
    const owner = { id: 'owner', real: { id: 'owner', admin: true }, people }
    const t = text(renderToString(<PeopleCard who={owner} />))
    if (!/Log for Sam/.test(t)) throw new Error('no door into Sam\'s log')
    if (!/Your log \(open\)/.test(t)) throw new Error('the open log is not marked')
    const acting = text(renderToString(<PeopleCard who={{ ...owner, id: 'sam' }} />))
    if (!/Back to your log/.test(acting)) throw new Error('no way back from Sam\'s log')
    if (renderToString(<PeopleCard who={{ id: 'sam', real: { id: 'sam', admin: false }, people: [] }} />) !== '') throw new Error('someone who is not the owner can switch logs')
    if (renderToString(<PeopleCard who={{ ...owner, people: [people[0]] }} />) !== '') throw new Error('a switcher with nobody to switch to')
  }],
  // The rest day is a door of its own: as a footer link under "Pick a session" it
  // was technically reachable and the user could not find it.
  ['FabMenu(five doors, rest included)',
    <FabMenu onClose={noop} onPlan={noop} onLog={noop} onPickSession={noop} onPlanWeek={noop} onRest={noop} />,
    (html) => {
      const t = text(html)
      for (const door of ['Plan a workout', 'Log a workout', 'Pick a session', 'Log a rest day', 'Plan the week']) {
        if (!t.includes(door)) throw new Error(`no "${door}" door`)
      }
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
      // A forgotten rest day is logged after the fact, so the day is choosable.
      if (!/type="date"/.test(html)) throw new Error('a rest day can only be logged for today')
    }],
  ['RestPrompt(opens on the day it was asked from)',
    <RestPrompt opt={plan.dailyMenu.find(m => m.role === 'rest')} date="2026-09-20"
      entryFor={() => null} onSave={noop} onClose={noop} />,
    (html) => {
      if (!/value="2026-09-20"/.test(html)) throw new Error('the prompt ignored the day it was opened on')
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
  ['LogTab(a rest day says why)', <LogTab plan={plan} upsertEntry={noop} deleteEntry={noop} entries={[
    { id: 'daily-2026-09-20', kind: 'daily', date: '2026-09-20', updatedAt: 'z',
      data: { slot: 'main', optId: 'off', level: 1, name: 'Rest day', minutes: 0, done: true,
        out: { why: 'travel', notes: 'Flight to Denver' } } }]} />,
    (html) => {
      const t = text(html)
      if (!t.includes('Travelling')) throw new Error('the reason is not on the log card')
      if (!t.includes('Flight to Denver')) throw new Error('the note is not on the log card')
    }],

  // A FRESH INSTALL. content/starter.json is the first thing a stranger's
  // install renders: no achievements, no climbing cards, the catalogs only.
  ['starter: TodayTab', <TodayTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['starter: WeekTab', <WeekTab plan={starter} entries={[]} upsertEntry={noop} />],
  ['starter: LogTab', <LogTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['starter: AchievementsTab', <AchievementsTab plan={starter} entries={[]} upsertEntry={noop} />],
  ['starter: ProgressView', <ProgressView plan={starter} entries={[]} />],
  ['starter: TestingTab', <TestingTab plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['starter: WhyTab', <WhyTab plan={starter} />],
  ['starter: ProfileMenu', <ProfileMenu plan={starter} entries={[]} upsertEntry={noop} deleteEntry={noop} status="synced" />],
  ['starter: ActivityChooser', <ActivityChooser plan={starter} field={activityFieldOf(starter)} onPick={noop} onClose={noop} />,
    (html) => { if (!/Run/.test(text(html))) throw new Error('the activity catalog is missing from the starter') }],
  ['example: TodayTab', <TodayTab plan={example} entries={[]} upsertEntry={noop} deleteEntry={noop} />],
  ['example: WeekTab', <WeekTab plan={example} entries={[]} upsertEntry={noop} />],
  ['example: AchievementsTab', <AchievementsTab plan={example} entries={[]} upsertEntry={noop} />,
    (html) => { if (!text(html).includes('Run a 10K')) throw new Error('the example achievements do not render') }],
  ['example: TestingTab', <TestingTab plan={example} entries={[]} upsertEntry={noop} deleteEntry={noop} />,
    (html) => { if (!text(html).includes('5 km time trial')) throw new Error('the example test does not render') }],
  ['example: SessionPicker', <SessionPicker plan={example} onPick={noop} onClose={noop} />,
    (html) => { if (!text(html).includes('Long run')) throw new Error('the example sessions are not offered') }],
  ['starter: an achievement the owner added', <AchievementsTab plan={starter} upsertEntry={noop} entries={[
    { id: 'achievement-marathon', kind: 'achievement', date: '2026-10-01', updatedAt: 'z',
      data: { id: 'marathon', name: 'First marathon', categories: ['run'], createdAt: '2026-10-01T00:00:00Z' } }]} />,
    (html) => { if (!text(html).includes('First marathon')) throw new Error('an owner-made achievement does not render') }],
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
