/*
 * Notifications, in the profile panel.
 *
 * Bushido is its own app on the phone: its own icon, its own permission, its own
 * subscription. Totem does the personal stuff; this does health and training.
 *
 * The panel's first job is to be honest about why notifications are or are not
 * working, because on iOS every failure is silent — push only works from a Home
 * Screen web app, the permission is asked once and a refusal sticks, and removing
 * the app destroys the subscription without a word. A toggle that ignores that is
 * a toggle that lies.
 *
 * Its second job is the rating. A downvote asks one optional follow-up as chips,
 * because "I disliked this" does not say whether the fact was wrong, the timing
 * was wrong, the wording was wrong, or there were simply too many — and those
 * have opposite fixes. An upvote is one tap: asking for detail on a good
 * notification taxes the behaviour you want.
 */

import { useCallback, useEffect, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import {
  pushState, subscribe, unsubscribe, sendTest, devices as listDevices,
  history as listHistory, weights as listWeights, rate, resetWeights, markRead,
  DOWNVOTE_REASONS,
} from './lib/push.js'

const ago = (ts) => {
  if (!ts) return 'never'
  const d = Date.now() - ts
  if (d < 60_000) return 'just now'
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function NotificationsSection() {
  const [state, setState] = useState(null)
  const [devices, setDevices] = useState([])
  const [configured, setConfigured] = useState(true)
  const [items, setItems] = useState([])
  const [weights, setWeights] = useState([])
  const [rating, setRating] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const refresh = useCallback(async () => {
    setState(await pushState())
    try {
      const d = await listDevices()
      setDevices(d.devices || [])
      setConfigured(d.configured !== false)
    } catch { /* the local state above is what gates the UI */ }
    try {
      const h = await listHistory()
      setItems(h.items || [])
      markRead().catch(() => {})
    } catch { /* an empty list reads the same as a quiet week */ }
    try {
      setWeights((await listWeights()).weights || [])
    } catch { /* advisory */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const enable = async () => {
    setBusy(true); setNote(null)
    // Must stay inside the click: iOS refuses a permission prompt that is not a
    // direct result of a gesture, and counts the refusal against the one chance.
    const r = await subscribe()
    if (!r.ok) setNote(r.error)
    await refresh(); setBusy(false)
  }

  const test = async () => {
    setBusy(true); setNote(null)
    try {
      const r = await sendTest()
      setNote(r.ok
        ? `Sent to ${r.delivered} device${r.delivered === 1 ? '' : 's'}. Nothing arrived? Check Focus modes.`
        : r.reason === 'no-devices' ? 'No registered devices yet.' : 'The push service refused it.')
    } catch (e) { setNote(e.message) }
    await refresh(); setBusy(false)
  }

  const vote = async (item, v, reasons = []) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, feedback: { vote: v, reasons } } : i)))
    setRating(null)
    try { await rate(item, v, reasons) } catch { /* advisory */ }
    try { setWeights((await listWeights()).weights || []) } catch { /* advisory */ }
  }

  if (!state) return <p className="sub">Checking this device…</p>

  const active = devices.filter((d) => d.state === 'active')
  const expired = devices.filter((d) => d.state === 'expired')
  const tuned = weights.filter((w) => w.multiplier !== 1)
  const off = async () => { setBusy(true); await unsubscribe(); await refresh(); setBusy(false) }

  return (
    <>
      <section className="prof-sec">
        <h2>{state.subscribed ? 'On for this device' : 'Off for this device'}</h2>
        {/* Why it cannot work, said where the button is: on iOS every failure
            is silent, and a button that does nothing is a button that lies. */}
        {!configured && (
          <p className="sub warn">The server has no push identity yet. Restart Bushido and it will make one.</p>
        )}
        {state.blocker && <p className="sub warn">{state.blocker}</p>}

        <div className="prof-actions">
          {state.subscribed ? (
            <>
              <button className="btn quiet" onClick={off} disabled={busy}>Turn off</button>
              <button className="btn secondary" onClick={test} disabled={busy || active.length === 0}>Send a test</button>
            </>
          ) : (
            <button className="btn" onClick={enable} disabled={busy || Boolean(state.blocker) || !configured}>
              {busy ? 'Working…' : 'Turn on'}
            </button>
          )}
        </div>
        {note && <p className="sub">{note}</p>}

        {devices.length > 0 && (
          <>
            <div className="section-head"><h3>Devices</h3></div>
            <div className="list">
              {active.map((d) => (
                <div className="list-row prof-static" key={d.id}>
                  <span className="dot synced" />
                  <span className="list-row-main">
                    <span className="list-row-title">{d.label}</span>
                    <span className="list-row-meta">Last notification {ago(d.lastDeliveredAt)}</span>
                  </span>
                </div>
              ))}
              {expired.map((d) => (
                <div className="list-row prof-static" key={d.id}>
                  <span className="dot offline" />
                  {/* Named rather than hidden: the usual cause is the app being removed
                      from the Home Screen, and dropping the row makes that look like it
                      never happened. */}
                  <span className="list-row-main">
                    <span className="list-row-title">{d.label}</span>
                    <span className="list-row-meta">Gone. Add Bushido back to that device and turn this on again.</span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {items.length > 0 && (
        <section className="prof-sec">
          <div className="section-head">
            <h3>Sent</h3>
            <span className="sub">Rate them to get fewer you don&rsquo;t want</span>
          </div>
          {items.slice(0, 20).map((item) => (
            <div className="notifrow" key={item.id}>
              <div className="notifcopy">
                <strong>{item.title}</strong>
                {item.body && <span className="sub">{item.body}</span>}
                <span className="sub dim">{ago(item.ts)}{item.openedAt ? ' · opened' : ''}</span>
                {rating === item.id && (
                  <div className="notifchips">
                    {DOWNVOTE_REASONS.map((r) => (
                      <button key={r.id} className="chip" onClick={() => vote(item, 'down', [r.id])}>{r.label}</button>
                    ))}
                    <button className="chip ghost" onClick={() => vote(item, 'down')}>Just less of this</button>
                  </div>
                )}
              </div>
              {item.ratable && (
                <div className="notifvote">
                  <button
                    className={`iconbtn${item.feedback?.vote === 'up' ? ' on' : ''}`}
                    onClick={() => vote(item, 'up')} aria-label="Useful" aria-pressed={item.feedback?.vote === 'up'}
                  ><Icon name="ThumbsUp" size={16} /></button>
                  <button
                    className={`iconbtn${item.feedback?.vote === 'down' ? ' on down' : ''}`}
                    onClick={() => setRating(rating === item.id ? null : item.id)} aria-label="Not useful"
                    aria-pressed={item.feedback?.vote === 'down'}
                  ><Icon name="ThumbsDown" size={16} /></button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* A kind gets rarer from ratings, never muted, and a pinned kind is unaffected. */}
      {tuned.length > 0 && (
        <section className="prof-sec">
          <div className="section-head"><h3>Sent less often</h3></div>
          <div className="list">
            {tuned.map((w) => (
              <div className="list-row prof-static" key={w.kind}>
                <span className="list-row-main">
                  <span className="list-row-title">{w.kind}</span>
                  <span className="list-row-meta">×{w.multiplier}, {w.because}{w.pinned ? ' (pinned, so no effect)' : ''}</span>
                </span>
                <button className="btn quiet" onClick={async () => { await resetWeights(w.kind); setWeights((await listWeights()).weights || []) }}>
                  Reset
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
