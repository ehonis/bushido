/* Smoke cases: the prescription editor and the exercise cards, picker and sheet.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { dayWords } from '../src/lib/dates.js'
import { PrescriptionEditor, BlockMenu, blockTag, noteDraft, landsOf } from '../src/editor.jsx'
import { normalizePrescription, setCircuit, noteBlock, tickSet, setTicked, addSet } from '../src/lib/prescription.js'
import { SessionLog } from '../src/sessionlog.jsx'
import { readFileSync } from 'node:fs'
import * as EXERCISES from '../src/exercises.jsx'
import { ExercisePicker, ExerciseSheet, ExerciseCard, ExerciseSection, SetTick, STEP, undoControl, UNDO_MS, Stepper, modeFlip, cardKey, copyDownWrite } from '../src/exercises.jsx'
import { removalWords, syncLine } from '../src/lib/removal.js'
import { searchExercises } from '../src/lib/lifts.js'
import {
  plan, entries, noop, TODAY, back, text, LIFT_FIELD, SQUAT, PRESCRIPTION, TRIP,
  PRIOR_LIFTS, HELD_CARD, HELD_FIELD, HELD_ENTRY,
} from './fixtures.jsx'

import { removeItem, appendLift } from '../src/lib/prescription.js'
import { lastTimeFill } from '../src/lib/lifts.js'

/* Walk a component's returned element tree (no render): what it hands its children. */
const kids = (e) => [e?.props?.children].flat(Infinity).filter(Boolean)
function findAll(e, ok, out = []) {
  if (!e || typeof e !== 'object') return out
  if (Array.isArray(e)) { e.forEach(x => findAll(x, ok, out)); return out }
  if (ok(e)) out.push(e)
  for (const k of kids(e)) findAll(k, ok, out)
  return out
}
const findEl = (e, ok) => findAll(e, ok)[0] || null
/* A component's returned tree, its hooks run inside a real render. */
function treeOf(C, props) {
  let tree = null
  const Probe = () => { tree = C(props); return null }
  renderToString(<Probe />)
  return tree
}
const lastTimeFillOf = (prior) => lastTimeFill(LIFT_FIELD, { kind: 'lift', implement: 'barbell', sets: [{ id: 's0', reps: null, weight: null }] }, prior)

