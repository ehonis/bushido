// modal.jsx on a phone: the same three layers with the same props, as the
// platform's own presentations.
//
//   Modal       the web's bottom sheet (.modal) -> an iOS page sheet. Header,
//               scrolling body, footer; the delete confirmation replaces the
//               body, as on the web, rather than stacking an alert on top.
//
// THE SHEET OWNS ITS DISMISS POLICY (#77). The header X always closes: it is
// the one exit, at the top, away from every input. Everything else that could
// close a sheet by accident stops once something is being entered: swipe-down
// is off while the keyboard is up, from the first edit in this sheet (kit's
// Input reports it through `SheetDirty`), and whenever the caller says the
// sheet is dirty (`dismissable`). And
// WHILE THE KEYBOARD IS UP THERE IS NO FOOTER AT ALL: the footer used to ride
// the KeyboardAvoidingView up onto the keypad, so the lime Close sat on the
// keys' top row and "I'm done typing" was a tap on Close. The keyboard's own
// bar (KeyboardBar.tsx: ‹ › Done editing) is the only thing above the keys; the
// footer comes back once the keys have gone (`keyboardDidHide`).
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
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Dimensions, KeyboardAvoidingView, Modal as RNModal, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, font, mix, radius, space, TAP, height } from '../theme'
import { Icon } from '../lib/icons'
import { T } from './Text'
import { Btn, IconBtn, Press } from './kit'
import { warn } from './haptics'
import { useKeyboardShown } from './KeyboardBar'
import ToastHost from './ToastHost'
import { SheetDirty } from './sheetDirty'

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
    <View style={[st.ico, { backgroundColor: c === colors.accent ? colors.accentSoft : mix(c, 14, colors.panel2) }]}>
      <Icon name={icon} size={20} color={c} />
    </View>
  )
}

/**
 * Scrolls the open sheet's body to a view inside it (doing mode's next exercise,
 * #94). Null outside a sheet, so a caller with nowhere to scroll does nothing.
 */
export const SheetScroll = createContext<((node: any) => void) | null>(null)
export const useSheetScroll = () => useContext(SheetScroll)

