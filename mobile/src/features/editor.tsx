/*
 * The prescription editor (app/src/editor.jsx): a planned workout's blocks and
 * their items, the one editor both routes of Plan a workout end in (BuildStep,
 * ReviewStep) and the session sheet shows afterwards. Moved out of planner.tsx in
 * #73, unchanged.
 */
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Btn, IconBtn, Input, Press } from '../ui/kit'
import { showMenu, prompt } from '../ui/menu'
import { impact, tap } from '../ui/haptics'
import {
  prescriptionSteps, itemLine, setLine, patchSet, addSet, removeSet, removeItem, patchItem,
  patchBlock, appendLift, moveItem, setCircuit, setTiming, circuitTiming,
  addBlock, renameBlock, noteBlock, removeBlock, moveBlock, tickSet, firstUnticked, splitPrescription,
} from '../lib/prescription.js'
import { removalWords, syncLine } from '../lib/removal.js'
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
/**
 * The piece button's words, from what the block is (#80): a Pull block offered
 * "Add a swim set, interval or hold". The web's `pieceWords`, word for word.
 */
export function pieceWords(block: any) {
  const kind = `${block?.category || ''} ${block?.activity || ''}`.toLowerCase()
  if (/swim/.test(kind)) return 'Add a swim set'
  if (/run|bike|ride|row|ski|cardio|endurance/.test(kind)) return 'Add an interval'
  if (/lift|support|strength|core|mobility|climb/.test(kind)) return 'Add a hold or timed exercise'
  return 'Add a swim set, interval or hold'
}

