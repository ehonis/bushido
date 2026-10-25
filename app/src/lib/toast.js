/*
 * Toasts: the transient result of an action (docs/DESIGN.md, "Components"). A
 * workout removed, with Undo; a save that did not reach the server, with Retry.
 * Nothing else: an error about a form stays inline under the field.
 *
 * The web port of mobile/src/lib/toast.ts, with the same API (`pushToast`,
 * `pushError`, `pushSuccess`, `dismissToast`, `useToasts`), so a screen calls the
 * same thing on both. A tiny external store, so code without a shared parent can
 * raise one. The deck the phone spreads on a tap is left out: on the web one
 * toast in front and the rest queued behind it is enough.
 */
import { useSyncExternalStore } from 'react'

/* Short-lived, and errors a little longer. */
const DEFAULT_MS = { error: 5000, success: 3500, info: 3500 }
/** Older toasts past this are dropped rather than piling up. */
const KEEP = 3

let toasts = []
const listeners = new Set()
const timers = new Map()
let seq = 0

const emit = () => { for (const fn of listeners) fn() }

/**
 * `kind` is 'error' | 'success' | 'info'. `action` is `{ label, onClick }` (Undo,
 * Retry); the toast goes once it is pressed. `duration: 0` keeps it until dismissed.
 */
export function pushToast(message, kind = 'error', { duration, action } = {}) {
  const text = typeof message === 'string' ? message : (message && message.message) || String(message || '')
  if (!text) return null
  const ms = duration ?? DEFAULT_MS[kind] ?? DEFAULT_MS.error
  // The same message again joins the toast already showing it, back at the front.
  const same = !action && toasts.find(t => t.text === text && t.kind === kind && !t.action)
  if (same) {
    toasts = [...toasts.filter(t => t.id !== same.id), { ...same, count: same.count + 1, duration: ms }]
    startTimer(same.id, ms)
    emit()
    return same.id
  }
  const id = ++seq
  toasts = [...toasts, { id, text, kind, action, duration: ms, count: 1 }]
  for (const old of toasts.slice(0, Math.max(0, toasts.length - KEEP))) dismissToast(old.id, false)
  startTimer(id, ms)
  emit()
  return id
}

function startTimer(id, ms) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  if (ms && typeof setTimeout === 'function') timers.set(id, setTimeout(() => dismissToast(id), ms))
}

export function dismissToast(id, notify = true) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts = toasts.filter(t => t.id !== id)
  if (notify) emit()
}

export const pushError = (message) => pushToast(message, 'error')
export const pushSuccess = (message) => pushToast(message, 'success')

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
const getSnapshot = () => toasts
export function useToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
