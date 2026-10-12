// Whose log something belongs to, when the owner can see more than one: the
// web's `[data-tone]` colours and `.side-who` pill (styles.css, "the owner as
// trainer"). The owner is the accent; everyone else takes the validated series
// colours in People order, so there is nothing new for the palette check. The
// name always goes with the colour.
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { T } from './Text'

export const toneColor = (tone?: number | null) =>
  tone === 1 ? colors.series1 : tone === 2 ? colors.series2 : colors.accent

/** The name in a pill of its colour, ahead of a title. */
export function SideWho({ who }: { who?: { name: string; tone?: number } | null }) {
  if (!who) return null
  return (
    <View style={[st.pill, { backgroundColor: toneColor(who.tone) }]}>
      <T size={12} weight={700} color={colors.bg}>{who.name}</T>
    </View>
  )
}

/** A rule in their colour along the top of a workout screen. */
export function SideRule({ who }: { who?: { tone?: number } | null }) {
  if (!who) return null
  return <View style={[st.rule, { backgroundColor: toneColor(who.tone) }]} />
}

export function Dot({ tone }: { tone?: number | null }) {
  return <View style={[st.dot, { backgroundColor: toneColor(tone) }]} />
}

const st = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, alignSelf: 'flex-start', marginBottom: 2 },
  rule: { height: 3 },
  dot: { width: 9, height: 9, borderRadius: 5 },
})