function PieceAdder({ unit, onAdd, label = pieceWords(null) }: { unit: string; onAdd: (name: string, by: string, unit: string) => void; label?: string }) {
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
        <T size={font.small} faint>{label}</T>
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
 * What a block's head says of its settings (#79), since the controls moved into
 * its ⋯ (the web's `blockTag`): "Circuit", and where it lands. Once any block of
 * the workout is its own entry, every block says which it is (G F8); a workout
 * that does not split says nothing about it.
 */
export function blockTag(block: any, pres: any, categories: any[] = []): string | null {
  const lands = categories.length ? landsOf(pres).get(block?.id) : null
  const cat = lands === 'own' ? categories.find((c: any) => c.key === block.category) : null
  const words = cat ? `A separate ${cat.name} workout` : lands === 'beside' ? 'Part of the workout beside it' : null
  return [block?.circuit ? 'Circuit' : null, words].filter(Boolean).join(' · ') || null
}

/**
 * Where each block lands, by `splitPrescription`'s own rule (the web's
 * `landsOf`): nothing when the workout stays one entry; otherwise the block that
 * opens a workout of its category is `own`, every other block `beside`.
 */
export function landsOf(pres: any): Map<string, 'own' | 'beside'> {
  const out = new Map<string, 'own' | 'beside'>()
  if ((splitPrescription as any)(pres).length < 2) return out
  let open: string | null = null
  for (const b of pres?.blocks || []) {
    const own = Boolean(b.category) && b.category !== open
    if (b.category) open = b.category
    out.set(b.id, own ? 'own' : 'beside')
  }
  return out
}

/**
 * A block's note: the warm-up written as prose, which the editor never showed
 * (C F8). Read under the head; a box while it is written: always in planning
 * once there is one, and in doing only when asked for from the ⋯.
 */
function BlockNote({ note, editing, asked, onCommit, onFocus, onDone }: any) {
  /* The box owns its text while it is written: the note is trimmed when stored
     (`noteBlock`), so storing per keystroke ate the space being typed. Stored when
     the box is left, and when the sheet closes under it. */
  const [text, setText] = useState(note || '')
  const pending = useRef<string | null>(null)
  const commit = useRef(onCommit)
  commit.current = onCommit
  useEffect(() => { if (pending.current === null) setText(note || '') }, [note])
  useEffect(() => () => { if (pending.current !== null) commit.current(pending.current) }, [])
  const leave = () => {
    if (pending.current !== null) { commit.current(pending.current); pending.current = null }
    onDone?.()
  }
  if (!editing) return note ? <T size={font.small} faint style={{ marginBottom: space[2] }}>{note}</T> : null
  return (
    <Input multiline value={text} onChangeText={(v: string) => { pending.current = v; setText(v) }}
      autoFocus={asked} onFocus={onFocus} onBlur={leave}
      accessibilityLabel="Block note" placeholder="A note: a warm-up, a cue, how to pace it"
      style={{ minHeight: 64, marginBottom: space[2] }} />
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
 * A block switched to Circuit: the same head and fold as any block, then the
 * circuit's timing in one row, its exercises with their own timing behind a
 * tap (circuit.tsx), and the two settings people rarely change folded.
 */
/** "10 lb": a circuit exercise's planned weight, which its logged rows carry. */
const loadOf = (it: any) => {
  const w = it.sets?.[0]?.weight
  return w !== null && w !== undefined && w !== '' ? `${w} ${it.weightLabel || 'lb'}` : null
}

function CircuitBlock({ block: b, pres, onChange, onDrop, liftField, entries, entryId, open, onToggle, extra, menu = null, tag = null, lead = null }: any) {
  const [more, setMore] = useState(false)
  const c = b.circuit
  const items = b.items.map((it: any) => ({ id: it.id, key: it.exercise, name: it.name, timing: (circuitTiming as any)(it), load: loadOf(it) }))
  const timing = (next: any) => onChange((patchBlock as any)(pres, b.id, { circuit: { ...c, ...next } }))
  return (
    <View style={{ marginBottom: open ? 22 : 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Press onPress={() => { tap(); onToggle() }} accessibilityRole="button" accessibilityState={{ expanded: open }}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: TAP }}>
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} color={colors.inkFaint} />
          <T size={font.body} weight={600} style={{ flex: 1, minWidth: 0 }}>{b.name}</T>
          {tag ? <T size={font.small} dim>{tag}</T> : null}
          <T size={font.small} dim tabular>{setCount(b)}</T>
        </Press>
        {menu ? menu({ reorder: null }) : null}
      </View>
      {open ? (
        <>
          {lead}
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
 * only says what a BLOCK is: its ⋯ (#79, the system sheet: rename, a note,
 * reorder, move, circuit, where it lands, remove), its note, and where the
 * session splits. Shared by the review step and the session sheet.
 *
 * `doing` (#79, D9): the sheet of a planned workout on its day or after. One
 * exercise opens, the first with a set still to do (`firstUnticked`), and the
 * next opens as it is finished; every set has a ✓ (`tickSet`, the log).
 */
export function PrescriptionEditor({
  pres, onChange: emit, liftField, entries = [], entryId = null, categories = [], compact = false,
  canReorder = true, onAddPiece = null, syncedWith = null, doing = false, asWritten = false,
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
  // The block whose note is being written.
  const [noteFor, setNoteFor] = useState<string | null>(null)

  const total = (prescriptionSteps as any)(pres).length
  const blocks: any[] = pres.blocks || []
  // ONE exercise starts open. Planning: the first in the SESSION. Doing: the
  // first with a set still to do, which is where the workout is.
  const next = doing ? (firstUnticked as any)(pres, asWritten) : null
  const firstItemId = doing ? next : blocks.flatMap((b: any) => b.items || [])[0]?.id || null

  const toggleBlock = (id: string) => setShut(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  // A block op renumbers blocks, so what is folded is let go rather than left
  // pointing at whichever block took its place.
  const regroup = (p: any) => { setShut(new Set()); setNoteFor(null); onChange(p) }
  const dropBlock = (b: any) => {
    const words = `Removed ${b.name}`
    setShut(new Set())
    remove((removeBlock as any)(pres, b.id), syncedWith?.length ? `${words}. ${syncLine(syncedWith)}` : words)
  }

  /*
   * A BLOCK'S OWN SETTINGS, behind its ⋯ (#79), as the system's action sheet.
   * Every block used to carry a full-width Circuit switch and the split fold,
   * even a run and an empty warm-up (C F14, G F8); a block could not be renamed,
   * given a note, moved or removed. Remove is last and red, and has Undo.
   */
  const openMenu = (b: any, bi: number, reorder: (() => void) | null) => {
    const lands = () => setTimeout(() => showMenu([
      { label: `${!b.category ? '✓ ' : ''}Part of the workout beside it`, onPress: () => onChange((patchBlock as any)(pres, b.id, { category: null })) },
      ...categories.map((c: any) => ({
        label: `${b.category === c.key ? '✓ ' : ''}A separate ${c.name} workout`,
        onPress: () => onChange((patchBlock as any)(pres, b.id, { category: c.key })),
      })),
    ], { title: `Where ${b.name} lands` }), 350)
    showMenu([
      { label: 'Rename', onPress: () => { prompt('Rename this block', { defaultValue: b.name }).then((v) => { if (v) onChange((renameBlock as any)(pres, b.id, v)) }) } },
      { label: b.note ? 'Edit the note' : 'Add a note', onPress: () => setNoteFor(b.id) },
      ...(reorder ? [{ label: 'Reorder exercises', onPress: reorder }] : []),
      ...(bi > 0 ? [{ label: 'Move block up', onPress: () => regroup((moveBlock as any)(pres, b.id, 'up').pres) }] : []),
      ...(bi < blocks.length - 1 ? [{ label: 'Move block down', onPress: () => regroup((moveBlock as any)(pres, b.id, 'down').pres) }] : []),
      { label: b.circuit ? 'Not a circuit' : 'Make it a circuit', onPress: () => onChange((setCircuit as any)(pres, b.id, !b.circuit)) },
      ...(categories.length ? [{ label: 'Where it lands…', onPress: lands }] : []),
      ...(blocks.length > 1 ? [{ label: 'Remove block', destructive: true, onPress: () => dropBlock(b) }] : []),
    ], { title: b.name })
  }
  const menuOf = (b: any, bi: number) => ({ reorder }: { reorder: (() => void) | null }) => (
    <IconBtn icon="Ellipsis" label={`${b.name}: block options`} onPress={() => openMenu(b, bi, reorder)} />
  )
  // Planning shows a note as its box; doing reads it, and the ⋯ opens the box.
  const leadOf = (b: any) => (
    <BlockNote note={b.note} editing={noteFor === b.id || (!doing && Boolean(b.note))} asked={noteFor === b.id}
      onCommit={(v: string) => onChange((noteBlock as any)(pres, b.id, v))}
      onFocus={() => setNoteFor(b.id)} onDone={() => setNoteFor(null)} />
  )

  return (
    <View style={compact ? { gap: 0 } : null}>
      {blocks.map((b: any, bi: number) => (b.circuit ? (
        <CircuitBlock key={b.id} block={b} pres={pres} onChange={onChange} onDrop={dropItem} liftField={liftField}
          entries={entries} entryId={entryId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          menu={menuOf(b, bi)} tag={blockTag(b, pres, categories)} lead={leadOf(b)} />
      ) : (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map((it: any) => ({ ...it, line: (itemLine as any)(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          menu={menuOf(b, bi)} tag={blockTag(b, pres, categories)} lead={leadOf(b)}
          doing={doing} asWritten={asWritten} focusId={next}
          onTick={doing ? (id: string, setId: string, v: boolean) => onChange((tickSet as any)(pres, id, setId, v)) : null}
          /* The hand-built route only. A session the model wrote already has its
             intervals in it, and the place to change one is the card. */
          foot={onAddPiece
            ? <PieceAdder unit={distanceUnitFor(b)} label={pieceWords(b)}
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
            const n: any = (appendLift as any)(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId })
            onChange(n)
            return addedId(pres, n, b.id)
          }} />
      )))}
      {/* A block of its own: a finisher, a cool-down. Last, under everything; its
          name and the rest are its ⋯. */}
      <Btn kind="quiet" icon="Plus" title="Add a block" style={{ alignSelf: 'flex-start', paddingHorizontal: space[1] }}
        onPress={() => { impact(); regroup((addBlock as any)(pres).pres) }} />
      {/* Only where there is nothing to be done about it: a session still being
          built is empty because the user has not started. */}
      {!total && !onAddPiece && (
        <T style={st.subp}>Nothing left in this workout. Add an exercise to a block, or a block.</T>
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
