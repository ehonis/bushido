/*
 * The interval timer's host (#98: out of timer.jsx), mounted once at the top of
 * the app and in the main bundle. It answers `openTimer` (timerbus.js) and finds
 * a run that was going when the page went away. The timer's screen itself
 * (timer.jsx) loads on demand: opened by a tap and failing to load, it says so
 * in its own frame with Try again and Close; resumed in the background and
 * failing to load, it draws nothing (the run stays on the device for next time).
 */
import { useState, useSyncExternalStore } from 'react'
import { currentMe } from './lib/whoami.js'
import { runKeyFor, saveRun, loadRun } from './lib/timer.js'
import { subscribe, getRequest, closeTimer } from './timerbus.js'
import { FullScreen } from './modal.jsx'
import { lazyPart, LoadFailed } from './lazy.jsx'

const storage = () => (typeof window === 'undefined' ? null : window.localStorage)

const IntervalTimer = lazyPart(() => import('./timer.jsx'), 'IntervalTimer', {
  failed: (props, retry) => (props.resumed ? null : (
    <FullScreen title="Interval timer" onBack={props.onClose}>
      <LoadFailed what="The interval timer" onRetry={retry} />
    </FullScreen>
  )),
})

/**
 * Mounted once, at the top of the app. Shows nothing until the timer is asked
 * for, or until a run that was going when the page went away is found.
 */
export function TimerHost({ entries, upsertEntry, deleteEntry, onLog = null, onPlace = null }) {
  const req = useSyncExternalStore(subscribe, getRequest, getRequest)
  const key = runKeyFor(currentMe().id)
  const [resumed, setResumed] = useState(() => loadRun(storage(), key, Date.now()))
  if (!req && !resumed) return null
  const close = () => {
    saveRun(storage(), key, null)
    setResumed(null)
    closeTimer()
  }
  return (
    <IntervalTimer key={resumed ? 'resumed' : req.seq}
      title={resumed ? resumed.title : req.title}
      sessionPresets={resumed ? [] : req.presets}
      resumed={resumed} entries={entries} upsertEntry={upsertEntry} deleteEntry={deleteEntry}
      onLog={onLog} onPlace={onPlace ? (name, config) => { onPlace(name, config); close() } : null}
      persist={(doc) => saveRun(storage(), key, doc)} onClose={close} />
  )
}

