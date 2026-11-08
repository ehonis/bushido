/*
 * SHARED WORKOUTS, on the sheet: the sharing chip and its panel, the person
 * switcher, and the other person's side of the form. `app/src/sharedwith.jsx`,
 * one to one; the rules are in lib/shared.js and the server's half is
 * `peopleRoute` in server.js.
 *
 * ONE ROW, NOT A SETUP SECTION (#80): who is on a workout is one chip under the
 * title beside the done chip ("with Sam · in sync ›", or "Add someone"), opening
 * `SharePanel` (a page sheet) with the sync switch, Copy my exercises (sync off),
 * Take Sam off and Add Jo. The "With" chips and the Sync card no longer sit
 * between the title and the workout.
 *
 * Owner-only, on the owner's own log: `sharePeople(me)` is empty for anyone
 * else, while acting as someone and on a one-person install. The other person's
 * copy is never held in the owner's store; the sheet keeps WHICH person and
 * WHICH entry id, and the copy is whatever the server last answered, re-read
 * every few seconds while open. With sync on, the server keeps the exercises
 * the same on both sides (server/sharedsync.js); this file only shows the switch.
 *
 * Native: the person bar goes in the sheet's header (`sub`), which sits outside
 * the ScrollView, so it stays put while the body scrolls (the web pins it with
 * `position: sticky`). The sync switch is the system Switch; taking someone off
 * asks with a system alert (`confirm`), and switching sides gives a haptic.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppState, ScrollView, StyleSheet, View } from 'react-native'
import { colors, font, mix, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, IconBtn, Press, Spinner, Toggle, s as kit } from '../ui/kit'
import { Popover } from '../ui/Sheet'
import { confirm } from '../ui/menu'
import { toneColor } from '../ui/Person'
import { success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { pushToast } from '../lib/toast'
import { SessionLog } from './sessionlog'
import * as sharedLib from '../lib/shared.js'
import * as peopleApi from '../lib/peopleapi.js'
import { getPersonEntry, putPersonEntry, sendPersonEntry } from '../lib/peopleapi.js'
import { createCopyQueue, openedCopy } from '../lib/copyqueue.js'
import { withAck, isDone } from '../lib/store.js'
import * as trainerLib from '../lib/trainer.js'

type Person = { id: string; name: string; entryId?: string; tone?: number }

const {
  withLine, inStepLine, openSide, shareSummary, isSynced, addPerson, removePerson, withSharedPerson,
  withSync, copyExercises, hasExercises,
} = sharedLib as any

/** How often an open side re-reads their copy, for changes made on their own phone. */
const REREAD_MS = 10000
/** The side each shared workout was last viewed on, on this device: `{ [entryId]: personId }`. */
const SIDE_KEY = 'bushido:shared-side'
const SIDES_KEPT = 50

/** A picked person's fill and edge, the way accentSoft / accentLine are a picked chip's (people.css `--who-soft`, `--who-line`). */
export const toneSoft = (tone?: number | null) => mix(toneColor(tone), 16, colors.panel3)
export const toneLine = (tone?: number | null) => mix(toneColor(tone), 70, colors.line)

/**
 * The owner's one row about who is on this workout, under the title beside the
 * done chip: "with Sam · in sync ›", or "Add someone" when nobody is. 32pt to
 * look at, 44 to hit, like the done chip; it opens `SharePanel`. Nothing for
 * anyone but the owner (`people` is empty).
 */
export function ShareChip({ entry, on = [], people = [], onOpen }: {
  entry: any; on?: Person[]; people?: Person[]; onOpen: () => void
}) {
  if (!people.length) return null
  const { title, sync } = shareSummary(entry, on)
  return (
    <Press haptic onPress={onOpen} hitSlop={6} accessibilityRole="button"
      accessibilityLabel={on.length ? `Who is on this workout: ${title}${sync ? `, ${sync}` : ''}` : 'Add someone to this workout'}
      style={[st.shareChip, { flexShrink: 1 }]}>
      <Icon name={on.length ? 'Users' : 'UserPlus'} size={16} color={colors.inkFaint} />
      <T size={font.small} weight={500} color={on.length ? colors.ink : colors.inkDim} numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}{sync ? <T size={font.small} dim>{` · ${sync}`}</T> : null}
      </T>
      <Icon name="ChevronRight" size={14} color={colors.inkFaint} />
    </Press>
  )
}

