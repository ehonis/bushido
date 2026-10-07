/*
 * The profile: the user, their gear, their numbers, and the reference material.
 *
 * Added 2026-09-15. It replaced the sync pill in the header with the user's name
 * and Strava profile picture. The sync state did not die with
 * it; it moved into the panel, because a corner of the screen that only ever says
 * "synced 3:52 PM" is a corner spent on the least interesting true statement the
 * app can make, and "who am I and what do I own" is the more useful thing.
 *
 * It also absorbed three tabs. Gear, Testing and Why were all reference rather
 * than doing: none of them is touched mid-session, all three were taking space in
 * a bottom bar used with one chalky thumb. The bar is now Today, Week, Log,
 * Progress — the four screens a session actually passes through.
 *
 * IT WAS A FULL-SCREEN PAGE FOR ABOUT AN HOUR, and that was wrong. Full-screen
 * suits a session you are in the middle of — one thing, all the room. This is
 * reference: you open it, change one number or read one odometer, and leave. On a
 * 2300px desktop the full-screen version put a narrow column of fields in the
 * middle of a dark void with six tabs spread edge to edge.
 *
 * Now it is a popover anchored under the avatar, sized to its contents, with the
 * sections as a rail down the side. On a phone the same component becomes a
 * bottom sheet, which is where a thumb expects a menu to come from — the
 * difference is CSS, not a second component.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { ScreenCard } from './screeninfo.jsx'
import { Popover } from './modal.jsx'
import { useStrava } from './lib/strava.jsx'
import { athleteOf, profileFacts, buildProfileEntry, factValue, PROFILE_GROUPS } from './lib/profile.js'
import { GearSection } from './gear.jsx'
import { TestingTab, WhyTab } from './tabs.jsx'
import { usePrefs } from './lib/prefs.jsx'
import { localIso } from './lib/dates.js'
import { NotificationsSection } from './notifications.jsx'
import { currentMe, actAs } from './lib/whoami.js'

/* ---------------------------------------------------------- the menu */

const SECTIONS = [
  { key: 'you', label: 'You', icon: 'PersonStanding' },
  { key: 'gear', label: 'Gear', icon: 'ShoppingBag' },
  { key: 'testing', label: 'Testing', icon: 'Gauge' },
  { key: 'why', label: 'Why', icon: 'FlaskConical' },
  { key: 'alerts', label: 'Alerts', icon: 'Bell' },
  { key: 'settings', label: 'Settings', icon: 'Shield' },
]

/**
 * The avatar in the header, and the panel it opens.
 *
 * One component rather than two, because the panel has to be positioned against
 * the button and splitting them means passing a ref up through App to get it.
 *
 * The sync DOT lives on the avatar, because "is my log actually saved" is a real
 * question with a real failure mode and burying it entirely would be worse than
 * the pill it replaced. A dot rather than a sentence: green is fine, anything
 * else is worth opening.
 */
