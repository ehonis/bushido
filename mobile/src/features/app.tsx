// The pieces of App.jsx that are components: which tabs a person gets, the
// acting banner, the + menu and the rest-day prompt. Same copy, same order,
// same reasons; the comments that explain a choice are kept short here and
// live in full in app/src/App.jsx.
import React, { useEffect, useState } from 'react'
import { Modal as RNModal, Pressable, StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, elevation, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Chip, Field, Input, NoteField, Press } from '../ui/kit'
import { Modal } from '../ui/Sheet'
import { Icon } from '../lib/icons'
import { localIso } from '../lib/dates.js'
import { actAs } from '../lib/whoami.js'
import { reloadApp } from '../shell/reload'
import { impact } from '../ui/haptics'

/*
 * Seven tabs, ordered roughly by how often a session touches them. ACHIEVEMENTS
 * and GOALS are deliberately two tabs: an achievement is open-ended and lives
 * here; a Totem goal is a week or a quarter and lives there.
 */
export const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'log', label: 'Log' },
  { id: 'progress', label: 'Progress' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'goals', label: 'Goals' },
  { id: 'coach', label: 'Coach' },
] as const

/*
 * What this person's app offers (lib/whoami.js). The coach is the owner's for
 * now, and linked goals come from the owner's Totem; for anyone else those tabs
 * are not there at all.
 */
export const tabsFor = (features: any, owner = true) => TABS.filter((t) =>
  (t.id !== 'coach' || features?.ai !== false) &&
  // The owner keeps the tab with no bridge: it is where the app says how to set one up.
  (t.id !== 'goals' || owner || features?.goals))

/**
 * Whose log is open when the owner is acting as someone else, on every screen,
 * with the way back. Logging into the wrong log is the failure to make hard.
 */
export function ActingBanner({ me }: { me: any }) {
  const [busy, setBusy] = useState(false)
  if (!me?.acting) return null
  return (
    <View style={st.acting} accessibilityRole="alert">
      <Icon name="Users" size={15} color={colors.accent} />
      <T size={font.small} style={{ flex: 1, minWidth: 0 }}>
        Logging for <T size={font.small} weight={700}>{me.name}</T>
      </T>
      <Press
        disabled={busy}
        style={st.actingBack}
        onPress={() => { setBusy(true); (actAs as any)(null, { reload: reloadApp }).catch(() => setBusy(false)) }}
      >
        <T size={font.small} weight={600}>{busy ? 'Switching…' : `Back to ${me.real.name || 'me'}`}</T>
      </Press>
    </View>
  )
}

// Log a workout leads and is the only door in the accent: it is what the + is
// pressed for most (docs/DESIGN.md D7). Logging doors, then planning, then tools;
// one line under each door, not a paragraph.
const FAB_ROWS = [
  { key: 'log', icon: 'NotebookPen', tint: colors.accent, title: 'Log a workout', sub: 'Something you already did' },
  // A rest day used to be a link at the foot of the old session picker, under
  // thirty cards, which is to say nowhere.
  { key: 'rest', icon: 'Sunset', tint: null, title: 'Log a rest day', sub: 'A day off on purpose' },
  { key: 'plan', icon: 'Sparkles', tint: null, title: 'Plan a workout', sub: 'Build it yourself, or have it written for you' },
  { key: 'week', icon: 'CalendarRange', tint: null, title: 'Plan the week', sub: 'Talk this week’s counts through' },
  { key: 'timer', icon: 'Timer', tint: null, title: 'Interval timer', sub: 'Work, rest and rounds' },
] as const

/**
 * What the + offers. Four doors: the separate session picker went on 2026-10-14 when the
 * plan's cards moved into Log a workout as the climbing folders (lib/folders.js).
 * A sheet from the bottom, because the button is at the bottom and a menu that
 * opens away from your thumb is one you reach across for.
 */
export function FabMenu({ onClose, onPlan, onLog, onPlanWeek, onRest, onTimer = null }: {
  onClose: () => void
  onPlan: () => void
  onLog: () => void
  onPlanWeek: (() => void) | null
  onRest: (() => void) | null
  onTimer?: (() => void) | null
}) {
  const insets = useSafeAreaInsets()
  const handlers: Record<string, (() => void) | null> = { plan: onPlan, log: onLog, rest: onRest, week: onPlanWeek, timer: onTimer }
  return (
    <RNModal visible transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Pressable style={st.scrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[st.fabmenu, { marginBottom: Math.max(space[2], insets.bottom) }]} onPress={() => {}} accessibilityLabel="Add a workout">
          {FAB_ROWS.filter((r) => handlers[r.key]).map((r) => (
            <Press key={r.key} haptic style={st.row} onPress={() => handlers[r.key]?.()}>
              <View style={[st.rowIco, { backgroundColor: r.tint ? colors.accentSoft : colors.panel3 }]}>
                <Icon name={r.icon} size={22} color={r.tint || colors.inkDim} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T size={font.body} weight={600}>{r.title}</T>
                <T size={font.small} dim>{r.sub}</T>
              </View>
            </Press>
          ))}
          <Press onPress={onClose} style={st.cancel}>
            <T size={font.body} weight={600}>Cancel</T>
          </Press>
        </Pressable>
      </Pressable>
      </GestureHandlerRootView>
    </RNModal>
  )
}

