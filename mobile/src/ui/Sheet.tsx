// modal.jsx on a phone: the same three layers with the same props, as the
// platform's own presentations.
//
//   Modal       the web's bottom sheet (.modal) -> an iOS page sheet. Swipe down
//               to close, unless `dismissable` is false (the web locks its scrim
//               the same way once data is being entered). Header, scrolling
//               body, footer; the delete confirmation replaces the body, as on
//               the web, rather than stacking an alert on top.
//   FullScreen  .fs, "doing is a page": a full-screen modal with a back chevron
//               and the optional section tabs.
//   Popover     reference, anchored on desktop and a bottom sheet on a phone:
//               a page sheet with no chrome of its own.
//
// Ported screens keep their component-state open/close logic unchanged and
// render these where the web rendered the DOM version.
//
// A React Native Modal is a separate native root, outside the app's
// GestureHandlerRootView, so every sheet's content gets its own: without it a
// swipeable set row or a slider inside a sheet silently does nothing. Context
// (the store, the plan, WHOOP, Strava) still flows through, since a Modal is
// in the same React tree.
import React, { useState } from 'react'
import { Dimensions, KeyboardAvoidingView, Modal as RNModal, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, mix } from '../theme'
import { Icon } from '../lib/icons'
import { T } from './Text'
import { Btn, IconBtn, Press } from './kit'
import { warn } from './haptics'

/** The tones the CSS gives .modal.t-* / .fs.t-*: which colour the icon and the edge take. */
export const TONES: Record<string, string> = {
  rec: colors.accent,
  extra: colors.series3,
  also: colors.series3,
  rest: colors.series1,
  branch: colors.series2,
  swapped: colors.load3,
}

function TitleIcon({ icon, tone }: { icon: string; tone?: string }) {
  const c = (tone && TONES[tone]) || colors.accent
  return (
    <View style={[st.ico, { backgroundColor: mix(c, 14, colors.panel2) }]}>
      <Icon name={icon} size={20} color={c} />
    </View>
  )
}