export function ProfileMenu({ plan, entries, upsertEntry, deleteEntry, status, lastSync, me: who = currentMe() }) {
  const btn = useRef(null)
  const [anchor, setAnchor] = useState(null)
  const [tab, setTab] = useState('you')
  const { cache: strava, pull, pulling } = useStrava()
  // Strava's name and picture when connected; otherwise the name this person has on the install.
  const me = athleteOf(strava, who.name)

  const open = () => setAnchor(btn.current?.getBoundingClientRect() || null)
  const close = () => setAnchor(null)

  return (
    <>
      <button ref={btn} className="mebtn" onClick={() => (anchor ? close() : open())}
        aria-expanded={Boolean(anchor)} title="You, your gear and your numbers">
        <span className="mebtn-av">
          {me.avatar
            ? <img src={me.avatar} alt="" width={28} height={28} />
            : <span className="mebtn-ini">{me.initials || <Icon name="PersonStanding" size={16} />}</span>}
          <span className={`mebtn-dot ${status}`} />
        </span>
        <span className="mebtn-name">{me.firstName || me.name}</span>
        <Icon name="ChevronDown" size={14} className="mebtn-chev" />
      </button>

      {anchor !== undefined && anchor !== null && (
        <Popover anchor={anchor} label={me.name} onClose={close}>
          <header className="pop-head">
            <span className="pop-av">
              {me.avatar
                ? <img src={me.avatar} alt="" width={36} height={36} />
                : <span className="mebtn-ini">{me.initials || '?'}</span>}
            </span>
            <span className="pop-who">
              <strong>{me.name}</strong>
              <span className="sub">{who.acting ? `${who.real.name || 'You'}, logging for them` : me.connected ? 'via Strava' : who.features.strava ? 'Strava not connected' : ''}</span>
            </span>
            <button className="pop-x" onClick={close} aria-label="Close"><Icon name="X" size={17} /></button>
          </header>

          <div className="pop-split">
            <nav className="pop-rail" role="tablist">
              {SECTIONS.map(sec => (
                <button key={sec.key} role="tab" aria-selected={tab === sec.key}
                  className={`pop-railbtn ${tab === sec.key ? 'on' : ''}`}
                  onClick={() => setTab(sec.key)}>
                  <Icon name={sec.icon} size={15} />
                  <span>{sec.label}</span>
                </button>
              ))}
            </nav>

            <div className="pop-body">
              {tab === 'you' && <YouSection plan={plan} entries={entries} strava={strava} upsertEntry={upsertEntry} />}
              {tab === 'gear' && (
                <GearSection plan={plan} entries={entries} strava={strava}
                  upsertEntry={upsertEntry} deleteEntry={deleteEntry} />
              )}
              {tab === 'testing' && <TestingTab plan={plan} entries={entries} upsertEntry={upsertEntry} />}
              {tab === 'why' && <WhyTab plan={plan} />}
              {tab === 'alerts' && <NotificationsSection />}
              {tab === 'settings' && (
                <SettingsSection status={status} lastSync={lastSync} who={who}
                  strava={strava} onPullStrava={pull} pulling={pulling} />
              )}
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}

/* ------------------------------------------------------------------- you */

function YouSection({ plan, entries, strava, upsertEntry }) {
  const facts = profileFacts(entries)
  const save = (key, value) => {
    const next = { ...facts }
    if (value === '' || value === null || value === undefined) delete next[key]
    else next[key] = value
    upsertEntry(buildProfileEntry(next))
  }

  /*
   * Bodyweight writes to the SERIES, not to the profile.
   *
   * It is the one fact here with a history worth keeping — the chart goes back to
   * July — so typing a new number logs a new point rather than overwriting a
   * standing value. Same id shape the quick-log used, so today's weight entered
   * here and entered there are the same entry rather than two.
   */
  const saveWeight = (lb) => {
    const n = Number(lb)
    if (!(n > 0)) return
    const date = localIso()
    upsertEntry({ id: `bodyweight-${date}`, kind: 'bodyweight', date, data: { lb: n } })
  }

  return (
    <>
      {PROFILE_GROUPS.map(group => (
        <div className="card" key={group.key}>
          <h2><Icon name={group.icon} size={16} /> {group.name}</h2>
          {group.blurb && <p className="sub">{group.blurb}</p>}
          <div className="factgrid">
            {group.fields.map(f => {
              const { value, source, date } = factValue(f, { facts, strava, entries })
              return (
                <label className="field fact" key={f.key}>
                  <span className="fact-label">
                    {f.label} {f.unit ? <em>({f.unit})</em> : null}
                    {/* A value the user did not give must never look like one the user did —
                        the same rule `filledBy` enforces on a WHOOP-filled
                        distance. */}
                    {source === 'strava' && <span className="out-from">from Strava</span>}
                    {source === 'logged' && <span className="out-from">logged {date}</span>}
                  </span>
                  <input
                    type={f.type === 'number' ? 'number' : 'text'}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    defaultValue={source === 'own' ? value : ''}
                    /*
                     * A number the app is only SHOWING on their behalf goes in the
                     * placeholder, never the value: it reads the same, and it does
                     * not silently become their the next time anything saves. Same
                     * rule as a derived average speed. Failing that, a short
                     * example — the explanatory sentence lives under the box,
                     * because a placeholder long enough to explain something is a
                     * placeholder truncated at the input's width.
                     */
                    placeholder={source !== 'own' && value !== null ? String(value) : (f.eg || '')}
                    onBlur={e => (f.writes === 'bodyweight'
                      ? saveWeight(e.target.value)
                      : save(f.key, f.type === 'number'
                          ? (e.target.value === '' ? '' : Number(e.target.value))
                          : e.target.value))}
                  />
                  {f.hint && <span className="fact-hint">{f.hint}</span>}
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

/* -------------------------------------------------------------- settings */

/* Whether this server has sign-in at all (proxy mode has nothing to sign out of). */
function useCanSignOut() {
  const [can, setCan] = useState(false)
  useEffect(() => {
    let live = true
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(me => { if (live) setCan(Boolean(me && me.mode !== 'proxy')) })
      .catch(() => {})
    return () => { live = false }
  }, [])
  return can
}

/**
 * The owner's way into someone else's log, to mark their sets for them. A
 * reload into that person's log rather than a swap in place (lib/whoami.js), and
 * the banner under the header says whose it is until they switch back.
 */
export function PeopleCard({ who }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  if (!who.real.admin || who.people.length < 2) return null
  const go = (id) => {
    setBusy(id ?? 'me'); setError(null)
    actAs(id).catch(e => { setBusy(null); setError(e.message) })
  }
  return (
    <div className="card">
      <h2>People</h2>
      <p className="sub">
        Open someone&rsquo;s log to log sessions and mark sets for them. Everything you do there
        is theirs, until you switch back.
      </p>
      {who.people.map(p => {
        const isOpen = p.id === who.id
        const isMe = p.id === who.real.id
        return (
          <button key={p.id} className="restbtn" disabled={isOpen || Boolean(busy)}
            onClick={() => go(isMe ? null : p.id)}>
            <Icon name={isMe ? 'PersonStanding' : 'Users'} size={16} />
            <span>
              {isOpen ? `${isMe ? 'Your log' : `${p.name}’s log`} (open)`
                : busy === (isMe ? 'me' : p.id) ? 'Switching…'
                  : isMe ? 'Back to your log' : `Log for ${p.name}`}
            </span>
          </button>
        )
      })}
      {error && <p className="sub" style={{ color: 'var(--bad)' }}>{error}</p>}
    </div>
  )
}

function SettingsSection({ status, lastSync, strava, onPullStrava, pulling, who = currentMe() }) {
  const { allHidden, toggleAll } = usePrefs()
  const canSignOut = useCanSignOut()
  const label = {
    loading: 'connecting', syncing: 'saving',
    synced: lastSync ? `synced ${lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'synced',
    offline: 'offline — will retry',
  }[status]

  return (
    <>
      <PeopleCard who={who} />
      {(who.real.admin || canSignOut) && (
      <div className="card">
        <h2>Server</h2>
        <p className="sub">
          Sign-in, AI, the training plan and integrations are set on the server&rsquo;s own
          Settings page.
        </p>
        {who.real.admin && (
          <a className="restbtn" href="/settings">
            <Icon name="Shield" size={16} />
            <span>Open Settings</span>
          </a>
        )}
        {canSignOut && (
          <a className="restbtn" href="/?signout=1">
            <Icon name="LogOut" size={16} />
            <span>Sign out of this device</span>
          </a>
        )}
      </div>
      )}

      <div className="card">
        <h2>Sync</h2>
        <p className="sub">
          This is what the header used to say. Your log lives on your box and syncs
          across devices; an offline edit queues and pushes when the tailnet comes back.
        </p>
        <div className="setrow">
          <span className={`dot ${status}`} /> <strong>{label}</strong>
        </div>
      </div>

      {/* The owner's Strava, through the owner's bridge: not someone else's to refresh. */}
      {who.owner && (
      <div className="card">
        <h2>Strava</h2>
        <p className="sub">
          {strava?.athlete
            ? `Connected as ${strava.athlete.name}. Your name, picture, bikes and shoes come from here.`
            : strava?.configured === false
              ? 'Not connected. Strava is read through a Totem bridge; set one up in Settings → Integrations.'
              : 'Not connected. Connect it in Totem — the credentials live there, never in this app.'}
        </p>
        <button className="restbtn" onClick={() => onPullStrava?.()} disabled={pulling}>
          <Icon name="RotateCw" size={16} />
          <span>{pulling ? 'Refreshing…' : 'Refresh now'}</span>
        </button>
      </div>
      )}

      <div className="card">
        <h2>Explanations</h2>
        <p className="sub">
          The app explains itself a lot. Once you know why a thing is there, you can
          collapse every explainer to a one-line stub and tap any of them back.
        </p>
        <button className="restbtn" onClick={toggleAll}>
          <Icon name={allHidden ? 'Eye' : 'EyeOff'} size={16} />
          <span>{allHidden ? 'Show the explanations' : 'Hide the explanations'}</span>
        </button>
      </div>

      {/* What the device gives the page — see screeninfo.jsx. */}
      <ScreenCard />
    </>
  )
}
