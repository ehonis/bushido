/*
 * THE OWNER AS TRAINER, on screen: "For: You / Sam" in the planners, the side
 * switcher inside a workout, the owner's read-only view of someone's day, and
 * About you for everyone. `app/src/trainer.jsx`, one to one; the rules are in
 * lib/trainer.js and the server's half is `peopleRoute` and `aiSpaceFor`.
 *
 * Owner-only, on the owner's own log: `planPeople(me)` is empty for anyone else,
 * while acting as someone and on a one-person install. Someone else's log is
 * never held in the owner's store; what is open is WHICH person and WHICH entry
 * id, and the entry is whatever the server last answered.
 *
 * Native: switching sides in a workout gives a haptic; the workout sides share
 * ONE full-screen modal (iOS presents one at a time), each runner `embedded`.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Modal as RNModal, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, H2, IconBtn, Input, Field, Press, SectionHeader, Spinner, Sub, s as kit } from '../ui/kit'
import { FullScreen, Modal } from '../ui/Sheet'
import { Fold } from '../ui/Fold'
import { toneColor } from '../ui/Person'
import { impact, success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { WorkoutRunner } from './runner'
import { WorkoutMode } from './workout'
import { SessionLog } from './sessionlog'
import { usePersonCopy, Avatar, PersonChip, PersonSegmented } from './sharedwith'
import * as peopleApi from '../lib/peopleapi.js'
import { optFor } from '../lib/menu.js'
import * as trainerLib from '../lib/trainer.js'
import { isDone } from '../lib/store.js'
import { prescriptionSteps, runProgress, restLeft, itemLine, prescriptionLine } from '../lib/prescription.js'
import { fromIso, localIso, mondayOf, weekDays, shiftWeek } from '../lib/dates.js'
import { currentMe } from '../lib/whoami.js'

type Person = { id: string; name: string; entryId?: string; tone?: number }
type Side = { id: string | null; name: string; entryId: string | null; tone: number }

// Default parameters in the ported JS narrow TypeScript's inference; cast here
// rather than edit the copied file (mobile/AGENTS.md).
const { applyRun, applyOut, applyDone, canStart, dayOf, dayRow, runKind, plannedLine, toneFor } = trainerLib as any

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`

/* ------------------------------------------------------------ For: … */

/** "For: You / Sam", at the top of the planners: the same person chips as "With …". Nothing for anyone but the owner. */
export function ForChoice({ people = [], target = null, onTarget }: {
  people?: Person[]
  target?: Person | null
  onTarget: (p: Person | null) => void
}) {
  if (!people.length) return null
  return (
    <View style={st.forRow} accessibilityLabel="Who this is for">
      <T size={font.small} dim style={{ marginRight: space[1] }}>For</T>
      <PersonChip person={{ name: 'You' }} tone={0} on={!target} onPress={() => onTarget(null)} tall />
      {people.map((p) => (
        <PersonChip key={p.id} person={p} tone={toneFor(people, p.id)} on={target?.id === p.id} onPress={() => onTarget(p)} tall />
      ))}
    </View>
  )
}

/** "Planning for Sam", on every screen after the choice. */
export function ForLine({ person, people = [] }: { person?: Person | null; people?: Person[] }) {
  if (!person) return null
  const tone = toneFor(people, person.id)
  return (
    <View style={[st.forLine, { borderLeftColor: toneColor(tone) }]}>
      <Avatar name={person.name} tone={tone} size={22} />
      <T size={font.small} dim style={{ flex: 1 }}>
        {'Planning for '}<T size={font.small} weight={600}>{person.name}</T>{` · it goes in ${person.name}’s log`}
      </T>
    </View>
  )
}