export function Modal({
  title, sub, icon, tone, onClose, onRename = null, onDelete = null,
  deleteLabel = 'Remove this session', deleteBody = null,
  dismissable = true, footer, children, scroll = true, bodyStyle,
}: {
  title: string
  sub?: React.ReactNode
  icon?: string | null
  tone?: string
  onClose: () => void
  onRename?: (() => void) | null
  onDelete?: (() => void) | null
  deleteLabel?: string
  deleteBody?: React.ReactNode
  dismissable?: boolean
  footer?: React.ReactNode
  children?: React.ReactNode
  /** False when the body is its own list (a FlatList) and must not be wrapped in a ScrollView. */
  scroll?: boolean
  bodyStyle?: StyleProp<ViewStyle>
}) {
  const [confirming, setConfirming] = useState(false)
  // A page sheet starts below the top of the screen, but KeyboardAvoidingView
  // measures the keyboard against its own frame from y=0, so without this the
  // footer and the last field stay that far under the keyboard.
  const [sheetTop, setSheetTop] = useState(0)
  const insets = useSafeAreaInsets()
  const body = confirming ? (
    <View style={st.confirm}>
      <Icon name="TriangleAlert" size={34} color={colors.vizCrit} />
      <T size={17} weight={600} align="center" style={{ marginTop: 10, marginBottom: 6 }}>{`${deleteLabel}?`}</T>
      <T size={13} dim align="center">
        {deleteBody || 'It comes off the day, out of the week’s quotas and out of your training load. Anything you logged on it goes with it.'}
      </T>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 20, alignSelf: 'stretch' }}>
        <Btn kind="ghost" title="Keep it" flex onPress={() => setConfirming(false)} />
        <Btn kind="bad" icon="Trash2" title="Remove" flex onPress={() => { setConfirming(false); onDelete?.() }} />
      </View>
    </View>
  ) : children

  return (
    <RNModal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={dismissable}
      onRequestClose={() => { if (dismissable) onClose() }}
    >
      <GestureHandlerRootView style={{ flex: 1 }} onLayout={(e) => setSheetTop(Math.max(0, Dimensions.get('window').height - e.nativeEvent.layout.height))}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={sheetTop} style={st.sheet}>
        <View style={[st.head, tone && TONES[tone] ? { borderTopWidth: 3, borderTopColor: TONES[tone] } : null]}>
          {icon ? <TitleIcon icon={icon} tone={tone} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={16} weight={600} lineHeight={20} numberOfLines={2}>{title}</T>
            {sub ? (typeof sub === 'string' ? <T size={12} faint style={{ marginTop: 2 }}>{sub}</T> : sub) : null}
          </View>
          {onRename ? <IconBtn icon="Pencil" size={16} label="Edit this workout" onPress={onRename} /> : null}
          {onDelete ? <IconBtn icon="Trash2" size={16} label={deleteLabel} onPress={() => { warn(); setConfirming(true) }} /> : null}
          <IconBtn icon="X" label="Close" onPress={onClose} />
        </View>
        {scroll || confirming ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={[{ padding: 16, paddingBottom: footer ? 16 : insets.bottom + 24 }, bodyStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {body}
          </ScrollView>
        ) : <View style={[{ flex: 1 }, bodyStyle]}>{body}</View>}
        {footer && !confirming ? (
          <View style={[st.foot, { paddingBottom: Math.max(12, insets.bottom) }]}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </RNModal>
  )
}

export function FullScreen({ title, sub, icon, tone, onBack, tabs, active, onTab, children, scroll = true }: {
  title: string
  sub?: React.ReactNode
  icon?: string | null
  tone?: string
  onBack: () => void
  tabs?: { key: string; icon: string; label: string }[]
  active?: string
  onTab?: (key: string) => void
  children?: React.ReactNode
  scroll?: boolean
}) {
  const insets = useSafeAreaInsets()
  return (
    <RNModal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onBack}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[st.fs, { paddingTop: insets.top }]}>
        {tone && TONES[tone] ? <View style={{ height: 3, backgroundColor: TONES[tone] }} /> : null}
        <View style={st.fsHead}>
          <IconBtn icon="ChevronLeft" size={20} label="Back" onPress={onBack} />
          {icon ? <TitleIcon icon={icon} tone={tone} /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T size={16} weight={600} lineHeight={20} numberOfLines={2}>{title}</T>
            {sub ? (typeof sub === 'string' ? <T size={12} faint style={{ marginTop: 2 }}>{sub}</T> : sub) : null}
          </View>
        </View>
        {tabs && tabs.length > 1 ? (
          <View style={st.fsTabs}>
            {tabs.map((t) => {
              const on = t.key === active
              return (
                <Press key={t.key} haptic onPress={() => onTab?.(t.key)} style={[st.fsTab, on && st.fsTabOn]}>
                  <Icon name={t.icon} size={15} color={on ? colors.ink : colors.inkFaint} />
                  <T size={13} weight={500} color={on ? colors.ink : colors.inkFaint}>{t.label}</T>
                </Press>
              )
            })}
          </View>
        ) : null}
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, paddingBottom: 28 + insets.bottom }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {children}
          </ScrollView>
        ) : <View style={{ flex: 1 }}>{children}</View>}
      </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </RNModal>
  )
}

export function Popover({ label, onClose, children }: { label?: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <RNModal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} accessibilityLabel={label}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={st.sheet}>{children}</View>
      </GestureHandlerRootView>
    </RNModal>
  )
}

const st = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.panel },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  ico: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  foot: {
    flexDirection: 'row', gap: 9, paddingHorizontal: 16, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.panel,
  },
  confirm: { paddingTop: 18, paddingHorizontal: 4, paddingBottom: 8, alignItems: 'center' },
  fs: { flex: 1, backgroundColor: colors.bg },
  fsHead: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  fsTabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  fsTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: 'transparent', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 6, minHeight: 44,
  },
  fsTabOn: { backgroundColor: colors.panel2, borderColor: colors.line },
})