/**
 * Everything that changes who is on a workout, and how, behind the sharing chip:
 * per person their sync switch, "Copy my exercises to Sam" while sync is off,
 * and "Take Sam off this workout" (which asks first when they have logged on
 * their copy); then a row for everyone who could be added. A page sheet over
 * the session sheet, like the exercise sheet.
 */
export function SharePanel({ entry, on = [], people = [], busy = null, error = null, onAdd, onRemove, onSync, onCopy = null, onClose }: {
  entry: any
  on?: Person[]
  people?: Person[]
  busy?: string | null
  error?: string | null
  onAdd: (p: Person) => void
  onRemove: (p: Person) => void
  onSync: (p: Person, v: boolean) => void
  onCopy?: ((p: Person) => void) | null
  onClose: () => void
}) {
  const free = people.filter((p) => !on.some((o) => o.id === p.id))
  return (
    <Popover label="Who is on this workout" onClose={onClose}>
      <View style={st.panelHead}>
        <T size={font.title} weight={600} style={{ flex: 1 }}>{on.length ? 'Who is on this workout' : 'Add someone'}</T>
        <IconBtn icon="X" label="Close" onPress={onClose} size={20} />
      </View>
      <ScrollView contentContainerStyle={st.panelBody}>
        {on.map((p, i) => {
          const synced = isSynced(entry, p.id)
          return (
            <View key={p.id} style={[st.panelPerson, i > 0 && st.panelDivider]} accessibilityLabel={p.name}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Avatar name={p.name} tone={p.tone ?? 1} />
                <T size={font.body} weight={600}>{p.name}</T>
              </View>
              <SyncToggle person={p} on={synced} onChange={(v) => onSync(p, v)} />
              {!synced && onCopy && hasExercises(entry) ? (
                <Btn kind="ghost" icon="Copy" title={`Copy my exercises to ${p.name}`} disabled={Boolean(busy)} onPress={() => onCopy(p)} />
              ) : null}
              <Btn kind="quiet" icon="UserMinus" title={`Take ${p.name} off this workout`} disabled={Boolean(busy)} onPress={() => onRemove(p)} />
            </View>
          )
        })}
        {free.length ? (
          <View style={on.length ? st.panelDivider : null}>
            {free.map((p) => (
              <Press key={p.id} haptic disabled={Boolean(busy)} onPress={() => onAdd(p)} accessibilityRole="button"
                accessibilityLabel={`Add ${p.name} to this workout`} style={kit.row}>
                <Icon name="UserPlus" size={20} color={colors.inkDim} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T size={font.body} weight={500}>{`Add ${p.name}`}</T>
                  <T size={font.small} dim>{`It goes in ${p.name}’s log; ${p.name} logs their own numbers`}</T>
                </View>
              </Press>
            ))}
          </View>
        ) : null}
        {busy ? <T size={font.small} dim>{busy}</T> : null}
        {error ? <T size={font.small} color={colors.bad}>{error}</T> : null}
      </ScrollView>
    </Popover>
  )
}

/**
 * The sharing chip's writes, out of the sheet (#80): add someone, take someone
 * off, switch sync, copy the owner's exercises over. "Copy my exercises" writes
 * through the ONE queue a side has, so for someone not on screen it opens their
 * side first and copies once their copy is read. The panel closes before a
 * removal asks: a system alert cannot show over a page sheet on its way out.
 */
/** Whose copy a person on the workout is, as `usePersonCopy` names the one it holds (`of`). */
export const copyOf = (person: Person | null) => (person ? `${person.id}\n${person.entryId}` : null)

/**
 * May "Copy my exercises to `person`" write now? Only on their side, with THEIR
 * copy read: right after a switch the copy on screen is still the last side's,
 * and with three people two copies can share an entry id.
 */