export default [
  /*
   * DOING MODE MOVES ON (#94, B F2): ticking an exercise's last set left it open
   * and opened the next below the fold. The card just finished folds and the
   * next is scrolled to (`doingMove`, an effect SSR cannot run, so the wiring is
   * pinned on both platforms).
   */
  ['ExerciseCard(doing: the finished card folds, the next is scrolled into view, web and phone)', null, () => {
    const web = readFileSync(new URL('../src/exercises.jsx', import.meta.url), 'utf8')
    if (!/doingMove\(was\.current, \{ finished, focus \}\)/.test(web) || !/if \(move\.fold\) setOpen\(false\)/.test(web) || !/scrollIntoView/.test(web)) {
      throw new Error('the web card does not fold and bring the next into view')
    }
    const phone = readFileSync(new URL('../../mobile/src/features/exercises.tsx', import.meta.url), 'utf8')
    if (!/doingMove as any\)\(was\.current, \{ finished, focus \}\)/.test(phone) || !/if \(move\.fold\) setOpen\(false\)/.test(phone) || !/scrollTo\(root\.current\)/.test(phone)) {
      throw new Error('the phone card does not fold and scroll to the next')
    }
    const css = readFileSync(new URL('../src/css/sheet.css', import.meta.url), 'utf8')
    if (!/\.presc\.doing \.presc-item \{ scroll-margin-top/.test(css)) throw new Error('the next card lands flush under the edge')
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
  /*
   * The exercise sheet (#63): reference, so a popover, never a full screen. It
   * says what a movement works and needs, how to do it, and offers the video
   * only when the library has one.
   */
  ['ExerciseSheet(muscles in words, what it needs, numbered steps, and Watch how)',
    <ExerciseSheet field={HELD_FIELD} exercise="dead-bug" onClose={noop} />,
    html => {
      const t = text(html)
      if (!/class="pop[ "]/.test(html) || /class="fs[ "]/.test(html)) throw new Error('not a popover, or a full screen')
      if (!/role="dialog"[^>]*aria-label="About Dead bug"/.test(html)) throw new Error('the dialog is not named for the exercise')
      if (!/class="bodymap"/.test(html)) throw new Error('no body diagram')
      if (!/Works.*abs/.test(t)) throw new Error('the muscles are not in words')
      if (!/Needs.*None/.test(t)) throw new Error('no equipment')
      if (!/Lie on your back and slowly lower/.test(t)) throw new Error('no gist')
      if ((html.match(/class="how-n"/g) || []).length !== 4) throw new Error('the steps are not numbered, one each')
      for (const w of ['Most common mistake', 'Make it easier', 'Make it harder']) if (!t.includes(w)) throw new Error(`no "${w}"`)
      if (!/<button[^>]*>.*?Watch how<\/button>/.test(t)) throw new Error('no Watch how button for an exercise with a video')
      if (!/Example: the dead bug · Example channel/.test(t)) throw new Error('the video does not say what it is')
      if (/class="btn"[^>]*>.*?Add /.test(t)) throw new Error('an Add button where nothing is being picked')
    }],
  ['ExerciseSheet(no video and no how-to: still the body and the muscles, and no Watch how)',
    <ExerciseSheet field={HELD_FIELD} exercise="wall-sit" onClose={noop} />,
    html => {
      const t = text(html)
      if (!/class="bodymap"/.test(html)) throw new Error('no body diagram without a how-to')
      if (!/Works.*quads/.test(t) || !/Also.*glutes/.test(t)) throw new Error('primary and secondary muscles are not in words')
      if (!/Held for time/.test(t)) throw new Error('a hold does not say so')
      if (/Watch how/.test(t)) throw new Error('Watch how without a video')
      if (!/No step-by-step/.test(t)) throw new Error('an empty how-to is not said')
    }],
  ['ExerciseSheet(from the picker, before adding: the one primary is Add)',
    <ExerciseSheet field={HELD_FIELD} exercise="couch-stretch" onClose={noop} onAdd={noop} />,
    html => {
      if ((html.match(/class="btn"/g) || []).length !== 1) throw new Error('not exactly one primary')
      if (!/Add Couch stretch/.test(text(html))) throw new Error('no way to add it from what it is')
    }],
  /* Reachability: every exercise the picker lists has its "what is this?", and
   * every exercise in the merged catalog is found by its own name. */
  ['ExercisePicker(every exercise listed has "what is this?" beside it)',
    <ExercisePicker field={HELD_FIELD} onPick={noop} onClose={noop} />,
    html => {
      const rows = (html.match(/class="expick-row"/g) || []).length
      const about = (html.match(/aria-label="What is [^"]+\?"/g) || []).length
      if (!rows) throw new Error('the picker listed nothing, so this proves nothing')
      if (rows !== about) throw new Error(`${rows} rows, ${about} ways to ask what one is`)
    }],
  ['ExercisePicker(every exercise in the merged catalog can be found by its name)', null, () => {
    const lost = HELD_FIELD.exercises.filter(ex => !searchExercises(HELD_FIELD, ex.name, { limit: 1000 }).includes(ex))
    if (lost.length) throw new Error(`unreachable: ${lost.slice(0, 5).map(e => e.key).join(', ')}`)
    for (const key of ['couch-stretch', 'wall-sit', 'reverse-crunch']) {
      if (!HELD_FIELD.exercises.some(e => e.key === key)) throw new Error(`the library's ${key} is not in the catalog`)
    }
  }],
  ['searchExercises(by description: "lower abs no equipment" finds Dead bug and Reverse crunch)', null, () => {
    const hits = searchExercises(HELD_FIELD, 'lower abs no equipment').map(e => e.key)
    for (const k of ['dead-bug', 'reverse-crunch']) if (!hits.includes(k)) throw new Error(`missed ${k}: ${hits.join(', ')}`)
    if (searchExercises(HELD_FIELD, 'bench')[0]?.key !== 'bench-press') throw new Error('a name no longer ranks first')
  }],
  /*
   * The card's whole head folds it, name included, as it always did (cards start
   * folded, so it is the tap made most); what it is moved to a 44px ⓘ beside
   * the head (#63 review). Both addresses pinned. A piece with no catalog
   * identity (a swim, a bike) has nothing to explain.
   */
  ['ExerciseCard(a catalog movement: the whole head folds, the ⓘ beside it says what it is)',
    <ExerciseCard item={{ ...HELD_ENTRY.data.plan.blocks[0].items[1], line: '1 × 10' }} liftField={HELD_FIELD}
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />,
    html => {
      const head = (html.match(/<button[^>]*class="presc-itemhead"[^>]*aria-expanded="false"[^>]*>([\s\S]*?)<\/button>/) || [])[1] || ''
      if (!head) throw new Error('the head no longer folds the card')
      if (!/Dead bug/.test(text(head)) || !/1 × 10/.test(text(head))) throw new Error('the name or the numbers are no longer part of the fold')
      if (!/<button[^>]*class="iconbtn presc-about"[^>]*aria-label="What is Dead bug\?"/.test(html)) throw new Error('no ⓘ for what it is')
      if (/presc-itemabout|presc-itemfold|how to do it/.test(html)) throw new Error('the name is a second button again')
      // The summary sits under the name, inside it, so a long name has the width
      // beside the ⓘ (#63 follow-up), folded or open.
      if (!/class="presc-itemname">[\s\S]*?<span class="presc-itemline">1 × 10<\/span><\/span>/.test(html)) throw new Error('the summary is beside the name again')
      if (/class="pop/.test(html)) throw new Error('the sheet is open before anyone asked')
    }],
  ['ExerciseCard(a piece with no catalog identity: one button that folds, no ⓘ)',
    <ExerciseCard item={{ ...PRESCRIPTION.blocks[0].items[0], line: '10 min' }} liftField={HELD_FIELD}
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />,
    html => {
      if (/presc-about|What is/.test(html)) throw new Error('a bike piece offers a how-to')
      if (!/<button[^>]*class="presc-itemhead"[^>]*aria-expanded/.test(html)) throw new Error('the piece no longer folds')
    }],
  /* A new hold can be counted in reps: the count's label is the switch, one tap,
   * until something is counted on it. A reps movement never offers it. */
  ['ExerciseCard(a new hold: "sec" under the count is the switch to reps)',
    <ExerciseCard item={{ id: 'h', kind: 'lift', name: 'Plank', exercise: 'plank', measure: 'time', line: '', sets: [{ id: '0', seconds: '', weight: '' }] }}
      liftField={HELD_FIELD} defaultOpen blank=""
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />,
    html => {
      if (!/<button[^>]*aria-label="Counted in seconds\. Switch to reps"/.test(html)) throw new Error('no switch on a new hold')
      if (!/aria-label="less sec"/.test(html)) throw new Error('the hold is not in seconds')
    }],
  ['ExerciseCard(no switch once a hold is counted, and none on a reps movement)', null, () => {
    const card = (item) => renderToString(<ExerciseCard item={{ kind: 'lift', line: '', ...item }} liftField={HELD_FIELD} defaultOpen
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />)
    if (/Counted in/.test(card({ id: 'h', name: 'Plank', exercise: 'plank', sets: [{ id: '0', seconds: 30, weight: '' }] }))) throw new Error('a counted hold can still be switched')
    if (/Counted in/.test(card({ id: 'd', name: 'Dead bug', exercise: 'dead-bug', sets: [{ id: '0', reps: '', weight: '' }] }))) throw new Error('a reps movement offers to be a hold')
    if (!/Counted in reps\. Switch to seconds/.test(card({ id: 'h', name: 'Plank', exercise: 'plank', sets: [{ id: '0', reps: '', weight: '' }] }))) throw new Error('a hold counted in reps cannot go back')
  }],
  /* A hold in the log: seconds, not reps, and a summary in seconds. */
  ['SessionLog(a hold: seconds and weight, "3 × 45 s", no volume)', <SessionLog session={HELD_CARD}
    entry={{ id: 'held1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'plank-1', key: 'plank', name: 'Plank', group: 'Core', implement: 'bodyweight', implementLabel: 'Bodyweight',
          sets: [{ seconds: 45, weight: '' }, { seconds: 45, weight: '' }, { seconds: 45, weight: '' }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/class="presc-sets"/.test(html)) throw new Error('the card is not open, so this proves nothing')
      if (!/aria-label="less sec"/.test(html)) throw new Error('a hold has no seconds stepper')
      if (/aria-label="less reps"/.test(html)) throw new Error('a hold is asked for reps')
      if (!/3 × 45 s/.test(t)) throw new Error('the summary is not "3 × 45 s"')
      if (!/1 exercise · 3 sets(?! ·)/.test(t)) throw new Error('the session line is not "1 exercise · 3 sets", or a hold claims a volume')
    }],
  ['SessionLog(a Plank logged as reps before the library reads exactly as before)', <SessionLog session={HELD_CARD}
    entry={{ id: 'held2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'plank-1', key: 'plank', name: 'Plank', group: 'Core', implement: 'bodyweight', implementLabel: 'Bodyweight',
          sets: [{ reps: 60, weight: '' }, { reps: 45, weight: '' }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      if (!/aria-label="less reps"/.test(html)) throw new Error('an old reps row lost its reps')
      if (/aria-label="less sec"/.test(html)) throw new Error('an old reps row is asked for seconds')
      if (!/60, 45/.test(text(html))) throw new Error('the old row reads differently')
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
      // In the sheet's words (#93: "Fri, Nov 7", never "2026-11-07").
      if (!t.includes(`Last time · ${dayWords('2026-09-10')}`) || /2026-09-10/.test(t)) throw new Error('no previous session on the planning screen, in words')
      if (!/175/.test(t)) throw new Error('the previous weight is not shown')

      // 3. A category per block, not per session: where the session splits into
      //    workouts. Said in plain words; the quotas it used to fill are gone.
      if (!/A separate .*workout/.test(t)) throw new Error('no per-block split control')
      if (!/Lift/.test(t) || !/Run/.test(t)) throw new Error('the two blocks do not name their own categories')
      // The warm-up is not a workout in its own right.
      if (!/Part of the workout beside it/.test(t)) throw new Error('the warm-up claims to be a workout')
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
  /*
   * A plan's block switched to Circuit: the switch says so, the timing is one row
   * of three steppers, and each exercise says how long it runs, the circuit's own
   * time or its own. Pinned absent: the per-set editor, which a circuit has no use
   * for (its rounds are the circuit's), and the switch turned on for a plain block.
   */
  ['PrescriptionEditor(a circuit block: the switch, one row of steppers, each exercise\'s timing)', null, () => {
    const pres = normalizePrescription({ title: 'Abs', blocks: [
      { name: 'Core', circuit: { work: 40, rest: 20, rounds: 3, countIn: 10 }, items: [
        { kind: 'lift', name: 'Crunch', exercise: 'crunch', sets: [] },
        { kind: 'lift', name: 'Plank', exercise: 'plank', sets: [{ seconds: 60 }] },
        { kind: 'lift', name: 'Hanging leg raise', exercise: 'hanging-leg-raise', sets: [{ reps: 12 }] },
      ] },
      { name: 'Finisher', items: [{ kind: 'lift', name: 'Squat', exercise: SQUAT.key, sets: [{ reps: 10 }] }] },
    ] }, { liftField: LIFT_FIELD })
    const html = renderToString(<PrescriptionEditor pres={pres} liftField={LIFT_FIELD} onChange={noop} />)
    const t = text(html)
    // The switch moved into each block's ⋯ (#79): the circuit says so on its head, and
    // no block carries a full-width switch any more. `BlockMenu(…)` pins the new address.
    if (/role="switch"/.test(html)) throw new Error('a full-width Circuit switch is back on a block')
    if (!/class="presc-blocktag">Circuit</.test(html)) throw new Error('the circuit block does not say it is one')
    if ((html.match(/class="presc-blocktag"/g) || []).length !== 1) throw new Error('the plain block claims a tag')
    if ((html.match(/aria-label="[^"]*: block options"/g) || []).length !== 2) throw new Error('not every block has its ⋯')
    if (!/aria-label="Circuit timing"/.test(html)) throw new Error('no row of circuit steppers')
    for (const w of ['Work', 'Rest', 'Rounds', '40s', '20s', '3 rounds', 'Crunch', 'Plank', '1:00', '12 reps', 'Add an exercise']) {
      if (!t.includes(w)) throw new Error(`no "${w}" in the circuit block`)
    }
    if (!/class="cx-time own"[^>]*>1:00/.test(html) || !/class="cx-time"[^>]*>40s/.test(html)) throw new Error('an exercise\'s own time does not read differently from the circuit\'s')
    const circuitPart = html.slice(0, html.indexOf('Finisher'))
    if (/Add a set|aria-label="less reps"/.test(circuitPart)) throw new Error('a circuit grew the per-set editor')
    if (!/Add a set|aria-label="less reps"|1 set/.test(html.slice(html.indexOf('Finisher')))) throw new Error('the plain block lost its sets')
    // Switching a plain lift block on is the editor's own write (lib/prescription.js).
    if (!setCircuit(pres, 'b1', true).blocks[1].circuit) throw new Error('the switch does nothing')
  }],
  /*
   * MIS-TAPS (#77). A set row is its number and its steppers: the remove-set ✕
   * wrapped onto its own line under the reps stepper at 390px and stepping reps
   * down deleted the set. Removing is Edit's: each set read back with its own
   * Remove, then the whole exercise, and nothing destructive where Add a set was.
   * Both addresses pinned: absent from the row, present in Edit.
   */
  ['ExerciseCard(a set row is numbers only; Remove lives in Edit, far from Add a set)', null, () => {
    const item = { ...PRESCRIPTION.blocks[1].items[0], line: '3 × 8' }
    const card = (props) => renderToString(<ExerciseCard item={item} liftField={LIFT_FIELD} defaultOpen
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} {...props} />)
    const html = card({})
    if (/presc-setx|aria-label="remove set|aria-label="Remove set/i.test(html)) throw new Error('a remove-set ✕ is back in the set row')
    if ((html.match(/class="presc-setfields"/g) || []).length !== item.sets.length) throw new Error('the steppers are not in one wrapping group per set')
    const foot = (h) => (h.match(/<div class="presc-itemfoot">([\s\S]*?)<\/div>/) || [])[1] || ''
    if (!/Add a set/.test(foot(html)) || !/class="btn quiet presc-itemedit"[^>]*>.*Edit/.test(foot(html))) throw new Error('the foot is not Add a set … Edit')
    if (/Remove/.test(text(foot(html)))) throw new Error('Remove is back beside Add a set')
    const edit = card({ defaultEditing: true })
    if (/class="stepper/.test(edit)) throw new Error('Edit still shows steppers beside the removes')
    for (let i = 1; i <= item.sets.length; i++) {
      if (!new RegExp(`aria-label="Remove set ${i}"`).test(edit)) throw new Error(`Edit has no Remove for set ${i}`)
    }
    if (!edit.includes(`aria-label="Remove ${item.name}"`)) throw new Error('Edit cannot remove the whole exercise')
    if (/Add a set/.test(edit) || !/Done editing/.test(foot(edit))) throw new Error('Edit’s foot is not just Done editing')
    if (!/8 reps · 135 lb/.test(text(edit))) throw new Error('a set is not read back in Edit')
    // A piece's time reads in its box's words (#87's minutes box), never raw seconds.
    const piece = renderToString(<ExerciseCard item={{ ...PRESCRIPTION.blocks[0].items[0], line: '10 min' }} liftField={LIFT_FIELD}
      defaultOpen defaultEditing onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />)
    const said = (piece.match(/<span class="presc-editwhat">([^<]*)<\/span>/) || [])[1] || ''
    if (!/^10 min/.test(said) || /600|sec/.test(said)) throw new Error(`a ten-minute piece reads "${said}" in Edit`)
  }],
  /* Every removal is undoable (#77): written at once, Undo writes back exactly what was there. */
  ['undoControl(a removal writes, Undo puts it back; any other edit withdraws the offer)', null, () => {
    let value = { sets: [1, 2, 3] }
    const toasts = new Map()
    let nextId = 1
    const toast = {
      push: (text, kind, opts) => { const id = nextId++; toasts.set(id, { text, kind, ...opts }); return id },
      dismiss: (id) => toasts.delete(id),
    }
    const ctl = undoControl(() => value, (next) => { value = next }, toast)
    ctl.remove({ sets: [1, 3] }, 'Removed set 2 of squat')
    if (value.sets.join() !== '1,3') throw new Error('the removal was not written')
    const [id, t] = [...toasts][0] || []
    if (!t || t.text !== 'Removed set 2 of squat' || t.action?.label !== 'Undo') throw new Error('no toast with Undo')
    if (t.duration !== UNDO_MS || UNDO_MS < 5000) throw new Error('the Undo is gone before a thumb can reach it')
    t.action.onClick()
    if (value.sets.join() !== '1,2,3') throw new Error('Undo did not put the set back')
    // A second removal, then an edit: the Undo would now take the edit too, so it goes.
    ctl.remove({ sets: [1, 2] }, 'Removed set 3 of squat')
    const second = [...toasts.keys()].at(-1)
    ctl.change({ sets: [1, 9] })
    if (toasts.has(second)) throw new Error('an edit after a removal left a stale Undo on screen')
    if (value.sets.join() !== '1,9') throw new Error('the edit was not written')
    void id
  }],
  /*
   * THE RULE for a removal's words (#77, lib/removal.js): only what is certain.
   * The server decides what happens on someone else's side (set counts adjusted,
   * what they logged kept), from data this device does not have, so a toast never
   * claims it. Plain words, and on a synced workout one static line stating the
   * rule. lib/removal.js is the phone's too, byte for byte.
   */
  ['removalWords(neutral: what was removed; a synced entry adds only the static line, never a claim about the other side)', null, () => {
    const item = { name: 'Hip adduction', sets: [{}, {}, {}] }
    const plain = [
      [removalWords(item), 'Removed Hip adduction'],
      [removalWords(item, 1), 'Removed set 2 of Hip adduction'],
      [removalWords({ ...item, sets: [{}] }, 0), 'Removed Hip adduction'],
      [removalWords({ ...item, sets: [{}] }, 0, { lastTakesItem: false }), 'Removed set 1 of Hip adduction'],
    ]
    const synced = [
      [removalWords(item, 1, { syncedWith: ['Sam'] }),
        "Removed set 2 of Hip adduction. Exercises stay in step with Sam: what Sam has logged stays on Sam's side."],
      [removalWords(item, null, { syncedWith: ['you'] }),
        'Removed Hip adduction. Exercises stay in step with you: what you have logged stays on your side.'],
      [removalWords(item, null, { syncedWith: ['Sam', 'Alex'] }),
        'Removed Hip adduction. Exercises stay in step with Sam and Alex: what each of them has logged stays on their side.'],
    ]
    for (const [got, want] of [...plain, ...synced]) if (got !== want) throw new Error(`"${got}", not "${want}"`)
    for (const [got] of plain) if (/step with|logged/.test(got)) throw new Error(`an unsynced removal talks about another side: "${got}"`)
    for (const [got] of [...plain, ...synced]) {
      if (/both workouts|all \d+ workouts|keeps it|keep it|comes back|blank|for you and/.test(got)) throw new Error(`a claim about the other side: "${got}"`)
    }
    if (syncLine(['Sam']) !== "Exercises stay in step with Sam: what Sam has logged stays on Sam's side.") throw new Error('the synced line changed')
    // Gone on purpose: guessing the other side by set position was wrong both ways.
    for (const k of ['loggedThere', 'removalToast', 'backWords']) if (k in EXERCISES) throw new Error(`${k} is back`)
    // The phone says the same words: its lib/removal.js is this file.
    const web = readFileSync(new URL('../src/lib/removal.js', import.meta.url), 'utf8')
    const phone = readFileSync(new URL('../../mobile/src/lib/removal.js', import.meta.url), 'utf8')
    if (web !== phone) throw new Error('mobile/src/lib/removal.js drifted from the web’s')
    const native = readFileSync(new URL('../../mobile/src/features/exercises.tsx', import.meta.url), 'utf8')
    if (/loggedThere|removalToast|backWords/.test(native)) throw new Error('the phone still guesses the other side')
  }],
  /*
   * The geometry the CSS used to get wrong (#77): `.presc-itemfoot .btn.quiet`
   * outranked `.presc-itemrm { margin-left: auto }`, so Remove sat flush against
   * Add a set. The far-right button now has a rule that outranks it, after it.
   */
  ['editor.css(the far-right foot button outranks the foot’s quiet-button margin)', null, () => {
    const css = readFileSync(new URL('../src/css/editor.css', import.meta.url), 'utf8')
    const base = css.indexOf('.presc-itemfoot .btn.quiet {')
    const far = css.search(/\.presc-itemfoot \.btn\.quiet\.presc-itemedit \{[^}]*margin-left: auto/)
    if (base < 0 || far < base) throw new Error('nothing pushes Edit to the far right past `.presc-itemfoot .btn.quiet`')
    if (/\.stepper-btn \{[^}]*width: 40px/.test(css)) throw new Error('the ± buttons are under 44px again')
    if (/\.presc-setx/.test(css)) throw new Error('the set row’s ✕ is styled again')
  }],
  /*
   * A BLOCK'S OWN SETTINGS (#79). Every block carried a full-width Circuit switch
   * and the split fold; a block could not be renamed, given a note, moved or
   * removed. All of it is the block's ⋯ now: reachability, every control at its
   * one address. The head keeps what is true of it (`blockTag`).
   */
  ['BlockMenu(every block setting is reachable: name, note, reorder, move, circuit, where it lands, remove)', null, () => {
    const b = { id: 'b1', name: 'Main', note: '', category: 'lift', items: [] }
    const html = renderToString(<BlockMenu block={b} first={false} last={false} only={false}
      categories={plan.quotaCategories} onRename={noop} onNote={noop} onCircuit={noop} onQuota={noop}
      onReorder={noop} onMove={noop} onRemove={noop} onClose={noop} />)
    const t = text(html)
    if (!/<input value="Main"/.test(html)) throw new Error('no way to rename the block')
    for (const w of ['Add a note', 'Reorder exercises', 'Move block up', 'Move block down', 'Circuit',
      'Where it lands', 'Part of the workout beside it', 'Remove block', 'Done']) {
      if (!t.includes(w)) throw new Error(`the block menu has no "${w}"`)
    }
    const lift = plan.quotaCategories.find(c => c.key === 'lift')
    if (!new RegExp(`aria-pressed="true"[^>]*>(?:(?!</button>).)*${lift.name}</button>`).test(html)) throw new Error('the block\u2019s own split is not marked')
    // Ends and the only block: nothing that cannot be done is offered.
    const one = renderToString(<BlockMenu block={{ ...b, note: 'x' }} first last only categories={[]}
      onRename={noop} onNote={noop} onCircuit={noop} onQuota={noop} onMove={noop} onRemove={noop} onClose={noop} />)
    if (/Move block|Remove block|Reorder exercises/.test(one)) throw new Error('the only block offers a move, a removal or a reorder')
    if (!/Edit the note/.test(one)) throw new Error('a note that exists is not offered for editing')
  }],
  ['PrescriptionEditor(the block head: a ⋯ and what is true of it; the note shown; Add a block last)', null, () => {
    const html = renderToString(<PrescriptionEditor pres={TRIP} liftField={LIFT_FIELD} categories={plan.quotaCategories} onChange={noop} />)
    if (/class="cx-switch"|<details class="blockquota/.test(html)) throw new Error('a block grew its full-width switch or split fold back')
    if ((html.match(/: block options"/g) || []).length !== TRIP.blocks.length) throw new Error('not every block has its ⋯')
    if (!/<textarea[^>]*aria-label="Block note"[^>]*>Five easy minutes/.test(html)) throw new Error('the warm-up note is not editable where the block is')
    if (html.lastIndexOf('Add a block') < html.lastIndexOf('presc-block')) throw new Error('Add a block is not last')
    if (blockTag(TRIP.blocks[0], TRIP, plan.quotaCategories) !== 'Part of the workout beside it') throw new Error('a warm-up does not say where it lands')
    if (!/^A separate .* workout$/.test(blockTag(TRIP.blocks[1], TRIP, plan.quotaCategories))) throw new Error('a split block does not say it is its own workout')
    const single = { ...TRIP, blocks: TRIP.blocks.map(b => ({ ...b, category: null })) }
    if (blockTag(single.blocks[0], single, plan.quotaCategories) !== null) throw new Error('a workout that does not split talks about splitting')
  }],
  /*
   * IMPLEMENTS (#79, C F15): the ones the exercise declares, then Other… for the
   * rest of the catalog. A curl offered all nineteen, sled and rings included.
   */
  ['ExerciseCard(implements: the declared ones and Other…, not the whole catalog)', null, () => {
    const curl = LIFT_FIELD.exercises.find(e => e.key === 'barbell-curl')
    const item = { id: 'i', kind: 'lift', name: curl.name, exercise: curl.key, implement: 'barbell', sets: [{ id: 's', reps: 10, weight: 50 }] }
    const html = renderToString(<ExerciseCard item={item} liftField={LIFT_FIELD} defaultOpen onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />)
    const chips = (html.match(/class="implchip(?: on| )?"/g) || []).length
    if (chips !== curl.implements.length) throw new Error(`${chips} implements offered, ${curl.implements.length} declared`)
    if (!/class="implchip ghost"[^>]*>Other…</.test(html)) throw new Error('no Other… for the rest')
    if (/>Sled<|>Rings</.test(html)) throw new Error('the whole catalog is offered up front')
    // Doing: the chips are behind one switch that says what it is now.
    const doing = renderToString(<ExerciseCard item={item} liftField={LIFT_FIELD} defaultOpen doing onTick={noop} onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />)
    if (/class="presc-impl"/.test(doing)) throw new Error('the implement chips are open while doing')
    if (!/class="implswitch[^"]*"[^>]*><span>Barbell</.test(doing)) throw new Error('the implement switch does not say what it is')
  }],
  ['SetTick(a set’s ✓: its number until ticked, a check after; one tap flips it)', null, () => {
    const off = renderToString(<SetTick n={2} on={false} onToggle={noop} />)
    const on = renderToString(<SetTick n={2} on onToggle={noop} />)
    if (!/aria-checked="false"[^>]*aria-label="Set 2 done"[^>]*><span class="presc-tickn">2</.test(off)) throw new Error('an unticked set does not show its number')
    if (!/class="presc-tick on"[^>]*aria-checked="true"/.test(on) || /presc-tickn/.test(on)) throw new Error('a ticked set does not show its check')
    let got = null
    SetTick({ n: 1, on: false, onToggle: (v) => { got = v } }).props.onClick()
    if (got !== true) throw new Error('a tap on an unticked set does not tick it')
  }],
  /* A note is stored when its box is left, never per keystroke: `noteBlock` trims,
     and a trim on every key ate the space being typed. */
  ['noteDraft(a block note keeps its spaces and lines while written; stored on leaving)', null, () => {
    let pres = normalizePrescription({ title: 'P', blocks: [{ name: 'Warm-up', note: 'x', items: [] }, { name: 'M', items: [{ kind: 'lift', exercise: SQUAT.key, sets: [{ reps: 5 }] }] }] }, { liftField: LIFT_FIELD })
    const writes = []
    const d = noteDraft((v) => { writes.push(v); pres = noteBlock(pres, 'b0', v) })
    let typed = ''
    for (const ch of 'Bike 5 min,\nthen rows ') { typed += ch; d.type(typed) }
    if (writes.length) throw new Error('the note was stored (and trimmed) while it was being typed')
    d.leave()
    if (pres.blocks[0].note !== 'Bike 5 min,\nthen rows') throw new Error(`stored "${pres.blocks[0].note}"`)
    d.leave()
    if (writes.length !== 1) throw new Error('leaving twice stored twice')
  }],
  /* A ✓ always means logged: a set with nothing in it cannot be ticked, and its ✓
     goes to the set's first box instead. */
  ['SetTick(a set with no number: not tickable, and the tap goes to its box)', null, () => {
    const pres = normalizePrescription({ title: 'P', blocks: [{ name: 'M', items: [{ kind: 'lift', exercise: SQUAT.key, sets: [{ reps: null, weight: null }] }] }] }, { liftField: LIFT_FIELD })
      || { v: 1, title: 'P', blocks: [{ id: 'b0', name: 'M', note: '', items: [{ id: 'b0i0', kind: 'lift', name: 'Squat', exercise: SQUAT.key, sets: [{ id: 'b0i0s0', reps: null, weight: null }] }] }] }
    const ticked = tickSet(pres, 'b0i0', 'b0i0s0', true)
    if (ticked.blocks[0].items[0].sets[0].typed) throw new Error('a blank set was ticked: a ✓ that logs nothing')
    if (setTicked({ typed: true, reps: null, weight: null })) throw new Error('a typed-but-empty set reads as done')
    const html = renderToString(<SetTick n={1} on={false} empty onToggle={noop} onPrompt={noop} />)
    if (!/aria-disabled="true"/.test(html) || !/type what you did first/.test(html)) throw new Error('a blank set’s ✓ does not say what it needs')
    // Never the empty-state's class (#93): its padding made the ✓ 50×66 and wrapped the row.
    if (/class="[^"]*\bempty\b/.test(html)) throw new Error('a blank set’s ✓ wears .empty, the empty-state component')
    let prompted = false; let toggled = false
    SetTick({ n: 1, on: false, empty: true, onToggle: () => { toggled = true }, onPrompt: () => { prompted = true } }).props.onClick()
    if (toggled || !prompted) throw new Error('a blank set’s ✓ ticks instead of asking for the number')
  }],
  /* "A separate … workout" only where splitPrescription really makes one. */
  ['landsOf(where a block lands follows splitPrescription: one block, merged blocks, real splits)', null, () => {
    const cats = plan.quotaCategories
    const mk = (blocks) => normalizePrescription({ title: 'T', blocks: blocks.map(([name, category]) => ({ name, category, items: [{ kind: 'lift', exercise: SQUAT.key, sets: [{ reps: 5 }] }] })) }, { liftField: LIFT_FIELD })
    const one = mk([['Legs', 'lift']])
    if (blockTag(one.blocks[0], one, cats) !== null) throw new Error('a single block says it is a separate workout')
    const merged = mk([['Main', 'lift'], ['Accessory', 'lift']])
    if (blockTag(merged.blocks[1], merged, cats) !== null) throw new Error('blocks that merge into one entry talk about splitting')
    const trip = mk([['Warm-up', null], ['Main', 'lift'], ['Accessory', 'lift'], ['Run home', 'run']])
    const t = trip.blocks.map(b => blockTag(b, trip, cats))
    if (!/^A separate .* workout$/.test(t[1]) || !/^A separate .* workout$/.test(t[3])) throw new Error(`the workouts that open an entry do not say so: ${t}`)
    if (t[0] !== 'Part of the workout beside it' || t[2] !== 'Part of the workout beside it') throw new Error(`a block that joins its neighbour claims its own entry: ${t}`)
    if (landsOf(trip).size !== 4) throw new Error('not every block of a split workout says where it lands')
  }],

  /* ================================================= the set row (#93) ===
   *
   * B F1 / A F2, the blocker: a tap at the centre of the weight cell hit the
   * weight-meaning switch and turned 90 lb on the bar into 90 lb per side, with
   * no Undo. The number is the cell now, the ✓ is at the row's start, and what a
   * number means is switched once, on the card, with Undo. Each pinned at its
   * old address (absent) and its new one (present).
   */
  ['Stepper(the number is the cell: the box is the whole middle, its unit drawn in it, no button in it)', null, () => {
    const html = renderToString(<Stepper label="lb on the bar" unit="lb" value={90} onChange={noop} />)
    const mid = (html.match(/<label class="stepper-mid">([\s\S]*?)<\/label>/) || [])[1]
    if (!mid) throw new Error('the middle is not a label for its box: a tap beside the number focuses nothing')
    if (/<button/.test(mid)) throw new Error('a button sits in the number\'s cell')
    if (!/<input[^>]*aria-label="lb on the bar"/.test(mid)) throw new Error('the box lost its full name')
    if (!/<span class="stepper-label" aria-hidden="true">lb<\/span>/.test(mid)) throw new Error('the cell does not say just its unit')
    const css = readFileSync(new URL('../src/css/editor.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (sel) => (css.match(new RegExp(`\\n${sel.replace(/[.*]/g, (c) => '\\' + c)} \\{([^}]*)\\}`)) || [])[1] || ''
    if (!/height: var\(--tap\)/.test(rule('.stepper-mid'))) throw new Error('the number cell is not 44 tall')
    if (!/position: absolute; inset: 0; width: 100%; height: 100%/.test(rule('.stepper-mid input'))) throw new Error('the box does not fill its cell')
    if (!/font-size: var\(--fs-input\)/.test(rule('.stepper-mid input'))) throw new Error('the number is under 16px')
    if (!/pointer-events: none/.test(rule('.stepper-label')) || !/white-space: nowrap/.test(rule('.stepper-label'))) throw new Error('the unit takes taps or wraps')
  }],
  ['ExerciseCard(doing: ✓ at the row’s start, the cells numbers only, the meaning switched once on the card)', null, () => {
    const item = { id: 'b0i0', uid: 'u-row', kind: 'lift', name: 'Bent-over row', exercise: 'bent-over-row', implement: 'ez-bar',
      weightLabel: 'lb on the bar', line: '3 × 10', sets: [0, 1, 2].map(i => ({ id: `s${i}`, reps: 10, weight: 90 })) }
    const html = renderToString(<ExerciseCard item={item} liftField={LIFT_FIELD} defaultOpen doing onTick={noop}
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />)
    const rows = html.match(/<div class="presc-set">[\s\S]*?(?=<div class="presc-set|<\/div><div class="presc-itemfoot")/g) || []
    if (rows.length !== 3) throw new Error(`${rows.length} set rows`)
    for (const r of rows) {
      if (!/^<div class="presc-set"><button[^>]*class="presc-tick/.test(r)) throw new Error('the ✓ is not the first thing in the row')
      if (/stepper-swap|Switch to|modeswitch/.test(r)) throw new Error('a meaning switch is back in a set row')
    }
    if ((html.match(/class="modeswitch"/g) || []).length !== 1) throw new Error('not one meaning switch on the card')
    if (!/<button[^>]*class="modeswitch"[^>]*aria-label="Weight is lb on the bar\. Switch to lb per side"[^>]*>on the bar/.test(html)) throw new Error('the switch does not say what it is and what a tap does')
    const meta = (html.match(/<div class="presc-doingmeta">([\s\S]*?)<div class="presc-sets/) || [])[1] || ''
    if (!/implswitch/.test(meta) || !/modeswitch/.test(meta)) throw new Error('the meaning is not beside what it is done with')
    const css = readFileSync(new URL('../src/css/editor.css', import.meta.url), 'utf8')
    if (!/\.presc-sets\.doing \.presc-set \{ gap: var\(--sp-4\); \}/.test(css)) throw new Error('the ✓ is not 16px clear of the reps’ −')
  }],
  ['modeFlip(one tap writes the next meaning and offers Undo, which writes the old one back)', null, () => {
    const item = { kind: 'lift', name: 'Bent-over row', implement: 'ez-bar', weightLabel: 'lb on the bar' }
    const writes = []; const pushed = []
    const toast = { push: (words, kind, opts) => { pushed.push({ words, opts }); return 1 }, dismiss: noop }
    const f = modeFlip(LIFT_FIELD, item, (p) => writes.push(p), toast)
    if (f.words !== 'on the bar') throw new Error(`the switch reads "${f.words}"`)
    f.onSwitch()
    if (writes[0]?.weightMode !== 'side' || writes[0].weightLabel !== 'lb per side') throw new Error(`wrote ${JSON.stringify(writes[0])}`)
    if (pushed[0]?.words !== 'Bent-over row: weight now per side' || pushed[0].opts.action?.label !== 'Undo') throw new Error('no toast with Undo')
    pushed[0].opts.action.onClick()
    if (writes[1]?.weightMode !== null || writes[1].weightLabel !== 'lb on the bar') throw new Error(`Undo wrote ${JSON.stringify(writes[1])}`)
    if (modeFlip(LIFT_FIELD, { kind: 'lift', implement: 'machine' }, noop, toast) !== null) throw new Error('a machine offers a meaning')
  }],
  ['ExerciseCard(last time: in words, a button that fills the blank sets, a line when there is nothing to fill)', null, () => {
    const card = (sets, props = {}) => renderToString(<ExerciseCard liftField={LIFT_FIELD} entries={PRIOR_LIFTS} defaultOpen
      item={{ id: 'i', kind: 'lift', name: SQUAT.name, exercise: SQUAT.key, implement: 'barbell', weightLabel: 'lb on the bar', line: '', sets }}
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} {...props} />)
    const blank = card([{ id: 's0', reps: null, weight: null }], { onFill: noop })
    const t = text(blank).replace(/<[^>]+>/g, '')
    if (!t.includes(`Last time · ${dayWords('2026-09-10')}: 2 × 5 @ 175 lb`) || /2026-09-10/.test(t)) throw new Error(`last time is not in words: ${t.slice(0, 200)}`)
    if (!/<button[^>]*class="presc-prior presc-use"[^>]*aria-label="Use last time: 2 × 5 @ 175 lb"/.test(blank)) throw new Error('last time does not fill a blank set')
    if (/<button[^>]*presc-use/.test(card([{ id: 's0', reps: 5, weight: 185 }], { onFill: noop }))) throw new Error('a Use button with nothing to fill')
    if (/<button[^>]*presc-use/.test(card([{ id: 's0', reps: null, weight: null }]))) throw new Error('a Use button where nothing can write it')
    // What it hands the parent: the blanks, as one write.
    const fills = lastTimeFillOf({ date: '2026-09-10', summary: '2 × 5 @ 175 lb', row: PRIOR_LIFTS[0].data.out.lifts[0] })
    if (JSON.stringify(fills) !== JSON.stringify([{ setId: 's0', patch: { reps: 5, weight: 175 } }])) throw new Error(JSON.stringify(fills))
  }],
  ['PrescriptionEditor("use last time" is one write of numbers as targets: never a ticked set)', null, () => {
    // Hand-built: one blank set, then a second (normalizePrescription keeps no blank plan).
    const one = appendLift({ v: 1, title: 'P', blocks: [] }, LIFT_FIELD, SQUAT.key)
    const pres = addSet(one, one.blocks[0].items[0].id)
    const [s0, s1] = pres.blocks[0].items[0].sets.map(x => x.id)
    let out = null
    const tree = treeOf(PrescriptionEditor, { pres, liftField: LIFT_FIELD, entries: PRIOR_LIFTS, onChange: (p) => { out = p } })
    const section = findEl(tree, (e) => e?.type === ExerciseSection)
    if (!section?.props.onFill) throw new Error('the editor hands its cards no way to fill')
    section.props.onFill(pres.blocks[0].items[0].id, [{ setId: s0, patch: { reps: 5, weight: 175 } }, { setId: s1, patch: { reps: 5, weight: 175 } }])
    const sets = out?.blocks[0].items[0].sets || []
    if (sets.map(x => `${x.reps}@${x.weight}`).join(',') !== '5@175,5@175') throw new Error(`filled ${JSON.stringify(sets)}`)
    if (sets.some(x => x.typed)) throw new Error('a fill ticked a set: a ✓ means done, a fill is a target')
  }],
  ['ExerciseCard(Edit: the whole exercise is its own named Remove, under a rule, apart from the sets’)', null, () => {
    const item = { ...PRESCRIPTION.blocks[1].items[0], line: '3 × 8' }
    const html = renderToString(<ExerciseCard item={item} liftField={LIFT_FIELD} defaultOpen defaultEditing
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} />)
    const all = (html.match(/<div class="presc-editrow presc-editall">([\s\S]*?)<\/div>/) || [])[1] || ''
    if (!/class="btn quiet presc-rmall"/.test(all) || !text(all).includes(`Remove ${item.name}`)) throw new Error('the whole-exercise Remove does not name what it takes')
    if ((html.match(/presc-rmall/g) || []).length !== 1 || (html.match(/class="btn quiet presc-rm"/g) || []).length !== item.sets.length) throw new Error('set removes and the exercise remove look alike')
    const css = readFileSync(new URL('../src/css/editor.css', import.meta.url), 'utf8')
    if (!/\.presc-editall \{ border-top: 1px solid var\(--line\)/.test(css)) throw new Error('no rule above the whole-exercise Remove')
  }],
  /* A F1: Edit followed the PLACE. Positional ids meant the next exercise took
     the removed card's component, Edit open, its Remove under the thumb. */
  ['cardKey(a card is its exercise: removing one leaves every other card’s key, and so its state, where it was)', null, () => {
    const pres = normalizePrescription({ title: 'P', blocks: [{ name: 'M', items: ['bent-over-row', 'preacher-curl', SQUAT.key].map(k => ({ kind: 'lift', exercise: k, sets: [{ reps: 5 }] })) }] }, { liftField: LIFT_FIELD })
    const withUids = { ...pres, blocks: pres.blocks.map(b => ({ ...b, items: b.items.map((it, i) => ({ ...it, uid: `u${i}` })) })) }
    const keys = (p) => p.blocks[0].items.map(cardKey)
    const before = keys(withUids)
    const after = keys(removeItem(withUids, 'b0i0'))
    // Positional ids renumber: Preacher curl takes b0i0, the id the removed row had.
    const moved = removeItem(withUids, 'b0i0').blocks[0].items[0]
    if (moved.id !== 'b0i0' || moved.uid !== 'u1') throw new Error('the fixture no longer renumbers, so this proves nothing')
    if (after.join() !== before.slice(1).join()) throw new Error(`keys moved: ${before} → ${after}`)
    const tree = treeOf(ExerciseSection, { title: 'M', items: withUids.blocks[0].items, liftField: LIFT_FIELD, onPatch: noop, onPatchSet: noop, onAddSet: noop, onRemoveSet: noop, onRemove: noop })
    const cards = findAll(tree, (e) => e?.type === ExerciseCard)
    if (cards.map(c => c.key).join() !== before.join()) throw new Error(`the section keys cards by ${cards.map(c => c.key)}`)
  }],
  ['ExercisePicker(opens on the block’s group, chips still up; no keyboard of its own on a phone)', null, () => {
    const squat = LIFT_FIELD.exercises.find(e => e.key === SQUAT.key)
    const html = renderToString(<ExercisePicker field={LIFT_FIELD} group={squat.group} onPick={noop} onClose={noop} />)
    if (!new RegExp(`class="implchip on" aria-pressed="true">${squat.group.replace(/&/g, '&amp;')}<`).test(html)) throw new Error('the block’s group is not the one open')
    const rows = [...html.matchAll(/<button class="expick-row"[\s\S]*?<span class="sub">([^<]*)<\/span>/g)].map(m => m[1])
    if (!rows.length || rows.some(g => g !== squat.group.replace(/&/g, '&amp;'))) throw new Error(`the list is not the group: ${rows.slice(0, 4)}`)
    if (/autofocus|autoFocus/i.test(html)) throw new Error('the search box takes the keyboard on a phone')
    const src = readFileSync(new URL('../src/exercises.jsx', import.meta.url), 'utf8')
    if (!/group=\{pickerGroupFor\(liftField, items, title\)\}/.test(src)) throw new Error('the section does not open the picker on its group')
  }],
  /* COPY DOWN (#93, the owner's ask): one set's numbers into the empty sets
     under it, numbers only, with Undo. Under the set, never beside a ✓ or a +. */
  ['ExerciseCard(Copy down: under a set with numbers whose next set is empty; nowhere else)', null, () => {
    const item = (sets) => ({ id: 'b0i0', uid: 'u', kind: 'lift', name: 'Bent-over row', exercise: 'bent-over-row', implement: 'ez-bar',
      weightLabel: 'lb on the bar', line: '', sets: sets.map((x, i) => ({ id: `s${i}`, reps: null, weight: null, ...x })) })
    const card = (sets, props = {}) => renderToString(<ExerciseCard item={item(sets)} liftField={LIFT_FIELD} defaultOpen onFill={noop}
      onPatch={noop} onPatchSet={noop} onAddSet={noop} onRemoveSet={noop} onRemove={noop} {...props} />)
    const n = (h) => (h.match(/class="btn quiet presc-copydown"/g) || []).length
    for (const doing of [false, true]) {
      const props = doing ? { doing: true, onTick: noop } : {}
      const html = card([{ reps: 10, weight: 90 }, {}, {}], props)
      if (n(html) !== 1) throw new Error(`${n(html)} Copy down buttons (doing: ${doing})`)
      // It sits between set 1 and set 2, outside both rows.
      if (!/<\/div><button type="button" class="btn quiet presc-copydown" aria-label="Copy set 1 to the empty sets below">/.test(html)) throw new Error('Copy down is not its own line under set 1')
      const rows = html.match(/<div class="presc-set">[\s\S]*?<\/span><\/div>/g) || []
      if (rows.some(r => /presc-copydown/.test(r))) throw new Error('Copy down is inside a set row, beside the ✓ or a +')
      if (n(card([{ reps: 10, weight: 90 }, { reps: 10, weight: 90 }], props))) throw new Error('offered with nothing empty below')
      if (n(card([{}, {}], props))) throw new Error('offered on an empty set')
    }
    if (n(card([{ reps: 10, weight: 90 }, {}], { onFill: null }))) throw new Error('offered where nothing can write it')
    if (n(card([{ reps: 10, weight: 90 }, {}], { doing: true, onTick: noop, asWritten: true }))) throw new Error('offered on a done day read as written')
    const css = readFileSync(new URL('../src/css/editor.css', import.meta.url), 'utf8')
    const rule = (css.match(/\.btn\.quiet\.presc-copydown \{([^}]*)\}/) || [])[1] || ''
    if (!/min-height: var\(--tap\)/.test(rule)) throw new Error('Copy down is under 44px')
    // Its own line at the row's right edge, 16px clear of the steppers above and below (the grid's 8 + its 8).
    if (!/justify-self: end/.test(rule) || !/margin: var\(--sp-2\) 0/.test(rule) || /margin-left/.test(rule)) throw new Error('Copy down is back beside a stepper column')
    if (!/\.presc-sets \{ display: grid; gap: var\(--sp-2\)/.test(css)) throw new Error('the set grid gap moved: redo the 16px clearance')
  }],
  ['SessionLog(the lift log offers Copy down too)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'log-workout')}
    entry={{ id: 'cd', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'log-workout', out: { activity: 'lift', lifts: [
      { uid: 'bench-press-1', key: 'bench-press', name: 'Bench press', implement: 'barbell', sets: [{ reps: 5, weight: 135 }, { reps: '', weight: '' }] }] } } }}
    entries={[]} onSave={noop} bare />,
    html => { if (!/class="btn quiet presc-copydown"/.test(html)) throw new Error('no Copy down on a logged lift') }],
  ['copyDownWrite(one write of the numbers; "Copied to 2 sets" with Undo, which puts the blanks back exactly)', null, () => {
    const item = { sets: [{ id: 'a', reps: 10, weight: 90 }, { id: 'b', reps: null, weight: null }, { id: 'c', reps: null, weight: null, typed: true }] }
    const writes = []; let toast = null
    copyDownWrite(item, 'a', (f) => writes.push(f), { push: (words, kind, opts) => { toast = { words, opts }; return 1 } })
    if (writes.length !== 1 || writes[0].length !== 2) throw new Error(`wrote ${JSON.stringify(writes)}`)
    if (toast?.words !== 'Copied to 2 sets' || toast.opts.action?.label !== 'Undo') throw new Error(`toast ${JSON.stringify(toast)}`)
    toast.opts.action.onClick()
    if (JSON.stringify(writes[1]) !== JSON.stringify([{ setId: 'b', patch: { reps: null, weight: null } }, { setId: 'c', patch: { reps: null, weight: null, typed: true } }])) {
      throw new Error(`Undo wrote ${JSON.stringify(writes[1])}`)
    }
    // The review's repro: Copy down, type 95 into set 3, tick set 2, Undo. Both stay.
    let now = { sets: [{ id: 'a', reps: 10, weight: 90 }, { id: 'b', reps: 10, weight: 90 }, { id: 'c', reps: 10, weight: 90 }] }
    const w2 = []; let t2 = null
    copyDownWrite(item, 'a', (f) => w2.push(f), { push: (words, kind, opts) => { t2 = opts; return 1 } }, () => now)
    now = { sets: [now.sets[0], { ...now.sets[1], typed: true }, { ...now.sets[2], weight: 95, typed: true }] }
    t2.action.onClick()
    if (w2.length !== 1) throw new Error(`Undo wrote over sets touched since: ${JSON.stringify(w2[1])}`)
    if (copyDownWrite({ sets: [{ id: 'a', reps: 1 }] }, 'a', () => { throw new Error('wrote nothing to fill') }) !== null) throw new Error('a toast with nothing copied')
  }],
  ['PrescriptionEditor(Copy down is numbers only: same sets, same ids, none ticked)', null, () => {
    const one = appendLift({ v: 1, title: 'P', blocks: [] }, LIFT_FIELD, SQUAT.key)
    const id = one.blocks[0].items[0].id
    let pres = addSet(addSet(one, id), id)
    pres = { ...pres, blocks: [{ ...pres.blocks[0], items: [{ ...pres.blocks[0].items[0], sets: pres.blocks[0].items[0].sets.map((x, i) => (i ? x : { ...x, reps: 5, weight: 185, typed: true })) }] }] }
    let out = null
    const section = findEl(treeOf(PrescriptionEditor, { pres, liftField: LIFT_FIELD, onChange: (p) => { out = p }, doing: true }), (e) => e?.type === ExerciseSection)
    const item = pres.blocks[0].items[0]
    copyDownWrite(item, item.sets[0].id, (f) => section.props.onFill(id, f), { push: () => 1 })
    const sets = out.blocks[0].items[0].sets
    if (sets.map(x => x.id).join() !== item.sets.map(x => x.id).join()) throw new Error('a set was added, removed or renumbered')
    if (sets.map(x => `${x.reps}@${x.weight}`).join() !== '5@185,5@185,5@185') throw new Error(JSON.stringify(sets))
    if (sets.slice(1).some(x => x.typed) || !sets[0].typed) throw new Error('a copied set reads as done, or the source lost its tick')
  }],
]