/** Someone's whole log and plan, through the people endpoints. `ready` once THIS person's answer is in. */
export function usePersonLog(personId?: string | null) {
  const [state, setState] = useState<{ id: string | null; entries: any[]; plan: any; loading: boolean; error: string | null }>(
    { id: null, entries: [], plan: null, loading: false, error: null })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!personId) { setState({ id: null, entries: [], plan: null, loading: false, error: null }); return undefined }
    let live = true
    setState((s) => ({ ...s, loading: true, error: null }))
    Promise.all([peopleApi.getPersonState(personId), peopleApi.getPersonContent(personId)])
      .then(([stt, plan]: any[]) => {
        if (live) setState({ id: personId, entries: Object.values(stt?.entries || {}), plan, loading: false, error: null })
      })
      .catch((err: any) => { if (live) setState({ id: null, entries: [], plan: null, loading: false, error: err.message }) })
    return () => { live = false }
  }, [personId, nonce])
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { ...state, ready: Boolean(personId) && state.id === personId && !state.loading, reload }
}

/* -------------------------------------------------- sides of a workout */

/**
 * "Done" is finished on this screen or a run that has ended, not `isDone`: every
 * side of today's workout is done by default (§4) before anyone has lifted.
 */
export function sideStatus(kind: string, entry: any, now = Date.now(), finished = false) {
  if (!entry || entry.deleted) return ''
  if (finished || entry.data?.run?.endedAt) return 'done'
  if (kind !== 'runner') return ''
  const run = entry.data?.run || null
  const left = restLeft(run, now)
  if (left > 0) return `rest ${mmss(left)}`
  if (run?.restUntil && now - run.restUntil < 60000) return 'rest up'
  const p: any = runProgress(run, prescriptionSteps(entry.data?.plan))
  return p.total ? `${p.done}/${p.total}` : ''
}

/** You / Sam inside a running workout: the sheet's person segmented control, with what each side is doing. */
export function SideSwitch({ sides = [], side = null, onSide, status = {} }: {
  sides?: Side[]
  side?: string | null
  onSide: (id: string | null) => void
  status?: Record<string, string>
}) {
  if (sides.length < 2) return null
  return (
    <PersonSegmented people={sides} side={side || null} onSide={onSide} status={status}
      label="Whose side of the workout is showing" style={{ marginHorizontal: 10, marginTop: space[2] }} />
  )
}

/**
 * A workout run from more than one person's side. Every side stays mounted so
 * each keeps its own clock; only the side on screen makes a sound. Each side is
 * that person's own entry with its OWN writer (§6.2). Finishing a side hands over
 * to the next one not yet finished, and the last one closes the screen.
 */
