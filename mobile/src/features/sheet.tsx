/*
 * The session sheet (app/src/sheet.jsx): one session opened from the day list,
 * with its header, its body and its footer. Moved out of tabs.tsx in #73. Its
 * header and footer were redone in #77 (no Close in the footer, done is a chip
 * by the title, every flip has Undo).
 */
import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Press, Row } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { SessionView } from './session'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog'
import { liftFieldOf } from '../lib/lifts.js'
import { pushToast, dismissToast } from '../lib/toast'
import { dayWords } from '../lib/dates.js'
import { metaText } from './metaline'
import { isDone, markDone, doneState } from '../lib/store.js'
import { openTimerAfterSheet, timerRequestFor } from './timer'
import { PrescriptionEditor } from './editor'
import { UNDO_MS } from './exercises'
import { PlanTalk } from './planner'
import { usePlan } from '../lib/planctx.jsx'
import { prescriptionLine, isLiftOnly } from '../lib/prescription.js'
import { hasWorkout } from '../lib/workout.js'
import { loggedMinutes } from '../lib/minutes.js'
import { titleFor } from '../lib/naming.js'
import { loggedActivity } from '../lib/activities.js'
import { currentMe } from '../lib/whoami.js'
import {
  sharePeople, sharedPeopleOn, addPerson, removePerson, withSharedPerson, copyExercises,
  hasExercises, isSynced, withSync,
} from '../lib/shared.js'
import * as peopleApi from '../lib/peopleapi.js'
import { confirm } from '../ui/menu'
import {
  WithControl, PersonSwitch, SyncToggle, SharedNote, TheirSide, usePersonCopy, useSide,
  TogetherPending,
} from './sharedwith'
import { usePersonLog } from './trainer'
import * as trainerLib from '../lib/trainer.js'

// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { applyOut, applyPlan, canStart, plannedLine } = trainerLib as any
const _titleFor = titleFor as any

/* --------------------------------------------------------- session sheets */

/*
 * "ADD-ONS FOR THIS SESSION" IS GONE, 2026-09-21. It was never used. Adjuncts
 * already ON an entry still render as rows in the day list, because they are
 * history; nothing offers a new one.
 */

/**
 * Does this session have anything worth running a screen for?
 *
 * A card that declares a timer does (`hasWorkout`). A PRESCRIPTION does, unless
 * it is nothing but lifting: there are no times and lift rest is not prescribed,
 * so the runner would count nothing down. MIXED sessions keep it — the row after
 * the squats is the part worth running.
 */
export function runnable(opt: any, pres: any) {
  if (pres) return !isLiftOnly(pres)
  return hasWorkout(opt)
}

/**
 * DONE IS A STATE BY THE TITLE (#77), not a footer button. It sat beside Close
 * at the foot, directly under the set steppers and, on a phone, on top of the
 * keypad, so a near miss took a workout out of the streak with nothing to say
 * so. Now it says what is true ("Done" / "Not done") at the top of the sheet,
 * a flip says what it did in a toast with Undo, and a flip of someone else's
 * copy says whose.
 */
export function DoneChip({ done, whose = null, onToggle }: { done: boolean; whose?: string | null; onToggle: () => void }) {
  const said = done ? 'Done' : 'Not done'
  return (
    <Press onPress={onToggle} hitSlop={6} accessibilityRole="switch" accessibilityState={{ checked: done }}
      accessibilityLabel={whose ? `${whose}: ${said}` : said}
      accessibilityHint={done ? 'Marks it undone' : 'Marks it done'}
      style={[st.chip, done && st.chipOn]}>
      <Icon name={done ? 'CircleCheck' : 'Circle'} size={16} color={done ? colors.accent : colors.inkFaint} />
      <T size={font.small} weight={500} color={done ? colors.ink : colors.inkDim}>{said}</T>
    </Press>
  )
}

/**
 * One session, opened from the day list. This is the ONLY place the full
 * protocol appears — the dashboard stays a list of names.
 */
