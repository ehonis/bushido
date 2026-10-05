/*
 * Post-session capture. Appears once you've logged a session.
 *
 * Kept deliberately short — six fields at most, sliders default to sensible
 * values, and it saves on every change rather than behind a submit button. A
 * form you skip because it's tedious produces worse data than no form.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { Modal } from './modal.jsx'
import { SetLog, GradeSelect, totalSets, totalReps } from './setlog.jsx'
import { LiftLog } from './liftlog.jsx'
import { ActivityPicker } from './activitypicker.jsx'
import { liftSets, liftReps, liftsLine } from './lib/lifts.js'
import { asksItsOwnDuration, minutesFor, minutesSourceOf } from './lib/minutes.js'
import { visibleOutputs, pruneHidden, derivedValue, filledBy } from './lib/outputs.js'
import { gateResolver } from './lib/activities.js'
import { usePlan } from './lib/planctx.jsx'
import { quickNames, titleOf, nameFor, rename, titleFor } from './lib/naming.js'
import { GearPicker } from './gearpicker.jsx'
import { WhoopWorkouts } from './whoop.jsx'
import { StravaActivities } from './strava.jsx'

/* --------------------------------------------------------------- notes --- */

/**
 * Every previous time you did THIS session and wrote something down, newest
 * first. The point of writing "grip kept opening on the last circuit" is being
 * shown it again before the next one, so this is what the repeat lookup reads.
 */
