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
import { colors, mix } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, Press, Spinner, Toggle } from '../ui/kit'
import { toneColor } from '../ui/Person'
import { tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { SessionLog } from './sessionlog'
import { withLine, openSide } from '../lib/shared.js'
import { getPersonEntry, putPersonEntry } from '../lib/peopleapi.js'

type Person = { id: string; name: string; entryId?: string; tone?: number }

/** How often an open side re-reads their copy, for changes made on their own phone. */
const REREAD_MS = 10000
/** The side each shared workout was last viewed on, on this device: `{ [entryId]: personId }`. */
const SIDE_KEY = 'bushido:shared-side'
const SIDES_KEPT = 50

/** Who else is on this workout, and the way to add or take off someone. */
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
    <View style={st.row} accessibilityLabel="Who else did this workout">
      <View style={st.lead}>
        <Icon name="Users" size={14} color={colors.inkFaint} />
        <T size={12} faint>With</T>
      </View>
      {on.map((p) => (
        <View key={p.id} style={st.onChip}>
          <T size={13}>{p.name}</T>
          <Press onPress={() => onRemove(p)} disabled={Boolean(busy)} style={st.x}
            accessibilityRole="button" accessibilityLabel={`Take ${p.name} off this workout`}>
            <Icon name="X" size={13} color={colors.inkFaint} />
          </Press>
        </View>
      ))}
      {free.map((p) => (
        <Chip key={p.id} small icon="Plus" label={p.name} onPress={busy ? undefined : () => onAdd(p)} />
      ))}
      {busy ? <T size={12} faint>{busy}</T> : null}
      {error ? <T size={12} color={colors.bad} style={{ width: '100%' }}>{error}</T> : null}
    </View>
  )
}

/** A person's initial in their colour. */
export function Avatar({ name, tone = 0, size = 28 }: { name: string; tone?: number; size?: number }) {
  return (
    <View style={[st.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: toneColor(tone) }]}>
      <T size={Math.round(size / 2)} weight={700} color={colors.bg}>{(String(name || '?').trim().charAt(0) || '?').toUpperCase()}</T>
    </View>
  )
}

/**
 * You / Sam, at the top of a shared workout's sheet: each person's initial and
 * name in their colour, the one being filled in filled in. Nothing without
 * someone on it. `on` people carry `tone`.
 */
export function PersonSwitch({ on = [], side = null, onSide }: {
  on?: Person[]
  side?: string | null
  onSide: (id: string | null) => void
}) {
  if (!on.length) return null
  const who: Person[] = [{ id: '', name: 'You', tone: 0 }, ...on]
  return (
    <View style={st.bar} accessibilityRole="tablist" accessibilityLabel="Whose log this is">
      {who.map((p) => {
        const sel = (p.id || null) === (side || null)
        const c = toneColor(p.tone ?? 1)
        return (
          <Press key={p.id || 'you'} accessibilityRole="tab" accessibilityState={{ selected: sel }}
            onPress={() => { if (!sel) { tap(); onSide(p.id || null) } }}
            style={[st.barBtn, sel ? { borderColor: c, backgroundColor: mix(c, 18, colors.panel) } : null]}>
            <Avatar name={p.name} tone={p.tone ?? 1} />
            <T size={15} weight={sel ? 700 : 400} color={sel ? colors.ink : colors.inkDim} numberOfLines={1} style={{ flexShrink: 1 }}>{p.name}</T>
          </Press>
        )
      })}
    </View>
  )
}

/** "Sync exercises with Sam": one switch per person on the workout. */
export function SyncToggle({ person, on, onChange }: { person: Person; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={st.sync}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T size={15} weight={600}>{`Sync exercises with ${person.name}`}</T>
        <T size={12} faint>
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
    <View style={[st.lead, { marginBottom: 10 }]}>
      <Icon name="Users" size={12} color={colors.inkFaint} />
      <T size={12} faint>{line}</T>
    </View>
  )
}

/** Someone's copy of a shared workout, read and written through `/api/people/:id/entry`. */
export function usePersonCopy(personId?: string | null, entryId?: string | null, name = '') {
  // Loading from the first frame: a sheet that reopens on their side must not flash "not in their log".
  const [state, setState] = useState<{ entry: any; loading: boolean; error: string | null }>(
    () => ({ entry: null, loading: Boolean(personId && entryId), error: null }))
  const latest = useRef<any>(null)
  const writing = useRef(0)

  useEffect(() => {
    latest.current = null
    if (!personId || !entryId) { setState({ entry: null, loading: false, error: null }); return undefined }
    let live = true
    setState({ entry: null, loading: true, error: null })
    getPersonEntry(personId, entryId)
      .then((e: any) => { if (!live) return; latest.current = e; setState({ entry: e, loading: false, error: null }) })
      .catch((err: any) => { if (live) setState({ entry: null, loading: false, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    // Re-read while open (and in the foreground), never over an edit still on its way.
    const iv = setInterval(() => {
      if (writing.current || AppState.currentState !== 'active') return
      const was = latest.current
      getPersonEntry(personId, entryId).then((e: any) => {
        if (!live || writing.current || latest.current !== was || !e) return
        if (was && String(e.updatedAt || '') <= String(was.updatedAt || '')) return
        latest.current = e
        setState((s) => ({ ...s, entry: e }))
      }).catch(() => { /* offline: keep what is on screen */ })
    }, REREAD_MS)
    return () => { live = false; clearInterval(iv) }
  }, [personId, entryId, name])

  const update = useCallback(async (fn: (cur: any) => any) => {
    const cur = latest.current
    if (!cur || cur.deleted) return
    const next = fn(cur)
    latest.current = next
    writing.current += 1
    setState((s) => ({ ...s, entry: next, error: null }))
    try {
      const merged = await putPersonEntry(personId as string, next)
      if (latest.current === next) { latest.current = merged; setState((s) => ({ ...s, entry: merged })) }
    } catch (err: any) {
      setState((s) => ({ ...s, error: `Not saved to ${name || 'their'} log yet: ${err.message}` }))
    } finally {
      writing.current -= 1
    }
  }, [personId, name])

  return { ...state, update }
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
    return <T size={13} dim>{error || `This workout is not in ${person.name}'s log any more.`}</T>
  }
  return (
    <View style={{ gap: 4 }}>
      <T size={13} dim>{`Everything here goes in ${person.name}’s log. Your numbers show in grey.`}</T>
      {error ? <T size={12} color={colors.bad}>{error}</T> : null}
      {plan}
      <SessionLog session={session} entry={copy} entries={entries} onSave={onSave}
        hints={ownerOut || null} measured={false} defaultOpen whose={person.name} />
      {/* With sync off: the owner's exercises, copied over when asked, never their numbers (lib/shared.js copyExercises). */}
      {synced ? null : onCopyMine ? (
        <Btn title={`Copy my exercises to ${person.name}`} icon="Copy" kind="ghost" onPress={onCopyMine} />
      ) : ownerHasExercises ? (
        <T size={13} dim>{`${person.name} has all your exercises.`}</T>
      ) : null}
    </View>
  )
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 2 },
  onChip: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 12, minHeight: 36,
    borderRadius: 999, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.panel,
  },
  x: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  bar: { flexDirection: 'row', gap: 8, marginTop: 10 },
  barBtn: {
    flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.line,
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  sync: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, marginBottom: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
})
