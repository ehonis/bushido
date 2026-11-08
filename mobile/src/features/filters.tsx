/*
 * The two things every list screen opens with: app/src/filters.jsx, native (#98).
 *
 * `ScreenTitle`: Log and Progress titled at screen size, as Today's day is.
 * `SubFilter`: a second level of filter inside the activity picked (the plan's
 * categories under Climbing), said as one: a caption naming what it narrows,
 * indented behind a rule, outlined chips, so "Endurance" never reads as one more
 * sport. `ChipRow` is the one sideways-scrolling row of chips both screens use.
 */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { colors, font, space } from '../theme'
import { T } from '../ui/Text'
import { Chip } from '../ui/kit'

export function ScreenTitle({ children }: { children: string }) {
  return <T size={font.screen} weight={600} accessibilityRole="header" style={st.title}>{children}</T>
}

/** "Kind of climbing": what the second row narrows, from the activity's name. */
export const subFilterLabel = (activityName?: string | null) => (activityName ? `Kind of ${activityName.toLowerCase()}` : 'Kind')

/** One row of filter chips that scrolls sideways (#97), bled to the screen's edges. */
export function ChipRow({ children, style, inset = false }: { children: React.ReactNode; style?: any; inset?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[inset ? st.chipRowInset : st.chipRow, style]}
      contentContainerStyle={inset ? st.chipRowInsetIn : st.chipRowIn} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  )
}

export function SubFilter({ label, children, style }: { label: string; children: React.ReactNode; style?: any }) {
  return (
    <View style={[st.sub, style]} accessibilityRole="none" accessibilityLabel={label}>
      <T size={font.label} dim style={st.subLabel}>{label}</T>
      <ChipRow inset>{children}</ChipRow>
    </View>
  )
}

/** A chip of the second level: outlined until it is on. */
export function SubChip(props: React.ComponentProps<typeof Chip>) {
  return <Chip small {...props} style={[!props.on && st.subChip, props.style]} />
}

const st = StyleSheet.create({
  title: { marginBottom: space[3] },
  chipRow: { marginHorizontal: -space.gutter, flexGrow: 0 },
  chipRowIn: { gap: space[2], paddingHorizontal: space.gutter },
  chipRowInset: { marginRight: -space.gutter, flexGrow: 0 },
  chipRowInsetIn: { gap: space[2], paddingRight: space.gutter },
  sub: { marginBottom: space[3], paddingLeft: space[3], borderLeftWidth: 2, borderLeftColor: colors.accentLine },
  subLabel: { marginBottom: space[1] },
  subChip: { backgroundColor: 'transparent' },
})
