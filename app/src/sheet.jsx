/*
 * The session sheet: one session opened from the day list, with its header, its
 * body and its footer. Moved out of tabs.jsx in #73, so Today (tabs.jsx) and the
 * sheet are separate files; mobile/src/features/sheet.tsx is its twin. Its header
 * and footer were redone in #77: no Close in the footer, done is a chip by the
 * title, and every flip has Undo.
 */
import { useEffect, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { SessionView } from './session.jsx'
import { Modal } from './modal.jsx'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog.jsx'
import { liftFieldOf } from './lib/lifts.js'
import { dayWords } from './lib/dates.js'
import { MetaLine, metaParts } from './metaline.jsx'
import { isDone, markDone, doneState } from './lib/store.js'
import { openTimer, timerRequestFor } from './timer.jsx'
import { PrescriptionEditor } from './editor.jsx'
import { PlanTalk } from './planner.jsx'
import { usePlan } from './lib/planctx.jsx'
import { prescriptionLine, isLiftOnly, runOf } from './lib/prescription.js'
import { aiOffered } from './lib/plannerapi.js'
import { localIso } from './lib/dates.js'
import { hasWorkout } from './lib/workout.js'
import { loggedMinutes } from './lib/minutes.js'
import { titleFor } from './lib/naming.js'
import { loggedActivity } from './lib/activities.js'
import { currentMe } from './lib/whoami.js'
import { applyOut, applyPlan, canStart, plannedLine, toneFor } from './lib/trainer.js'
import {
  sharePeople, sharedPeopleOn, addPerson, removePerson, withSharedPerson, copyExercises,
  hasExercises, isSynced, withSync,
} from './lib/shared.js'
import * as peopleApi from './lib/peopleapi.js'
import {
  WithControl, PersonSwitch, SyncToggle, SharedNote, TheirSide, usePersonCopy, useSide,
  TogetherPending,
} from './sharedwith.jsx'
import { usePersonLog } from './trainer.jsx'
import { Undo2 } from 'lucide-react'
import { pushToast, dismissToast } from './lib/toast.js'
import { UNDO_MS } from './exercises.jsx'

/* --------------------------------------------------------- session sheets */

/*
 * "ADD-ONS FOR THIS SESSION" IS GONE, 2026-09-21. It was a pill row at the foot
 * of every main session offering the four support blocks to ride along with it.
 * It was never used and was just bloat. Adjuncts that are already ON an entry
 * still render as rows in the day list, because they are history; nothing offers
 * a new one.
 */

/**
 * Does this session have anything worth running a screen for?
 *
 * A card that declares a timer does (`hasWorkout` — the hangboard and board
 * work, the 4×4s). A PRESCRIPTION does, unless it is nothing but lifting.
 *
 * Workout mode makes no sense for a lifting workout: there are no times, and
 * rest between lifting sets is not prescribed. Once the rest came off a lift set there was nothing left for the runner to run: it counted
 * nothing down, advanced nothing on its own, and was a full-screen wrapper around
 * a set list — the same judgement that took workout mode off the lead laps and
 * the bodyweight circuits in the first place. A lift session is edited and ticked
 * off in the sheet.
 *
 * MIXED sessions keep it. A gym trip that is squats and then a twenty-minute row
 * has an interval in it, and the row is the part worth running.
 */
export function runnable(opt, pres) {
  if (pres) return !isLiftOnly(pres)
  return hasWorkout(opt)
}

/**
 * DONE IS A STATE BY THE TITLE (#77), not a footer button. "Mark undone" sat
 * beside Close at the foot, directly under the set steppers, so a near miss took
 * a workout out of the streak with nothing on screen to say so (on someone
 * else's copy too). Now the chip says what is true ("Done" / "Not done") at the
 * top of the sheet, a flip says what it did in a toast with Undo, and a flip of
 * someone else's copy says whose.
 */
export function DoneChip({ done, whose = null, onToggle }) {
  const said = done ? 'Done' : 'Not done'
  return (
    <button type="button" className={`done-chip ${done ? 'on' : ''}`} role="switch" aria-checked={done}
      aria-label={whose ? `${whose}: ${said}` : said} title={done ? 'Mark undone' : 'Mark done'} onClick={onToggle}>
      <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} />
      <span>{said}</span>
    </button>
  )
}

/**
 * Where "Ask the model to change this" (PlanTalk) sits on a planned workout's
 * sheet (#79): nowhere without a model on offer (#55); behind the pencil while
 * the workout is being done, because it is planning and sat above the first set;
 * inline above the plan on a day still to come, which is still being planned.
 */
