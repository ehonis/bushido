/*
 * The prescription editor: a planned workout's blocks and their items, the one
 * editor both routes of Plan a workout end in (BuildStep, ReviewStep) and the
 * session sheet shows afterwards. One component, two places, because a second one
 * would drift (planner.jsx says why). Moved out of planner.jsx in #73, unchanged,
 * so the flow and the editor are separate files; mobile/src/features/editor.tsx is
 * its twin.
 */
import { useState } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  prescriptionSteps, itemLine, setLine, patchSet, addSet, removeSet, removeItem, patchItem,
  patchBlock, appendLift, moveItem, setCircuit, setTiming, circuitTiming,
} from './lib/prescription.js'
import { removalWords } from './lib/removal.js'
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
function PieceAdder({ unit, onAdd }) {
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
        <Icon name="Timer" size={15} /> <span>Add a swim set, interval or hold</span>
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
  const picked = categories.find(c => c.key === value) || null
  return (
    <details className="blockquota">
      <summary>
        <Icon name="Target" size={12} />
        <span>
          {picked ? <>A separate <strong>{picked.name}</strong> workout</> : 'Part of the workout beside it'}
        </span>
      </summary>
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
    </details>
  )
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

function CircuitBlock({ block: b, pres, onChange, onDrop, liftField, entries, entryId, open, onToggle, extra }) {
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
        <span className="presc-blockmeta"><span className="presc-blockn">{setCount(b)}</span></span>
      </div>
      {open && (
        <>
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
 * Every set, editable, with thumbs in mind.
 *
 * Steppers rather than keyboards for reps and weight: the numbers move in
 * predictable increments (a rep at a time, five pounds at a time) and a numeric
 * keyboard on a phone covers half the screen with the thing you are editing
 * underneath it. The value is still an input, so a genuinely odd number is one
 * tap and a type away.
 *
 * Shared by the review step and the session sheet on purpose. Editing a plan
 * the way a session is already edited means the same editor in both places, not
 * two that agree today.
 */
/**
 * Every set of a planned session, editable, with thumbs in mind.
 *
 * THE SAME COMPONENT THE LOG FORM USES, since 2026-09-21: planned and logged
 * workouts should look exactly the same, and where they differed the plan side
 * won. So the card,
 * the fold, the implement chips, the steppers, the picker and reorder mode all
 * live in `exercises.jsx` and this file only says what a BLOCK is. What is left
 * here is the one thing the log has no counterpart for: `BlockQuota`, which
 * decides where a session splits.
 *
 * Shared by the review step and the session sheet on purpose. Editing a plan
 * the way a session is already edited means the same editor in every place, not
 * several that agree today.
 */
export function PrescriptionEditor({
  pres, onChange: emit, liftField, entries = [], entryId = null, categories = [], compact = false,
  canReorder = true, onAddPiece = null, syncedWith = null,
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

  const total = prescriptionSteps(pres).length
  // ONE exercise starts open and it is the first in the SESSION, not the first in
  // each block — six open cards is four screens of steppers to scroll past.
  const firstItemId = (pres?.blocks || []).flatMap(b => b.items || [])[0]?.id || null

  const toggleBlock = (id) => setShut(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <div className={`presc ${compact ? 'compact' : ''}`}>
      {(pres.blocks || []).map(b => (b.circuit ? (
        <CircuitBlock key={b.id} block={b} pres={pres} onChange={onChange} onDrop={dropItem} liftField={liftField}
          entries={entries} entryId={entryId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={<>
            <CircuitSwitch on onChange={(on) => onChange(setCircuit(pres, b.id, on))} />
            <BlockQuota categories={categories} value={b.category}
              onChange={(key) => onChange(patchBlock(pres, b.id, { category: key }))} />
          </>} />
      ) : (
        <ExerciseSection key={b.id}
          title={b.name}
          count={b.items.length > 0 ? setCount(b) : null}
          items={b.items.map(it => ({ ...it, line: itemLine(it) }))}
          liftField={liftField} entries={entries} entryId={entryId}
          firstOpenId={firstItemId}
          open={!shut.has(b.id)} onToggle={() => toggleBlock(b.id)}
          extra={<>
            <CircuitSwitch on={false} onChange={(on) => onChange(setCircuit(pres, b.id, on))} />
            <BlockQuota categories={categories} value={b.category}
              onChange={(key) => onChange(patchBlock(pres, b.id, { category: key }))} />
          </>}
          /* The hand-built route only. A session the model wrote already has its
             intervals in it, and the place to change one is the card. */
          foot={onAddPiece
            ? <PieceAdder unit={distanceUnitFor(b)}
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
            const next = appendLift(pres, liftField, key, { blockId: b.id, entries, excludeId: entryId })
            onChange(next)
            return addedId(pres, next, b.id)
          }} />
      )))}
      {/* Only where there is nothing to be done about it. A session the user is still
          building is empty because the user has not started, and every block on the
          screen is already offering them the two ways in. */}
      {!total && !onAddPiece && (
        <p className="sub">Nothing left in this workout. Redo it, or close and start again.</p>
      )}
    </div>
  )
}

export { setLine }
