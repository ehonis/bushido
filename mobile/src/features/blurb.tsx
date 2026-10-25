/*
 * A context blurb: explanation you want available but not permanently in the way
 * (app/src/blurb.jsx).
 *
 * Hidden state collapses to a single tappable line rather than vanishing, so you
 * can always find the reasoning again — the point is to get it out of the daily
 * path, not to lose it.
 *
 * Progress no longer carries one (issue #43); the climbing pages still do. The
 * header's "hide every blurb" switch went with it: nothing rendered it.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { usePrefs } from '../lib/prefs.jsx'
import { T } from '../ui/Text'
import { H2, IconBtn, Press } from '../ui/kit'

export function Blurb({ id, title, children, tone = 'note' }: {
  id: string
  title: string
  children?: React.ReactNode
  tone?: string
}) {
  const { isHidden, toggle } = usePrefs() as any

  if (isHidden(id)) {
    return (
      <Press haptic style={s.stub} onPress={() => toggle(id)} accessibilityRole="button" accessibilityState={{ expanded: false }}>
        <Icon name="Info" size={16} color={colors.inkDim} />
        <T size={font.small} dim numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{title}</T>
        <Icon name="ChevronDown" size={16} color={colors.inkFaint} />
      </Press>
    )
  }

  return (
    // .card.note: a 2px accent rule down the left edge; tone="card" is a plain card.
    <View style={[s.card, tone === 'note' && s.note]}>
      <View style={s.head}>
        <H2 style={{ flex: 1, marginBottom: space[2] }}>{title}</H2>
        <IconBtn icon="X" size={16} label={`Hide "${title}"`} onPress={() => toggle(id)} style={{ marginTop: -10, marginRight: -10 }} />
      </View>
      {typeof children === 'string' ? <T size={font.small} dim>{children}</T> : children}
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
    padding: space[4], marginBottom: space[3],
  },
  note: { borderLeftWidth: 2, borderLeftColor: colors.accent },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  stub: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], width: '100%',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.card,
    paddingHorizontal: space[3], marginBottom: space[3], minHeight: TAP,
  },
})
