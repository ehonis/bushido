// What a part of the web that has not been ported yet shows instead, so it is
// clearly absent rather than silently missing: what it is, and that the web app
// on the same server still has it.
import React from 'react'
import { View } from 'react-native'
import { colors } from '../theme'
import { T } from './Text'
import { Icon } from '../lib/icons'

export function NotYet({ what, icon = 'Info', children }: { what: string; icon?: string; children?: React.ReactNode }) {
  return (
    <View style={{ padding: 20, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 10, alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={22} color={colors.inkFaint} />
      <T size={15} weight={600} align="center">{`${what}: not on native yet`}</T>
      <T size={13} dim align="center">
        {children || 'This part of Bushido has not been rebuilt for the iPhone app yet. It works in the web app on the same server, and anything you do there shows up here.'}
      </T>
    </View>
  )
}