export function SidesWorkout({
  kind, session, sides = [], ownerEntry = null, entries = [],
  onOwnerRun = null, onOwnerSave = null, onOwnerDone = null, onExit, onSwitch = null, initialSide = null,
}: {
  kind: 'runner' | 'mode'
  session: any
  sides?: Side[]
  ownerEntry?: any
  entries?: any[]
  onOwnerRun?: ((run: any, opts: any) => void) | null
  onOwnerSave?: ((out: any) => void) | null
  onOwnerDone?: ((v: boolean) => void) | null
  onExit: () => void
  onSwitch?: ((id: string | null) => void) | null
  initialSide?: string | null
}) {
  const insets = useSafeAreaInsets()
  const [side, setSide] = useState<string | null>(() => (sides.some((s) => s.id && s.id === initialSide) ? initialSide as string : sides[0]?.id ?? null))
  const [copies, setCopies] = useState<Record<string, any>>({})
  // The sides finished on this screen, by id ('' for the owner).
  const [finished, setFinished] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sides.length < 2) return undefined
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [sides.length])

  const report = useCallback((id: string, e: any) => setCopies((c) => (c[id] === e ? c : { ...c, [id]: e })), [])
  const entryOf = (s: Side) => (s.id ? copies[s.id] : ownerEntry)
  const status: Record<string, string> = {}
  for (const s of sides) status[s.id || ''] = sideStatus(kind, entryOf(s), now, finished.includes(s.id || ''))

  const pick = (id: string | null) => {
    if ((id || null) === (side || null)) return
    // Native: a firm tap on the switch, so a glance is not needed to know it took.
    impact()
    setSide(id)
    onSwitch?.(id)
  }
  const finishSide = (id: string | null) => () => {
    const over = [...finished, id || '']
    setFinished(over)
    const next = sides.find((s) => !over.includes(s.id || '') && !entryOf(s)?.data?.run?.endedAt)
    if (next) { success(); pick(next.id || null) } else onExit()
  }
  const switcher = <SideSwitch sides={sides} side={side} onSide={pick} status={status} />

  return (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onExit}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
          {sides.map((s) => {
            const shown = (s.id || null) === (side || null)
            const who = sides.length > 1 || s.id ? { name: s.id ? s.name : 'You', tone: s.tone } : null
            return (
              <View key={s.id || 'you'} style={shown ? { flex: 1 } : { display: 'none' }}
                accessibilityElementsHidden={!shown} importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}>
                {s.id ? (
                  <TheirSlot kind={kind} person={s} session={session} shown={shown} who={who} switcher={switcher}
                    onExit={onExit} onFinish={finishSide(s.id)} report={report} />
                ) : kind === 'runner' ? (
                  <WorkoutRunner session={session} entry={ownerEntry} entries={entries} onRun={onOwnerRun as any}
                    onExit={onExit} onFinish={finishSide(null)} who={who} switcher={switcher} shown={shown} embedded />
                ) : (
                  <WorkoutMode session={session} entry={ownerEntry} onSave={onOwnerSave as any} onSetDone={onOwnerDone || undefined}
                    onExit={onExit} onFinish={finishSide(null)} who={who} switcher={switcher} shown={shown} embedded />
                )}
              </View>
            )
          })}
        </View>
      </GestureHandlerRootView>
    </RNModal>
  )
}

function TheirSlot({ kind, person, session, shown, who, switcher, onExit, onFinish, report }: any) {
  const copy = usePersonCopy(person.id, person.entryId, person.name)
  // Their own history, for "last time" in the runner: they lift different weights.
  const log = usePersonLog(kind === 'runner' ? person.id : null)
  useEffect(() => { report(person.id, copy.entry) }, [person.id, copy.entry, report])

  if (!copy.entry || copy.entry.deleted) {
    return (
      <View style={{ flex: 1 }}>
        {switcher}
        <View style={st.empty}>
          {copy.loading ? <Spinner label={`Opening ${person.name}’s log…`} />
            : <T size={15} align="center">{copy.error || `This workout is not in ${person.name}’s log any more.`}</T>}
          <Btn title="Back" onPress={onExit} />
        </View>
      </View>
    )
  }
  return (
    <View style={{ flex: 1 }}>
      {kind === 'runner' ? (
        <WorkoutRunner session={session} entry={copy.entry} entries={log.entries}
          onRun={(run: any, opts: any) => copy.update((cur: any) => applyRun(cur, session, run, opts))}
          onExit={onExit} onFinish={onFinish} who={who} switcher={switcher} shown={shown} embedded />
      ) : (
        <WorkoutMode session={session} entry={copy.entry}
          onSave={(out: any) => copy.update((cur: any) => applyOut(cur, session, out))}
          onSetDone={(v: boolean) => copy.update((cur: any) => applyDone(cur, v))}
          onExit={onExit} onFinish={onFinish} who={who} switcher={switcher} shown={shown} embedded />
      )}
      {copy.error && shown ? (
        <View style={st.err}><T size={13} color={colors.bad}>{copy.error}</T></View>
      ) : null}
    </View>
  )
}

/* ------------------------------------------------------ someone's day */

