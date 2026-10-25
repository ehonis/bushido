/*
 * Where toasts appear (lib/toast.js): full width under the header, one solid
 * fill per kind, white text, the newest in front. The twin of the phone's
 * mobile/src/ui/ToastHost.tsx.
 *
 * Mount it once near the root. Until the shell does (App.jsx is not this
 * screen's file), Today mounts one itself; if more than one is mounted, only the
 * first renders, so the shell can add its own without a toast showing twice.
 */
import { useEffect, useId, useSyncExternalStore } from 'react'
import { Icon } from './lib/icons.jsx'
import { useToasts, dismissToast } from './lib/toast.js'

const ICONS = { error: 'TriangleAlert', success: 'CircleCheck', info: 'Info' }

let hosts = []
const hostListeners = new Set()
const hostChanged = () => { for (const fn of hostListeners) fn() }
const subscribeHosts = (fn) => { hostListeners.add(fn); return () => hostListeners.delete(fn) }
const firstHost = () => hosts[0] ?? null

export function ToastHost() {
  const id = useId()
  useEffect(() => {
    hosts = [...hosts, id]
    hostChanged()
    return () => { hosts = hosts.filter(h => h !== id); hostChanged() }
  }, [id])
  const first = useSyncExternalStore(subscribeHosts, firstHost, () => null)
  const toasts = useToasts()
  if (first !== id || !toasts.length) return null
  return <ToastList toasts={toasts} />
}

/** The toasts themselves, newest first. Pure, so the smoke suite can draw it. */
export function ToastList({ toasts }) {
  return (
    <div className="toasts">
      {[...toasts].reverse().map(t => (
        <div key={t.id} className={`toast t-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <Icon name={ICONS[t.kind] || ICONS.error} size={16} />
          <span className="toast-text">
            {t.text}{t.count > 1 && <span className="toast-n"> ×{t.count}</span>}
          </span>
          {t.action && (
            <button type="button" className="toast-act"
              onClick={() => { const run = t.action.onClick; dismissToast(t.id); run() }}>
              <Icon name="RotateCw" size={13} /> {t.action.label}
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