export const copyReady = (person: Person | null, side: string | null, theirs: any) => Boolean(person && side === person.id
  && theirs?.entry && !theirs.loading && theirs.of === copyOf(person))

export function useSharing({ entry, opt, me, onSaveEntry, side, setSide, theirs, touch = () => {} }: {
  entry: any; opt: any; me: any; onSaveEntry?: ((e: any) => void) | null
  side: string | null; setSide: (id: string | null) => void; theirs: any; touch?: () => void
}) {
  const [state, setState] = useState<{ isOpen: boolean; busy: string | null; error: string | null }>({ isOpen: false, busy: null, error: null })
  const [copyFor, setCopyFor] = useState<Person | null>(null)
  // The entry as of the latest render: an add or a removal awaits the server.
  const latest = useRef(entry)
  latest.current = entry
  const run = async (verb: string, person: Person, fn: () => Promise<boolean | void>) => {
    setState((s) => ({ ...s, busy: `${verb} ${person.name}…`, error: null }))
    try {
      if (await fn()) success()
      setState((s) => ({ ...s, busy: null, error: null }))
    } catch (err: any) {
      setState((s) => ({ ...s, busy: null, error: `${person.name}: ${err.message}` }))
    }
  }
  const add = (person: Person) => run('Adding', person, async () => {
    const { copy } = await addPerson({ ownerEntry: latest.current, person, session: opt,
      owner: { id: me.real.id, name: me.real.name }, api: peopleApi })
    onSaveEntry?.(withSharedPerson(latest.current, person.id, copy.id))
    return true
  })
  const remove = (person: Person) => {
    setState((s) => ({ ...s, isOpen: false }))
    void run('Taking off', person, async () => {
      const next = await removePerson({ ownerEntry: latest.current, person, session: opt, api: peopleApi,
        confirmFn: (q: string) => confirm(q, { confirmLabel: 'Take it out' }) })
      if (!next) return false
      if (side === person.id) setSide(null)
      onSaveEntry?.(withSharedPerson(latest.current, person.id, null, { remove: true }))
      return true
    })
  }
  /* Sync lives on the owner's link; the server does the keeping-the-same (server/sharedsync.js). */
  const sync = (person: Person, v: boolean) => onSaveEntry?.(withSync(latest.current, person.id, v))
  const copy = (person: Person) => {
    touch()
    setState((s) => ({ ...s, isOpen: false }))
    setCopyFor(person)
    if (side !== person.id) setSide(person.id)
  }
  // Their side is open and their copy is read: copy now, through its queue, once.
  useEffect(() => {
    // Only once the copy on screen IS theirs: right after a switch it is still the last side's.
    if (!copyFor || !copyReady(copyFor, side, theirs)) return
    const person: Person = copyFor
    setCopyFor(null)
    if (copyExercises(theirs.entry, latest.current) === theirs.entry) { pushToast(`${person.name} has all your exercises`, 'info'); return }
    // Said once it landed: a write that did not is the copy's own Retry toast.
    void theirs.update((cur: any) => copyExercises(cur, latest.current)).then((landed: boolean) => {
      if (!landed) return
      success()
      pushToast(`Copied your exercises to ${person.name}`, 'info')
    })
  }, [copyFor, side, theirs.entry, theirs.loading, theirs.of]) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    ...state,
    open: () => setState((s) => ({ ...s, isOpen: true, error: null })),
    close: () => setState((s) => ({ ...s, isOpen: false })),
    add, remove, sync, copy,
  }
}

/**
 * Each side's done state, for the person switch: the side on screen from what
 * its copy last read (`server`), everyone else's read once as the sheet opens
 * and again on every switch. `{ [personId]: boolean }`.
 */
