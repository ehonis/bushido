/*
 * SHARED WORKOUTS, on the sheet: "With …", the person switcher, and the other
 * person's side of the form. `app/src/sharedwith.jsx`, one to one; the rules are
 * in lib/shared.js and the server's half is `peopleRoute` in server.js.
 *
 * Owner-only, on the owner's own log: `sharePeople(me)` is empty for anyone
 * else, while acting as someone and on a one-person install. The other person's
 * copy is never held in the owner's store; the sheet keeps WHICH person and
 * WHICH entry id, and the copy is whatever the server last answered.
 *
 * Native: the switcher is the kit's Segmented, taking someone off asks with a
 * system alert (`confirm`), and adding, removing and marking done give haptics.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Chip, Press, Segmented, Spinner } from '../ui/kit'
import { Icon } from '../lib/icons'
import { SessionLog } from './sessionlog'
import { withLine } from '../lib/shared.js'
import { getPersonEntry, putPersonEntry } from '../lib/peopleapi.js'

type Person = { id: string; name: string; entryId?: string }

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

/** You / Sam, at the top of a shared workout's sheet. Nothing without someone on it. */
export function PersonSwitch({ on = [], side = null, onSide }: {
  on?: Person[]
  side?: string | null
  onSide: (id: string | null) => void
}) {
  if (!on.length) return null
  const ME = '__you'
  return (
    <Segmented
      style={{ marginBottom: 12 }}
      options={[{ value: ME, label: 'You' }, ...on.map((p) => ({ value: p.id, label: p.name }))]}
      value={side || ME}
      onChange={(v) => onSide(v === ME ? null : v)}
    />
  )
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
  const [state, setState] = useState<{ entry: any; loading: boolean; error: string | null }>({ entry: null, loading: false, error: null })
  const latest = useRef<any>(null)

  useEffect(() => {
    latest.current = null
    if (!personId || !entryId) { setState({ entry: null, loading: false, error: null }); return undefined }
    let live = true
    setState({ entry: null, loading: true, error: null })
    getPersonEntry(personId, entryId)
      .then((e: any) => { if (!live) return; latest.current = e; setState({ entry: e, loading: false, error: null }) })
      .catch((err: any) => { if (live) setState({ entry: null, loading: false, error: `Could not open ${name || 'their'} log: ${err.message}` }) })
    return () => { live = false }
  }, [personId, entryId, name])

  const update = useCallback(async (fn: (cur: any) => any) => {
    const cur = latest.current
    if (!cur || cur.deleted) return
    const next = fn(cur)
    latest.current = next
    setState((s) => ({ ...s, entry: next, error: null }))
    try {
      const merged = await putPersonEntry(personId as string, next)
      if (latest.current === next) { latest.current = merged; setState((s) => ({ ...s, entry: merged })) }
    } catch (err: any) {
      setState((s) => ({ ...s, error: `Not saved to ${name || 'their'} log yet: ${err.message}` }))
    }
  }, [personId, name])

  return { ...state, update }
}

/** The other person's side: their form, the owner's numbers as placeholders, no WHOOP or Strava. */
export function TheirSide({ session, copy, loading = false, error = null, person, ownerOut, entries = [], onSave }: {
  session: any
  copy: any
  loading?: boolean
  error?: string | null
  person: Person
  ownerOut?: any
  entries?: any[]
  onSave: (out: any) => void
}) {
  if (loading) return <Spinner label={`Opening ${person.name}’s log…`} />
  if (!copy || copy.deleted) {
    return <T size={13} dim>{error || `This workout is not in ${person.name}'s log any more.`}</T>
  }
  return (
    <View style={{ gap: 4 }}>
      <T size={13} dim>
        {'Filling in '}<T size={13} weight={700}>{person.name}</T>
        {'’s log. Your numbers show greyed out as a guide; nothing of yours is copied in.'}
      </T>
      {error ? <T size={12} color={colors.bad}>{error}</T> : null}
      <SessionLog session={session} entry={copy} entries={entries} onSave={onSave}
        hints={ownerOut || null} measured={false} defaultOpen />
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
})
