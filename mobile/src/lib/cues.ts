/*
 * Non-visual cues for workout mode and the runner: a buzz per phase change, and
 * keeping the screen on. The web's lib/cues.js, native.
 *
 * Same exports as the web so workout.tsx and runner.tsx call them unchanged. What
 * differs is the medium: the web synthesises beeps with Web Audio and buzzes only
 * on Android; an iPhone has the Taptic Engine and no oscillator. So each CUE is a
 * distinct haptic pattern, and they have to be told apart BY FEEL — the phone may
 * be face-down on a crash pad, or in a chalk bag, with nobody looking at it:
 *
 *   tick      selection tick        the lightest thing iOS has; three per countdown
 *   countIn   one light tap         "get ready"
 *   work      two heavy thumps      go; also the runner's rest bell
 *   rest      one medium, one soft  a falling "let go"
 *   setDone   the success pattern   the same one every logged set gets app-wide
 *   finished  success, then three heavy thumps building
 *
 * All best-effort by design, as on the web: a missing buzz is a nuisance and a
 * timer that threw mid-hang is a ruined session, so nothing here may throw.
 *
 * beep() is a no-op. Native has no oscillator, and a bundled sound file plus an
 * audio session for one beep is not worth it while the haptics carry the cues.
 */
import * as Haptics from 'expo-haptics'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'

const later = (ms: number, fn: () => void) => { setTimeout(fn, ms) }
const impact = (style: Haptics.ImpactFeedbackStyle) => { Haptics.impactAsync(style).catch(() => {}) }
const heavy = () => impact(Haptics.ImpactFeedbackStyle.Heavy)
const success = () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}) }

/** The web's synthesised tone. Silent on native; the haptic carries the cue. */
export function beep(_opts: { freq?: number; ms?: number; gain?: number } = {}) { /* no oscillator on native */ }

/** The web's navigator.vibrate. A number or a pattern becomes one heavy impact. */
export function buzz(_pattern: number | number[] = 60) { heavy() }

/** Distinct enough to tell apart without looking at the phone. */
export const CUES: Record<string, () => void> = {
  // One per second over the last three seconds of any countdown, so a change of
  // phase is felt coming rather than noticed afterwards. Deliberately the
  // faintest cue in the set.
  tick: () => { Haptics.selectionAsync().catch(() => {}) },
  countIn: () => impact(Haptics.ImpactFeedbackStyle.Light),
  work: () => { heavy(); later(120, heavy) },
  rest: () => { impact(Haptics.ImpactFeedbackStyle.Medium); later(160, () => impact(Haptics.ImpactFeedbackStyle.Soft)) },
  setDone: success,
  finished: () => { success(); later(320, heavy); later(480, heavy); later(700, heavy) },
}

/** The web creates its audio context inside a real tap here. Nothing to prime natively. */
export function primeAudio() { /* no audio context */ }

/** The web retakes a suspended audio context on return. Nothing to resume natively. */
export function resumeAudio() { /* no audio context */ }

let seq = 0

/**
 * Keep the screen awake while the timer runs. Resolves to the tag that holds it
 * (each caller its own, so the runner releasing cannot drop workout mode's), or
 * null if keep-awake is unavailable.
 */
export async function acquireWakeLock(): Promise<string | null> {
  const tag = `bushido-workout-${++seq}`
  try {
    await activateKeepAwakeAsync(tag)
    return tag
  } catch {
    return null
  }
}

export function releaseWakeLock(lock: string | null | undefined) {
  if (!lock) return
  try { deactivateKeepAwake(lock).catch(() => {}) } catch { /* already gone */ }
}
