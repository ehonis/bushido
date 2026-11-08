/*
 * The prescription editor: a planned workout's blocks and their items, the one
 * editor both routes of Plan a workout end in (BuildStep, ReviewStep) and the
 * session sheet shows afterwards. One component, two places, because a second one
 * would drift (planner.jsx says why). Moved out of planner.jsx in #73, unchanged,
 * so the flow and the editor are separate files; mobile/src/features/editor.tsx is
 * its twin.
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  prescriptionSteps, itemLine, setLine, patchSet, addSet, removeSet, removeItem, patchItem,
  patchBlock, appendLift, moveItem, setCircuit, setTiming, circuitTiming,
  addBlock, renameBlock, noteBlock, removeBlock, moveBlock, tickSet, firstUnticked, splitPrescription,
} from './lib/prescription.js'
import { removalWords, syncLine } from './lib/removal.js'
import { ExerciseSection, useUndoable } from './exercises.jsx'
import { CircuitSteppers, CircuitList, SecondsRow } from './circuit.jsx'

/* ------------------------------------------------------------- the editor */

/**
 * A piece of work that is not a lift.
 *
 * Name it, say how it is MEASURED, add it. The shape is asked for up front
 * because an interval set shows the fields it carries and nothing else — see
 * `setFieldsFor` — so this is the one moment the answer is available.
 *
 * Folded behind a button of its own, beside the exercise catalogue's, rather than
 * sitting open under every block: on a lift day it is never the answer, and a
 * text box under each of six blocks is six text boxes the user is not going to use.
 */
/**
 * The piece button's words, from what the block is (#80): a Pull block offered
 * "Add a swim set, interval or hold". A swim block adds a swim set, a run or a
 * ride an interval, a lift or support block a hold; a block that names no
 * sport keeps the whole list. Read off the block's category, then its activity.
 */
export function pieceWords(block) {
  const kind = `${block?.category || ''} ${block?.activity || ''}`.toLowerCase()
  if (/swim/.test(kind)) return 'Add a swim set'
  if (/run|bike|ride|row|ski|cardio|endurance/.test(kind)) return 'Add an interval'
  if (/lift|support|strength|core|mobility|climb/.test(kind)) return 'Add a hold or timed exercise'
  return 'Add a swim set, interval or hold'
}

function PieceAdder({ unit, onAdd, label = pieceWords(null) }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [by, setBy] = useState('time')

  const add = () => {
    const said = name.trim()
    if (!said) return
    onAdd(said, by, unit)
    setName('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button className="presc-add" onClick={() => setOpen(true)}>
        <Icon name="Timer" size={15} /> <span>{label}</span>
      </button>
    )
  }

  return (
    <div className="pieceadd">
      <div className="pieceadd-row">
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          aria-label="What the piece is called"
          placeholder="easy spin, 400s, hollow hold…"
          onKeyDown={e => { if (e.key === 'Enter') add() }} />
        <button className="modal-btn" onClick={() => { setOpen(false); setName('') }}
          aria-label="Close"><Icon name="X" size={16} /></button>
      </div>
      <div className="pieceadd-by">
        {[['time', 'by time'], ['distance', 'by distance'], ['reps', 'by reps']].map(([k, lbl]) => (
          <button key={k} className={`implchip ${by === k ? 'on' : ''}`}
            onClick={() => setBy(k)} aria-pressed={by === k}>{lbl}</button>
        ))}
        <button className="btn" disabled={!name.trim()} onClick={add}>Add</button>
      </div>
    </div>
  )
}

/**
 * Which category a BLOCK is — and therefore where the session SPLITS.
 *
 * Each workout in the session has its own category, not the session as a whole:
 * a run and a lift land as two entries, each with its own log and its own place
 * for the watch to attach to. (Until 2026-10-25 this was also which weekly quota
 * the block filled; the quotas are gone, the split stays.)
 *
 * `none` is a real answer and the default for a warm-up: a block that is not a
 * workout in its own right belongs to the one beside it.
 */