export function Modal({
  title, sub, status = null, icon, tone, onClose, onRename = null, onDelete = null,
  deleteLabel = 'Remove this session', deleteBody = null,
  dismissable = true, footer, children, scroll = true, bodyStyle,
  hidden = false, onHidden,
}: {
  title: string
  sub?: React.ReactNode
  /** A state you can flip, under the title: the session sheet's done chip. Far from every input. */
  status?: React.ReactNode
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
  /**
   * Put away for a moment and brought back as it was (#94, F N2): the session
   * sheet while the interval timer it opened is up, because iOS presents one
   * modal at a time. The caller's state stays (this component stays mounted);
   * the body comes back at the scroll position it left. `onHidden` runs once the
   * sheet has slid away, which is when the next modal can be presented.
   */
  hidden?: boolean
  onHidden?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  // Where the body was scrolled, kept across `hidden` (the native modal drops its
  // children while it is away); `back` is the offset to come back at.
  const scrollY = useRef(0)
  const scrollRef = useRef<ScrollView>(null)
  const [back, setBack] = useState(0)
  useEffect(() => { if (hidden) setBack(scrollY.current) }, [hidden])
  const offset = useMemo(() => ({ x: 0, y: back }), [back])
  const scrollTo = useCallback((node: any) => {
    const sv: any = scrollRef.current
    const inner = sv?.getInnerViewRef?.()
    if (!sv || !inner || !node?.measureLayout) return
    node.measureLayout(inner, (_x: number, y: number) => sv.scrollTo({ y: Math.max(0, y - space[3]), animated: true }), () => {})
  }, [])
  // A page sheet starts below the top of the screen, but KeyboardAvoidingView
  // measures the keyboard against its own frame from y=0, so without this the
  // footer and the last field stay that far under the keyboard.
  const [sheetTop, setSheetTop] = useState(0)
  const insets = useSafeAreaInsets()
  const typing = useKeyboardShown()
  // Changed once an input in it reports an edit (kit's Input, through SheetDirty);
  // focusing a box is not a change. While the keyboard is up the swipe waits too.
  const [touched, setTouched] = useState(false)
  const markDirty = useCallback(() => setTouched(true), [])
  // The toasts sit under this sheet's header, so they never cover its X.
  const [headH, setHeadH] = useState(0)
  const canSwipe = dismissable && !touched && !typing
  const showFoot = Boolean(footer) && !confirming && !typing
  const body = confirming ? (
    <View style={st.confirm}>
      <Icon name="TriangleAlert" size={34} color={colors.vizCrit} />
      <T size={font.title} weight={600} align="center" style={{ marginTop: space[2], marginBottom: space[2] }}>{`${deleteLabel}?`}</T>
      <T size={font.label} dim align="center">
        {deleteBody || 'It comes off the day and out of your training load. Anything you logged on it goes with it.'}
      </T>
      <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[6], alignSelf: 'stretch' }}>
        <Btn kind="secondary" title="Keep it" flex onPress={() => setConfirming(false)} />
        <Btn kind="destructive" icon="Trash2" title="Remove" flex onPress={() => { setConfirming(false); onDelete?.() }} />
      </View>
    </View>
  ) : children

  return (
    <RNModal
      visible={!hidden}
      animationType="slide"
      presentationStyle="pageSheet"
      allowSwipeDismissal={canSwipe}
      onRequestClose={() => { if (canSwipe) onClose() }}
      onDismiss={hidden ? onHidden : undefined}
    >
      <SheetDirty.Provider value={markDirty}>
      <SheetScroll.Provider value={scrollTo}>
      <GestureHandlerRootView style={{ flex: 1 }} onLayout={(e) => setSheetTop(Math.max(0, Dimensions.get('window').height - e.nativeEvent.layout.height))}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={sheetTop} style={st.sheet}>
        {/* THE HEADER (#82, from #91's review): one title row that never wraps its
            line (the day and one count, ellipsized), with the bin, pencil and X on
            it, and the state row (the done chip, who it is shared with) across the
            full width under it. With the meta and the chip squeezed beside three
            buttons, "Wed, Nov 4 · 3 exercises" broke and the header grew to 190pt.
            The icon well is decoration: it gives way when the bin and pencil are
            both there, so the day and the count fit at 390. */}
        <View onLayout={(e) => setHeadH(Math.round(e.nativeEvent.layout.height))}
          style={[st.head, tone && TONES[tone] ? { borderTopWidth: 3, borderTopColor: TONES[tone] } : null]}>
          <View style={st.headRow}>
            {icon && !(onDelete && onRename) ? <TitleIcon icon={icon} tone={tone} /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <T size={font.title} weight={600} numberOfLines={2}>{title}</T>
              {sub ? (typeof sub === 'string'
                ? <T size={font.label} dim numberOfLines={1} ellipsizeMode="tail" style={{ marginTop: 2 }}>{sub}</T>
                : sub) : null}
            </View>
            {/* The bin first and the pencil between it and the X, so the destructive
                one is never beside the exit (it asks first anyway). */}
            {onDelete ? <IconBtn icon="Trash2" size={16} label={deleteLabel} onPress={() => { warn(); setConfirming(true) }} /> : null}
            {onRename ? <IconBtn icon="Pencil" size={16} label="Edit this workout" onPress={onRename} /> : null}
            <IconBtn icon="X" label="Close" onPress={onClose} />
          </View>
          {status && !confirming ? <View style={st.status}>{status}</View> : null}
        </View>
        {scroll || confirming ? (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={[{ padding: space[4], paddingBottom: showFoot ? 16 : typing ? 24 : insets.bottom + 24 }, bodyStyle]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentOffset={offset}
            onScroll={(e) => { scrollY.current = e.nativeEvent.contentOffset.y }}
            scrollEventThrottle={64}
          >
            {body}
          </ScrollView>
        ) : <View style={[{ flex: 1 }, bodyStyle]}>{body}</View>}
        {showFoot ? (
          <View style={[st.foot, { paddingBottom: Math.max(12, insets.bottom) }]}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
      {/* This sheet's own toasts: iOS draws it above the root, and the root's host. */}
      <ToastHost top={headH + space[2]} />
      </GestureHandlerRootView>
      </SheetScroll.Provider>
      </SheetDirty.Provider>
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
            <T size={font.title} weight={600} numberOfLines={2}>{title}</T>
            {sub ? (typeof sub === 'string' ? <T size={font.label} dim style={{ marginTop: 2 }}>{sub}</T> : sub) : null}
          </View>
        </View>
        {tabs && tabs.length > 1 ? (
          <View style={st.fsTabs}>
            {tabs.map((t) => {
              const on = t.key === active
              return (
                <Press key={t.key} haptic onPress={() => onTab?.(t.key)} style={[st.fsTab, on && st.fsTabOn]}>
                  <Icon name={t.icon} size={15} color={on ? colors.ink : colors.inkDim} />
                  <T size={font.label} weight={500} color={on ? colors.ink : colors.inkDim}>{t.label}</T>
                </Press>
              )
            })}
          </View>
        ) : null}
        {scroll ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: space[4], paddingBottom: space[8] + insets.bottom }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {children}
          </ScrollView>
        ) : <View style={{ flex: 1 }}>{children}</View>}
      </KeyboardAvoidingView>
      <ToastHost />
      </GestureHandlerRootView>
    </RNModal>
  )
}

// `visible` and `onDismiss` let a sheet slide away before what it started
// happens (iOS presents one transition at a time): the exercise sheet's Add.
export function Popover({ label, onClose, children, visible = true, onDismiss }: {
  label?: string; onClose: () => void; children?: React.ReactNode; visible?: boolean; onDismiss?: () => void
}) {
  return (
    <RNModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismiss} accessibilityLabel={label}>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={st.sheet}>{children}</View>
      <ToastHost active={visible} top={space[3]} />
      </GestureHandlerRootView>
    </RNModal>
  )
}

// The sheet frame (styles.css .modal, .modal-head, .modal-foot, .fs): the
// header's title is the largest text in the sheet, the close is a quiet 44pt
// round button, and the footer holds the one primary action.
const st = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.panel },
  head: {
    paddingLeft: space[4], paddingRight: space[2], paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  ico: { width: 40, height: 40, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  foot: {
    flexDirection: 'row', gap: space[2], paddingHorizontal: space[4], paddingTop: space[3],
    borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.panel,
  },
  status: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], marginTop: space[2], paddingRight: space[2] },
  confirm: { paddingTop: space[4], paddingHorizontal: space[1], paddingBottom: space[2], alignItems: 'center' },
  fs: { flex: 1, backgroundColor: colors.bg },
  fsHead: {
    flexDirection: 'row', alignItems: 'center', gap: space[3],
    paddingLeft: space[2], paddingRight: space[4], paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  fsTabs: { flexDirection: 'row', gap: space[1], paddingHorizontal: space[4], paddingVertical: space[2], borderBottomWidth: 1, borderBottomColor: colors.line },
  fsTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    borderWidth: 1, borderColor: 'transparent', borderRadius: radius.control, paddingHorizontal: space[2], minHeight: TAP,
  },
  fsTabOn: { backgroundColor: colors.panel3, borderColor: colors.lineStrong },
})
