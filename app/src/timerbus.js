/*
 * The interval timer's request line (#98: out of timer.jsx, so a screen that
 * only opens the timer does not load it). Any screen can ask for the timer (the
 * session sheet, the + menu) without threading the store through to it:
 * `openTimer` posts the request and the one `TimerHost` (timer.jsx) answers it.
 */
import { sessionTimer } from './lib/timer.js'

let request = null
let seq = 0
const listeners = new Set()
const notify = () => { for (const fn of listeners) fn() }
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const getRequest = () => request

/** Open the timer. `title` is the workout it was opened from; `presets` that workout's own timers. */
export function openTimer({ title = null, presets = [] } = {}) {
  request = { title, presets: presets.filter(Boolean), seq: ++seq }
  notify()
}
export function closeTimer() { request = null; notify() }

/** What the session sheet asks for: the workout's name, and its plan's timer if it declares one. */
export function timerRequestFor(opt, entry = null) {
  return {
    title: entry?.data?.name || opt?.name || null,
    presets: [sessionTimer(opt, entry?.data?.out || {})],
  }
}