export function priorSessions(entries, session, excludeId) {
  const ids = priorIdsOf(session)
  if (!ids.length) return []
  return (entries || [])
    .filter(e => e.kind === 'daily' && !e.deleted && ids.includes(e.data?.optId) && e.id !== excludeId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
}

/**
 * Which optIds count as "this session", for history.
 *
 * A card's own id, plus the ids it has ANSWERED TO — `aka` (a rename) and
 * `priorIds` (a card this one was split out of).
 *
 * Opening repeaters did not show the last repeaters workout, because max hangs
 * AND repeaters were one card (`hard-home`) until 2026-08-10, so every repeaters session before
 * that date is stored under an id this lookup had never heard of. The charts have
 * always read both (`loadSeries(['max-hangs', 'hard-home'])`); this did not, so
 * the one place the history is meant to be useful — while you are standing there
 * about to do it again — was the one place it was truncated.
 *
 * Content, not code: the ids live on the card in plan.json, the same way the
 * rename does, because which card a card used to be is a fact about the program.
 */
export function priorIdsOf(session) {
  if (!session?.id) return []
  return [session.id, ...(session.aka || []), ...(session.priorIds || [])]
}

const dayLabel = (iso) => {
  const days = Math.round((Date.now() - new Date(`${iso}T12:00:00`)) / 86400000)
  if (days <= 0) return 'earlier today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return iso
}

/** "3 sets, 21 reps · 5.10+" — what the session itself was, off what was logged. */
function priorWork(out) {
  const bits = []
  const sets = totalSets(out)
  const reps = totalReps(out)
  if (sets) bits.push(`${sets} set${sets === 1 ? '' : 's'}${reps ? `, ${reps} reps` : ''}`)
  const lifting = liftsLine(out)
  if (lifting) bits.push(lifting)
  if (Number(out?.distance) > 0) bits.push(`${out.distance} mi`)
  if (Number(out?.minutesSpent) > 0) bits.push(`${out.minutesSpent} min`)
  return bits.join(' · ')
}

/**
 * The last time you did this, surfaced BEFORE you do it again.
 *
 * TWO CHANGES on 2026-09-21, both from opening repeaters and seeing nothing. First, the ids: a card that was split out of another one reads the
 * older one's entries too — see `priorIdsOf`. Second, A SESSION WITH NOTHING
 * WRITTEN ON IT IS STILL A SESSION. This used to filter to entries carrying free
 * text, so the last four repeaters nights — every one of them logged, with sets
 * and loads on them, and none of them commented on — rendered as no history at
 * all. What the user is looking for before a hangboard session is what the user hung last
 * time, and that is on the entry whether or not the user also had something to say.
 */
export function PriorNote({ entries, session, excludeId, all = false }) {
  const prior = priorSessions(entries, session, excludeId)
  if (!prior.length) return null
  const shown = all ? prior.slice(0, 5) : prior.slice(0, 1)
  const noted = prior.filter(e =>
    String(e.data?.out?.notes || '').trim() || String(e.data?.out?.improve || '').trim())

  return (
    <div className="prior">
      <div className="prior-head">
        <Icon name="Repeat" size={13} />
        {all
          ? `Your last ${shown.length} session${shown.length === 1 ? '' : 's'}${noted.length ? '' : ' — nothing written down yet'}`
          : 'Last time you did this'}
      </div>
      {shown.map(e => {
        const work = priorWork(e.data?.out)
        return (
          <div key={e.id} className="prior-item">
            <div className="prior-when">
              {dayLabel(e.date)}
              {Number.isFinite(e.data?.out?.rpe) && <span> · RPE {e.data.out.rpe}</span>}
              {Number.isFinite(e.data?.out?.fingers) && <span> · fingers {e.data.out.fingers}/5</span>}
            </div>
            {work && <p className="prior-work">{work}</p>}
            {e.data?.out?.notes && <p className="prior-felt">{e.data.out.notes}</p>}
            {e.data?.out?.improve && (
              <p className="prior-improve"><strong>To improve:</strong> {e.data.out.improve}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Free text saves on a timer rather than per keystroke — the store rewrites its
 * whole localStorage cache on every commit, and a season of entries is not
 * something you want re-serialised once per letter.
 */
function NoteField({ label, hint, value, onCommit }) {
  const [draft, setDraft] = useState(value ?? '')
  const commit = useRef(onCommit)
  commit.current = onCommit

  useEffect(() => {
    if (draft === (value ?? '')) return
    const t = setTimeout(() => commit.current(draft), 400)
    return () => clearTimeout(t)
  }, [draft, value])

  return (
    <label className="notefield">
      <span className="notefield-label">{label}</span>
      <textarea rows={3} value={draft} placeholder={hint}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (value ?? '')) commit.current(draft) }} />
    </label>
  )
}

function Slider({ field, value, onChange }) {
  const v = value ?? field.default
  const pct = ((v - field.min) / (field.max - field.min)) * 100
  return (
    <div className="out-field">
      <div className="out-label">
        <span>{field.label}</span>
        <span className="out-value">{v}</span>
      </div>
      <input
        type="range" min={field.min} max={field.max} step={field.step} value={v}
        onChange={e => onChange(Number(e.target.value))}
        style={{ '--pct': `${pct}%` }}
        className="slider"
      />
      {field.scale && (
        <div className="out-scale">
          {field.scale.map((s, i) => <span key={i}>{s}</span>)}
        </div>
      )}
    </div>
  )
}

/**
 * Rename this one workout — mostly by tapping.
 *
 * A single workout can be renamed, with quick-name chips so most renames need no
 * typing. So the box is here for the specific case and the
 * chips are the answer for everything else; the vocabulary is content, per
 * discipline (`quickNames` in plan.json).
 *
 * Four decisions worth not undoing.
 *
 * **Blank is not nameless.** The box is EMPTY until the user names it and the name the
 * session already has is its placeholder, which is the rule the whole app follows
 * for a value the app worked out (see `TimeSpent`): a pre-filled "Bike" is a
 * string the user would confirm without reading, and clearing the box has to be how you
 * get the default back.
 *
 * **Tapping the live chip clears it**, same as `Choice`, because the fastest
 * correction of a name picked by mistake is the chip the user just pressed.
 *
 * **The overflow is a `<details>`, not a slice.** Ten names is more than a phone
 * shows at 44px, and hiding the tail behind a "show more" that does not RENDER it
 * is how a name becomes unreachable and invisible to the render suite — the same
 * argument as the folded sport catalogs in the planner.
 *
 * **It is app-level**, like gear, time spent and the notes: it applies to
 * anything the user can log, so the plan is never asked to remember to offer it.
 */
const NAMES_SHOWN = 6

export function NameField({ session, out, onChange }) {
  const plan = usePlan()
  const mine = titleOf(out)
  const [draft, setDraft] = useState(mine || '')
  const commit = useRef(onChange)
  commit.current = onChange

  // Typed text commits on a pause, not per keystroke — the store re-serialises
  // its whole cache on every commit. Same reason as `NoteField`.
  useEffect(() => {
    if (draft === (mine || '')) return
    const t = setTimeout(() => commit.current(draft), 400)
    return () => clearTimeout(t)
  }, [draft, mine])

  // A name that arrived from somewhere else — a chip, or the "just miles" box
  // writing "Commute" — belongs in the box the user is looking at.
  useEffect(() => { setDraft(mine || '') }, [mine])

  const names = quickNames(plan, session, out)
  const otherwise = nameFor(session, { ...out, title: undefined }) || session?.name || ''
  const pick = (name) => { setDraft(name === mine ? '' : name); commit.current(name === mine ? '' : name) }

  const chip = (name) => (
    <button key={name} type="button" className={`out-chip ${name === mine ? 'on' : ''}`}
      aria-pressed={name === mine} onClick={() => pick(name)}>
      <span>{name}</span>
    </button>
  )

  return (
    <div className="out-field out-name">
      <div className="out-label">
        <span>Name</span>
        {mine && otherwise && (
          <button type="button" className="out-name-reset" onClick={() => pick(mine)}>
            use “{otherwise}”
          </button>
        )}
      </div>
      <input className="out-name-box" type="text" value={draft} placeholder={otherwise}
        maxLength={60} enterKeyHint="done"
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { if (draft !== (mine || '')) commit.current(draft) }} />
      {names.length > 0 && (
        <>
          <div className="out-choices">{names.slice(0, NAMES_SHOWN).map(chip)}</div>
          {names.length > NAMES_SHOWN && (
            <details className="out-name-more">
              <summary>{names.length - NAMES_SHOWN} more</summary>
              <div className="out-choices">{names.slice(NAMES_SHOWN).map(chip)}</div>
            </details>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Pick one of a fixed set — "what did you actually do today". Tapping the
 * selected chip again clears it, because a card whose whole point is being
 * open-ended must not force an answer it doesn't have.
 */
function Choice({ field, value, onChange }) {
  return (
    <div className="out-field">
      <div className="out-label"><span>{field.label}</span></div>
      <div className="out-choices">
        {(field.options || []).map(o => {
          const on = value === o.value
          return (
            <button key={o.value} type="button" className={`out-chip ${on ? 'on' : ''}`}
              aria-pressed={on} onClick={() => onChange(on ? undefined : o.value)}>
              {o.icon && <Icon name={o.icon} size={14} />}
              <span>{o.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * How long it actually took.
 *
 * The field is never PRE-FILLED with a number the user did not give — a pre-filled 150
 * is a number you confirm without reading, and confirming the plan is what this
 * exists to stop. But blank does not mean unknown either: whatever source is
 * currently winning is shown as the placeholder and named underneath, so the
 * number the load chart is actually multiplying by is on screen rather than
 * implied. Attaching a WHOOP workout therefore sets the session's length outright,
 * with nothing to confirm; typing over it wins, and clearing the box hands it back.
 *
 * The order lives in lib/minutes.js and is read here rather than restated, so the
 * sentence under the box cannot drift from the number the chart uses.
 */
function TimeSpent({ session, out, onChange }) {
  const value = out?.minutesSpent
  const source = minutesSourceOf(session, out)
  const inUse = Number(minutesFor(session, out))
  const measured = Number(out?.elapsedMin)

  const hint = {
    typed: 'This is what the weekly training-load chart multiplies your RPE by.',
    whoop: `Using the ${inUse} min WHOOP recorded. Type to change it.`,
    strava: `Using the ${inUse} min moving on the Strava activity you attached. Type to change it.`,
    timer: `Using the ${inUse} min workout mode measured. Type to change it.`,
    estimate: Number.isFinite(inUse)
      ? `Blank uses the card's ${inUse} min estimate. The weekly load chart is RPE × this, so a night that ran short or long is worth a second here.`
      : 'The weekly load chart is RPE × this.',
  }[source]

  return (
    <div className="out-field out-spent">
      <div className="out-label">
        <span>Time spent</span>
        <span className="out-value">min</span>
      </div>
      <div className="spent-row">
        <input
          type="number" inputMode="numeric" min="0" step="1"
          placeholder={Number.isFinite(inUse) ? String(inUse) : ''}
          aria-label="Time spent, in minutes"
          value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
        {/* The one number that is measured but NOT winning. Offered as a tap rather
            than described, because it is the only thing here the user might want and
            cannot see — everything else is already in the box or in the sentence. */}
        {(source === 'whoop' || source === 'strava') && Number.isFinite(measured) && measured > 0 && Math.round(measured) !== inUse && (
          <button type="button" className="spent-use" onClick={() => onChange(Math.round(measured))}>
            use {Math.round(measured)} from the timer instead
          </button>
        )}
      </div>
      <p className="spent-hint">{hint}</p>
    </div>
  )
}

/**
 * WHAT THIS SESSION WAS, as opposed to how it went: its name, what it was done
 * on, whether it was training at all, and how long it took.
 *
 * Everything below the WHOOP and Strava sections (except notes and how hard it
 * was) lives in the edit modal. Every one of these is a thing you set once and then leave — and all four sat between the
 * measurements the user opens the sheet to look at and the note the user opens it to write.
 *
 * It is a PANEL and not a screen, so the two sheets that have one (the day's
 * session sheet and the log feed's) open the same thing behind the same pencil
 * rather than growing a version each.
 *
 * `onTraining` is absent where the question is nonsense — a commute is a ride,
 * not a set of max hangs — and then the toggle simply is not there.
 */
export function SessionDetails({ session, entry, entries, onSave, training, onTraining = null }) {
  const out = entry?.data?.out || {}
  // Pruned on the way in exactly as the form does it, so a value corrected here
  // cannot leave a hidden field's answer behind. See lib/outputs.js.
  const derive = useMemo(() => gateResolver(session), [session])
  const set = (key, value) => onSave(pruneHidden(session, { ...out, [key]: value }, derive))

  return (
    <div className="out-body sessdetails">
      {/*
        * Blank is not nameless: the box is EMPTY with the session's current name
        * as its placeholder, so clearing it hands the default back. See NameField.
        */}
      <NameField session={session} out={out} onChange={v => onSave(rename(out, v))} />

      {/*
        * What it was done on. App-level rather than declared per session, because
        * gear applies to every workout and a plan that had to remember to ask
        * would forget. Renders nothing at all for a session whose discipline uses
        * no gear — a dance class is never asked which bike it was on.
        */}
      <GearPicker session={session} out={out} entries={entries}
        onChange={v => set('gear', v)} />

      {/*
        * Training, or just activity? `training: false` keeps the miles, the gear
        * and the streak, and takes it out of the quota and the training load.
        */}
      {onTraining && (
        <label className="out-toggle out-casual">
          <input type="checkbox" checked={training === false}
            onChange={e => onTraining(!e.target.checked)} />
          <span>
            Just miles — not a workout
            <em>Counts the distance and the streak. Not the quota, not the training load.</em>
          </span>
        </label>
      )}

      {/*
        * How long it actually took — the number the weekly load chart multiplies
        * RPE by. Never pre-filled: whatever source is winning is the PLACEHOLDER
        * and is named underneath. A session that asks for its own duration does
        * not also get this box.
        */}
      {!asksItsOwnDuration(session) && (
        <TimeSpent session={session} out={out} onChange={v => set('minutesSpent', v)} />
      )}
    </div>
  )
}

/**
 * What this session WAS, on its own layer, opened by the pencil beside the X.
 *
 * Started as the name box alone on 2026-09-21 — a modal on top of the sheet,
 * opened by a pencil next to the X — and grew the rest the same day: everything
 * below the WHOOP and Strava sections except notes and effort. Which is the same
 * argument twice. Each of those four fields is set once
 * and then left, and all four sat between the measurements the user opens the sheet to
 * check and the note the user opens it to write.
 *
 * A Modal on top of a Modal works because `useModalLayer` counts rather than
 * flags: the first one to close must not unlock the page under the second.
 */
export function DetailsSheet({
  session, entry, entries, onSave, onClose, training, onTraining = null,
}) {
  return (
    <Modal title="Edit this workout"
      sub={titleFor(session, entry?.data?.out, entry?.data?.plan)}
      icon="Pencil" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Done</button>}>
      <SessionDetails session={session} entry={entry} entries={entries} onSave={onSave}
        training={training} onTraining={onTraining} />
    </Modal>
  )
}

/** `bare` drops the collapse header — the log feed's sheet is already the form. */
export function SessionLog({
  session, entry, entries, onSave, bare = false,
  defaultOpen = false,
}) {
  const declared = session?.outputs || []
  const hasSets = Boolean(session?.logSpec?.exercises?.length)
  /*
   * Collapsed by default, because on a real session the protocol is what you
   * open the sheet to read and the form is what you fill in afterwards.
   *
   * `defaultOpen` is for the cards where that is backwards — the workout card has
   * no protocol worth reading and the form IS the card. It used to open itself in
   * practice, because the first field was the activity question and answering it
   * was the only way in; since 2026-09-17 the activity is picked before the card
   * opens, so without this the fields the user came for sit behind a tap.
   */
  const [open, setOpen] = useState(defaultOpen)
  const out = entry?.data?.out || {}

  // Notes are app-level, not plan-level: every session gets them, including the
  // ones with no measurable outputs at all.
  if (!declared.length && !hasSets && !entry) return null

  // Which fields are questions today. On the free-form cards the answer to the
  // first one decides that: miles and incline are the point of a run and noise
  // on a bench-press day. See lib/outputs.js.
  // The catalog resolver, so a field may gate on what the CATALOG says about the
  // picked activity (`shape`, `elevation`, `incline`) rather than on a list of
  // ninety-one activity keys. Null for every session that is not the workout
  // card, and then every gate reads only what the user answered — see lib/outputs.js.
  const derive = useMemo(() => gateResolver(session), [session])
  const fields = visibleOutputs(session, out, derive)

  // Pruned on the way in, so what is stored and what is on screen can never
  // disagree — correcting a run to a lift takes its distance with it rather than
  // leaving a mileage on a lifting day for the stats line to report.
  const set = (key, value) => onSave(pruneHidden(session, { ...out, [key]: value }, derive))

  /*
   * WHAT COUNTS AS HAVING LOGGED SOMETHING.
   *
   * Two exclusions, and both exist because this header went green on a card with
   * nothing in it.
   *
   * A field marked `optional` never BLOCKS "logged" — the free-form cards are
   * mostly optional detail, and a form that can never read as finished is a form
   * you stop filling in. But a card whose fields are ALL optional then satisfied
   * `every()` vacuously and claimed to be logged before the user had typed anything.
   * So where nothing is required, one real answer is.
   *
   * And the field the card NAMES ITSELF from is not an answer at all — it is the
   * card's identity. On the workout card that is the activity, and since
   * 2026-09-17 it is picked before the card even opens (see picker.jsx), so
   * counting it would make "Session logged" true the instant the user chose "Mountain
   * bike". Both of these were invisible while the form sat collapsed under a
   * header you had to open anyway; leading the card with the form put them on
   * screen.
   */
  const identity = session?.nameFrom
  const asked = fields.filter(f => f.key !== identity)
  const filled = asked.filter(f => out[f.key] !== undefined).length
  const setsDone = totalSets(out) + liftSets(out)
  const repsDone = totalReps(out) + liftReps(out)
  const hasNote = Boolean(String(out.notes || '').trim() || String(out.improve || '').trim())
  // A field that is not being ASKED cannot block it either.
  const required = asked.filter(f => !f.optional)
  const answered = filled > 0 || setsDone > 0 || hasNote
  const complete = required.every(f => out[f.key] !== undefined)
    && (required.length > 0 || answered)
    && (!hasSets || totalSets(out) > 0)

  const shown = bare || open

  return (
    <div className={`outlog ${complete ? 'done' : ''} ${bare ? 'bare' : ''}`}>
      {!bare && (
      <button className="alt-head" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span>
          <Icon name={complete ? 'CircleCheck' : 'NotebookPen'} size={15} />{' '}
          {complete
            ? `Session logged${setsDone ? ` — ${setsDone} sets${repsDone ? `, ${repsDone} reps` : ''}` : ''}${hasNote ? ' · noted' : ''}`
            : filled || setsDone || hasNote
              ? `How did it go? (${filled}/${asked.length})${hasNote ? ' · noted' : ''}`
              : 'How did it go?'}
        </span>
        <span className={`alt-chev ${open ? 'open' : ''}`}><Icon name="ChevronDown" size={17} /></span>
      </button>
      )}

      {!shown && !filled && (
        <p className="sub" style={{ margin: '8px 0 0' }}>
          Takes about twenty seconds and it's what makes the progress charts mean anything.
        </p>
      )}

      {shown && (
        <div className="out-body">
          {hasSets && <SetLog session={session} out={out} onSave={onSave} />}

          {fields.map(f => {
            if (f.type === 'slider') {
              return <Slider key={f.key} field={f} value={out[f.key]} onChange={v => set(f.key, v)} />
            }
            if (f.type === 'choice') {
              return <Choice key={f.key} field={f} value={out[f.key]} onChange={v => set(f.key, v)} />
            }
            // What you did, out of ninety-one sports. It is the question that
            // decides what the rest of this form even means, so it is always
            // first and it is the only one on an empty card. See lib/activities.js.
            if (f.type === 'activity') {
              return <ActivityPicker key={f.key} field={f} value={out[f.key]} out={out} onChange={v => set(f.key, v)} />
            }
            // A grade is a fixed ladder, not a number you type: see lib/grades.js.
            if (f.type === 'grade') {
              return (
                <div key={f.key} className="out-field out-grade">
                  <div className="out-label"><span>{f.label}</span></div>
                  <GradeSelect value={out[f.key]} label={f.label}
                    onChange={v => set(f.key, v === '' ? undefined : v)} />
                </div>
              )
            }
            if (f.type === 'toggle') {
              return (
                <label key={f.key} className="out-toggle">
                  <input type="checkbox" checked={Boolean(out[f.key])} onChange={e => set(f.key, e.target.checked)} />
                  <span>{f.label}</span>
                </label>
              )
            }
            // Exercises chosen at log time, with their own implement and sets —
            // the shape the climbing set log cannot hold. See lib/lifts.js.
            if (f.type === 'lifts') {
              return (
                <LiftLog key={f.key} field={f} out={out} entries={entries} entryId={entry?.id}
                  onSave={onSave} />
              )
            }
            // A number the app can work out gets it as a PLACEHOLDER — average
            // speed out of distance and time — and a number a service measured
            // says which service, because a value the user did not type must never look
            // like one the user did. Both live in lib/outputs.js.
            const derived = derivedValue(f, out)
            const source = filledBy(out, f.key)
            return (
              <label key={f.key} className="field out-num">
                {f.label} {f.unit ? `(${f.unit})` : ''}
                {source && <span className="out-from">from {source}</span>}
                <input
                  type="number" inputMode="decimal"
                  placeholder={derived != null ? String(derived) : f.hint}
                  value={out[f.key] ?? ''}
                  onChange={e => set(f.key, e.target.value === '' ? undefined : Number(e.target.value))}
                />
                {derived != null && out[f.key] === undefined && (
                  <span className="out-derived">worked out from your distance and time</span>
                )}
              </label>
            )
          })}

          {/* What the band recorded, if anything. Renders nothing at all when
              there is no WHOOP — see WhoopWorkouts. It sits above time spent
              because attaching a workout is what fills time spent in. */}
          <WhoopWorkouts session={session} entry={entry} entries={entries} onSave={onSave} />

          {/* What Strava recorded — the ride, run or walk itself. Same rules as
              WHOOP (suggest, never apply; nothing on screen when there is
              nothing), and on the Other-training card attaching also fills the
              blank distance/time/speed/elevation fields above. */}
          <StravaActivities session={session} entry={entry} entries={entries} onSave={onSave} />

          {/*
            * EVERYTHING BELOW THE MEASUREMENTS MOVED OUT, 2026-09-21, apart from
            * notes and effort. That is the name, the
            * gear, "just miles" and time spent — four questions about what this
            * session WAS, sitting between the numbers the user came to check and the
            * note the user came to write. They are `SessionDetails` now, behind the
            * pencil beside the X.
            *
            * What stayed is what the form is FOR: what the user did (the fields and the
            * set log), how hard it was, what the band and Strava measured, and
            * what the user wants to remember about it.
            */}

          <div className="notes">
            <div className="notes-head">
              <Icon name="NotebookPen" size={13} /> Notes for this session
            </div>
            {/*
              * "How did it feel?" used to sit here, and it asked the same
              * question as the slider six inches above it. It was redundant, and
              * the slider was kept, so the
              * free text that survives is the one that changes what the user does
              * next time rather than the one that describes what just happened.
              * Notes logged before that date are still shown — by `PriorNote`
              * below, in the history tab, and in the coach's digest — because
              * retiring a field is not the same as deleting what the user wrote.
              */}
            {/*
              * A PLAIN NOTES BOX, back since 2026-09-21.
              *
              * It was retired on 2026-09-06 asking "how did it feel?", six inches
              * under a slider asking the same thing, and that reasoning still
              * stands — nothing here asks how it felt. What is wanted is a place
              * to write down whatever the session was, replacing the five steps
              * of app boilerplate the workout card called a protocol. Same key as before on purpose, so the hundreds of notes
              * written before that date read back in the same box rather than
              * beside a second one.
              */}
            <NoteField
              key={`notes-${entry?.id}`}
              label="Notes"
              hint="rowed 10 min to warm up; left knee grumbled on the last set"
              value={out.notes}
              onCommit={v => set('notes', v.trim() || undefined)}
            />
            <NoteField
              key={`improve-${entry?.id}`}
              label="What to improve next time"
              hint="start the timer before chalking; drop a grade on problem 3"
              value={out.improve}
              onCommit={v => set('improve', v.trim() || undefined)}
            />
            <PriorNote entries={entries} session={session} excludeId={entry?.id} all />
          </div>
        </div>
      )}
    </div>
  )
}