const dayWords = (iso: string) => fromIso(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

/** What a row says about one of someone's sessions: where it stands, who planned it. */
const rowMeta = (r: any) => [r.running ? 'In progress' : r.done ? 'Done' : 'Not done yet', r.plannedBy, r.sharedFrom ? 'shared' : null]
  .filter(Boolean).join(' · ')

/** "Sam's day", on Today: a card with one row per person, the owner's way into someone's days without acting as them. */
export function PeopleDays({ people = [], date, plan }: { people?: Person[]; date: string; plan: any }) {
  const [open, setOpen] = useState<Person | null>(null)
  const [seen, setSeen] = useState(0)
  if (!people.length) return null
  return (
    <>
      <Card style={st.listCard}>
        {people.map((p, i) => (
          <PersonDayRow key={p.id} person={p} tone={toneFor(people, p.id)} date={date} plan={plan} seen={seen}
            first={i === 0} onOpen={() => setOpen(p)} />
        ))}
      </Card>
      {open ? (
        <PersonDay person={{ ...open, tone: toneFor(people, open.id) }} date={date} plan={plan}
          onClose={() => { setOpen(null); setSeen((n) => n + 1) }} />
      ) : null}
    </>
  )
}

/** One person's row: their initial, "Sam's day", and what is on it, from their log. Until that answers the row is just the door. */
function PersonDayRow({ person, tone, date, plan, seen, first, onOpen }: {
  person: Person; tone: number; date: string; plan: any; seen: number; first: boolean; onOpen: () => void
}) {
  const [names, setNames] = useState<string[] | null>(null)
  useEffect(() => {
    let live = true
    setNames(null)
    peopleApi.getPersonDay(person.id, date)
      .then((entries: any[]) => { if (live) setNames(dayOf(entries, date).map((e: any) => dayRow(e, plan?.dailyMenu || []).name)) })
      .catch(() => { /* offline or refused: the row is still the way in */ })
    return () => { live = false }
  }, [person.id, date, plan, seen])
  return (
    <Press haptic onPress={onOpen} accessibilityRole="button" style={[kit.row, !first && st.divider]}>
      <Avatar name={person.name} tone={tone} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={font.body} weight={500} numberOfLines={1}>{`${person.name}’s day`}</T>
        {names ? <T size={font.small} dim numberOfLines={1}>{names.length ? names.join(' · ') : 'Nothing on it yet'}</T> : null}
      </View>
      <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
    </Press>
  )
}

/** Someone's week, read-only, from their log on the server; a tap opens one session. */
export function PersonDay({ person, date = localIso(), plan, openId: initialOpen = null, onClose }: {
  person: Person
  date?: string
  plan: any
  openId?: string | null
  onClose: () => void
}) {
  const log = usePersonLog(person.id)
  const [monday, setMonday] = useState(() => mondayOf(date))
  const [openId, setOpenId] = useState<string | null>(initialOpen)
  const me = currentMe()
  const menu = (log.plan || plan)?.dailyMenu || []
  const today = localIso()
  const tone = person.tone ?? 1
  const c = toneColor(tone)
  const label = `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
    `${fromIso(weekDays(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  return (
    <FullScreen title={`${person.name}’s week`} sub={label} icon="Users" onBack={onClose}>
      <View style={{ height: 3, backgroundColor: c, marginBottom: space[2], borderRadius: 2 }} />
      <View style={st.daynav}>
        <IconBtn icon="ChevronLeft" size={20} label="Previous week" onPress={() => setMonday((m: string) => shiftWeek(m, -1))} />
        <T size={font.body} weight={600} style={{ flex: 1 }} align="center">
          {monday === mondayOf(today) ? 'This week' : label}
        </T>
        <IconBtn icon="ChevronRight" size={20} label="Next week" onPress={() => setMonday((m: string) => shiftWeek(m, 1))} />
      </View>
      <View style={st.lead}>
        <Avatar name={person.name} tone={tone} size={22} />
        <Sub style={{ flex: 1 }}>{`Everything you change here goes in ${person.name}’s log.`}</Sub>
      </View>
      {log.loading ? <Spinner label={`Opening ${person.name}’s log…`} /> : null}
      {log.error ? <T size={font.small} color={colors.bad}>{`Could not open ${person.name}’s log: ${log.error}`}</T> : null}
      {log.ready ? weekDays(monday).map((d: string, i: number) => {
        const rows = dayOf(log.entries, d).map((e: any) => dayRow(e, menu, me))
        return (
          <View key={d} style={i ? { marginTop: space[5] } : null}>
            <SectionHeader title={dayWords(d)} style={{ marginTop: 0 }}
              right={d === today ? (
                <Sub><T size={font.small} weight={600} color={c}>Today</T>{rows.length ? '' : ' · Nothing'}</Sub>
              ) : rows.length ? undefined : 'Nothing'} />
            {rows.length ? (
              <Card style={[st.listCard, { marginBottom: 0 }]}>
                {rows.map((r: any, j: number) => (
                  <Press key={r.id} haptic onPress={() => setOpenId(r.id)} accessibilityRole="button" style={[kit.row, j > 0 && st.divider]}>
                    <Icon name={r.done ? 'CircleCheck' : 'Circle'} size={20} color={r.done ? colors.vizGood : colors.inkFaint} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <T size={font.body} weight={500} numberOfLines={1}>{r.name}</T>
                      <T size={font.small} dim numberOfLines={1}>{rowMeta(r)}</T>
                    </View>
                    <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
                  </Press>
                ))}
              </Card>
            ) : null}
          </View>
        )
      }) : null}
      <Fold summary={`About ${person.name}`} style={{ marginTop: space[6] }}>
        <AboutForm load={() => peopleApi.getPersonAbout(person.id)} save={(doc: any) => peopleApi.putPersonAbout(person.id, doc)}
          lead={`What ${person.name}'s workout planner is told, and what yours is told when you plan for ${person.name}.`} />
      </Fold>

      {openId ? (
        <PersonEntrySheet person={person} entryId={openId} menu={menu} entries={log.entries}
          onClose={() => { setOpenId(null); log.reload() }} />
      ) : null}
    </FullScreen>
  )
}

/**
 * One of someone's sessions, opened by the owner. Every write goes to that one
 * entry in their log. Done is the default once its day arrives, so the footer
 * offers the exception: Mark undone, or Mark done on one that was undone.
 */
export function PersonEntrySheet({ person, entryId, menu = [], entries = [], onClose }: {
  person: Person
  entryId: string
  menu?: any[]
  entries?: any[]
  onClose: () => void
}) {
  const copy = usePersonCopy(person.id, entryId, person.name)
  const [running, setRunning] = useState(false)
  const me = currentMe()
  const e = copy.entry
  const opt = e ? optFor(menu, e.data?.optId) : null
  const kind = e && opt ? runKind(e, opt) : null
  const tone = person.tone ?? 1

  if (running && e && opt && kind) {
    return (
      <SidesWorkout kind={kind as any} session={opt} sides={[{ id: person.id, name: person.name, entryId, tone }]}
        onExit={() => setRunning(false)} />
    )
  }

  const done = isDone(e)
  const pres = e?.data?.plan || null
  const start = Boolean(kind && e && canStart(e))
  const by = e ? plannedLine(e, me) : null
  return (
    <Modal title={e?.data?.name || opt?.name || 'Session'} sub={e?.date ? dayWords(e.date) : `${person.name}’s log`} icon="Users" onClose={onClose}
      footer={e && !e.deleted ? (
        <View style={{ gap: space[2] }}>
          {start ? (
            <Btn icon="Play" title={`Start for ${person.name}`} onPress={() => { impact(); setRunning(true) }} />
          ) : null}
          <Btn kind={done ? 'quiet' : start ? 'secondary' : 'primary'} icon={done ? 'CircleCheck' : 'Circle'}
            title={done ? 'Mark undone' : `Mark done for ${person.name}`}
            onPress={() => { if (!done) success(); copy.update((cur: any) => applyDone(cur, !done)) }} />
        </View>
      ) : null}>
      <View style={[st.forLine, { borderLeftColor: toneColor(tone) }]}>
        <Avatar name={person.name} tone={tone} size={22} />
        <T size={font.small} dim style={{ flex: 1 }}>
          <T size={font.small} weight={600}>{`${person.name}’s log`}</T>{by ? ` · ${by}` : ''}
        </T>
      </View>
      {copy.loading ? <Spinner label={`Opening ${person.name}’s log…`} /> : null}
      {copy.error ? <T size={font.small} color={colors.bad}>{copy.error}</T> : null}
      {e && !e.deleted ? (
        <>
          {pres ? (
            <View style={{ marginBottom: space[3], gap: space[2] }}>
              <Sub>{prescriptionLine(pres)}</Sub>
              {(pres.blocks || []).map((b: any) => (
                <View key={b.id} style={{ gap: 2 }}>
                  <T size={font.body} weight={600}>{b.name}</T>
                  {(b.items || []).map((it: any) => <Sub key={it.id}>{`${it.name} · ${itemLine(it)}`}</Sub>)}
                  {!b.items?.length && b.note ? <Sub>{b.note}</Sub> : null}
                </View>
              ))}
            </View>
          ) : null}
          {opt ? (
            <SessionLog session={opt} entry={e} entries={entries} measured={false} defaultOpen
              onSave={(out: any) => copy.update((cur: any) => applyOut(cur, opt, out))} />
          ) : null}
        </>
      ) : null}
      {e?.deleted ? <Sub>{`This session is not in ${person.name}’s log any more.`}</Sub> : null}
    </Modal>
  )
}

/* ------------------------------------------------------------ About you */

/** A person's name and notes for their own workout planner. */
export function AboutForm({ load, save, lead = null }: {
  load: () => Promise<any>
  save: (doc: { name: string; notes: string }) => Promise<any>
  lead?: string | null
}) {
  const [doc, setDoc] = useState<{ name: string; notes: string } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    load().then((d) => { if (live) setDoc({ name: d?.name || '', notes: d?.notes || '' }) })
      .catch((err) => { if (live) setStatus(err.message) })
    return () => { live = false }
    // Loaded once per mount: the form owns its text after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!doc) return <Sub>{status || 'Loading…'}</Sub>
  const submit = async () => {
    setStatus('Saving…')
    try {
      const d = await save(doc)
      setDoc({ name: d?.name || '', notes: d?.notes || '' })
      setStatus('Saved')
      success()
    } catch (err: any) { setStatus(err.message) }
  }
  return (
    <View style={{ gap: 10 }}>
      {lead ? <Sub>{lead}</Sub> : null}
      <Field label="Name">
        <Input value={doc.name} maxLength={80} autoCorrect={false}
          onChangeText={(v) => { setDoc({ ...doc, name: v }); setStatus(null) }} />
      </Field>
      <Field label="Notes for the workout planner">
        <Input multiline value={doc.notes} maxLength={4000} style={{ minHeight: 110 }}
          placeholder="Goals, injuries, the equipment you have, anything a planner should know."
          onChangeText={(v) => { setDoc({ ...doc, notes: v }); setStatus(null) }} />
      </Field>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Btn title="Save" onPress={submit} />
        {status ? <Sub>{status}</Sub> : null}
      </View>
    </View>
  )
}

/** About you, in the profile, for anyone but the owner (whose is on the Settings page). */
export function MyAbout({ me = currentMe() }: { me?: any }) {
  if (me.owner) return null
  return (
    <Card>
      <H2>About you</H2>
      <AboutForm load={peopleApi.getMyAbout} save={peopleApi.putMyAbout}
        lead={me.acting ? `What ${me.name}'s workout planner is told about ${me.name}.`
          : 'What your workout planner is told about you. Only you and the owner of this install can see it.'} />
    </Card>
  )
}

const st = StyleSheet.create({
  forRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], marginBottom: space[4] },
  forLine: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3], paddingVertical: space[2], paddingHorizontal: space[3],
    borderRadius: radius.control, borderLeftWidth: 3, backgroundColor: colors.panel2,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[4], padding: space[6] },
  err: { position: 'absolute', left: space[3], right: space[3], bottom: space[6], padding: 10, borderRadius: radius.card, backgroundColor: colors.panel2 },
  listCard: { paddingVertical: space[1] },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  daynav: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
  lead: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
})
