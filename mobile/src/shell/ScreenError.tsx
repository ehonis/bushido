// What a screen shows when it throws while rendering. In a release build an
// uncaught render error closes the whole app; with this, only that screen
// fails, says why, and can be retried or left (the drawer and back still work).
// The usual cause is the server's data changing shape before the app caught up.
import React from 'react'
import { ScrollView, View } from 'react-native'
import { router, type ErrorBoundaryProps } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import { colors, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn } from '../ui/kit'
import { Icon } from '../lib/icons'

export function ScreenError({ error, retry }: ErrorBoundaryProps) {
  const insets = useSafeAreaInsets()
  const head = `${error?.name || 'Error'}: ${error?.message || String(error)}`
  // Hermes and V8 stacks start with the message line already.
  const stack = (error?.stack || '').split('\n').filter((l, i) => !(i === 0 && l.trim() === head)).slice(0, 8)
  const detail = [head, ...stack].join('\n')
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space[6], paddingTop: insets.top + 40, gap: space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Icon name="TriangleAlert" size={18} color={colors.warn} />
        <T size={font.title} weight={600}>This screen hit an error</T>
      </View>
      <T dim lineHeight={20}>The rest of Bushido still works. Try again, or go back. If it keeps happening, copy the details and send them over.</T>
      <View style={{ padding: space[3], borderRadius: radius.control, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line }}>
        <T mono size={font.caption} color={colors.inkDim} selectable>{detail}</T>
      </View>
      <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
        <Btn title="Try again" onPress={retry} />
        {router.canGoBack() ? <Btn kind="secondary" title="Go back" onPress={() => router.back()} /> : <Btn kind="secondary" title="Today" onPress={() => router.replace('/')} />}
        <Btn kind="secondary" icon="Copy" title="Copy details" onPress={() => { Clipboard.setStringAsync(detail).catch(() => {}) }} />
      </View>
    </ScrollView>
  )
}
