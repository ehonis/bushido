/*
 * The keyboard's own bar (#77): ‹ › to walk the fields, and Done editing.
 *
 * iOS's decimal and number pads have no return key, so before this the way to
 * put the keypad away was to tap just above it, which was the sheet's lime
 * Close. Now the only thing above the keys is this bar, and its one word ends
 * typing and nothing else: it never closes a sheet, finishes a workout or
 * places a plan. "Done editing" rather than "Done", because on a workout
 * sheet "done" already means the workout.
 *
 * It is the platform's InputAccessoryView, attached to the keyboard by iOS, so
 * it rides the keypad exactly in a page sheet, a full screen and the tabs, and
 * follows an interactive swipe-down. On the new architecture one accessory
 * binds to ONE input (it searches the window for the first input naming it),
 * so every input mounts its own, with its own id (`Input` in kit.tsx does it).
 * Previous and next are react-native-keyboard-controller's own field walk (it
 * is already in the binary and its provider is mounted in app/_layout.tsx),
 * so nothing here needs a native change (D13).
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native'
import { FocusedInputEvents, KeyboardController } from 'react-native-keyboard-controller'
import { colors, font, radius, space, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { T } from './Text'
import { tap } from './haptics'

/* Which field of how many has focus, from one listener however many inputs are mounted. */
let focus = { current: 0, count: 0 }
const subs = new Set<() => void>()
let listening: { remove: () => void } | null = null
function subscribe(fn: () => void) {
  subs.add(fn)
  if (!listening) {
    listening = FocusedInputEvents.addListener('focusDidSet', (e: any) => {
      focus = { current: Number(e?.current) || 0, count: Number(e?.count) || 0 }
      subs.forEach((s) => s())
    })
  }
  return () => {
    subs.delete(fn)
    if (!subs.size && listening) { listening.remove(); listening = null }
  }
}
const snapshot = () => focus

/**
 * True from the moment the keyboard starts to rise until it has fully gone.
 *
 * Shows on `keyboardWillShow` so a footer is gone before the keys arrive under
 * it; hides on `keyboardDidHide`, after the keys have left, so nothing slides
 * back into the place a thumb was still lifting from.
 */
export function useKeyboardShown() {
  const [shown, setShown] = useState(() => Keyboard.isVisible())
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  return shown
}

/** Done editing: puts the keyboard away. That is all it does. */
export function doneEditing() {
  tap()
  void KeyboardController.dismiss().catch(() => Keyboard.dismiss())
}

export function KeyboardBar({ nativeID }: { nativeID: string }) {
  const pos = useSyncExternalStore(subscribe, snapshot, snapshot)
  if (Platform.OS !== 'ios') return null
  // Unknown (no event yet) leaves both arrows on: a walk past the end does nothing.
  const atFirst = pos.count > 0 && pos.current <= 0
  const atLast = pos.count > 0 && pos.current >= pos.count - 1
  const walk = (to: 'prev' | 'next') => { tap(); KeyboardController.setFocusTo(to) }
  return (
    <InputAccessoryView nativeID={nativeID} backgroundColor={colors.panel2}>
      <View style={st.bar}>
        <Arrow icon="ChevronUp" label="Previous field" disabled={atFirst} onPress={() => walk('prev')} />
        <Arrow icon="ChevronDown" label="Next field" disabled={atLast} onPress={() => walk('next')} />
        <View style={{ flex: 1 }} />
        <Pressable onPress={doneEditing} accessibilityRole="button" accessibilityLabel="Done editing"
          style={({ pressed }) => [st.done, pressed && { backgroundColor: colors.panel3 }]}>
          <T size={font.body} weight={600}>Done editing</T>
        </Pressable>
      </View>
    </InputAccessoryView>
  )
}

function Arrow({ icon, label, disabled, onPress }: { icon: string; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [st.arrow, pressed && !disabled && { backgroundColor: colors.panel3 }, disabled && { opacity: 0.35 }]}>
      <Icon name={icon} size={20} color={colors.ink} />
    </Pressable>
  )
}

const st = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: space[2], height: TAP + space[2],
    paddingHorizontal: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.lineStrong,
    backgroundColor: colors.panel2,
  },
  arrow: { width: TAP, height: TAP, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
  done: { minHeight: TAP, paddingHorizontal: space[4], borderRadius: radius.control, alignItems: 'center', justifyContent: 'center' },
})
