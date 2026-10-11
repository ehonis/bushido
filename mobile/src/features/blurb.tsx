/*
 * A context blurb: explanation you want available but not permanently in the way
 * (app/src/blurb.jsx).
 *
 * Hidden state collapses to a single tappable line rather than vanishing, so you
 * can always find the reasoning again — the point is to get it out of the daily
 * path, not to lose it.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, radius } from '../theme'
import { Icon } from '../lib/icons'
import { usePrefs } from '../lib/prefs.jsx'
import { T } from '../ui/Text'
import { H2, Press } from '../ui/kit'

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
        <Icon name="Info" size={13} color={colors.inkFaint} />
        <T size={13} faint numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{title}</T>
        <View style={{ opacity: 0.6 }}><Icon name="ChevronDown" size={15} color={colors.inkFaint} /></View>
      </Press>
    )
  }

  return (
    // .card.note: a 2px accent rule down the left edge; tone="card" is a plain card.
    <View style={[s.card, tone === 'note' && s.note]}>
      <View style={s.head}>
        <H2 style={{ flex: 1, marginBottom: 8 }}>{title}</H2>
        <Press haptic style={s.x} onPress={() => toggle(id)} accessibilityRole="button" accessibilityLabel={`Hide "${title}"`} hitSlop={8}>
          <Icon name="X" size={16} color={colors.inkFaint} />
        </Press>
      </View>
      {typeof children === 'string' ? <T size={13} dim>{children}</T> : children}
    </View>
  )
}

/** Header control: collapse or restore every blurb at once. */
export function BlurbToggle() {
  const { allHidden, setAllHidden } = usePrefs() as any
  // On a phone the header is tight: the icon carries it, as the web hides .ctx-label.
  return (
    <Press
      haptic
      style={[s.ctx, allHidden && s.ctxOff]}
      onPress={() => setAllHidden(!allHidden)}
      accessibilityRole="button"
      accessibilityLabel={allHidden ? 'Show context blurbs' : 'Hide context blurbs'}
      accessibilityState={{ selected: allHidden }}
      hitSlop={8}
    >
      <Icon name={allHidden ? 'EyeOff' : 'Eye'} size={15} color={allHidden ? colors.inkFaint : colors.inkDim} />
    </Press>
  )
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 16, marginBottom: 14,
  },
  note: { borderLeftWidth: 2, borderLeftColor: colors.accent },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  x: {
    minWidth: 28, minHeight: 28, marginTop: -2, marginRight: -2, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  stub: {
    flexDirection: 'row', alignItems: 'center', gap: 8, width: '100%',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 8,
    paddingVertical: 9, paddingHorizontal: 12, marginBottom: 10, minHeight: 40,
  },
  ctx: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.pill,
    paddingVertical: 4, paddingHorizontal: 8, minHeight: 30,
  },
  ctxOff: { borderStyle: 'dashed' },
})