export function useSidesDone(on: Person[] = [], sideId: string | null = null, sideServer: any = null) {
  const [read, setRead] = useState<Record<string, boolean>>({})
  const key = on.map((p) => `${p.id}:${p.entryId}`).join(',')
  useEffect(() => {
    let live = true
    for (const p of on) {
      if (p.id === sideId) continue
      getPersonEntry(p.id, p.entryId)
        .then((e: any) => { if (live) setRead((r) => ({ ...r, [p.id]: Boolean(e && !e.deleted && isDone(e)) })) })
        .catch(() => { /* offline: no tick, rather than a wrong one */ })
    }
    return () => { live = false }
  }, [key, sideId]) // eslint-disable-line react-hooks/exhaustive-deps
  const out: Record<string, boolean> = { ...read }
  if (sideId && sideServer) out[sideId] = Boolean(!sideServer.deleted && isDone(sideServer))
  return out
}

/**
 * A person's initial in their colour: filled when it is the one picked or the
 * only one shown, an outline in their colour beside a picked one, so which side
 * is on is never told by colour alone.
 */
export function Avatar({ name, tone = 0, size = 28, outline = false }: { name: string; tone?: number; size?: number; outline?: boolean }) {
  const c = toneColor(tone)
  return (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2 },
      outline ? { borderWidth: 1.5, borderColor: c } : { backgroundColor: c }]}>
      <T size={size <= 22 ? font.caption : font.small} weight={700} color={outline ? c : colors.bg} lineHeight={size - 4}>
        {(String(name || '?').trim().charAt(0) || '?').toUpperCase()}
      </T>
    </View>
  )
}

/**
 * One person as a choice: their initial and name, in their colour when picked.
 * The same chip in "With …" and "For: …". `tall` for an answer (44pt).
 */
export function PersonChip({ person, tone = 1, on = false, onPress, tall = false }: {
  person: { name: string }
  tone?: number
  on?: boolean
  onPress: () => void
  tall?: boolean
}) {
  return (
    <Press haptic onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[kit.chip, st.personChip, tall && { minHeight: TAP, paddingRight: space[4] },
        on && { backgroundColor: toneSoft(tone), borderColor: toneLine(tone) }]}>
      <Avatar name={person.name} tone={tone} size={22} outline={!on} />
      <T size={font.small} color={on ? colors.ink : colors.inkDim} numberOfLines={1} style={{ flexShrink: 1 }}>{person.name}</T>
    </Press>
  )
}

/**
 * The segmented control for people: the sheet's person bar and the workout's
 * side switcher. The side on screen is raised in that person's colour with their
 * initial filled; the others are outlined. `status` is what each side is doing.
 */
