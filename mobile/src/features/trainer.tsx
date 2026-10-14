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
import { colors, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, H2, Input, Field, Press, Spinner, Sub } from '../ui/kit'
import { FullScreen, Modal } from '../ui/Sheet'
import { Fold } from '../ui/Fold'
import { Dot, toneColor } from '../ui/Person'
import { impact, success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { WorkoutRunner } from './runner'
import { WorkoutMode } from './workout'
import { SessionLog } from './sessionlog'
import { usePersonCopy } from './sharedwith'
import * as peopleApi from '../lib/peopleapi.js'
import { optFor } from '../lib/menu.js'
import * as trainerLib from '../lib/trainer.js'
import { prescriptionSteps, runProgress, restLeft, itemLine, prescriptionLine } from '../lib/prescription.js'
import { mondayOf, weekDays, shiftWeek } from '../lib/quota.js'
import { fromIso, localIso } from '../lib/dates.js'
import { currentMe } from '../lib/whoami.js'

type Person = { id: string; name: string; entryId?: string; tone?: number }
type Side = { id: string | null; name: string; entryId: string | null; tone: number }

// Default parameters in the ported JS narrow TypeScript's inference; cast here
// rather than edit the copied file (mobile/AGENTS.md).
const { applyRun, applyOut, applyDone, dayOf, dayRow, runKind, plannedLine, toneFor } = trainerLib as any

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`
const isDoneEntry = (e: any) => Boolean(e && !e.deleted && e.data?.done !== false)

/* ------------------------------------------------------------ For: … */

/** "For: You / Sam", at the top of the planners. Nothing for anyone but the owner. */
export function ForChoice({ people = [], target = null, onTarget }: {
  people?: Person[]
  target?: Person | null
  onTarget: (p: Person | null) => void
}) {
  if (!people.length) return null
  const opts = [{ id: null as string | null, name: 'You', tone: 0 }, ...people.map((p) => ({ id: p.id, name: p.name, tone: toneFor(people, p.id) }))]
  return (
    <View style={st.forRow} accessibilityLabel="Who this is for">
      <T size={12} faint>For</T>
      <View style={st.seg}>
        {opts.map((o) => {
          const on = (target?.id || null) === o.id
          return (
            <Press key={o.id || 'you'} haptic onPress={() => onTarget(o.id ? people.find((p) => p.id === o.id) || null : null)}
              accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={[st.segBtn, on && { backgroundColor: colors.panel2, borderBottomColor: toneColor(o.tone) }]}>
              <T size={13} weight={500} color={on ? toneColor(o.tone) : colors.inkFaint} numberOfLines={1}>{o.name}</T>
            </Press>
          )
        })}
      </View>
    </View>
  )
}

/** "Planning for Sam", on every screen after the choice. */
export function ForLine({ person, people = [] }: { person?: Person | null; people?: Person[] }) {
  if (!person) return null
  const c = toneColor(toneFor(people, person.id))
  return (
    <View style={[st.forLine, { borderLeftColor: c }]}>
      <Icon name="Users" size={13} color={colors.inkDim} />
      <T size={13} dim style={{ flex: 1 }}>
        {'Planning for '}<T size={13} weight={700} color={c}>{person.name}</T>
        {`, with ${person.name}’s log. It is written to ${person.name}’s, from you.`}
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

export function sideStatus(kind: string, entry: any, now = Date.now()) {
  if (!entry || entry.deleted) return ''
  if (isDoneEntry(entry)) return 'done'
  if (kind !== 'runner') return ''
  const run = entry.data?.run || null
  const left = restLeft(run, now)
  if (left > 0) return `rest ${mmss(left)}`
  if (run?.restUntil && now - run.restUntil < 60000) return 'rest up'
  const p: any = runProgress(run, prescriptionSteps(entry.data?.plan))
  return p.total ? `${p.done}/${p.total}` : ''
}

/** You / Sam inside a running workout, each with its colour and what that side is doing. */
export function SideSwitch({ sides = [], side = null, onSide, status = {} }: {
  sides?: Side[]
  side?: string | null
  onSide: (id: string | null) => void
  status?: Record<string, string>
}) {
  if (sides.length < 2) return null
  return (
    <View style={[st.seg, { marginHorizontal: 10, marginTop: 8 }]} accessibilityLabel="Whose side of the workout is showing">
      {sides.map((s) => {
        const on = (s.id || null) === (side || null)
        const stt = status[s.id || '']
        return (
          <Press key={s.id || 'you'} onPress={() => onSide(s.id || null)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={[st.segBtn, { minHeight: TAP, flexDirection: 'row', gap: 6 }, on && { backgroundColor: colors.panel2, borderBottomColor: toneColor(s.tone) }]}>
            <Dot tone={s.tone} />
            <T size={13} weight={600} color={on ? colors.ink : colors.inkFaint} numberOfLines={1}>{s.name}</T>
            {stt ? <T size={11} faint tabular>{stt}</T> : null}
          </Press>
        )
      })}
    </View>
  )
}

/**
 * A workout run from more than one person's side. Every side stays mounted so
 * each keeps its own clock; only the side on screen makes a sound. Each side is
 * that person's own entry with its OWN writer (§6.2). Finishing a side hands over
 * to the next one not done yet, and the last one closes the screen.
 */
export function SidesWorkout({
  kind, session, sides = [], ownerEntry = null, entries = [],
  onOwnerRun = null, onOwnerSave = null, onOwnerDone = null, onExit, initialSide = null,
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
  initialSide?: string | null
}) {
  const insets = useSafeAreaInsets()
  const [side, setSide] = useState<string | null>(() => (sides.some((s) => s.id && s.id === initialSide) ? initialSide as string : sides[0]?.id ?? null))
  const [copies, setCopies] = useState<Record<string, any>>({})
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (sides.length < 2) return undefined
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [sides.length])

  const report = useCallback((id: string, e: any) => setCopies((c) => (c[id] === e ? c : { ...c, [id]: e })), [])
  const entryOf = (s: Side) => (s.id ? copies[s.id] : ownerEntry)
  const status: Record<string, string> = {}
  for (const s of sides) status[s.id || ''] = sideStatus(kind, entryOf(s), now)

  const pick = (id: string | null) => {
    if ((id || null) === (side || null)) return
    // Native: a firm tap on the switch, so a glance is not needed to know it took.
    impact()
    setSide(id)
  }
  const finishSide = (id: string | null) => () => {
    const next = sides.find((s) => (s.id || null) !== (id || null) && !isDoneEntry(entryOf(s)))
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

/** "Sam's day", on Today: the owner's way to see someone's days without acting as them. */
export function PeopleDays({ people = [], date, plan }: { people?: Person[]; date: string; plan: any }) {
  const [open, setOpen] = useState<Person | null>(null)
  if (!people.length) return null
  return (
    <>
      <View style={st.peopleDays}>
        {people.map((p) => (
          <Press key={p.id} haptic onPress={() => setOpen(p)} accessibilityRole="button" style={st.peopleDay}>
            <Dot tone={toneFor(people, p.id)} />
            <T size={13} dim>{`${p.name}’s day`}</T>
          </Press>
        ))}
      </View>
      {open ? (
        <PersonDay person={{ ...open, tone: toneFor(people, open.id) }} date={date} plan={plan} onClose={() => setOpen(null)} />
      ) : null}
    </>
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
  const c = toneColor(person.tone ?? 1)
  const label = `${fromIso(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
    `${fromIso(weekDays(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

  return (
    <FullScreen title={`${person.name}’s week`} sub={label} icon="Users" onBack={onClose}>
      <View style={{ height: 3, backgroundColor: c, marginBottom: 8, borderRadius: 2 }} />
      <View style={st.daynav}>
        <Press haptic onPress={() => setMonday((m: string) => shiftWeek(m, -1))} style={st.navBtn} accessibilityLabel="previous week">
          <Icon name="ChevronLeft" size={18} color={colors.inkDim} />
        </Press>
        <T size={14} weight={600} style={{ flex: 1 }} align="center">
          {label}{monday === mondayOf(today) ? ' · this week' : ''}
        </T>
        <Press haptic onPress={() => setMonday((m: string) => shiftWeek(m, 1))} style={st.navBtn} accessibilityLabel="next week">
          <Icon name="ChevronRight" size={18} color={colors.inkDim} />
        </Press>
      </View>
      <Sub style={{ marginBottom: 10 }}>
        {`What is on ${person.name}’s days. Open one to log it or run it from ${person.name}’s side; everything you change is written to ${person.name}’s log.`}
      </Sub>
      {log.loading ? <Spinner label={`Opening ${person.name}’s log…`} /> : null}
      {log.error ? <T size={12} color={colors.bad}>{`Could not open ${person.name}’s log: ${log.error}`}</T> : null}
      {log.ready ? weekDays(monday).map((d: string) => {
        const rows = dayOf(log.entries, d).map((e: any) => dayRow(e, menu, me))
        return (
          <View key={d} style={{ marginBottom: 12 }}>
            <T size={12} weight={600} color={d === today ? c : colors.inkFaint} style={{ marginBottom: 4, letterSpacing: 0.5 }}>
              {fromIso(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
            </T>
            {rows.length ? rows.map((r: any) => (
              <Press key={r.id} haptic onPress={() => setOpenId(r.id)} accessibilityRole="button" style={st.dayRow}>
                <Icon name={r.done ? 'CircleCheck' : 'Circle'} size={16} color={r.done ? colors.vizGood : colors.inkFaint} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T size={14} weight={600} numberOfLines={1}>{r.name}</T>
                  <T size={12} faint numberOfLines={1}>
                    {[r.running ? 'in progress' : r.done ? 'done' : 'not done yet', r.plannedBy, r.sharedFrom ? 'shared' : null].filter(Boolean).join(' · ')}
                  </T>
                </View>
                <Icon name="ChevronRight" size={16} color={colors.inkFaint} />
              </Press>
            )) : <T size={12} faint style={{ marginBottom: 4 }}>Nothing on this day.</T>}
          </View>
        )
      }) : null}
      <Fold summary={`About ${person.name}`} style={{ marginTop: 16 }}>
        <AboutForm load={() => peopleApi.getPersonAbout(person.id)} save={(doc: any) => peopleApi.putPersonAbout(person.id, doc)}
          lead={`What ${person.name}'s coach and planners are told, and what yours are told when you plan for ${person.name}.`} />
      </Fold>

      {openId ? (
        <PersonEntrySheet person={person} entryId={openId} menu={menu} entries={log.entries}
          onClose={() => { setOpenId(null); log.reload() }} />
      ) : null}
    </FullScreen>
  )
}

/** One of someone's sessions, opened by the owner. Every write goes to that one entry in their log. */
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

  const done = isDoneEntry(e)
  const pres = e?.data?.plan || null
  const by = e ? plannedLine(e, me) : null
  return (
    <Modal title={e?.data?.name || opt?.name || 'Session'} sub={`${person.name}’s log`} icon="Users" onClose={onClose}
      footer={e && !e.deleted ? (
        <View style={{ gap: 8 }}>
          {kind && !done ? (
            <Btn icon="Play" title={`Start for ${person.name}`} onPress={() => { impact(); setRunning(true) }} />
          ) : null}
          <Btn kind={done ? 'ghost' : 'primary'} icon={done ? 'CircleCheck' : 'Circle'}
            title={done ? `Done for ${person.name} — tap to undo` : `Mark done for ${person.name}`}
            onPress={() => { if (!done) success(); copy.update((cur: any) => applyDone(cur, !done)) }} />
        </View>
      ) : null}>
      <View style={[st.forLine, { borderLeftColor: toneColor(tone) }]}>
        <Icon name="Users" size={13} color={colors.inkDim} />
        <T size={13} dim>{`${person.name}’s side`}</T>
      </View>
      {copy.loading ? <Spinner label={`Opening ${person.name}’s log…`} /> : null}
      {copy.error ? <T size={12} color={colors.bad}>{copy.error}</T> : null}
      {e && !e.deleted ? (
        <>
          {by ? (
            <View style={st.note}><Icon name="ClipboardCheck" size={12} color={colors.inkFaint} /><T size={12} faint>{by}</T></View>
          ) : null}
          {pres ? (
            <View style={{ marginBottom: 12, gap: 6 }}>
              <T size={13} dim>{prescriptionLine(pres)}</T>
              {(pres.blocks || []).map((b: any) => (
                <View key={b.id} style={{ gap: 2 }}>
                  <T size={14} weight={600}>{b.name}</T>
                  {(b.items || []).map((it: any) => <T key={it.id} size={12} dim>{`${it.name} · ${itemLine(it)}`}</T>)}
                  {!b.items?.length && b.note ? <T size={12} dim>{b.note}</T> : null}
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

/** A person's name and notes for their own coach and planners. */
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
      <Field label="Notes for the coach and planners">
        <Input multiline value={doc.notes} maxLength={4000} style={{ minHeight: 110 }}
          placeholder="Goals, injuries, the equipment you have, anything a coach should know."
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
        lead={me.acting ? `What ${me.name}'s coach and planners are told about ${me.name}.`
          : 'What your coach and planners are told about you. Only you and the owner of this install can see it.'} />
    </Card>
  )
}

const st = StyleSheet.create({
  forRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  seg: {
    flex: 1, flexDirection: 'row', gap: 4, padding: 3, borderRadius: radius.md,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
  },
  segBtn: {
    flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm,
    borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 6,
  },
  forLine: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, padding: 10,
    borderRadius: radius.md, borderLeftWidth: 3, backgroundColor: colors.panel,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  err: { position: 'absolute', left: 12, right: 12, bottom: 24, padding: 10, borderRadius: radius.md, backgroundColor: colors.panel2 },
  peopleDays: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 16 },
  peopleDay: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: TAP, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  daynav: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  navBtn: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center' },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: TAP, padding: 10, marginBottom: 4,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  note: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
})