/**
 * Why rest today, asked before it is logged. The chips are the rest card's own
 * `why` output, so the answer stays editable in the session sheet afterwards.
 * Both optional: a prompt, not a gate.
 */
export function RestPrompt({ opt, date: initialDate, entryFor, onSave, onClose }: {
  opt: any
  date: string | null
  entryFor: (date: string) => any
  onSave: (r: { date: string; why?: string; notes?: string }) => void
  onClose: () => void
}) {
  const field = (opt?.outputs || []).find((f: any) => f.key === 'why')
  const today = localIso()
  const [date, setDate] = useState(initialDate || today)
  const existing = entryFor ? entryFor(date) : null
  const [why, setWhy] = useState<string | undefined>(existing?.data?.out?.why)
  const [notes, setNotes] = useState<string>(existing?.data?.out?.notes || '')
  // Moving the date onto a day that already rests shows THAT day's answer.
  useEffect(() => {
    setWhy(existing?.data?.out?.why)
    setNotes(existing?.data?.out?.notes || '')
  }, [existing?.id])
  const save = () => { impact(); onSave({ date, why: why || undefined, notes: notes.trim() || undefined }) }
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today

  return (
    <Modal title="Rest day" sub={existing ? 'Already a rest day — change the why' : 'Why are you resting?'}
      icon={opt?.icon || 'Sunset'} tone="rest" onClose={onClose}
      footer={<Btn icon="Check" title={existing ? 'Save' : 'Log the rest day'} flex disabled={!valid} onPress={save} />}>
      {/* Any day up to today — a rest day the user forgot to log is still one they took. */}
      <Field label="Day" style={{ marginBottom: 10, flexBasis: 'auto' }}>
        <DayStepper value={date} max={today} onChange={setDate} />
      </Field>
      {field ? (
        <View style={{ gap: 7, marginBottom: 12 }}>
          <T size={13} dim>{field.label}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 1 }}>
            {field.options.map((o: any) => {
              const on = why === o.value
              return <Chip key={o.value} out on={on} icon={o.icon} label={o.label} onPress={() => setWhy(on ? undefined : o.value)} />
            })}
          </View>
        </View>
      ) : null}
      <NoteField label="In your own words" value={notes} onChangeText={setNotes} placeholder="Optional — what's going on?" />
    </Modal>
  )
}

/** The web's <input type="date" max={today}> as a day stepper: back a day, forward up to today. */
export function DayStepper({ value, max, onChange }: { value: string; max?: string; onChange: (iso: string) => void }) {
  const shift = (n: number) => {
    const d = new Date(`${value}T12:00:00`)
    d.setDate(d.getDate() + n)
    const iso = localIso(d)
    if (max && iso > max) return
    onChange(iso)
  }
  const label = new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Press haptic onPress={() => shift(-1)} style={st.dayBtn} accessibilityLabel="The day before"><Icon name="ChevronLeft" size={18} color={colors.inkDim} /></Press>
      <Input value={label} editable={false} style={{ flex: 1, textAlign: 'center' }} />
      <Press haptic onPress={() => shift(1)} disabled={Boolean(max && value >= max)} style={st.dayBtn} accessibilityLabel="The day after"><Icon name="ChevronRight" size={18} color={colors.inkDim} /></Press>
    </View>
  )
}

const st = StyleSheet.create({
  // The visual system's acting banner and + menu (styles.css .acting, .fabmenu).
  acting: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], marginHorizontal: space.gutter, marginBottom: space[2],
    padding: space[1], paddingLeft: space[3],
    borderWidth: 1, borderColor: colors.accentLine, borderRadius: radius.card, backgroundColor: colors.accentSoft,
  },
  actingBack: {
    minHeight: 44, paddingHorizontal: space[3], borderRadius: radius.control, borderWidth: 1, borderColor: colors.lineStrong,
    backgroundColor: colors.panel2, justifyContent: 'center',
  },
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end', paddingHorizontal: space[2] },
  fabmenu: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sheet, padding: space[2], gap: 2,
    ...elevation[3],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 64, paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.card },
  rowIco: { width: 44, height: 44, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: 44, marginTop: space[1], alignItems: 'center', justifyContent: 'center', borderRadius: radius.card, backgroundColor: colors.panel2 },
  dayBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
})