function BlockQuota({ categories, value, onChange }) {
  if (!categories.length) return null
  return (
    <div className="blockquota" role="group" aria-label="Where this block lands">
      <span className="blockmenu-label">Where it lands: part of the workout beside it, or a separate one</span>
      <div className="blockquota-chips">
        <button className={`implchip ${!value ? 'on' : ''}`}
          onClick={() => onChange(null)} aria-pressed={!value}>
          Part of the workout beside it
        </button>
        {categories.map(c => (
          <button key={c.key} className={`implchip ${value === c.key ? 'on' : ''}`}
            onClick={() => onChange(c.key)} aria-pressed={value === c.key}>
            <Icon name={c.icon} size={13} /> {c.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * What a block's head says of its settings (#79), since the controls moved into
 * its ⋯: "Circuit", and where it lands. The split is never hidden (G F8): once
 * the workout really splits (`landsOf`), every block says which it is, "A
 * separate Lift workout" or "Part of the workout beside it". A workout that
 * lands as one entry says nothing about it.
 */
export function blockTag(block, pres, categories = []) {
  const lands = categories.length ? landsOf(pres).get(block?.id) : null
  const cat = lands === 'own' ? categories.find(c => c.key === block.category) : null
  const words = cat ? `A separate ${cat.name} workout` : lands === 'beside' ? 'Part of the workout beside it' : null
  return [block?.circuit ? 'Circuit' : null, words].filter(Boolean).join(' · ') || null
}

/**
 * Where each block lands, by `splitPrescription`'s own rule: nothing when the
 * workout stays one entry; otherwise the block that opens a workout of its
 * category is `own`, and every other block (a warm-up, a second block of the
 * same category that merges into it) is `beside`.
 */
export function landsOf(pres) {
  const out = new Map()
  if (splitPrescription(pres).length < 2) return out
  let open = null
  for (const b of pres.blocks || []) {
    const own = Boolean(b.category) && b.category !== open
    if (b.category) open = b.category
    out.set(b.id, own ? 'own' : 'beside')
  }
  return out
}

/**
 * What a distance in THIS block is measured in.
 *
 * A pool is yards here (see the planner's own prompt, which writes swims that
 * way); everything else that covers ground is miles, which is what Strava hands
 * back and therefore what every other distance in this app already is. It is a
 * default on a box the user can retype, not a conversion.
 */
const distanceUnitFor = (block) => (/swim/i.test(block?.activity || '') ? 'yd' : 'mi')

/** "1 set", "6 sets" — the header count. It read "1 sets" until 2026-09-22. A circuit counts rounds. */
const setCount = (block) => {
  if (block?.circuit) return `${block.circuit.rounds} round${block.circuit.rounds === 1 ? '' : 's'}`
  const n = (block?.items || []).reduce((sum, i) => sum + i.sets.length, 0)
  return `${n} set${n === 1 ? '' : 's'}`
}

/**
 * Any block can be a circuit (issue #68): its exercises one after another on
 * the interval timer, which is what Start runs. A switch, because it is on or
 * off, with the words beside it.
 */
function CircuitSwitch({ on, onChange }) {
  return (
    <label className="cx-switch">
      <span className="cx-switchwords">
        <span>Circuit</span>
        <span className="sub">Timed, one exercise after another</span>
      </span>
      <input type="checkbox" role="switch" className="switch" checked={on}
        onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

/**
 * A block switched to Circuit: the same head and fold as any block, then the
 * circuit's timing in one row, its exercises in order with their own timing
 * behind a tap (circuit.jsx), and the two settings people rarely change folded.
 */
/** "10 lb": a circuit exercise's planned weight, which its logged rows carry. */
const loadOf = (it) => {
  const w = it.sets?.[0]?.weight
  return w !== null && w !== undefined && w !== '' ? `${w} ${it.weightLabel || 'lb'}` : null
}

function CircuitBlock({ block: b, pres, onChange, onDrop, liftField, entries, entryId, open, onToggle, extra, menu = null, tag = null, lead = null }) {
  const [more, setMore] = useState(false)
  const c = b.circuit
  const items = b.items.map(it => ({ id: it.id, key: it.exercise, name: it.name, timing: circuitTiming(it), load: loadOf(it) }))
  const timing = (next) => onChange(patchBlock(pres, b.id, { circuit: { ...c, ...next } }))
  return (
    <div className={`presc-block cx-block ${open ? '' : 'shut'}`}>
      <div className="presc-blockhead">
        <button className="presc-blocktoggle" onClick={onToggle} aria-expanded={open}>
          <span className={`alt-chev ${open ? 'open' : ''}`}><Icon name="ChevronDown" size={14} /></span>
          <h3>{b.name}</h3>
        </button>
        <span className="presc-blockmeta">
          {tag && <span className="presc-blocktag">{tag}</span>}
          <span className="presc-blockn">{setCount(b)}</span>
          {menu && menu({ reorder: null })}
        </span>
      </div>
      {open && (
        <>
          {lead}
          {extra}
          <CircuitSteppers circuit={c} onChange={timing} />
          <button type="button" className="btn quiet it-more" aria-expanded={more} onClick={() => setMore(!more)}>
            <Icon name="ChevronDown" size={16} style={{ transform: more ? 'rotate(180deg)' : 'none' }} />
            {more ? 'Fewer options' : 'More options'}
          </button>
          {more && (
            <div className="it-rows cx-more">
              <SecondsRow label="Rest between rounds" value={c.roundRest} onChange={v => timing({ roundRest: v })} />
              <SecondsRow label="Get ready" value={c.countIn} max={60} onChange={v => timing({ countIn: v })} />
            </div>
          )}
          <CircuitList items={items} work={c.work} liftField={liftField}
            onTiming={(i, t) => onChange(setTiming(pres, items[i].id, t))}
            onRemove={(i) => onDrop(items[i].id)}
            onMove={(i, dir) => onChange(moveItem(pres, items[i].id, dir).pres)}
            onAdd={(key) => onChange(appendLift(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId }))} />
        </>
      )}
    </div>
  )
}


/**
 * A BLOCK'S OWN SETTINGS, behind its ⋯ (#79). Every block used to carry a
 * full-width Circuit switch and the "Part of the workout beside it" fold, even
 * a run and an empty warm-up, so before the first set of a planned Pull came
 * two rows of planning per block (C F14, G F8). They live here now, with what
 * a block could not do at all before: be renamed, given a note, moved, removed.
 * The head keeps one word of it (`blockTag`). Opens in place under the head,
 * one at a time; Remove is last, apart from the rest, and has Undo.
 */
export function BlockMenu({
  block: b, first, last, only, categories = [], onRename, onNote, onCircuit, onQuota,
  onReorder = null, onMove, onRemove, onClose,
}) {
  const [name, setName] = useState(b.name)
  useEffect(() => setName(b.name), [b.name])
  const commit = () => { if (name.trim() && name.trim() !== b.name) onRename(name); else setName(b.name) }
  return (
    <div className="blockmenu" role="group" aria-label={`${b.name}: block options`}>
      <label className="field blockmenu-name">
        <span>Name</span>
        <input value={name} onChange={e => setName(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
      </label>
      <div className="list blockmenu-list">
        <button type="button" className="list-row" onClick={onNote}>
          <Icon name="NotebookPen" size={18} />
          <span className="list-row-main"><span className="list-row-title">{b.note ? 'Edit the note' : 'Add a note'}</span></span>
        </button>
        {onReorder && (
          <button type="button" className="list-row" onClick={onReorder}>
            <Icon name="ArrowUpDown" size={18} />
            <span className="list-row-main"><span className="list-row-title">Reorder exercises</span></span>
          </button>
        )}
        {!first && (
          <button type="button" className="list-row" onClick={() => onMove('up')}>
            <Icon name="ArrowUp" size={18} />
            <span className="list-row-main"><span className="list-row-title">Move block up</span></span>
          </button>
        )}
        {!last && (
          <button type="button" className="list-row" onClick={() => onMove('down')}>
            <Icon name="ArrowDown" size={18} />
            <span className="list-row-main"><span className="list-row-title">Move block down</span></span>
          </button>
        )}
      </div>
      <CircuitSwitch on={Boolean(b.circuit)} onChange={onCircuit} />
      <BlockQuota categories={categories} value={b.category} onChange={onQuota} />
      <div className="blockmenu-foot">
        {!only && (
          <button type="button" className="btn quiet blockmenu-rm" onClick={onRemove}>
            <Icon name="Trash2" size={16} /> Remove block
          </button>
        )}
        <button type="button" className="btn secondary blockmenu-done" onClick={onClose}>
          <Icon name="Check" size={16} /> Done
        </button>
      </div>
    </div>
  )
}

/**
 * A block's note: the warm-up the model wrote as prose ("5 min easy bike, then
 * leg swings"), which the editor never showed, so a warm-up read as an empty
 * block (C F8). Read under the head; a box while it is being written, which is
 * always in planning and in doing only when asked for from the ⋯ (`editing`).
 */
/**
 * A note being written: its text is held, not stored, until the box is left or
 * the sheet closes (`leave`). Stored per keystroke, `noteBlock`'s trim ate the
 * space being typed ("…aparts then rows" became "…apartsthenrows").
 */
export function noteDraft(commit) {
  let pending = null
  return {
    type: (v) => { pending = v },
    held: () => pending !== null,
    leave: () => {
      if (pending === null) return
      const v = pending
      pending = null
      commit(v)
    },
  }
}

function BlockNote({ note, editing, asked = false, onCommit, onFocus, onDone }) {
  const [text, setText] = useState(note || '')
  const commit = useRef(onCommit)
  commit.current = onCommit
  const draft = useRef(null)
  if (!draft.current) draft.current = noteDraft((v) => commit.current(v))
  useEffect(() => { if (!draft.current.held()) setText(note || '') }, [note])
  // The sheet closing under the box stores what was written.
  useEffect(() => () => draft.current.leave(), [])
  if (!editing) return note ? <p className="presc-blocknote">{note}</p> : null
  return (
    <div className="presc-blocknote-edit">
      <textarea rows={2} value={text} aria-label="Block note" placeholder="A note: a warm-up, a cue, how to pace it"
        autoFocus={asked} onFocus={onFocus} onBlur={() => { draft.current.leave(); onDone?.() }}
        onChange={e => { draft.current.type(e.target.value); setText(e.target.value) }} />
    </div>
  )
}

/**
 * The id of the exercise `appendLift` just put at the end of block `blockId`.
 * Found by the block's PLACE, which re-minting keeps, never by its name: two
 * blocks called "Main" opened the wrong card (#78, C F17).
 */
export function addedId(before, next, blockId) {
  const at = (before?.blocks || []).findIndex(x => x.id === blockId)
  const block = next?.blocks?.[at] || next?.blocks?.[0]
  return block?.items?.at(-1)?.id || null
}

/**
 * Every set of a planned session, editable, with thumbs in mind.
 *
 * THE SAME COMPONENT THE LOG FORM USES, since 2026-09-21: planned and logged
 * workouts should look exactly the same, and where they differed the plan side
 * won. So the card, the fold, the implement chips, the steppers, the picker and
 * reorder mode all live in `exercises.jsx` and this file only says what a BLOCK
 * is: its menu (`BlockMenu`, #79), its note, and where the session splits.
 *
 * Shared by the review step and the session sheet on purpose. Editing a plan
 * the way a session is already edited means the same editor in every place, not
 * several that agree today.
 *
 * `doing` (#79, D9): the session sheet of a planned workout on its day or
 * after, where lifting is done. One exercise opens, the first with a set still
 * to do (`firstUnticked`), and the next opens as it is finished; every set has
 * a ✓ (`tickSet`, the log); the cards drop what is planning (exercises.jsx).
 * `asWritten`: a done plan whose day has passed, where every set with a number
 * is already the log (`liftsDone`), so its ✓s are read, not toggled.
 * Block settings are the ⋯ in both modes.
 */
export function PrescriptionEditor({
  pres, onChange: emit, liftField, entries = [], entryId = null, categories = [], compact = false,
  canReorder = true, onAddPiece = null, syncedWith = null, doing = false, asWritten = false,
}) {
  // Every write goes through `onChange`; a removal through `remove`, which offers
  // Undo (#77). `syncedWith` names the other sides of a synced workout, for the
  // toast's one line about them (lib/removal.js: it never claims what happened there).
  const { change: onChange, remove } = useUndoable(pres, emit)
  const itemOf = (id) => (pres?.blocks || []).flatMap(b => b.items || []).find(it => it.id === id)
  const dropSet = (id, setId) => {
    const it = itemOf(id)
    remove(removeSet(pres, id, setId), removalWords(it, (it?.sets || []).findIndex(s => s.id === setId), { syncedWith }))
  }
  const dropItem = (id) => remove(removeItem(pres, id), removalWords(itemOf(id), null, { syncedWith }))
  const [shut, setShut] = useState(() => new Set())  // blockIds folded away
  // The block whose ⋯ is open (one at a time), and the one whose note is being written.
  const [menuFor, setMenuFor] = useState(null)
  const [noteFor, setNoteFor] = useState(null)

  const total = prescriptionSteps(pres).length
  const blocks = pres.blocks || []
  // ONE exercise starts open. Planning: the first in the SESSION, not the first in
  // each block — six open cards is four screens of steppers to scroll past.
  // Doing: the first with a set still to do, which is where the workout is.
  const allItems = blocks.flatMap(b => b.items || [])
  const next = doing ? firstUnticked(pres, asWritten) : null
  const firstItemId = doing ? next : allItems[0]?.id || null

  const toggleBlock = (id) => setShut(s => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  // A block op renumbers blocks, so what is folded or open is let go rather than
  // left pointing at whichever block took its place.
  const regroup = (p) => { setShut(new Set()); setMenuFor(null); setNoteFor(null); onChange(p) }
  const dropBlock = (b) => {
    const words = `Removed ${b.name}`
    setMenuFor(null)
    setShut(new Set())
    remove(removeBlock(pres, b.id), syncedWith?.length ? `${words}. ${syncLine(syncedWith)}` : words)
  }

  const menuOf = (b) => () => (
    <button type="button" className={`iconbtn presc-blockmore ${menuFor === b.id ? 'on' : ''}`}
      aria-expanded={menuFor === b.id} aria-label={`${b.name}: block options`}
      onClick={() => setMenuFor(menuFor === b.id ? null : b.id)}>
      <Icon name="Ellipsis" size={18} />
    </button>
  )
  // Under the head: the open ⋯ (handed the section's Reorder) and the block's note.
  const leadOf = (b, bi) => ({ reorder = null } = {}) => (
    <>
      {menuFor === b.id && (
        <BlockMenu block={b} first={bi === 0} last={bi === blocks.length - 1} only={blocks.length === 1}
          categories={categories}
          onRename={(name) => onChange(renameBlock(pres, b.id, name))}
          onNote={() => { setNoteFor(b.id); setMenuFor(null) }}
          onCircuit={(on) => onChange(setCircuit(pres, b.id, on))}
          onQuota={(key) => onChange(patchBlock(pres, b.id, { category: key }))}
          onReorder={reorder ? () => { setMenuFor(null); reorder() } : null}
          onMove={(dir) => { const r = moveBlock(pres, b.id, dir); regroup(r.pres); setMenuFor(r.blockId) }}
          onRemove={() => dropBlock(b)}
          onClose={() => setMenuFor(null)} />
      )}
      {/* Planning shows a note as its box; doing reads it, and the ⋯ opens the box. */}
      <BlockNote note={b.note} editing={noteFor === b.id || (!doing && Boolean(b.note))} asked={noteFor === b.id}
        onCommit={(v) => onChange(noteBlock(pres, b.id, v))}
        onFocus={() => setNoteFor(b.id)} onDone={() => setNoteFor(null)} />
    </>
  )

  return (
    <div className={`presc ${compact ? 'compact' : ''} ${doing ? 'doing' : ''}`}>
      {blocks.map((b, bi) => (b.circuit ? (
        <CircuitBlock key={b.id} block={b} pres={pres} onChange={onChange} onDrop={dropItem} liftField={liftField}
          entries={entries} entryId={entryId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          menu={menuOf(b)} tag={blockTag(b, pres, categories)} lead={leadOf(b, bi)()} />
      ) : (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map(it => ({ ...it, line: itemLine(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          menu={menuOf(b)} tag={blockTag(b, pres, categories)} lead={leadOf(b, bi)}
          doing={doing} asWritten={asWritten} focusId={next}
          onTick={doing ? (id, setId, v) => onChange(tickSet(pres, id, setId, v)) : null}
          /* The hand-built route only. A session the model wrote already has its
             intervals in it, and the place to change one is the card. */
          foot={onAddPiece
            ? <PieceAdder unit={distanceUnitFor(b)} label={pieceWords(b)}
                onAdd={(name, by, unit) => onAddPiece(b.id, name, by, unit)} />
            : null}
          onPatch={(id, patch) => onChange(patchItem(pres, id, patch))}
          onPatchSet={(id, setId, patch) => onChange(patchSet(pres, id, setId, patch))}
          onAddSet={(id) => onChange(addSet(pres, id))}
          onRemoveSet={dropSet}
          onRemove={dropItem}
          onMove={canReorder ? (id, dir) => {
            const r = moveItem(pres, id, dir)
            onChange(r.pres)
            return r.itemId
          } : null}
          /* Same as the log form: the exercise the user just added opens. `appendLift`
             re-mints every id, and the new one is always last in its block. */
          onAdd={(key) => {
            const n = appendLift(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId })
            onChange(n)
            return addedId(pres, n, b.id)
          }} />
      )))}
      {/* A block of its own: a finisher, a cool-down. Last, under everything, and
          its name and the rest are its ⋯, opened for it. */}
      <button type="button" className="btn quiet presc-addblock"
        onClick={() => { const r = addBlock(pres); regroup(r.pres); setMenuFor(r.blockId) }}>
        <Icon name="Plus" size={16} /> Add a block
      </button>
      {/* Only where there is nothing to be done about it. A session the user is still
          building is empty because the user has not started, and every block on the
          screen is already offering them the two ways in. */}
      {!total && !onAddPiece && (
        <p className="sub">Nothing left in this workout. Add an exercise to a block, or a block.</p>
      )}
    </div>
  )
}

export { setLine }
