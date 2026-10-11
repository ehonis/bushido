/**
 * Typing a number one keystroke at a time.
 *
 * A controlled input that runs `Number()` on every keystroke cannot take a
 * decimal: "12." is 12, React writes "12" back into the box, and the dot the user
 * just typed is gone before the 5 arrives. Every weight box in the app did this
 * until 2026-09-20 — the lift log, the planner's steppers and the runner's big
 * ones — and it read as "decimals are not allowed".
 *
 * The fix is to keep what the user TYPED as the box's text and hand the number out
 * beside it, so the two can disagree for exactly as long as a half-typed number
 * needs them to. This is the pure half; `NumInput` in `numinput.jsx` is the box.
 */

const DEC = /^\d*\.?\d*$/
const INT = /^\d*$/

/**
 * What a keystroke leaves in the box, and what it means.
 *
 * Returns `null` to refuse the keystroke outright (letters, a second dot, a
 * minus — nothing in this app weighs less than nothing). Otherwise `text` is
 * what to show, `emit` says whether there is a number to hand out yet, and
 * `value` is that number — or `null` for an emptied box. A lone "." is text
 * with nothing to emit: the user is halfway through ".5" and the box should wait.
 */
export function acceptNumberText(raw, { decimal = true } = {}) {
  const text = String(raw ?? '').replace(',', '.')
  if (!(decimal ? DEC : INT).test(text)) return null
  if (text === '') return { text, emit: true, value: null }
  const n = Number(text)
  if (!Number.isFinite(n)) return { text, emit: false, value: null }
  return { text, emit: true, value: n }
}

/** Blank is blank whether it arrives as '', null or undefined; anything else is a number or blank. */
export function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