export function SessionSheet({
  opt, entry, tone, entries, isFuture,
  onLog, onSave, onSavePlan = null, onRemove, onSetDone, onClose, onStartWorkout,
  onTraining = null, onSaveEntry = null, me = currentMe(),
}: {
  opt: any
  entry?: any
  tone?: string
  entries: any[]
  isFuture?: boolean
  onLog?: ((opt: any) => any) | null
  onSave: (entry: any, out: any) => void
  onSavePlan?: ((entry: any, pres: any) => void) | null
  onRemove?: ((entry: any) => void) | null
  onSetDone?: (entry: any, done: boolean | Record<string, unknown>) => void
  onClose: () => void
  onStartWorkout?: ((opt: any, side?: string | null) => void) | null
  onTraining?: ((v: boolean) => void) | null
  onSaveEntry?: ((entry: any) => void) | null
  me?: any
}) {
  // Locks the sheet to the X button once you've touched the form.
  const [dirty, setDirty] = useState(false)
  // The name is its own layer now — a pencil beside the X. See DetailsSheet.
  const [renaming, setRenaming] = useState(false)
  const planned = Boolean(entry)
  const done = planned && isDone(entry)
  // The prescription, if this session has one. Its presence turns the sheet from
  // a protocol you read into a workout you edit.
  const pres = entry?.data?.plan || null
  const thePlan: any = usePlan()
  const liftField = (liftFieldOf as any)(thePlan)

  const save = (out: any) => { setDirty(true); onSave(entry, out) }

  /*
   * SHARED WORKOUTS (sharedwith.tsx, lib/shared.js). `people` is who the owner
   * could add, empty for anyone else, while acting as someone and on a
   * one-person install. `on` is re-derived every render; `side` is the person
   * whose copy the sheet is filling in, by id, or null for the owner's own,
   * remembered per entry on this device. On their side the history is THEIR log.
   */
  const people: any[] = planned && onSaveEntry ? (sharePeople as any)(me) : []
  const on: any[] = people.length
    ? (sharedPeopleOn as any)(entry, me.people).map((p: any) => ({ ...p, tone: (trainerLib.toneFor as any)(people, p.id) }))
    : []
  const [side, setSide] = useSide(entry?.id, on)
  const sidePerson = (side && on.find((p) => p.id === side)) || null
  const theirs = usePersonCopy(sidePerson?.id, sidePerson?.entryId, sidePerson?.name)
  const theirLog = usePersonLog(sidePerson?.id || null)
  const synced = Boolean(sidePerson && isSynced(entry, sidePerson.id))
  const [sharing, setSharing] = useState<{ busy: string | null; error: string | null }>({ busy: null, error: null })
  // The entry as of the latest render: an add or a removal awaits the server.
  const latestEntry = useRef(entry)
  latestEntry.current = entry
  const share = async (verb: string, person: any, run: () => Promise<boolean | void>) => {
    setSharing({ busy: `${verb} ${person.name}…`, error: null })
    try {
      if (await run()) success()
      setSharing({ busy: null, error: null })
    } catch (err: any) {
      setSharing({ busy: null, error: `${person.name}: ${err.message}` })
    }
  }
  const addSomeone = (person: any) => share('Adding', person, async () => {
    const { copy } = await (addPerson as any)({ ownerEntry: latestEntry.current, person, session: opt,
      owner: { id: me.real.id, name: me.real.name }, api: peopleApi })
    onSaveEntry?.(withSharedPerson(latestEntry.current, person.id, copy.id))
    return true
  })
  const removeSomeone = (person: any) => share('Taking off', person, async () => {
    const next = await (removePerson as any)({ ownerEntry: latestEntry.current, person, session: opt, api: peopleApi,
      confirmFn: (q: string) => confirm(q, { confirmLabel: 'Take it out' }) })
    if (!next) return false
    if (side === person.id) setSide(null)
    onSaveEntry?.((withSharedPerson as any)(latestEntry.current, person.id, null, { remove: true }))
    return true
  })
  // Their copy, written like `saveOutputs` writes the owner's. Never a test result.
  const saveTheirs = (out: any) => { setDirty(true); theirs.update((cur: any) => applyOut(cur, opt, out)) }
  const theirDone = Boolean(theirs.entry && isDone(theirs.entry))
  /* A flip of their copy says whose it was, and Undo puts back exactly what it had.
     Taken down with the sheet: their copy is written through this sheet's queue. */
  const theirUndo = useRef<number | null>(null)
  useEffect(() => () => { if (theirUndo.current != null) dismissToast(theirUndo.current) }, [])
  const flipTheirs = () => {
    const before = theirs.entry
    const v = !isDone(before)
    setDirty(true)
    if (v) success(); else tap()
    theirs.update((cur: any) => markDone(cur, v))
    theirUndo.current = pushToast(`${v ? 'Marked done' : 'Marked undone'} for ${sidePerson?.name}`, 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: null, onClick: () => { theirUndo.current = null; void theirs.update((cur: any) => markDone(cur, doneState(before))) } },
    })
  }
  /* The owner's own: the same toast. Undo puts back exactly the done fields the tap
     replaced, through the same write (`markDone` with `doneState`). */
  const flipMine = () => {
    const before = latestEntry.current
    const v = !isDone(before)
    setDirty(true)
    if (v) success(); else tap()
    onSetDone?.(before, v)
    pushToast(v ? 'Marked done' : 'Marked undone', 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: null, onClick: () => onSetDone?.(latestEntry.current, doneState(before)) },
    })
  }
  /* Their plan, edited from their side: the same write `savePlan` makes on the owner's. */
  const saveTheirPlan = (next: any) => { setDirty(true); theirs.update((cur: any) => applyPlan(cur, opt, next)) }
  const theirPres = theirs.entry?.data?.plan || null
  /* Your exercises onto their side, when you ask (sync off only): added, never their numbers replaced. */
  const canCopy = Boolean(!synced && theirs.entry && copyExercises(theirs.entry, entry) !== theirs.entry)
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const setSync = (person: any, v: boolean) => onSaveEntry?.(withSync(latestEntry.current, person.id, v))
  const copyMine = () => { setDirty(true); theirs.update((cur: any) => copyExercises(cur, latestEntry.current)) }

  /* A write to their log that did not land says so, with the way to send it again.
     It stays only while it is true: the cleanup takes it down when the error
     clears (a later write landed) and when the sheet closes. */
  useEffect(() => {
    if (!theirs.error || !/^Not saved/.test(theirs.error)) return undefined
    const id = pushToast(theirs.error, 'error', { duration: 0,
      action: { label: 'Retry', onClick: () => { void theirs.update((cur: any) => cur) } } })
    return () => { if (id != null) dismissToast(id) }
  }, [theirs.error])

  /*
   * The line under the name: the day, then the time as typed or measured, so the
   * header can never say "45 min" over a typed 29. Never the card's estimate or
   * tier ("any sport · counts anyway"). A planned session not yet timed says what
   * it holds.
   */
  const mins = planned ? (loggedMinutes as any)(entry, opt) : null
  const timed = mins !== null ? `${mins} min` : null
  const subLine = metaText([
    entry?.date ? dayWords(entry.date) : null,
    timed || (pres ? prescriptionLine(pres) : null),
  ])

  /*
   * THE FOOTER HOLDS A REAL ACTION OR NOTHING (#77). Every field saves as typed,
   * so "Close" was a non-action dressed as the primary, and it was the brightest
   * thing on the sheet, right under the last set (and on the keypad while typing:
   * the owner hit it over and over mid-workout). The header X closes. What is
   * left for the footer: Start, where there is something to run, or putting a
   * card on the day. Done is the chip under the title (`DoneChip`); a day still
   * to come has no done state to flip.
   */
  const start = (side: string | null = null) => (
    <Btn icon="Play" title={pres ? 'Start the workout' : 'Start workout'} flex
      onPress={() => { setDirty(true); onStartWorkout?.(opt, side) }} />
  )
  let footer: React.ReactNode = null
  let status: React.ReactNode = null
  if (sidePerson) {
    const theirsLive = theirs.entry && !theirs.entry.deleted
    if (!isFuture && theirsLive) status = <DoneChip done={theirDone} whose={sidePerson.name} onToggle={flipTheirs} />
    /* Their side starts the same shared workout, on their side of the switcher. */
    if (!isFuture && theirsLive && onStartWorkout && pres && theirPres && runnable(opt, theirPres) && canStart(theirs.entry)) {
      footer = <View style={st.sheetFoot}>{start(sidePerson.id)}</View>
    }
  } else if (!planned && onLog && !isFuture) {
    // A card opened with nothing on the day yet: putting it there IS the action.
    footer = (
      <View style={st.sheetFoot}>
        <Btn flex title={opt.role === 'rest' ? 'Take a rest day' : 'Add to today'}
          onPress={() => { setDirty(true); onLog(opt) }} />
      </View>
    )
  } else {
    /* A planned session always offers the runner, whatever the CARD declares.
       Not "while not done": today's session is done before it starts. */
    const startable = !isFuture && onLog && onStartWorkout && runnable(opt, pres) && canStart(entry)
    if (planned && !isFuture && onLog) status = <DoneChip done={done} onToggle={flipMine} />
    if (startable) footer = <View style={st.sheetFoot}>{start()}</View>
  }
  /* The other sides of a synced workout, for a removal toast's one line about them
     (lib/removal.js: never a claim about what happened there). */
  const syncedWith = sidePerson
    ? (synced ? ['you'] : null)
    : (() => { const s = on.filter((p) => isSynced(entry, p.id)).map((p) => p.name); return s.length ? s : null })()

  return (
    <Modal
      /*
       * What this session IS, not what the card is called. A planned session is
       * titled by its plan; a card that names itself from what you picked is
       * titled "Mountain bike", not "Log a workout".
       */
      title={String(_titleFor(opt, entry?.data?.out, pres) || opt.name)}
      /* Whose copy this sheet is filling in, in the header so it stays put while the body
         scrolls (the web pins it with position: sticky). Only on a shared workout. */
      sub={on.length ? (
        <View>
          {subLine ? <T size={12} faint style={{ marginTop: 2 }}>{subLine}</T> : null}
          <PersonSwitch on={on} side={sidePerson?.id || null} onSide={setSide} />
        </View>
      ) : subLine || undefined}
      // The activity's own icon, as its row in the Log feed shows it (#55).
      icon={(loggedActivity as any)(opt, entry?.data?.out)?.icon || opt.icon}
      tone={tone}
      status={status}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up: a rename is a thing you do TO the session you are
         looking at, so it belongs where the session's title is. */
      onRename={planned && !isFuture && !sidePerson ? () => setRenaming(true) : null}
      onDelete={onRemove && entry && !sidePerson ? () => onRemove(entry) : null}
      deleteLabel="Remove from today"
      footer={footer}
    >
      {on.map((p) => <SyncToggle key={p.id} person={p} on={isSynced(entry, p.id)} onChange={(v) => setSync(p, v)} />)}

      {/* Who else is on it, and the way to add someone. Owner-only. */}
      {!sidePerson && (
        <WithControl on={on} people={people} busy={sharing.busy} error={sharing.error}
          onAdd={addSomeone} onRemove={removeSomeone} />
      )}
      {/* A circuit done together that has not reached someone yet (#68): until it has. */}
      {on.length > 0 ? <TogetherPending entry={entry} session={opt} /> : null}
      {/* Everyone else sees, quietly, who it was done with. */}
      {!people.length && planned && <SharedNote entry={entry} people={me.people} />}
      {/* "planned by Alex": quiet, like who it was done with. The entry is theirs now. */}
      {planned && !sidePerson && plannedLine(entry, me) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
          <Icon name="ClipboardCheck" size={12} color={colors.inkFaint} />
          <T size={12} faint>{plannedLine(entry, me)}</T>
        </View>
      ) : null}

      {sidePerson ? (
        <TheirSide session={opt} copy={theirs.entry} loading={theirs.loading} error={theirs.error}
          person={sidePerson} ownerOut={entry?.data?.out} onSave={saveTheirs} entries={theirLog.entries}
          onCopyMine={canCopy ? copyMine : null} ownerHasExercises={hasExercises(entry)} synced={synced}
          /* A planned session is its plan, on their side as on the owner's: the same
             exercises, with their own numbers, and "last time" from THEIR log. */
          plan={theirPres ? (
            <PrescriptionEditor pres={theirPres} liftField={liftField} entries={theirLog.entries} entryId={theirs.entry?.id}
              categories={thePlan?.quotaCategories || []} onChange={saveTheirPlan} syncedWith={syncedWith} compact />
          ) : null} />
      ) : (<>
      {/* The "MAIN SESSION" / "ADDED SESSION" strap is gone (2026-09-21): it
          restated the tag the row already showed, in the scarcest space here. */}

      {/*
        * A card whose form IS the card puts it first and open: the workout card's
        * "protocol" is boilerplate, and the activity row is the one control that
        * changes what the rest of the form asks.
        */}
      {/* First in the sheet, so `bare`: no divider above it. */}
      {opt.logFirst && !isFuture && planned && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} bare />
      )}

      {/*
        * A PLANNED session shows its own prescription instead of the card's
        * protocol. `why` first: it says what the planner was thinking, which is
        * worth knowing before you change a number in it.
        */}
      {pres ? (
        <>
          {/* Still talkable-to after it lands. The thread lives on the entry. */}
          <PlanTalk pres={pres} compact entries={entries} entryId={entry?.id}
            onChange={(next: any) => { setDirty(true); onSavePlan?.(latestEntry.current, next) }} />
          <PrescriptionEditor pres={pres} liftField={liftField}
            entries={entries} entryId={entry?.id} categories={thePlan?.quotaCategories || []}
            onChange={(next: any) => { setDirty(true); onSavePlan?.(latestEntry.current, next) }} syncedWith={syncedWith} compact />
          {pres.notes?.length > 0 && (
            <View style={{ marginTop: 16, gap: 7 }}>
              {pres.notes.map((n: string, i: number) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                  <Icon name="Info" size={13} color={colors.inkFaint} style={{ marginTop: 3 }} />
                  <T size={12.5} faint style={{ flex: 1 }}>{n}</T>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          <T size={14} dim>{opt.dose}</T>
          <PriorNote entries={entries} session={opt} excludeId={entry?.id} />
          <SessionView key={opt.id} session={opt} entries={entries} />
        </>
      )}

      {/* Declared by the card. See `logFirst` in plan.json and SessionLog. */}
      {!isFuture && planned && !opt.logFirst && (
        <SessionLog session={opt} entry={entry} entries={entries} onSave={save} />
      )}

      {/*
        * "Log another workout today" came off the sheet on 2026-09-21: the + is
        * one tap from here.
        */}

      {/* Any workout can use a clock; a card that declares one offers it as a
          preset. A tool, so a row at the foot of the sheet. One modal at a time
          on iOS: the sheet goes, then the timer comes. */}
      {!isFuture && onLog && opt.role !== 'rest' ? (
        <View style={st.tools}>
          <Row icon="Timer" label="Interval timer"
            onPress={() => { const req = timerRequestFor(opt, entry); onClose(); openTimerAfterSheet(req) }} />
        </View>
      ) : null}

      {renaming && (
        <DetailsSheet session={opt} entry={entry} entries={entries}
          onSave={save}
          training={entry?.data?.training}
          /* Only where the question makes sense — a commute is a ride, not a set
             of max hangs. Driven by the discipline rather than by a list. */
          onTraining={onTraining}
          onClose={() => setRenaming(false)} />
      )}
      </>)}
    </Modal>
  )
}

/*
 * FULLSCREEN SESSION MODE IS GONE, 2026-09-21. It was the third way to look at
 * the same session and the one nothing pointed at, so every fix had to be made
 * twice. `FullScreen` itself stays for the planner, the pickers, workout mode
 * and the runner.
 */

const st = StyleSheet.create({
  // The sheet's foot: the one real action, full width.
  sheetFoot: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  // The done chip: a state, so a chip (accent-soft once done), 32 tall with its hit area to 44.
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, minHeight: 32, paddingHorizontal: space[3],
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
  tools: { marginTop: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
})
