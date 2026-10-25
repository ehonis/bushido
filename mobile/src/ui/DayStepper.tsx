// The day switcher (docs/DESIGN.md, "Components"): back a day, forward up to
// `max`. Moved here from features/app.tsx unchanged, so the shell's kit owns it.
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { Icon } from '../lib/icons'
import { localIso } from '../lib/dates.js'
import { Input, Press } from './kit'

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
  dayBtn: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
})
