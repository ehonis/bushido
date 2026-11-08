/*
 * The prescription editor (app/src/editor.jsx): a planned workout's blocks and
 * their items, the one editor both routes of Plan a workout end in (BuildStep,
 * ReviewStep) and the session sheet shows afterwards. Moved out of planner.tsx in
 * #73, unchanged.
 */
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Btn, IconBtn, Input, Press, Toggle } from '../ui/kit'
import { Fold } from '../ui/Fold'
import { impact, tap } from '../ui/haptics'
import {
  prescriptionSteps, itemLine, setLine, patchSet, addSet, removeSet, removeItem, patchItem,
  patchBlock, appendLift, moveItem, setCircuit, setTiming, circuitTiming,
} from '../lib/prescription.js'
import { removalWords } from '../lib/removal.js'
import { ExerciseSection, useUndoable } from './exercises'
import { CircuitSteppers, CircuitList, SecondsRow } from './circuit'

/* ------------------------------------------------------------- the editor */

/** .implchip: the small pill the editor and the block quota use. Selected is the accent tint, like .chip. */
function ImplChip({ label, icon, on, onPress }: { label: string; icon?: string; on?: boolean; onPress: () => void }) {
  const c = on ? colors.ink : colors.inkDim
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!on }}
      style={[st.implchip, on && st.implchipOn]}>
      {icon ? <Icon name={icon} size={13} color={c} /> : null}
      <T size={font.small} color={c}>{label}</T>
    </Press>
  )
}

/**
 * A piece of work that is not a lift. Name it, say how it is MEASURED, add it:
 * an interval set shows only the fields it carries (`setFieldsFor`), so this is
 * the one moment the answer is available. Folded behind a button of its own —
 * on a lift day it is never the answer.
 */
function PieceAdder({ unit, onAdd }: { unit: string; onAdd: (name: string, by: string, unit: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [by, setBy] = useState('time')

  const add = () => {
    const said = name.trim()
    if (!said) return
    impact()
    onAdd(said, by, unit)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Press haptic onPress={() => setOpen(true)} style={st.addPiece}>
        <Icon name="Timer" size={15} color={colors.inkFaint} />
        <T size={font.small} faint>Add a swim set, interval or hold</T>
      </Press>
    )
  }

  return (
    <View style={st.pieceadd}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Input autoFocus value={name} onChangeText={setName} style={{ flex: 1, minWidth: 0 }}
          accessibilityLabel="What the piece is called"
          placeholder="easy spin, 400s, hollow hold…"
          returnKeyType="done" onSubmitEditing={add} />
        <IconBtn icon="X" size={16} label="Close" onPress={() => { setOpen(false); setName('') }} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {[['time', 'by time'], ['distance', 'by distance'], ['reps', 'by reps']].map(([k, lbl]) => (
          <ImplChip key={k} label={lbl} on={by === k} onPress={() => setBy(k)} />
        ))}
        <Btn title="Add" disabled={!name.trim()} onPress={add} style={{ marginLeft: 'auto' }} />
      </View>
    </View>
  )
}

/**
 * Which category a BLOCK is — and therefore where the session SPLITS.
 *
 * Each workout in the session has its own category, not the session as a whole:
 * a run and a lift land as two entries, each with its own log and its own place
 * for the watch to attach to. (Until 2026-10-25 this was also which weekly quota
 * the block filled; the quotas are gone, the split stays.) `none` is a real
 * answer and the default for a warm-up: it belongs to the workout beside it.
 */
function BlockQuota({ categories, value, onChange }: any) {
  if (!categories.length) return null
  const picked = categories.find((c: any) => c.key === value) || null
  return (
    <Fold
      style={{ marginBottom: 10 }}
      headStyle={{ minHeight: 30 }}
      summary={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="Target" size={12} color={colors.inkFaint} />
          <T size={font.small} faint>
            {picked
              ? <>A separate <T size={font.small} weight={600} color={colors.accent}>{picked.name}</T> workout</>
              : 'Part of the workout beside it'}
          </T>
        </View>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 2 }}>
        <ImplChip label="Part of the workout beside it" on={!value} onPress={() => onChange(null)} />
        {categories.map((c: any) => (
          <ImplChip key={c.key} icon={c.icon} label={c.name} on={value === c.key} onPress={() => onChange(c.key)} />
        ))}
      </View>
    </Fold>
  )
}