export function PersonSegmented({ people, side, onSide, label, status = {}, done = null, style }: {
  people: { id: string | null; name: string; tone?: number }[]
  side: string | null
  onSide: (id: string | null) => void
  label: string
  status?: Record<string, string>
  done?: Record<string, boolean> | null
  style?: any
}) {
  return (
    <View style={[kit.segWrap, { flexDirection: 'row', gap: 4, marginBottom: 0 }, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {people.map((p) => {
        const sel = (p.id || null) === (side || null)
        const tone = p.tone ?? 1
        const stt = status[p.id || '']
        // Each side's done state on its own tab (#80), a tick beside the name.
        const d = done ? done[p.id || ''] : undefined
        return (
          <Press key={p.id || 'you'} accessibilityRole="tab" accessibilityState={{ selected: sel }}
            accessibilityLabel={d === undefined ? undefined : `${p.name}: ${d ? 'done' : 'not done'}`}
            onPress={() => { if (!sel) { tap(); onSide(p.id || null) } }}
            style={[kit.seg, { flex: 1, minHeight: TAP, gap: space[2] },
              sel && { backgroundColor: toneSoft(tone), borderWidth: 1, borderColor: toneLine(tone) }]}>
            <Avatar name={p.name} tone={tone} outline={!sel} />
            <T size={font.body} weight={sel ? 600 : 400} color={sel ? colors.ink : colors.inkDim} numberOfLines={1} style={{ flexShrink: 1 }}>{p.name}</T>
            {d === true ? <Icon name="CircleCheck" size={16} color={sel ? colors.ink : colors.inkDim} /> : null}
            {stt ? <T size={font.caption} dim tabular>{stt}</T> : null}
          </Press>
        )
      })}
    </View>
  )
}

/**
 * You / Sam, at the top of a shared workout's sheet, with a rule in the picked
 * person's colour under it. Nothing without someone on it. `on` people carry `tone`.
 */
export function PersonSwitch({ on = [], side = null, onSide, done = null }: {
  on?: Person[]
  side?: string | null
  onSide: (id: string | null) => void
  done?: Record<string, boolean> | null
}) {
  if (!on.length) return null
  const who = [{ id: null as string | null, name: 'You', tone: 0 }, ...on.map((p) => ({ id: p.id as string | null, name: p.name, tone: p.tone ?? 1 }))]
  const current = who.find((p) => (p.id || null) === (side || null)) || who[0]
  return (
    <View style={{ marginTop: 10 }}>
      <PersonSegmented people={who} side={side || null} onSide={onSide} label="Whose log this is" done={done} />
      <View style={[st.rule, { backgroundColor: toneColor(current.tone) }]} />
    </View>
  )
}

/** "Keep exercises in step": one switch per person, in the sharing panel. */
export function SyncToggle({ person, on, onChange }: { person: Person; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={st.sync}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={font.body} weight={600}>Keep exercises in step</T>
        <T size={font.small} dim>
          {on ? `Exercises and sets added or removed on your side or ${person.name}’s show on both. Numbers stay each person’s own.`
            : 'Off: changes stay on the side you make them.'}
        </T>
      </View>
      <Toggle value={on} onChange={onChange} />
    </View>
  )
}

function readSides(): Record<string, string> {
  try { return JSON.parse((globalThis as any).localStorage?.getItem(SIDE_KEY) || '{}') || {} } catch { return {} }
}

/** Remember the side a shared workout was last on (null: the owner's), from the sheet or a running workout. */
export function rememberSide(entryId?: string | null, id?: string | null) {
  if (!entryId) return
  try {
    const all = readSides()
    delete all[entryId]
    if (id) all[entryId] = id
    const kept = Object.fromEntries(Object.entries(all).slice(-SIDES_KEPT))
    ;(globalThis as any).localStorage?.setItem(SIDE_KEY, JSON.stringify(kept))
  } catch { /* storage full: the sheet just opens on yours */ }
}

/** Which side this sheet is on, starting on the one last viewed on this device. */
export function useSide(entryId: string | null | undefined, on: Person[] = []): [string | null, (id: string | null) => void] {
  const [side, setSide] = useState<string | null>(() => openSide(entryId ? readSides()[entryId] : null, on))
  const pick = useCallback((id: string | null) => { setSide(id); rememberSide(entryId, id) }, [entryId])
  return [openSide(side, on), pick]
}

/** "with Alex": who a shared workout was done with, where nothing can be changed about it. */
export function SharedNote({ entry, people = [] }: { entry: any; people?: Person[] }) {
  const line = withLine(entry, people)
  if (!line) return null
  // On a copy in step with the owner's (#80): say so, so an exercise added or
  // taken off here is known to change the owner's workout too.
  const step = inStepLine(entry)
  return (
    <View style={{ marginBottom: space[3], gap: space[1] }}>
      <View style={[st.note, { marginBottom: 0 }]}>
        <Icon name="Users" size={12} color={colors.inkFaint} />
        <T size={font.caption} faint>{line}</T>
      </View>
      {step ? (
        <View style={[st.note, { marginBottom: 0 }]}>
          <Icon name="Repeat" size={12} color={colors.inkFaint} />
          <T size={font.caption} faint>{step}</T>
        </View>
      ) : null}
    </View>
  )
}

/**
 * Someone's copy of a shared workout, read and written through `/api/people/:id/entry`.
 * The screen is the truth while you edit: writes go one at a time (lib/copyqueue.js),
 * and an answer to an older write never replaces newer edits; the copy takes that
 * write's receipt as its base instead (lib/store.js `withAck`).
 */
export function usePersonCopy(personId?: string | null, entryId?: string | null, name = '') {
  // Loading from the first frame: a sheet that reopens on their side must not flash "not in their log".
  // `server` is what the server last said, apart from `entry`, which may hold a
  // write still on its way (or one that never landed): a side's "done" and a
  // circuit done together read `server`.
  // `of` is whose copy `entry` is ("<person>\n<entry id>"): entry ids repeat across
  // people (`daily-<date>`), and for a render after a switch `entry` is still the last one's.
  const [state, setState] = useState<{ entry: any; server: any; loading: boolean; error: string | null; of: string | null }>(
    () => ({ entry: null, server: null, loading: Boolean(personId && entryId), error: null, of: null }))
  const latest = useRef<any>(null)
  // Who the copy on screen belongs to, for answers that land after the sheet switched sides.
  const owner = useRef<string | null>(null)
  owner.current = personId && entryId ? `${personId}\n${entryId}` : null
  const named = useRef(name)
  named.current = name
  const mine = (pid: string, e: any) => Boolean(e && owner.current === `${pid}\n${e.id}`)
  // An answer that landed while the copy was still being read (`openedCopy`).
  const early = useRef<any>(null)
  const queue = useRef<any>(null)
  if (!queue.current) {
    queue.current = createCopyQueue({
      send: (pid: string, e: any) => sendPersonEntry(pid, e),
      current: (pid: string, e: any) => (mine(pid, e) && latest.current?.id === e.id ? latest.current : e),
      landed: (pid: string, sent: any, reply: any) => {
        if (!mine(pid, sent)) return
        const merged = reply.entry
        if (!latest.current) { early.current = merged; return }
        if (latest.current === sent) { latest.current = merged; setState((s) => ({ ...s, entry: merged, server: merged })) }
        else { latest.current = withAck(latest.current, sent, reply.ack); setState((s) => ({ ...s, server: merged })) }
      },
      failed: (pid: string, sent: any, err: any) => {
        if (mine(pid, sent)) setState((s) => ({ ...s, error: `Not saved to ${named.current || 'their'} log yet: ${err.message}` }))
      },
    })
  }

  useEffect(() => {
    latest.current = null
    early.current = null
    if (!personId || !entryId) { setState({ entry: null, server: null, loading: false, error: null, of: null }); return undefined }
    let live = true
    setState({ entry: null, server: null, loading: true, error: null, of: null })
    getPersonEntry(personId, entryId)
      .then((e: any) => {
        if (!live) return
        // An edit of this copy still unanswered, or a save that landed meanwhile: not an older read.
        const mine = openedCopy(e, queue.current.newest(personId, entryId), early.current)
        early.current = null
        latest.current = mine
        setState({ entry: mine, server: e, loading: false, error: null, of: `${personId}\n${entryId}` })
      })
      .catch((err: any) => { if (live) setState({ entry: null, server: null, loading: false, of: null, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    // Re-read while open (and in the foreground), never over an edit still on its way.
    const iv = setInterval(() => {
      if (queue.current.busy || AppState.currentState !== 'active') return
      const was = latest.current
      getPersonEntry(personId, entryId).then((e: any) => {
        if (!live || !e) return
        setState((s) => (s.server === e ? s : { ...s, server: e }))
        if (queue.current.busy || latest.current !== was) return
        if (was && String(e.updatedAt || '') <= String(was.updatedAt || '')) return
        latest.current = e
        setState((s) => ({ ...s, entry: e }))
      }).catch(() => { /* offline: keep what is on screen */ })
    }, REREAD_MS)
    return () => { live = false; clearInterval(iv) }
  }, [personId, entryId, name])

  /*
   * Resolves true once the write landed, false if it did not (offline), so a
   * caller writing for several people can say who it missed (a circuit done
   * together, trainer.tsx). A `fn` that returns nothing has nothing to write;
   * one that returns the entry unchanged re-sends it (the sheet's Retry).
   */
  const update = useCallback(async (fn: (cur: any) => any): Promise<boolean> => {
    const cur = latest.current
    if (!cur || cur.deleted) return false
    const next = fn(cur)
    if (!next) return true
    latest.current = next
    setState((s) => ({ ...s, entry: next, error: null }))
    return queue.current.push(personId as string, next)
  }, [personId])

  /** An entry the server just answered with, written elsewhere (a circuit done together). */
  const accept = useCallback((e: any) => {
    if (!e) return
    if (!latest.current || String(e.updatedAt || '') >= String(latest.current.updatedAt || '')) {
      latest.current = e
      setState((s) => ({ ...s, entry: e, server: e }))
    } else setState((s) => ({ ...s, server: e }))
  }, [])

  return { ...state, update, accept }
}

/**
 * A circuit done together that did not reach someone (lib/trainer.js, rule 4),
 * said on the workout's sheet until it has: tried again as the sheet opens
 * (re-read, then fill), and on Try again. Nothing with nothing waiting.
 */
export function TogetherPending({ entry, session = null }: { entry: any; session?: any }) {
  const { pendingFor, retryPending, andWords } = trainerLib as any
  const storage = (globalThis as any).localStorage || null
  // Read against the LIVE entry every render: a miss about a run this entry no
  // longer carries (deleted and planned again, someone taken off) goes.
  const [, setTried] = useState(0)
  const left: any[] = pendingFor(storage, entry)
  const [busy, setBusy] = useState(false)
  const retry = async () => {
    setBusy(true)
    try {
      await retryPending({ storage, ownerEntry: entry, readPerson: getPersonEntry, putPerson: putPersonEntry, session })
    } catch { /* still waiting: the note stays */ } finally { setBusy(false); setTried((n) => n + 1) }
  }
  useEffect(() => { if (left.length) void retry() }, [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!left.length) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] }} accessibilityRole="alert">
      <Icon name="TriangleAlert" size={12} color={colors.inkDim} />
      <T size={font.small} style={{ flex: 1 }}>The circuit is not on {andWords([...new Set(left.map((p: any) => p.name))])}’s log yet</T>
      <Btn kind="quiet" small title="Try again" disabled={busy} onPress={() => { void retry() }} />
    </View>
  )
}

/**
 * The other person's side: their form, the owner's numbers as placeholders, no
 * WHOOP or Strava. `entries` is THEIR log, so "last time" is theirs. With sync
 * on there is nothing to copy.
 */
export function TheirSide({
  session, copy, loading = false, error = null, person, ownerOut, entries = [], onSave, plan = null,
}: {
  session: any
  copy: any
  loading?: boolean
  error?: string | null
  person: Person
  ownerOut?: any
  entries?: any[]
  onSave: (out: any) => void
  plan?: React.ReactNode
}) {
  if (loading) return <Spinner label={`Opening ${person.name}’s log…`} />
  if (!copy || copy.deleted) {
    return <T size={font.small} dim>{error || `This workout is not in ${person.name}'s log any more.`}</T>
  }
  return (
    <View style={{ gap: 4 }}>
      <T size={font.small} dim>{`Everything here goes in ${person.name}’s log. Your numbers show in grey.`}</T>
      {error ? <T size={font.small} color={colors.bad}>{error}</T> : null}
      {plan}
      <SessionLog session={session} entry={copy} entries={entries} onSave={onSave}
        hints={ownerOut || null} measured={false} defaultOpen whose={person.name} />
    </View>
  )
}

const st = StyleSheet.create({
  personChip: { paddingLeft: 5 },
  // "with Sam · in sync ›": the done chip's shape (sheetparts.tsx), quiet.
  shareChip: {
    flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, minHeight: 32, paddingLeft: space[3], paddingRight: space[2],
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
  panelHead: {
    flexDirection: 'row', alignItems: 'center', gap: space[3], paddingLeft: space[4], paddingRight: space[2], paddingVertical: space[3],
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  panelBody: { padding: space[4], gap: space[4] },
  panelPerson: { gap: space[2] },
  panelDivider: { paddingTop: space[4], borderTopWidth: 1, borderTopColor: colors.line },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[3] },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  rule: { height: 2, marginTop: space[2], borderRadius: 1 },
  sync: {
    flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: TAP, padding: space[3],
    borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
})
