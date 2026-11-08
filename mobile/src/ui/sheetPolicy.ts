/*
 * The phone's frame rules while a number is being typed (#77), as pure
 * functions, so a test can run them without a phone (app/native.test.js).
 * The owner's first complaint was Close under the thumb while editing a weight:
 * the footer rode the keyboard onto the decimal pad. Each layer that has
 * something at its foot asks these, never its own copy:
 *
 * - `Modal` (ui/Sheet.tsx): its footer, and whether a swipe down closes it.
 * - the planner's `StepPage` (features/planner.tsx): its sticky bar.
 * - the runner's set screen (features/runner.tsx): Done set and All sets.
 *
 * No React Native import here on purpose: node runs this file.
 */

/**
 * Which keyboard events say the keys are up, and gone. Up on `keyboardWillShow`
 * (iOS), so a footer is gone before the keys arrive under it; gone on
 * `keyboardDidHide`, after the keys have left, so nothing slides back into the
 * place a thumb is still lifting from (the runner once used `keyboardWillHide`,
 * F N4).
 */
export function keyboardEvents(os: string): { show: 'keyboardWillShow' | 'keyboardDidShow'; hide: 'keyboardDidHide' } {
  return { show: os === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', hide: 'keyboardDidHide' }
}

/** A sheet's footer: only when it has one, is not asking to confirm, and nothing is being typed. */
export const showFoot = ({ footer, confirming = false, typing }: { footer: unknown; confirming?: boolean; typing: boolean }) =>
  Boolean(footer) && !confirming && !typing

/**
 * A swipe down closes the sheet only while nothing in it was changed and no box
 * is being typed in. Focusing a box is not a change (`touched` comes from an
 * edit, ui/sheetDirty.ts); the header's X always closes.
 */
export const canSwipe = ({ dismissable = true, touched, typing }: { dismissable?: boolean; touched: boolean; typing: boolean }) =>
  dismissable && !touched && !typing

/** The runner's bottom actions (Done set, All sets, Add a set): none while the keys are up. */
export const showActs = ({ typing }: { typing: boolean }) => !typing
