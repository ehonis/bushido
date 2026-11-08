/* Smoke cases: the prescription editor and the exercise cards, picker and sheet.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { PrescriptionEditor } from '../src/editor.jsx'
import { normalizePrescription, setCircuit } from '../src/lib/prescription.js'
import { SessionLog } from '../src/sessionlog.jsx'
import { readFileSync } from 'node:fs'
import * as EXERCISES from '../src/exercises.jsx'
import { ExercisePicker, ExerciseSheet, ExerciseCard, STEP, undoControl, UNDO_MS } from '../src/exercises.jsx'
import { removalWords, syncLine } from '../src/lib/removal.js'
import { searchExercises } from '../src/lib/lifts.js'
import {
  plan, entries, noop, TODAY, back, text, LIFT_FIELD, SQUAT, PRESCRIPTION, TRIP,
  PRIOR_LIFTS, HELD_CARD, HELD_FIELD, HELD_ENTRY,
} from './fixtures.jsx'

export default [
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
      if (!/last time \(2026-09-10\)/.test(t)) throw new Error('no previous session on the planning screen')
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
    const switches = [...html.matchAll(/<input type="checkbox" role="switch" class="switch"([^>]*)>/g)].map(m => /checked/.test(m[1]))
    if (switches.join() !== 'true,false') throw new Error(`the Circuit switch should be on for the circuit and off for the plain block: ${switches}`)
    if (!/Timed, one exercise after another/.test(t)) throw new Error('the switch does not say what a circuit is')
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
]
