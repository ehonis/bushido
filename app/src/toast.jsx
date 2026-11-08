/*
 * Where toasts appear (lib/toast.js): full width under the header, one solid
 * fill per kind, white text, the newest in front. The twin of the phone's
 * mobile/src/ui/ToastHost.tsx.
 *
 * Mount it once near the root. Until the shell does (App.jsx is not this
 * screen's file), Today mounts one itself; if more than one is mounted, only the
 * first renders, so the shell can add its own without a toast showing twice.
 */
import { useEffect, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { Icon } from './lib/icons.jsx'
import { useToasts, dismissToast } from './lib/toast.js'

const ICONS = { error: 'TriangleAlert', success: 'CircleCheck', info: 'Info' }

let hosts = []
const hostListeners = new Set()
const hostChanged = () => { for (const fn of hostListeners) fn() }
const subscribeHosts = (fn) => { hostListeners.add(fn); return () => hostListeners.delete(fn) }
const firstHost = () => hosts[0] ?? null

/*
 * UNDER THE TOPMOST HEADER (#94, A F10, B F4). The deck sat at a fixed 60px, so
 * over an open sheet it covered the sheet's header for six seconds: its X, and
 * the toast's own ✕ landed exactly where the sheet's Close is, so "close the
 * sheet" dismissed the toast instead. The phone already starts its deck under
 * the sheet's header (ui/Sheet.tsx, `ToastHost top`); the web does the same,
 * measuring whichever header is on top: a sheet's, a full screen's, a workout's,
 * the timer's. Nothing open, the CSS's place under the app header.
 *
 * A HEADER LOW ON THE SCREEN (#101 review) is a bottom panel over a sheet (Edit
 * this workout at 390): under its header the deck sat on the panel's first
 * field, the Name box. There it goes ABOVE the panel instead, over the sheet
 * underneath, where nothing is being typed.
 */
export const TOAST_HEADS = '.modal-head, .fs-head, .wk-head, .it-head'

/**
 * Where the deck goes, from the last header laid out on screen: `{ top }` under
 * it, or `{ bottom }` above it when it heads a panel in the lower half of a
 * `viewH`-tall screen; null with none (the CSS's place).
 */
export function toastTop(doc, viewH = typeof window === 'undefined' ? 0 : window.innerHeight) {
  const heads = doc?.querySelectorAll?.(TOAST_HEADS) || []
  for (let i = heads.length - 1; i >= 0; i--) {
    const r = heads[i].getBoundingClientRect?.()
    if (!r || !(r.height > 0) || !(r.bottom > 0)) continue
    if (viewH > 0 && r.top > viewH / 2) return { bottom: Math.round(viewH - r.top + 8) }
    return { top: Math.round(r.bottom + 8) }
  }
  return null
}

/** The deck's inline place, from `toastTop`. */
const placeStyle = (at) => (at?.bottom != null ? { top: 'auto', bottom: `${at.bottom}px` }
  : at?.top != null ? { top: `${at.top}px` } : undefined)

/** `toastTop` kept up to date while toasts show: sheets open and close under them. */
function useToastTop(showing) {
  const [top, setTop] = useState(null)
  useLayoutEffect(() => {
    if (!showing || typeof document === 'undefined') return undefined
    let frame = 0
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setTop(toastTop(document))) }
    setTop(toastTop(document))
    const seen = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null
    seen?.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(frame); seen?.disconnect(); window.removeEventListener('resize', measure) }
  }, [showing])
  return top
}

export function ToastHost() {
  const id = useId()
  useEffect(() => {
    hosts = [...hosts, id]
    hostChanged()
    return () => { hosts = hosts.filter(h => h !== id); hostChanged() }
  }, [id])
  const first = useSyncExternalStore(subscribeHosts, firstHost, () => null)
  const toasts = useToasts()
  const mine = first === id && toasts.length > 0
  const top = useToastTop(mine)
  if (!mine) return null
  return <ToastList toasts={toasts} at={top} />
}

/* An action's glyph, as mobile's `ToastAction.icon`: a component (Undo passes
   lucide's Undo2), null for none, absent for Retry's arrow. */
function ActionIcon({ icon }) {
  if (icon === null) return null
  if (!icon) return <Icon name="RotateCw" size={13} />
  const Glyph = icon
  return <Glyph size={13} strokeWidth={1.75} aria-hidden="true" />
}

/** The toasts themselves, newest first. Pure, so the smoke suite can draw it. */
export function ToastList({ toasts, at = null }) {
  return (
    <div className="toasts" style={placeStyle(at)}>
      {[...toasts].reverse().map(t => (
        <div key={t.id} className={`toast t-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={ICONS[t.kind] || ICONS.error} size={16} />
          <span className="toast-text">
            {t.text}{t.count > 1 && <span className="toast-n"> ×{t.count}</span>}
          </span>
          {t.action && (
            <button type="button" className="toast-act"
              onClick={() => { const run = t.action.onClick; dismissToast(t.id); run() }}>
              <ActionIcon icon={t.action.icon} /> {t.action.label}
            </button>
          )}
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <Icon name="X" size={15} />
          </button>
        </div>
      ))}
    </div>
  )
}
