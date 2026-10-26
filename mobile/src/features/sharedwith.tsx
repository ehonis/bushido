/*
 * SHARED WORKOUTS, on the sheet: "With …", the person switcher, and the other
 * person's side of the form. `app/src/sharedwith.jsx`, one to one; the rules are
 * in lib/shared.js and the server's half is `peopleRoute` in server.js.
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
import { AppState, StyleSheet, View } from 'react-native'
import { colors, font, mix, radius, space, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Press, SectionHeader, Spinner, Toggle, s as kit } from '../ui/kit'
import { toneColor } from '../ui/Person'
import { tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { SessionLog } from './sessionlog'
import { withLine, openSide } from '../lib/shared.js'
import { getPersonEntry, putPersonEntry } from '../lib/peopleapi.js'
import * as trainerLib from '../lib/trainer.js'

type Person = { id: string; name: string; entryId?: string; tone?: number }

/** How often an open side re-reads their copy, for changes made on their own phone. */
const REREAD_MS = 10000
/** The side each shared workout was last viewed on, on this device: `{ [entryId]: personId }`. */
const SIDE_KEY = 'bushido:shared-side'
const SIDES_KEPT = 50

/** A picked person's fill and edge, the way accentSoft / accentLine are a picked chip's (people.css `--who-soft`, `--who-line`). */
export const toneSoft = (tone?: number | null) => mix(toneColor(tone), 16, colors.panel3)
export const toneLine = (tone?: number | null) => mix(toneColor(tone), 70, colors.line)

/**
 * Who else is on this workout, and the way to add or take off someone: a section
 * head, then one person chip each (× to take them off) and a dashed chip for
 * everyone who could be added.
 */