export const planTalkWhere = ({ ai, doing }) => (!ai ? null : doing ? 'details' : 'sheet')

/**
 * One session, opened from the day list. This is the ONLY place the full
 * protocol appears — the dashboard stays a list of names, because a dashboard
 * that shows you three complete protocols at once is a dashboard you scroll
 * past instead of reading.
 */
export function SessionSheet({
  opt, entry, tone, entries, isFuture,
  onLog, onSave, onSavePlan = null, onRemove, onSetDone, onClose, onStartWorkout,
  onTraining = null, onSaveEntry = null, me = currentMe(),
}) {
  // Locks the sheet to the X button once you've touched the form. See modal.jsx.
  const [dirty, setDirty] = useState(false)
  // The name is its own layer now — a pencil beside the X. See RenameSheet.
  const [renaming, setRenaming] = useState(false)
  const planned = Boolean(entry)
  const done = planned && isDone(entry)
  // The prescription, if this session has one. Its presence is what turns the
  // sheet from a protocol you read into a workout you edit — see runner.jsx.
  const pres = entry?.data?.plan || null
  /*
   * DOING MODE (#79, D9). A planned workout on its day or after is where the
   * lifting is done, so the sheet opens on the work: the first exercise with a
   * set to do, a ✓ per set, and the planning (the block's circuit and split
   * controls, the implement chips, asking the model) a tap away behind the ⋯
   * and the pencil. A day still to come is still being planned, and gets the
   * editor as the planner shows it.
   */
  const doing = Boolean(pres) && !isFuture
  // A done plan on an earlier day is the log as written (`liftsDone`): its ✓s are read.
  const asWritten = (e) => Boolean(e?.date && e.date < localIso() && isDone(e))
  // Asking the model to change it, only where a model is on offer (#55, D F9).
  const ai = aiOffered(me?.features)
  const thePlan = usePlan()
  const liftField = liftFieldOf(thePlan)

  const save = (out) => { setDirty(true); onSave(entry, out) }

  /*
   * SHARED WORKOUTS (sharedwith.jsx, lib/shared.js). `people` is who the owner
   * could add, empty for anyone else, while acting as someone and on a
   * one-person install. `on` is who is on this entry, re-derived every render;
   * `side` is the person whose copy the sheet is filling in, by id, or null for
   * the owner's own, remembered per entry on this device. On their side the
   * history is THEIR log (`theirLog`), never the owner's.
   */
  const people = planned && onSaveEntry ? sharePeople(me) : []
  const on = people.length ? sharedPeopleOn(entry, me.people).map(p => ({ ...p, tone: toneFor(people, p.id) })) : []
  const [side, setSide] = useSide(entry?.id, on)
  const sidePerson = (side && on.find(p => p.id === side)) || null
  const theirs = usePersonCopy(sidePerson?.id, sidePerson?.entryId, sidePerson?.name)
  const theirLog = usePersonLog(sidePerson?.id || null)
  const synced = Boolean(sidePerson && isSynced(entry, sidePerson.id))
  const [sharing, setSharing] = useState({ busy: null, error: null })
  // The entry as of the latest render: an add or a removal awaits the server, and
  // must name the person on what the entry is THEN, not on what it was when tapped.
  const latestEntry = useRef(entry)
  latestEntry.current = entry
  const share = async (verb, person, run) => {
    setSharing({ busy: `${verb} ${person.name}…`, error: null })
    try {
      await run()
      setSharing({ busy: null, error: null })
    } catch (err) {
      setSharing({ busy: null, error: `${person.name}: ${err.message}` })
    }
  }
  const addSomeone = (person) => share('Adding', person, async () => {
    const { copy } = await addPerson({ ownerEntry: latestEntry.current, person, session: opt,
      owner: { id: me.real.id, name: me.real.name }, api: peopleApi })
    onSaveEntry(withSharedPerson(latestEntry.current, person.id, copy.id))
  })
  const removeSomeone = (person) => share('Taking off', person, async () => {
    const next = await removePerson({ ownerEntry: latestEntry.current, person, session: opt, api: peopleApi,
      confirmFn: async (q) => typeof window !== 'undefined' && window.confirm(q) })
    if (!next) return
    if (side === person.id) setSide(null)
    onSaveEntry(withSharedPerson(latestEntry.current, person.id, null, { remove: true }))
  })
  /* Their copy, written like `saveOutputs` writes the owner's: the out, and the
     name, level and minutes it implies. Never a test result: that is a separate
     entry, and their log is theirs to keep. */
  const saveTheirs = (out) => { setDirty(true); theirs.update(cur => applyOut(cur, opt, out)) }
  /* Their plan, edited from their side: the same write `savePlan` makes on the owner's. */
  const saveTheirPlan = (next) => { setDirty(true); theirs.update(cur => applyPlan(cur, opt, next)) }
  const theirPres = theirs.entry?.data?.plan || null
  /* Your exercises onto their side, when you ask (sync off only): added, never their numbers replaced. */
  const canCopy = Boolean(!synced && theirs.entry && copyExercises(theirs.entry, entry) !== theirs.entry)
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const setSync = (person, v) => onSaveEntry(withSync(latestEntry.current, person.id, v))
  const copyMine = () => { setDirty(true); theirs.update(cur => copyExercises(cur, latestEntry.current)) }
  const theirDone = Boolean(theirs.entry && isDone(theirs.entry))
  /* A flip of their copy says whose it was, and Undo puts back exactly what it had.
     Taken down with the sheet: their copy is written through this sheet's queue. */
  const theirUndo = useRef(null)
  useEffect(() => () => { if (theirUndo.current != null) dismissToast(theirUndo.current) }, [])
  const flipTheirs = () => {
    const before = theirs.entry
    const v = !isDone(before)
    setDirty(true)
    theirs.update(cur => markDone(cur, v))
    theirUndo.current = pushToast(`${v ? 'Marked done' : 'Marked undone'} for ${sidePerson?.name}`, 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: Undo2, onClick: () => { theirUndo.current = null; theirs.update(cur => markDone(cur, doneState(before))) } },
    })
  }
  /* The owner's own: the same toast. Undo puts back exactly the done fields the tap
     replaced, through the same write (`markDone` with `doneState`). */
  const flipMine = () => {
    const before = latestEntry.current
    const v = !isDone(before)
    setDirty(true)
    onSetDone(before, v)
    pushToast(v ? 'Marked done' : 'Marked undone', 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: Undo2, onClick: () => onSetDone(latestEntry.current, doneState(before)) },
    })
  }

  /* A write to their log that did not land says so, with the way to send it again
     (the latest copy, as it stands: `update` re-sends it unchanged). It stays
     until dismissed, but only while it is true: the cleanup takes it down when the
     error clears (a later write landed, or another side opened) and when the
     sheet closes, so a stale Retry never outlives the failure it was about. */
  useEffect(() => {
    if (!theirs.error || !/^Not saved/.test(theirs.error)) return undefined
    const id = pushToast(theirs.error, 'error', { duration: 0,
      action: { label: 'Retry', onClick: () => theirs.update(cur => cur) } })
    return () => dismissToast(id)
  }, [theirs.error])

  /*
   * The line under the name: the day, then the time as it was typed or
   * measured, so the header can never say "45 min" over a typed 29. Never the
   * card's own estimate or its tier ("any sport · counts anyway"): neither is
   * something the user said. A planned session not yet timed says what it holds.
   */
  const mins = planned ? loggedMinutes(entry, opt) : null
  const timed = mins !== null ? `${mins} min` : null
  const subBits = [
    entry?.date ? dayWords(entry.date) : null,
    timed || (pres ? prescriptionLine(pres) : null),
  ]
  const sub = metaParts(subBits).length ? <MetaLine bits={subBits} /> : null

  /*
   * THE FOOTER HOLDS A REAL ACTION OR NOTHING (#77). Every field saves as it is
   * typed, so "Close" was a non-action dressed as the primary: the brightest
   * thing on the sheet, 0px under the first set's weight stepper, and the owner
   * hit it over and over mid-workout. The header X closes (Escape and the scrim
   * too, until something is entered). What is left for the footer: Start, where
   * there is something to run, or putting a card on the day. Done is the chip
   * under the title (`DoneChip`); a day still to come has no done state to flip.
   */
  /* A run already under way, or finished and reopened by Start (#75), is carried
     on, not started: the runner opens where it was. */
  const startWords = (e) => (runOf(e)?.startedAt ? 'Carry on' : pres ? 'Start the workout' : 'Start workout')
  const start = (side = null) => (
    <button type="button" className="btn" onClick={() => { setDirty(true); onStartWorkout(opt, side) }}>
      <Icon name="Play" size={17} /> {startWords(side ? theirs.entry : entry)}
    </button>
  )
  let footer = null
  let status = null
  if (sidePerson) {
    const theirsLive = theirs.entry && !theirs.entry.deleted
    if (!isFuture && theirsLive) status = <DoneChip done={theirDone} whose={sidePerson.name} onToggle={flipTheirs} />
    /* Their side starts the same shared workout, on their side of the switcher. */
    if (!isFuture && theirsLive && onStartWorkout && pres && theirPres && runnable(opt, theirPres) && canStart(theirs.entry)) {
      footer = <div className="sheet-foot">{start(sidePerson.id)}</div>
    }
  } else if (!planned && onLog && !isFuture) {
    // A card opened with nothing on the day yet: putting it there IS the action.
    footer = (
      <div className="sheet-foot">
        <button type="button" className="btn" onClick={() => { setDirty(true); onLog(opt) }}>
          {opt.role === 'rest' ? 'Take a rest day' : 'Add to today'}
        </button>
      </div>
    )
  } else {
    /* A planned session always offers the runner, whether or not the CARD
       declares a timer — what it walks is the prescription on the entry.
       Not "while not done": today's session is done before it starts. */
    const startable = !isFuture && planned && onStartWorkout && runnable(opt, pres) && canStart(entry)
    if (planned && !isFuture && onSetDone) status = <DoneChip done={done} onToggle={flipMine} />
    if (startable) footer = <div className="sheet-foot">{start()}</div>
  }
  /* The other sides of a synced workout, for a removal toast's one line about them
     (lib/removal.js: never a claim about what happened there). */
  const planTalk = pres && (
    <PlanTalk pres={pres} compact entries={entries} entryId={entry?.id}
      onChange={(next) => { setDirty(true); onSavePlan?.(latestEntry.current, next) }} />
  )
  const syncedWith = sidePerson
    ? (synced ? ['you'] : null)
    : (() => { const s = on.filter(p => isSynced(entry, p.id)).map(p => p.name); return s.length ? s : null })()

  return (
    <Modal
      /*
       * What this session IS, not what the card is called. A planned session is
       * titled by its plan; a card that names itself from what you picked
       * (`nameFrom`) is titled "Mountain bike" rather than "Log a workout".
       */
      title={titleFor(opt, entry?.data?.out, pres)}
      sub={sub}
      // The activity's own icon (a run's footprints), as its row in the Log feed
      // shows it; the workout card's generic one only until an activity is picked.
      icon={loggedActivity(opt, entry?.data?.out)?.icon || opt.icon}
      tone={tone}
      status={status}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up: a rename is a thing you do TO the session you are
         looking at, so it belongs where the session's title is. */
      onRename={planned && !isFuture && !sidePerson ? () => setRenaming(true) : null}
      onDelete={onRemove && entry && !sidePerson ? () => onRemove(entry) : null}
      deleteLabel={entry?.date && entry.date !== localIso() ? 'Remove this workout' : 'Remove from today'}
      footer={footer}
    >
      {/* Whose copy this sheet is filling in, pinned while the sheet scrolls. Only on a shared workout. */}
      <PersonSwitch on={on} side={sidePerson?.id || null} onSide={setSide} />
      {on.map(p => <SyncToggle key={p.id} person={p} on={isSynced(entry, p.id)} onChange={(v) => setSync(p, v)} />)}

      {/* Who else is on it, and the way to add someone. Owner-only; see sharedwith.jsx. */}
      {!sidePerson && (
        <WithControl on={on} people={people} busy={sharing.busy} error={sharing.error}
          onAdd={addSomeone} onRemove={removeSomeone} />
      )}
      {/* A circuit done together that has not reached someone yet (#68): until it has. */}
      {on.length > 0 && <TogetherPending entry={entry} session={opt} />}
      {/* Everyone else sees, quietly, who it was done with (their own copy names the
          owner; an owner acting as someone sees what that person would). */}
      {!people.length && planned && <SharedNote entry={entry} people={me.people} />}
      {/* "planned by Alex": quiet, like who it was done with. The entry is theirs now. */}
      {planned && !sidePerson && plannedLine(entry, me) && (
        <p className="sharednote"><Icon name="ClipboardCheck" size={12} /> {plannedLine(entry, me)}</p>
      )}

      {sidePerson ? (
        <TheirSide session={opt} copy={theirs.entry} loading={theirs.loading} error={theirs.error}
          person={sidePerson} ownerOut={entry?.data?.out} onSave={saveTheirs} entries={theirLog.entries}
          onCopyMine={canCopy ? copyMine : null} ownerHasExercises={hasExercises(entry)} synced={synced}
          /* A planned session is its plan, on their side as on the owner's: the same
             exercises, with their own numbers, and "last time" from THEIR log. */
          plan={theirPres && (
            <PrescriptionEditor pres={theirPres} liftField={liftField} entries={theirLog.entries} entryId={theirs.entry?.id}
              categories={thePlan?.quotaCategories || []} onChange={saveTheirPlan} syncedWith={syncedWith} compact
              doing={!isFuture} asWritten={asWritten(theirs.entry)} />
          )} />
      ) : (<>
      {/*
        * The "MAIN SESSION" / "ADDED SESSION" strap above the content is gone
        * (2026-09-21) as bloat. It restated the tag the day list already showed on the row the user
        * tapped, in the scarcest space on the sheet.
        */}

      {/*
        * A card whose form IS the card puts it first and open.
        *
        * The workout card's "protocol" is five steps of boilerplate about how to
        * use the app; the ride the user is logging is the point. Leading with it also
        * puts the activity row — the one control that changes what the rest of
        * the form asks — at the top where the user expects it, since the user just picked it
        * on the way in.
        */}
      {opt.logFirst && !isFuture && planned && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} />
      )}

      {/*
        * A PLANNED session shows its own prescription instead of the card's
        * protocol, because the card has none worth reading — see the `planned`
        * entry in plan.json. `why` first: it is one paragraph and it is the part
        * that says what the planner was thinking, which is the thing worth
        * knowing before you change a number in it.
        */}
      {pres ? (
        <>
          {/* Still talkable-to after it lands. The thread lives on the entry, so a
              session written at eight can be argued with at six. While doing it,
              that is planning: behind the pencil (`DetailsSheet`). */}
          {planTalkWhere({ ai, doing }) === 'sheet' && planTalk}
          <PrescriptionEditor pres={pres} liftField={liftField}
            entries={entries} entryId={entry?.id} categories={thePlan?.quotaCategories || []}
            onChange={(next) => { setDirty(true); onSavePlan?.(latestEntry.current, next) }} syncedWith={syncedWith} compact
            doing={doing} asWritten={asWritten(entry)} />
          {pres.notes?.length > 0 && (
            <ul className="plan-notes">
              {pres.notes.map((n, i) => <li key={i}><Icon name="Info" size={13} /> {n}</li>)}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="rec-dose">{opt.dose}</p>
          <PriorNote entries={entries} session={opt} excludeId={entry?.id} />
          <SessionView key={opt.id} session={opt} entries={entries} />
        </>
      )}

      {/* Declared by the card. See `logFirst` in plan.json and SessionLog. */}
      {!isFuture && planned && !opt.logFirst && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} />
      )}

      {/*
        * "Log another workout today" came off the sheet on 2026-09-21: the +
        * button is one tap from here, and a third way in at the bottom of a form
        * is the kind of thing that made this screen read as a maze.
        */}

      {/* Any workout can use a clock; a card that declares one offers it as a
          preset. A tool, so a row at the foot of the sheet rather than a second
          big button beside the one that matters. */}
      {!isFuture && (planned || onLog) && opt.role !== 'rest' && (
        <div className="list sheet-tools">
          <button type="button" className="list-row" onClick={() => openTimer(timerRequestFor(opt, entry))}>
            <Icon name="Timer" size={20} />
            <span className="list-row-main"><span className="list-row-title">Interval timer</span></span>
            <span className="list-row-chev"><Icon name="ChevronRight" size={16} /></span>
          </button>
        </div>
      )}

      {renaming && (
        <DetailsSheet session={opt} entry={entry} entries={entries}
          onSave={save}
          training={entry?.data?.training}
          /* Only where the question makes sense — a commute is a ride, not a set
             of max hangs. Driven by the discipline rather than by a list. */
          onTraining={onTraining}
          planTalk={planTalkWhere({ ai, doing }) === 'details' ? planTalk : null}
          onClose={() => setRenaming(false)} />
      )}
      </>)}
    </Modal>
  )
}

/*
 * FULLSCREEN SESSION MODE IS GONE, 2026-09-21.
 *
 * It was a whole page for one session — the same entry as the sheet, with tabs
 * for Plan / Log / Why — reached by an expand button in the sheet's header.
 * It was not worth keeping: it was the third way to look at the same session and
 * the one nothing pointed at, so every fix to the sheet had to be made twice and
 * the second copy is the one that drifted.
 *
 * `FullScreen` itself stays — the planner, the week planner, the pickers, workout
 * mode and the runner are all built on it. What went is the session page.
 */