/**
 * What a distance in THIS block is measured in: a pool is yards; everything else
 * that covers ground is miles, which is what Strava hands back. A default on a
 * box the user can retype, not a conversion.
 */
const distanceUnitFor = (block: any) => (/swim/i.test(block?.activity || '') ? 'yd' : 'mi')

/** "1 set", "6 sets" — the header count. */
const setCount = (block: any) => {
  if (block?.circuit) return `${block.circuit.rounds} round${block.circuit.rounds === 1 ? '' : 's'}`
  const n = (block?.items || []).reduce((sum: number, i: any) => sum + i.sets.length, 0)
  return `${n} set${n === 1 ? '' : 's'}`
}

/**
 * Any block can be a circuit (issue #68): its exercises one after another on
 * the interval timer, which is what Start runs. A switch, with the words beside it.
 */
function CircuitSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3], minHeight: TAP, marginVertical: space[1] }}>
      <View style={{ flexShrink: 1 }}>
        <T size={font.body}>Circuit</T>
        <T size={font.small} dim>Timed, one exercise after another</T>
      </View>
      <Toggle value={on} onChange={onChange} />
    </View>
  )
}

/**
 * A block switched to Circuit: the same head and fold as any block, then the
 * circuit's timing in one row, its exercises with their own timing behind a
 * tap (circuit.tsx), and the two settings people rarely change folded.
 */
/** "10 lb": a circuit exercise's planned weight, which its logged rows carry. */
const loadOf = (it: any) => {
  const w = it.sets?.[0]?.weight
  return w !== null && w !== undefined && w !== '' ? `${w} ${it.weightLabel || 'lb'}` : null
}

function CircuitBlock({ block: b, pres, onChange, onDrop, liftField, entries, entryId, open, onToggle, extra }: any) {
  const [more, setMore] = useState(false)
  const c = b.circuit
  const items = b.items.map((it: any) => ({ id: it.id, key: it.exercise, name: it.name, timing: (circuitTiming as any)(it), load: loadOf(it) }))
  const timing = (next: any) => onChange((patchBlock as any)(pres, b.id, { circuit: { ...c, ...next } }))
  return (
    <View style={{ marginBottom: open ? 22 : 10 }}>
      <Press onPress={() => { tap(); onToggle() }} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 34 }}>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} color={colors.inkFaint} />
        <T size={font.body} weight={600} style={{ flex: 1, minWidth: 0 }}>{b.name}</T>
        <T size={font.small} dim tabular>{setCount(b)}</T>
      </Press>
      {open ? (
        <>
          {extra}
          <CircuitSteppers circuit={c} onChange={timing} />
          <Btn kind="quiet" icon={more ? 'ChevronUp' : 'ChevronDown'} title={more ? 'Fewer options' : 'More options'}
            style={{ alignSelf: 'flex-start', paddingHorizontal: space[1] }} onPress={() => setMore(!more)} />
          {more ? (
            <View style={{ backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card, marginBottom: space[2] }}>
              <SecondsRow label="Rest between rounds" value={c.roundRest} onChange={v => timing({ roundRest: v })} />
              <SecondsRow label="Get ready" value={c.countIn} max={60} onChange={v => timing({ countIn: v })} first={false} />
            </View>
          ) : null}
          <CircuitList items={items} work={c.work} liftField={liftField}
            onTiming={(i, t) => onChange((setTiming as any)(pres, items[i].id, t))}
            onRemove={(i) => onDrop(items[i].id)}
            onMove={(i, dir) => onChange((moveItem as any)(pres, items[i].id, dir).pres)}
            onAdd={(key) => onChange((appendLift as any)(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId }))} />
        </>
      ) : null}
    </View>
  )
}

/**
 * The id of the exercise `appendLift` just put at the end of block `blockId`.
 * Found by the block's PLACE, which re-minting keeps, never by its name: two
 * blocks called "Main" opened the wrong card (#78, C F17).
 */
export function addedId(before: any, next: any, blockId: string): string | null {
  const at = (before?.blocks || []).findIndex((x: any) => x.id === blockId)
  const block = next?.blocks?.[at] || next?.blocks?.[0]
  return block?.items?.at(-1)?.id || null
}

/**
 * Every set of a planned session, editable, with thumbs in mind.
 *
 * THE SAME COMPONENT THE LOG FORM USES: the card, the fold, the implement chips,
 * the steppers, the picker and reorder mode all live in `exercises` and this file
 * only says what a BLOCK is. What is left here is `BlockQuota`, which decides
 * where a session splits. Shared by the review step and the session sheet.
 */
