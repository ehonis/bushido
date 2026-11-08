/*
 * The session sheet (app/src/sheet.jsx): one session opened from the day list,
 * with its header, its body and its footer. Moved out of tabs.tsx in #73. Its
 * header and footer were redone in #77 (no Close in the footer, done is a chip
 * by the title, every flip has Undo).
 */
import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Row } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { Icon } from '../lib/icons'
import { SessionView } from './session'
import { SessionLog, PriorNote, DetailsSheet } from './sessionlog'
import { liftFieldOf } from '../lib/lifts.js'
import { pushToast, dismissToast } from '../lib/toast'
import { dayWords } from '../lib/dates.js'
import { metaText } from './metaline'
import { isDone, markDone } from '../lib/store.js'
import { openTimer, timerRequestFor } from './timer'
import { PrescriptionEditor } from './editor'
import { PlanTalk } from './planner'
import { usePlan } from '../lib/planctx.jsx'
import { prescriptionLine, isLiftOnly, runOf } from '../lib/prescription.js'
import { aiOffered } from '../lib/plannerapi.js'
import { localIso } from '../lib/dates.js'
import { hasWorkout } from '../lib/workout.js'
import { loggedMinutes } from '../lib/minutes.js'
import { titleFor } from '../lib/naming.js'
import { loggedActivity } from '../lib/activities.js'
import { currentMe } from '../lib/whoami.js'
import { sharePeople, sharedPeopleOn, isSynced } from '../lib/shared.js'
import {
  PersonSwitch, SharedNote, TheirSide, usePersonCopy, useSide, TogetherPending,
  ShareChip, SharePanel, useSharing, useSidesDone,
} from './sharedwith'
import { usePersonLog } from './trainer'
import { DoneChip, useDoneFlip, SheetStart, sheetPartStyles } from './sheetparts'
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

/* The done chip, its flip with Undo and the footer's Start are sheetparts.tsx (#80). */
export { DoneChip }

/**
 * Where "Ask the model to change this" sits on a planned workout's sheet (#79,
 * the web's `planTalkWhere`): nowhere without a model on offer; behind the
 * pencil while doing; inline on a day still to come.
 */
export const planTalkWhere = ({ ai, doing }: { ai: boolean; doing: boolean }) => (!ai ? null : doing ? 'details' : 'sheet')

/**
 * One session, opened from the day list. This is the ONLY place the full
 * protocol appears — the dashboard stays a list of names.
 */
/** The day a card is put on, as the button says it: "Add to Today", "Add to Sat, Oct 24" (#82). */
const dayTitle = (iso: string | null) => (iso ? dayWords(iso) : 'Today')