export function WithControl({ on = [], people = [], busy = null, error = null, onAdd, onRemove }: {
  on?: Person[]
  people?: Person[]
  busy?: string | null
  error?: string | null
  onAdd: (p: Person) => void
  onRemove: (p: Person) => void
}) {
  if (!people.length) return null
  const free = people.filter((p) => !on.some((o) => o.id === p.id))
  return (
    <View style={st.with} accessibilityLabel="Who else did this workout">
      <SectionHeader title="With" right={busy || undefined} style={{ marginTop: space[4] }} />
      <View style={st.chips}>
        {on.map((p) => (
          <View key={p.id} style={[kit.chip, st.personChip, st.onChip, { backgroundColor: toneSoft(p.tone ?? 1), borderColor: toneLine(p.tone ?? 1) }]}>
            <Avatar name={p.name} tone={p.tone ?? 1} size={22} />
            <T size={font.small} numberOfLines={1} style={{ flexShrink: 1 }}>{p.name}</T>
            <Press onPress={() => onRemove(p)} disabled={Boolean(busy)} style={st.x}
              accessibilityRole="button" accessibilityLabel={`Take ${p.name} off this workout`}>
              <Icon name="X" size={14} color={colors.inkDim} />
            </Press>
          </View>
        ))}
        {free.map((p) => (
          <Press key={p.id} haptic disabled={Boolean(busy)} onPress={() => onAdd(p)} accessibilityRole="button"
            accessibilityLabel={`Add ${p.name} to this workout`} style={[kit.chip, st.ghostChip]}>
            <Icon name="Plus" size={14} color={colors.inkFaint} />
            <T size={font.small} dim>{p.name}</T>
          </Press>
        ))}
      </View>
      {error ? <T size={font.small} color={colors.bad} style={{ marginTop: space[2] }}>{error}</T> : null}
    </View>
  )
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
export function PersonSegmented({ people, side, onSide, label, status = {}, style }: {
  people: { id: string | null; name: string; tone?: number }[]
  side: string | null
  onSide: (id: string | null) => void
  label: string
  status?: Record<string, string>
  style?: any
}) {
  return (
    <View style={[kit.segWrap, { flexDirection: 'row', gap: 4, marginBottom: 0 }, style]} accessibilityRole="tablist" accessibilityLabel={label}>
      {people.map((p) => {
        const sel = (p.id || null) === (side || null)
        const tone = p.tone ?? 1
        const stt = status[p.id || '']
        return (
          <Press key={p.id || 'you'} accessibilityRole="tab" accessibilityState={{ selected: sel }}
            onPress={() => { if (!sel) { tap(); onSide(p.id || null) } }}
            style={[kit.seg, { flex: 1, minHeight: TAP, gap: space[2] },
              sel && { backgroundColor: toneSoft(tone), borderWidth: 1, borderColor: toneLine(tone) }]}>
            <Avatar name={p.name} tone={tone} outline={!sel} />
            <T size={font.body} weight={sel ? 600 : 400} color={sel ? colors.ink : colors.inkDim} numberOfLines={1} style={{ flexShrink: 1 }}>{p.name}</T>
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
export function PersonSwitch({ on = [], side = null, onSide }: {
  on?: Person[]
  side?: string | null
  onSide: (id: string | null) => void
}) {
  if (!on.length) return null
  const who = [{ id: null as string | null, name: 'You', tone: 0 }, ...on.map((p) => ({ id: p.id as string | null, name: p.name, tone: p.tone ?? 1 }))]
  const current = who.find((p) => (p.id || null) === (side || null)) || who[0]
  return (
    <View style={{ marginTop: 10 }}>
      <PersonSegmented people={who} side={side || null} onSide={onSide} label="Whose log this is" />
      <View style={[st.rule, { backgroundColor: toneColor(current.tone) }]} />
    </View>
  )
}

/** "Sync exercises with Sam": one switch per person on the workout. */
export function SyncToggle({ person, on, onChange }: { person: Person; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={st.sync}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={font.body} weight={600}>{`Sync exercises with ${person.name}`}</T>
        <T size={font.small} dim>
          {on ? 'Exercises and sets stay the same on both sides; your numbers stay yours.' : 'Off: changes stay on the side you make them.'}
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
  return (
    <View style={st.note}>
      <Icon name="Users" size={12} color={colors.inkFaint} />
      <T size={font.caption} faint>{line}</T>
    </View>
  )
}

/** Someone's copy of a shared workout, read and written through `/api/people/:id/entry`. */
export function usePersonCopy(personId?: string | null, entryId?: string | null, name = '') {
  // Loading from the first frame: a sheet that reopens on their side must not flash "not in their log".
  // `server` is what the server last said, apart from `entry`, which may hold a
  // write still on its way (or one that never landed): a side's "done" and a
  // circuit done together read `server`.
  const [state, setState] = useState<{ entry: any; server: any; loading: boolean; error: string | null }>(
    () => ({ entry: null, server: null, loading: Boolean(personId && entryId), error: null }))
  const latest = useRef<any>(null)
  const writing = useRef(0)

  useEffect(() => {
    latest.current = null
    if (!personId || !entryId) { setState({ entry: null, server: null, loading: false, error: null }); return undefined }
    let live = true
    setState({ entry: null, server: null, loading: true, error: null })
    getPersonEntry(personId, entryId)
      .then((e: any) => { if (!live) return; latest.current = e; setState({ entry: e, server: e, loading: false, error: null }) })
      .catch((err: any) => { if (live) setState({ entry: null, server: null, loading: false, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    // Re-read while open (and in the foreground), never over an edit still on its way.
    const iv = setInterval(() => {
      if (writing.current || AppState.currentState !== 'active') return
      const was = latest.current
      getPersonEntry(personId, entryId).then((e: any) => {
        if (!live || !e) return
        setState((s) => (s.server === e ? s : { ...s, server: e }))
        if (writing.current || latest.current !== was) return
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
    writing.current += 1
    setState((s) => ({ ...s, entry: next, error: null }))
    try {
      const merged = await putPersonEntry(personId as string, next)
      if (latest.current === next) { latest.current = merged; setState((s) => ({ ...s, entry: merged, server: merged })) }
      else setState((s) => ({ ...s, server: merged }))
      return true
    } catch (err: any) {
      setState((s) => ({ ...s, error: `Not saved to ${name || 'their'} log yet: ${err.message}` }))
      return false
    } finally {
      writing.current -= 1
    }
  }, [personId, name])

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
  session, copy, loading = false, error = null, person, ownerOut, entries = [], onSave,
  plan = null, onCopyMine = null, ownerHasExercises = false, synced = false,
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
  onCopyMine?: (() => void) | null
  ownerHasExercises?: boolean
  synced?: boolean
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
      {/* With sync off: the owner's exercises, copied over when asked, never their numbers (lib/shared.js copyExercises). */}
      {synced ? null : onCopyMine ? (
        <Btn title={`Copy my exercises to ${person.name}`} icon="Copy" kind="ghost" onPress={onCopyMine} />
      ) : ownerHasExercises ? (
        <T size={font.small} dim>{`${person.name} has all your exercises.`}</T>
      ) : null}
    </View>
  )
}

const st = StyleSheet.create({
  with: { marginBottom: space[4] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  personChip: { paddingLeft: 5 },
  ghostChip: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  // The × takes someone off: a destructive tap, so a full 44pt target. The chip grows to hold it.
  onChip: { minHeight: TAP },
  x: { width: TAP, height: TAP, marginVertical: -1, marginLeft: -4, marginRight: -space[3] - 1, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginBottom: space[3] },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  rule: { height: 2, marginTop: space[2], borderRadius: 1 },
  sync: {
    flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: TAP, marginBottom: space[3], padding: space[3],
    borderRadius: radius.card, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
})
