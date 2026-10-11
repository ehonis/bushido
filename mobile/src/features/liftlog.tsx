/*
 * Logging a lift session: which movement, what you loaded it with, and the sets.
 *
 * THIS IS THE SAME SCREEN AS THE PLANNER'S EDITOR, since 2026-09-21. Planned
 * workouts and logged workouts should look exactly the same, so the card, the
 * list, the picker and reorder mode all come from `exercises.tsx` and the two
 * cannot drift apart again.
 *
 * WHAT IS LEFT HERE is the adapter, for one real difference in the stored shapes:
 * a prescription's sets carry their own ids; a logged lift's sets are POSITIONAL
 * (`out.lifts[].sets[i]`), which is what hundreds of entries are written as. So
 * the index is the id on the way out and read back with `Number()` on the way in,
 * rather than rewriting history to suit a component.
 *
 * **The exercise is SEARCHED, not scrolled.** **Nothing is pre-filled, but the
 * previous set carries forward** (`addLiftSet` copies what the user TYPED).
 * **What the user lifted last time is on screen** (`lastLift`).
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import {
  implementsFor, weightLabelFor, liftsIn, liftSummary, liftsLine,
  addLift, removeLift, patchLift, addLiftSet, removeLiftSet, setLiftSet, moveLift,
  LIFT_FIELD,
} from '../lib/lifts.js'
import { ExerciseSection } from './exercises'

/**
 * A logged lift, in the shape `ExerciseCard` reads. `kind: 'lift'` makes
 * `setFieldsFor` ask for reps and weight and keeps the rest stepper off it.
 */
function asItem(field: any, lift: any) {
  const offered: any[] = implementsFor(field, lift.key)
  const chosen = offered.find((i) => i.value === lift.implement) || null
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
      .map((r: any, i: number) => ({ ...r, id: String(i) })),
  }
}

/**
 * The whole block, rendered for a `type: "lifts"` output field. `field` carries
 * its own catalog, so this needs nothing from the plan beyond the field.
 */
export function LiftLog({ field, out, entries = [], entryId = null, onSave }: any) {
  const list = liftsIn(out)
  const write = (next: any) => onSave({ ...out, [LIFT_FIELD]: next })
  const line = liftsLine(out)
  // Open, because on the log side this section IS the form. Foldable all the same.
  const [open, setOpen] = useState(true)

  const items = list.map((l: any) => asItem(field, l))

  return (
    <View style={{ gap: 14 }}>
      <ExerciseSection
        title={field.label || 'What did you lift?'}
        count={line || null}
        items={items}
        liftField={field} entries={entries} entryId={entryId}
        firstOpenId={items[0]?.id || null}
        open={open} onToggle={() => setOpen((v) => !v)}
        // A blank here is `''`, not `null`: that is what is on disk for the lift log.
        blank=""
        addLabel="Add an exercise"
        note={field.hint}
        onPatch={(uid: any, patch: any) => write(patchLift(field, list, uid, patch))}
        onPatchSet={(uid: any, setId: any, patch: any) => write(setLiftSet(list, uid, Number(setId), patch))}
        onAddSet={(uid: any) => write(addLiftSet(list, uid))}
        onRemoveSet={(uid: any, setId: any) => write(removeLiftSet(list, uid, Number(setId)))}
        onRemove={(uid: any) => write(removeLift(list, uid))}
        onMove={(uid: any, dir: any) => { write(moveLift(list, uid, dir)); return uid }}
        // Hands back the new row's id so the card it just made opens.
        onAdd={(key: any) => {
          const next = addLift(field, list, key)
          write(next)
          return next.at(-1)?.uid || null
        }} />
    </View>
  )
}