export function SessionSheet({
  opt, entry, tone, entries, isFuture,
  onLog, onSave, onSavePlan = null, onRemove, onSetDone, onClose, onStartWorkout,
  onTraining = null, onSaveEntry = null, me = currentMe(), day = null,
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
  /** The day Today is showing, which a card with nothing on it yet is put on. */
  day?: string | null
}) {
  // Locks the sheet to the X button once you've touched the form.
  const [dirty, setDirty] = useState(false)
  // The name is its own layer now — a pencil beside the X. See DetailsSheet.
  const [renaming, setRenaming] = useState(false)
  /*
   * THE INTERVAL TIMER COMES BACK TO THIS SHEET (#94, F N2). iOS presents one
   * modal at a time, so the row used to close the sheet and open the timer 450ms
   * later, and closing the timer left Today: mid-lift, a rest timer cost the
   * sheet. Now the sheet hides (`Modal hidden`, this component and its state stay
   * mounted), the timer opens once it has slid away (`onHidden`, not a guessed
   * delay), and closing the timer brings the sheet back where it was scrolled.
   */
  const [timing, setTiming] = useState(false)
  const timerReq = useRef<any>(null)
  const timerLate = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerLate.current) clearTimeout(timerLate.current) }, [])
  const showTimer = () => {
    if (timerLate.current) clearTimeout(timerLate.current)
    const req = timerReq.current
    timerReq.current = null
    if (req) openTimer({ ...req, onReturn: () => setTiming(false) })
  }
  const askTimer = () => {
    timerReq.current = timerRequestFor(opt, entry)
    setTiming(true)
    // `onDismiss` is how iOS says the sheet has gone; this is only in case it never does.
    timerLate.current = setTimeout(showTimer, 900)
  }
  const planned = Boolean(entry)
  const done = planned && isDone(entry)
  // The prescription, if this session has one. Its presence turns the sheet from
  // a protocol you read into a workout you edit.
  const pres = entry?.data?.plan || null
  /*
   * DOING MODE (#79, D9). A planned workout on its day or after is where the
   * lifting is done, so the sheet opens on the work: the first exercise with a
   * set to do, a ✓ per set, and the planning (the block's circuit and split, the
   * implement chips, asking the model) a tap away behind the ⋯ and the pencil.
   * A day still to come is still being planned.
   */
  const doing = Boolean(pres) && !isFuture
  // A done plan on an earlier day is the log as written (`liftsDone`): its ✓s are read.
  const asWritten = (e: any) => Boolean(e?.date && e.date < localIso() && isDone(e))
  // Asking the model to change it, only where a model is on offer (#55, D F9).
  const ai = (aiOffered as any)(me?.features)
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
  // The entry as of the latest render, for writes that land after a tap.
  const latestEntry = useRef(entry)
  latestEntry.current = entry
  /* Who is on it, and how: one chip under the title and its panel (sharedwith.tsx, #80). */
  const sharing = useSharing({ entry, opt, me, onSaveEntry, side: sidePerson?.id || null, setSide, theirs,
    touch: () => setDirty(true) })
  const sidesDone = useSidesDone(isFuture ? [] : on, sidePerson?.id || null, theirs.server)
  // Their copy, written like `saveOutputs` writes the owner's. Never a test result.
  const saveTheirs = (out: any) => { setDirty(true); theirs.update((cur: any) => applyOut(cur, opt, out)) }
  const theirDone = Boolean(theirs.entry && isDone(theirs.entry))
  /* A flip says what it did, with Undo (sheetparts.tsx). Their copy's names whose it
     was and goes with the sheet: it is written through this sheet's queue. */
  const flipTheirs = useDoneFlip({ read: () => theirs.entry, whose: sidePerson?.name,
    write: (v: any) => { setDirty(true); void theirs.update((cur: any) => markDone(cur, v)) } })
  const flipMine = useDoneFlip({ read: () => latestEntry.current, outlives: true,
    write: (v: any) => { setDirty(true); onSetDone?.(latestEntry.current, v) } })
  /* Their plan, edited from their side: the same write `savePlan` makes on the owner's. */
  const saveTheirPlan = (next: any) => { setDirty(true); theirs.update((cur: any) => applyPlan(cur, opt, next)) }
  const theirPres = theirs.entry?.data?.plan || null

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
  // THE SIDE ON SCREEN (#80): on Sam's side the title, time and counts are Sam's
  // copy's, never the owner's over Sam's exercises. Until it is read, the day only.
  const shown = sidePerson ? theirs.entry : entry
  const shownPres = sidePerson ? theirPres : pres
  const mins = shown && !shown.deleted ? (loggedMinutes as any)(shown, opt) : null
  const timed = mins !== null ? `${mins} min` : null
  const subLine = metaText([
    entry?.date ? dayWords(entry.date) : null,
    // Its first fact only ("6 exercises"): the whole line wrapped under the title at
    // 390px, and the block's own head says the sets right below (#80).
    timed || (shownPres ? prescriptionLine(shownPres).split(' · ')[0] || null : null),
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
  /* A run already under way, or finished and reopened by Start (#75), is carried
     on, not started: the runner opens where it was. */
  const startWords = (e: any) => ((runOf as any)(e)?.startedAt ? 'Carry on' : 'Start workout')
  const start = (side: string | null = null) => (
    <SheetStart label={startWords(side ? theirs.entry : entry)} onStart={() => { setDirty(true); onStartWorkout?.(opt, side) }} />
  )
  let footer: React.ReactNode = null
  let status: React.ReactNode = null
  if (sidePerson) {
    const theirsLive = theirs.entry && !theirs.entry.deleted
    if (!isFuture && theirsLive) status = <DoneChip done={theirDone} whose={sidePerson.name} onToggle={flipTheirs} />
    /* Their side starts the same shared workout, on their side of the switcher. */
    if (!isFuture && theirsLive && onStartWorkout && pres && theirPres && runnable(opt, theirPres) && canStart(theirs.entry)) {
      footer = start(sidePerson.id)
    }
  } else if (!planned && onLog && !isFuture) {
    // A card opened with nothing on the day yet: putting it there IS the action.
    footer = (
      <View style={st.sheetFoot}>
        <Btn flex title={opt.role === 'rest' ? 'Take a rest day' : `Add to ${dayTitle(day)}`}
          onPress={() => { setDirty(true); onLog(opt) }} />
      </View>
    )
  } else {
    /* A planned session always offers the runner, whatever the CARD declares.
       Not "while not done": today's session is done before it starts. */
    const startable = !isFuture && planned && onStartWorkout && runnable(opt, pres) && canStart(entry)
    if (planned && !isFuture && onSetDone) status = <DoneChip done={done} onToggle={flipMine} />
    if (startable) footer = start()
  }
  /* The other sides of a synced workout, for a removal toast's one line about them
     (lib/removal.js: never a claim about what happened there). */
  const planTalk = pres ? (
    <PlanTalk pres={pres} compact entries={entries} entryId={entry?.id}
      onChange={(next: any) => { setDirty(true); onSavePlan?.(latestEntry.current, next) }} />
  ) : null
  const syncedWith = sidePerson
    ? (synced ? ['you'] : null)
    : (() => { const s = on.filter((p) => isSynced(entry, p.id)).map((p) => p.name); return s.length ? s : null })()
  /* Under the title: the done chip, then who is on it ("with Sam · in sync ›", #80). */
  /* Whose copy this sheet is filling in (only on a shared workout) sits in the
     header too, so it stays put while the body scrolls (the web pins it with
     position: sticky); with the chips it spans the sheet's width (#82). */
  const chips = status || people.length > 0 ? (
    <View style={sheetPartStyles.status}>
      {status}
      <ShareChip entry={entry} on={on} people={people} onOpen={sharing.open} />
    </View>
  ) : null
  const statusRow = on.length ? (
    <View style={{ flex: 1, gap: space[2] }}>
      <PersonSwitch on={on} side={sidePerson?.id || null} onSide={setSide}
        done={isFuture ? null : { '': done, ...sidesDone }} />
      {chips}
    </View>
  ) : chips

  return (
    <Modal
      /*
       * What this session IS, not what the card is called. A planned session is
       * titled by its plan; a card that names itself from what you picked is
       * titled "Mountain bike", not "Log a workout".
       */
      title={String(_titleFor(opt, (shown || entry)?.data?.out, shownPres || pres) || opt.name)}
      /* Whose copy this sheet is filling in, in the header so it stays put while the body
         scrolls (the web pins it with position: sticky). Only on a shared workout. */
      /* The day and one count: one line beside the header's buttons, never wrapped (#82). */
      sub={subLine || undefined}
      // The activity's own icon, as its row in the Log feed shows it (#55).
      icon={(loggedActivity as any)(opt, entry?.data?.out)?.icon || opt.icon}
      tone={tone}
      status={statusRow}
      dismissable={!dirty}
      onClose={onClose}
      /* The name, one layer up: a rename is a thing you do TO the session you are
         looking at, so it belongs where the session's title is. Removing it is in
         the same panel (#94, C N13), so the header is Edit and Close, and nothing
         destructive sits beside the X. A day still to come has the panel too. */
      onRename={planned && !sidePerson ? () => setRenaming(true) : null}
      footer={footer}
      /* Away while the interval timer it opened is up, and back as it was (#94). */
      hidden={timing}
      onHidden={showTimer}
    >
      {/* Who is on it and how, behind the chip under the title. Owner-only; see sharedwith.tsx. */}
      {sharing.isOpen ? (
        <SharePanel entry={entry} on={on} people={people} busy={sharing.busy} error={sharing.error}
          onAdd={sharing.add} onRemove={sharing.remove} onSync={sharing.sync} onCopy={sharing.copy}
          onClose={sharing.close} />
      ) : null}
      {/* A circuit done together that has not reached someone yet (#68): until it has. */}
      {on.length > 0 ? <TogetherPending entry={entry} session={opt} /> : null}
      {/* Everyone else sees, quietly, who it was done with. */}
      {!people.length && planned && <SharedNote entry={entry} people={me.people} />}
      {/* "planned by Alex": quiet, like who it was done with. The entry is theirs now. */}
      {planned && !sidePerson && plannedLine(entry, me) ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[2] }}>
          <Icon name="ClipboardCheck" size={12} color={colors.inkFaint} />
          <T size={font.caption} faint>{plannedLine(entry, me)}</T>
        </View>
      ) : null}

      {sidePerson ? (
        <TheirSide session={opt} copy={theirs.entry} loading={theirs.loading} error={theirs.error}
          person={sidePerson} ownerOut={entry?.data?.out} onSave={saveTheirs} entries={theirLog.entries}
          /* A planned session is its plan, on their side as on the owner's: the same
             exercises, with their own numbers, and "last time" from THEIR log. */
          plan={theirPres ? (
            <PrescriptionEditor pres={theirPres} liftField={liftField} entries={theirLog.entries} entryId={theirs.entry?.id}
              categories={thePlan?.quotaCategories || []} onChange={saveTheirPlan} syncedWith={syncedWith} compact
              doing={!isFuture} asWritten={asWritten(theirs.entry)} />
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
          {/* Still talkable-to after it lands. The thread lives on the entry. While
              doing it, that is planning: behind the pencil (`DetailsSheet`). */}
          {planTalkWhere({ ai, doing }) === 'sheet' ? planTalk : null}
          <PrescriptionEditor pres={pres} liftField={liftField}
            entries={entries} entryId={entry?.id} categories={thePlan?.quotaCategories || []}
            onChange={(next: any) => { setDirty(true); onSavePlan?.(latestEntry.current, next) }} syncedWith={syncedWith} compact
            doing={doing} asWritten={asWritten(entry)} />
          {pres.notes?.length > 0 && (
            <View style={{ marginTop: space[4], gap: space[2] }}>
              {pres.notes.map((n: string, i: number) => (
                <View key={i} style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
                  <Icon name="Info" size={13} color={colors.inkFaint} style={{ marginTop: space[1] }} />
                  <T size={font.caption} faint style={{ flex: 1 }}>{n}</T>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        <>
          <T size={font.label} dim>{opt.dose}</T>
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
          on iOS: the sheet steps aside, the timer comes, and the sheet comes back. */}
      {!isFuture && (planned || onLog) && opt.role !== 'rest' ? (
        <View style={st.tools}>
          <Row icon="Timer" label="Interval timer"
            onPress={askTimer} />
        </View>
      ) : null}

      {renaming && (
        <DetailsSheet session={opt} entry={entry} entries={entries}
          onSave={save}
          training={entry?.data?.training}
          /* Only where the question makes sense — a commute is a ride, not a set
             of max hangs. Driven by the discipline rather than by a list. */
          onTraining={onTraining}
          planTalk={planTalkWhere({ ai, doing }) === 'details' ? planTalk : null}
          future={isFuture}
          onRemove={onRemove && entry ? onRemove : null}
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
  tools: { marginTop: space[4], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
})