export function PrescriptionEditor({
  pres, onChange: emit, liftField, entries = [], entryId = null, categories = [], compact = false,
  canReorder = true, onAddPiece = null, syncedWith = null,
}: any) {
  // Every write goes through `onChange`; a removal through `remove`, which offers Undo (#77).
  // `syncedWith`: the other sides of a synced workout, for the toast's line (lib/removal.js).
  const { change: onChange, remove } = useUndoable(pres, emit)
  const itemOf = (id: string) => (pres?.blocks || []).flatMap((b: any) => b.items || []).find((it: any) => it.id === id)
  const dropSet = (id: string, setId: string) => {
    const it = itemOf(id)
    remove((removeSet as any)(pres, id, setId), removalWords(it, (it?.sets || []).findIndex((s: any) => s.id === setId), { syncedWith }))
  }
  const dropItem = (id: string) => remove((removeItem as any)(pres, id), removalWords(itemOf(id), null, { syncedWith }))
  const [shut, setShut] = useState<Set<string>>(() => new Set())  // blockIds folded away

  const total = (prescriptionSteps as any)(pres).length
  // ONE exercise starts open and it is the first in the SESSION, not the first in
  // each block — six open cards is four screens of steppers to scroll past.
  const firstItemId = (pres?.blocks || []).flatMap((b: any) => b.items || [])[0]?.id || null

  const toggleBlock = (id: string) => setShut(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <View style={compact ? { gap: 0 } : null}>
      {(pres.blocks || []).map((b: any) => (b.circuit ? (
        <CircuitBlock key={b.id} block={b} pres={pres} onChange={onChange} onDrop={dropItem} liftField={liftField}
          entries={entries} entryId={entryId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={<>
            <CircuitSwitch on onChange={(on) => onChange((setCircuit as any)(pres, b.id, on))} />
            <BlockQuota categories={categories} value={b.category}
              onChange={(key: string | null) => onChange((patchBlock as any)(pres, b.id, { category: key }))} />
          </>} />
      ) : (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map((it: any) => ({ ...it, line: (itemLine as any)(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={<>
            <CircuitSwitch on={false} onChange={(on) => onChange((setCircuit as any)(pres, b.id, on))} />
            <BlockQuota categories={categories} value={b.category}
              onChange={(key: string | null) => onChange((patchBlock as any)(pres, b.id, { category: key }))} />
          </>}
          /* The hand-built route only. A session the model wrote already has its
             intervals in it, and the place to change one is the card. */
          foot={onAddPiece
            ? <PieceAdder unit={distanceUnitFor(b)}
                onAdd={(name, by, unit) => onAddPiece(b.id, name, by, unit)} />
            : null}
          onPatch={(id: string, patch: any) => onChange((patchItem as any)(pres, id, patch))}
          onPatchSet={(id: string, setId: string, patch: any) => onChange((patchSet as any)(pres, id, setId, patch))}
          onAddSet={(id: string) => onChange((addSet as any)(pres, id))}
          onRemoveSet={dropSet}
          onRemove={dropItem}
          onMove={canReorder ? (id: string, dir: number) => {
            const r: any = (moveItem as any)(pres, id, dir)
            onChange(r.pres)
            return r.itemId
          } : null}
          /* Same as the log form: the exercise just added opens. `appendLift`
             re-mints every id, and the new one is always last in its block. */
          onAdd={(key: string) => {
            const next: any = (appendLift as any)(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId })
            onChange(next)
            return addedId(pres, next, b.id)
          }} />
      )))}
      {/* Only where there is nothing to be done about it: a session still being
          built is empty because the user has not started. */}
      {!total && !onAddPiece && (
        <T style={st.subp}>Nothing left in this workout. Redo it, or close and start again.</T>
      )}
    </View>
  )
}

export { setLine }

const st = StyleSheet.create({
  subp: { color: colors.inkDim, fontSize: 12.5, lineHeight: 19 },

  implchip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space[3], minHeight: 36,
    borderRadius: radius.pill, backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  implchipOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  addPiece: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: TAP, marginTop: 6,
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8, paddingHorizontal: 10,
  },
  pieceadd: { gap: 8, padding: 10, marginTop: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8 },
})
