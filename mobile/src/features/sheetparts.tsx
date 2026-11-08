/*
 * What every sheet of ONE workout shares, whoever's log it is in (#80): the
 * done chip under the title, the flip it makes (with Undo), and the footer's one
 * action. `app/src/sheetparts.jsx`, one to one. The owner's sheet (sheet.tsx)
 * and someone's session opened from their week (trainer.tsx
 * `PersonEntrySheet`) both draw these; the second used to have a footer of its
 * own, the third style of footer for one workout.
 */
import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Press } from '../ui/kit'
import { impact, success, tap } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { isDone, doneState } from '../lib/store.js'
import { pushToast, dismissToast } from '../lib/toast'
import { UNDO_MS } from './exercises'

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
 * The done chip's tap: flip, then say so in a toast whose Undo puts back exactly
 * the done fields the tap replaced (`doneState`, lib/store.js `markDone`).
 * `read()` is the entry as it stands; `write(v)` writes `v` (true, false or a
 * `doneState`) through the sheet's one writer for that entry. `whose` names
 * someone else's copy. Their copy is written through the sheet's queue, so its
 * toast goes with the sheet (`outlives` false).
 */
export function useDoneFlip({ read, write, whose = null, outlives = false }: {
  read: () => any
  write: (v: any) => void
  whose?: string | null
  outlives?: boolean
}) {
  const toast = useRef<number | null>(null)
  useEffect(() => () => { if (!outlives && toast.current != null) dismissToast(toast.current) }, [outlives])
  return () => {
    const before = read()
    if (!before || before.deleted) return
    const v = !isDone(before)
    if (v) success(); else tap()
    write(v)
    toast.current = pushToast(`${v ? 'Marked done' : 'Marked undone'}${whose ? ` for ${whose}` : ''}`, 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: null, onClick: () => { toast.current = null; write(doneState(before)) } },
    }) as any
  }
}

/**
 * THE FOOTER HOLDS A REAL ACTION OR NOTHING (#77): Start, full width, the one
 * primary. Never Close (the header X), never done (the chip). `Modal` drops it
 * while the keyboard is up.
 */
export function SheetStart({ label, onStart }: { label: string; onStart: () => void }) {
  return (
    <View style={st.sheetFoot}>
      <Btn icon="Play" title={label} flex onPress={() => { impact(); onStart() }} />
    </View>
  )
}

export const sheetPartStyles = StyleSheet.create({
  // The row under the title: the done chip, then who is on it (#80). Wraps.
  status: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] },
})

const st = StyleSheet.create({
  // The sheet's foot: the one real action, full width.
  sheetFoot: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  // The done chip: a state, so a chip (accent-soft once done), 32 tall with its hit area to 44.
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, minHeight: 32, paddingHorizontal: space[3],
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
  chipOn: { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
})
