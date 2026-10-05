/*
 * Logging a lift session: which movement, what you loaded it with, and the sets.
 *
 * THIS IS THE SAME SCREEN AS THE PLANNER'S EDITOR, since 2026-09-21. Planned
 * workouts and logged workouts should look exactly the same, and where the two
 * differed the planner's version won, because that is where the recent work had
 * gone.
 *
 * They were different for a reason that was never a decision. This file was
 * written on 2026-09-10 — a `<table>` of bare inputs under a native `<select>` —
 * and `PrescriptionEditor` on 2026-09-17, with everything learned in the week
 * between: thumb-sized steppers, the body map on the row, what the user lifted last
 * time, implement chips instead of an OS wheel, a fold so six exercises are not
 * four screens of scrolling. Logging a workout and planning one are the same act
 * against different numbers, so the card, the list, the picker and reorder mode
 * all come from `exercises.jsx` now and the two cannot drift apart again.
 *
 * WHAT IS LEFT HERE is the adapter, and it exists because of one real difference
 * in the stored shapes. A prescription's sets carry their own ids; a logged
 * lift's sets are POSITIONAL — `out.lifts[].sets[i]` — and that shape is what
 * hundreds of entries are written as. So the adapter uses the index AS the id on
 * the way out and reads it back with `Number()` on the way in. The alternative
 * was migrating their log to give every set an id, which is a rewrite of history to
 * suit a component.
 *
 * The rest of the decisions this screen has always made are unchanged, and all of
 * them are now shared rather than re-implemented:
 *
 * **The exercise is SEARCHED, not scrolled.** Two hundred movements in a native
 * picker is a wheel you cannot aim with one thumb. The muscle-group chips are the
 * other way in for when the user does not want to type at all — they search for the
 * group, so browsing and searching are the same mechanism rather than two. Those
 * chips MOVED INTO the shared picker rather than being lost to it; the planner
 * never had them and now does.
 *
 * **Nothing is pre-filled, but the previous set carries forward.** `addLiftSet`
 * copies what the user TYPED, which is a different thing from a prescription's target.
 *
 * **What the user lifted last time is on screen, not a tab away.** `lastLift`, the same
 * call the planner and the runner make.
 */

import { useState } from 'react'
import {
  implementsFor, weightLabelFor, liftsIn, liftSummary, liftsLine,
  addLift, removeLift, patchLift, addLiftSet, removeLiftSet, setLiftSet, moveLift,
  LIFT_FIELD,
} from './lib/lifts.js'
import { ExerciseSection } from './exercises.jsx'

/**
 * A logged lift, in the shape `ExerciseCard` reads.
 *
 * `kind: 'lift'` is what makes `setFieldsFor` ask for reps and weight, and what
 * keeps the rest stepper off it — lifting has no programmed rest (rest between
 * sets is not prescribed), which was already true of a planned lift and is
 * now true of a logged one by construction rather than by coincidence.
 */
function asItem(field, lift) {
  const offered = implementsFor(field, lift.key)
  const chosen = offered.find(i => i.value === lift.implement) || null
  return {
    id: lift.uid,
    kind: 'lift',
    name: lift.name,
    group: lift.group || null,
    exercise: lift.key,
    note: '',
    implement: lift.implement || '',
    implementLabel: chosen?.label || lift.implementLabel || null,
    weightLabel: weightLabelFor(field, lift.implement),
    line: liftSummary(lift),
    // Positional ids. See the adapter note in the file header.
    sets: (Array.isArray(lift.sets) ? lift.sets : [])
      .map((r, i) => ({ ...r, id: String(i) })),
  }
}

/**
 * The whole block, rendered for a `type: "lifts"` output field.
 *
 * `field` carries its own catalog (see lib/lifts.js on why it is content), so
 * this needs nothing from the plan beyond the field it was handed — the same
 * contract every other output type has.
 */
export function LiftLog({ field, out, entries = [], entryId = null, onSave }) {
  const list = liftsIn(out)
  const write = (next) => onSave({ ...out, [LIFT_FIELD]: next })
  const line = liftsLine(out)
  // Open, because on the log side this section IS the form — unlike a plan, where
  // it is one block of several. Foldable all the same.
  const [open, setOpen] = useState(true)

  const items = list.map(l => asItem(field, l))

  return (
    <div className="out-field liftlog">
      <ExerciseSection
        title={field.label || 'What did you lift?'}
        count={line || null}
        items={items}
        liftField={field} entries={entries} entryId={entryId}
        firstOpenId={items[0]?.id || null}
        open={open} onToggle={() => setOpen(v => !v)}
        /*
         * A blank here is `''`, not `null`. The lift log's rows have used the
         * empty string since they existed and that is what is on disk; the
         * prescription uses null. One prop, rather than a migration of either.
         */
        blank=""
        addLabel="Add an exercise"
        note={field.hint}
        onPatch={(uid, patch) => write(patchLift(field, list, uid, patch))}
        onPatchSet={(uid, setId, patch) => write(setLiftSet(list, uid, Number(setId), patch))}
        onAddSet={(uid) => write(addLiftSet(list, uid))}
        onRemoveSet={(uid, setId) => write(removeLiftSet(list, uid, Number(setId)))}
        onRemove={(uid) => write(removeLift(list, uid))}
        onMove={(uid, dir) => { write(moveLift(list, uid, dir)); return uid }}
        /* Hands back the new row's id so the card it just made opens — the user added
           it to type its sets in. See `added` in ExerciseSection. */
        onAdd={(key) => {
          const next = addLift(field, list, key)
          write(next)
          return next.at(-1)?.uid || null
        }} />
    </div>
  )
}
