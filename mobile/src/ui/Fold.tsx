// <details>/<summary> on a phone: a header row you tap to open, with the
// chevron the web's summary::before draws. "Everything folds" (AGENTS.md §6.7),
// so this is used a lot; `open` is the initial state, or controlled with onToggle.
import React, { useState } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '../theme'
import { Icon } from '../lib/icons'
import { Press } from './kit'
import { T } from './Text'
import { tap } from './haptics'

export function Fold({ summary, open: initial = false, isOpen, onToggle, children, style, headStyle }: {
  /** A string renders as the CSS's 13px dim summary line; anything else is drawn as given. */
  summary: React.ReactNode
  open?: boolean
  isOpen?: boolean
  onToggle?: (open: boolean) => void
  children?: React.ReactNode
  style?: StyleProp<ViewStyle>
  headStyle?: StyleProp<ViewStyle>
}) {
  const [own, setOwn] = useState(initial)
  const open = isOpen ?? own
  const flip = () => { tap(); setOwn(!open); onToggle?.(!open) }
  return (
    <View style={style}>
      <Press onPress={flip} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 }, headStyle]}>
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={14} color={colors.inkFaint} />
        {typeof summary === 'string' ? <T size={13} dim style={{ flex: 1 }}>{summary}</T> : <View style={{ flex: 1 }}>{summary}</View>}
      </Press>
      {open ? children : null}
    </View>
  )
}
