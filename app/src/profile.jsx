/*
 * The profile: the user, their gear, their connections, and the reference material.
 *
 * Added 2026-09-15. It replaced the sync pill in the header with the user's name
 * and Strava profile picture. The sync state did not die with it; it moved onto
 * the avatar as a dot and into Settings, because "who am I and what do I own" is
 * the more useful thing for a corner of the screen to say.
 *
 * It is a popover anchored under the avatar on a desktop and a bottom sheet on a
 * phone (the difference is CSS, not a second component): reference, not doing
 * (AGENTS.md §6.7).
 *
 * A LIST OF SECTIONS since wave 2 (#44). It was six tabs in a sideways strip that
 * cut off on a phone ("Alerts" half hidden), with Testing and Why, which only a
 * climbing plan fills, sitting beside You and Gear. Now the panel opens on one
 * list (You, Gear, Notifications, Connections, Climbing, Settings), each row
 * opening its page with a back button in the header, and Testing and Why live
 * under the one Climbing row (docs/DESIGN.md D6).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './lib/icons.jsx'
import { ScreenCard } from './screeninfo.jsx'
import { Popover } from './modal.jsx'
import { useStrava } from './lib/strava.jsx'
import { athleteOf, profileFacts, buildProfileEntry, factValue, PROFILE_GROUPS } from './lib/profile.js'
import { gearUsage } from './lib/gear.js'
import { GearSection } from './gear.jsx'
import { TestingTab, WhyTab, hasTests, hasEvidence } from './testing.jsx'
import { usePrefs } from './lib/prefs.jsx'
import { localIso } from './lib/dates.js'
import { NotificationsSection } from './notifications.jsx'
import { currentMe, actAs } from './lib/whoami.js'
import { MyAbout } from './trainer.jsx'

/* ---------------------------------------------------------- the pages */

/*
 * Every page the panel can show, and the page its back button returns to. The
 * home list is the first six; Testing and Why are reached from Climbing.
 */
export const PAGES = {
  you: { label: 'You', icon: 'PersonStanding' },
  gear: { label: 'Gear', icon: 'ShoppingBag' },
  notifications: { label: 'Notifications', icon: 'Bell' },
  connections: { label: 'Connections', icon: 'Waypoints' },
  climbing: { label: 'Climbing', icon: 'Mountain' },
  settings: { label: 'Settings', icon: 'Shield' },
  testing: { label: 'Testing', icon: 'Gauge', parent: 'climbing' },
  why: { label: 'Why', icon: 'FlaskConical', parent: 'climbing' },
}

/* Whether this person has anything to connect: Strava is everyone's own, WHOOP the owner's (§3). */
export function canConnect(who) {
  if (who.acting) return false
  const strava = who.features.stravaConnect || who.features.strava
  const whoop = who.owner && (who.features.whoopConnect || who.features.whoop)
  return Boolean(strava || whoop)
}

/** The home rows, in order. Connections only where there is something to connect. */
export function homePages(who) {
  return ['you', 'gear', 'notifications', ...(canConnect(who) ? ['connections'] : []), 'climbing', 'settings']
}

const syncLabel = (status, lastSync) => ({
  loading: 'Connecting',
  syncing: 'Saving',
  synced: lastSync ? `Synced ${lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Synced',
  offline: 'Offline, will retry',
}[status] || '')

/**
 * The avatar in the header, and the panel it opens.
 *
 * One component rather than two, because the panel has to be positioned against
 * the button and splitting them means passing a ref up through App to get it.
 *
 * The sync DOT lives on the avatar, because "is my log actually saved" is a real
 * question with a real failure mode. A dot rather than a sentence: green is fine,
 * anything else is worth opening.
 */
export function ProfileMenu({ plan, entries, upsertEntry, deleteEntry, status, lastSync, me: who = currentMe() }) {
  const btn = useRef(null)
  const [anchor, setAnchor] = useState(null)
  const { cache: strava } = useStrava()
  // Strava's name and picture when connected; otherwise the name this person has on the install.
  const me = athleteOf(strava, who.name)

  const open = () => setAnchor(btn.current?.getBoundingClientRect() || null)
  const close = () => setAnchor(null)

  return (
    <>
      {/* A name for the button: on a phone it is a face and nothing else, and a
          `title` is not an accessible name there. */}
      <button ref={btn} className="mebtn" onClick={() => (anchor ? close() : open())}
        aria-expanded={Boolean(anchor)} aria-label={`Profile: ${me.name || 'you'}`}>
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
          <ProfilePanel plan={plan} entries={entries} upsertEntry={upsertEntry} deleteEntry={deleteEntry}
            status={status} lastSync={lastSync} who={who} onClose={close} />
        </Popover>
      )}
    </>
  )
}

/**
 * What the popover holds: the home list, or one page with a back button.
 * Exported so the smoke suite can render any page without opening a popover.
 */
export function ProfilePanel({
  plan, entries, upsertEntry, deleteEntry, status, lastSync, who = currentMe(), onClose, initialPage = null,
}) {
  const [page, setPage] = useState(initialPage)
  const { cache: strava, pull, pulling } = useStrava()
  const me = athleteOf(strava, who.name)
  const sec = page ? PAGES[page] : null

  return (
    <>
      <header className="pop-head">
        {sec ? (
          <>
            <button className="iconbtn prof-back" onClick={() => setPage(sec.parent || null)}
              aria-label={`Back to ${sec.parent ? PAGES[sec.parent].label : 'your profile'}`}>
              <Icon name="ChevronLeft" size={20} />
            </button>
            <span className="pop-who"><strong>{sec.label}</strong></span>
          </>
        ) : (
          <>
            <span className="pop-av">
              {me.avatar
                ? <img src={me.avatar} alt="" width={36} height={36} />
                : <span className="mebtn-ini">{me.initials || '?'}</span>}
            </span>
            <span className="pop-who">
              <strong>{me.name}</strong>
              <span className="sub">{who.acting ? `${who.real.name || 'You'}, logging for them` : me.connected ? 'via Strava' : ''}</span>
            </span>
          </>
        )}
        <button className="pop-x" onClick={onClose} aria-label="Close"><Icon name="X" size={17} /></button>
      </header>

      <div className="pop-body">
        {!page && (
          <HomeList who={who} plan={plan} entries={entries} strava={strava}
            status={status} lastSync={lastSync} onOpen={setPage} />
        )}
        {page === 'you' && <MyAbout me={who} />}
        {page === 'you' && <FactsForm groups={['body']} entries={entries} strava={strava} upsertEntry={upsertEntry} />}
        {page === 'gear' && (
          <GearSection plan={plan} entries={entries} strava={strava}
            upsertEntry={upsertEntry} deleteEntry={deleteEntry} />
        )}
        {page === 'notifications' && <NotificationsSection />}
        {page === 'connections' && <ConnectionsSection who={who} strava={strava} onPullStrava={pull} pulling={pulling} />}
        {page === 'climbing' && (
          <ClimbingSection plan={plan} entries={entries} strava={strava} upsertEntry={upsertEntry} onOpen={setPage} />
        )}
        {page === 'testing' && <TestingTab plan={plan} entries={entries} upsertEntry={upsertEntry} />}
        {page === 'why' && <WhyTab plan={plan} />}
        {page === 'settings' && <SettingsSection status={status} lastSync={lastSync} who={who} />}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ home */

/** One row that opens a page: icon, name, the one fact worth seeing, chevron. */
function PageRow({ page, meta, onOpen }) {
  const sec = PAGES[page]
  return (
    <button type="button" className="list-row" onClick={() => onOpen(page)}>
      <Icon name={sec.icon} size={20} />
      <span className="list-row-main">
        <span className="list-row-title">{sec.label}</span>
        {meta ? <span className="list-row-meta">{meta}</span> : null}
      </span>
      <Icon name="ChevronRight" size={16} className="list-row-chev" />
    </button>
  )
}

function HomeList({ who, plan, entries, strava, status, lastSync, onOpen }) {
  const facts = profileFacts(entries)
  const weightField = PROFILE_GROUPS.flatMap(g => g.fields).find(f => f.key === 'weightLb')
  const weight = weightField ? factValue(weightField, { facts, strava, entries }).value : null
  const gearCount = useMemo(
    () => gearUsage({ plan, entries, strava }).filter(g => !g.retired).length,
    [plan, entries, strava])
  const connected = [
    who.features.strava && 'Strava',
    who.owner && who.features.whoop && 'WHOOP',
  ].filter(Boolean)
  const meta = {
    you: weight != null ? `${weight} lb` : '',
    gear: gearCount ? `${gearCount} item${gearCount === 1 ? '' : 's'}` : '',
    connections: connected.length ? connected.join(' and ') : 'Not connected',
    climbing: facts.redpoint || facts.boulder || '',
    settings: syncLabel(status, lastSync),
  }
  return (
    <nav className="list prof-home" aria-label="Profile">
      {homePages(who).map(p => <PageRow key={p} page={p} meta={meta[p]} onOpen={onOpen} />)}
    </nav>
  )
}

/* ------------------------------------------------------- your numbers */

/*
 * Helper text only where a field is not obvious from its label (D7). Ape index
 * is a measurement most people have never taken; the rest say what they are.
 */
const HINTED = new Set(['apeIndex'])

/** The standing facts of the named PROFILE_GROUPS: body on You, grades on Climbing. */
function FactsForm({ groups, entries, strava, upsertEntry }) {
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

  return PROFILE_GROUPS.filter(g => groups.includes(g.key)).map(group => (
    <section className="prof-sec" key={group.key}>
      <div className="section-head"><h3>{group.key === 'climbing' ? 'Your grades' : group.name}</h3></div>
      <div className="factgrid">
        {group.fields.map(f => {
          const { value, source, date } = factValue(f, { facts, strava, entries })
          return (
            <label className="field fact" key={f.key}>
              <span className="fact-label">
                {f.label}{f.unit ? ` (${f.unit})` : ''}
                {/* A value the user did not give must never look like one they did —
                    the same rule `filledBy` enforces on a WHOOP-filled distance. */}
                {source === 'strava' && <span className="fact-from">from Strava</span>}
                {source === 'logged' && <span className="fact-from">logged {date}</span>}
              </span>
              <input
                type="text"
                inputMode={f.type === 'number' ? 'decimal' : undefined}
                defaultValue={source === 'own' ? value : ''}
                /*
                 * A number the app is only SHOWING on their behalf goes in the
                 * placeholder, never the value: it reads the same, and it does
                 * not silently become theirs the next time anything saves. Same
                 * rule as a derived average speed. Failing that, nothing: an
                 * example ("186 lb") in placeholder grey read as their own
                 * number, the reason the sheet dropped its examples in #41 (#55).
                 */
                placeholder={source !== 'own' && value !== null ? String(value) : ''}
                onBlur={e => (f.writes === 'bodyweight'
                  ? saveWeight(e.target.value)
                  : save(f.key, f.type === 'number'
                      ? (e.target.value === '' ? '' : Number(e.target.value))
                      : e.target.value))}
              />
              {f.hint && HINTED.has(f.key) && <span className="fact-hint">{f.hint}</span>}
            </label>
          )
        })}
      </div>
    </section>
  ))
}

/* ------------------------------------------------------------- climbing */

/*
 * Climbing: the grades, then Testing and Why as rows. Those two are filled only
 * by a plan that defines tests or evidence, so a row with nothing behind it is
 * left out rather than opening onto an apology (D7).
 */
function ClimbingSection({ plan, entries, strava, upsertEntry, onOpen }) {
  const tests = hasTests(plan)
  const why = hasEvidence(plan)
  return (
    <>
      <FactsForm groups={['climbing']} entries={entries} strava={strava} upsertEntry={upsertEntry} />
      {(tests || why) && (
        <div className="list">
          {tests && <PageRow page="testing" meta={`${(plan?.tests || []).length} in this plan`} onOpen={onOpen} />}
          {why && <PageRow page="why" meta="The evidence behind the plan" onOpen={onOpen} />}
        </div>
      )}
    </>
  )
}

/* ---------------------------------------------------------- connections */

/* A POST from a connect row: busy while it runs, its error kept for the row to show. */
function useConnectCall() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const call = async (path) => {
    setBusy(true); setError('')
    try {
      const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      return body
    } catch (err) {
      setError(err.message)
      setBusy(false)
      return null
    }
  }
  return { busy, error, call }
}

/**
 * One service: its name and state on a row, then its buttons. Connecting leaves
 * the app for the service's consent page and comes back to `/`; both directions
 * reload, since whether a service is on is decided at boot (whoami).
 */
function ServiceRow({ name, icon, connected, detail, connectPath, disconnectPath, confirmText, extra }) {
  const { busy, error, call } = useConnectCall()
  const connect = async () => {
    const body = await call(connectPath)
    if (body?.authUrl) window.location.href = body.authUrl
  }
  const disconnect = async () => {
    if (!window.confirm(confirmText)) return
    if (await call(disconnectPath)) window.location.reload()
  }
  return (
    <section className="prof-sec prof-service">
      <div className="list-row prof-service-row">
        <Icon name={icon} size={20} />
        <span className="list-row-main">
          <span className="list-row-title">{name}</span>
          <span className="list-row-meta">{connected ? (detail || 'Connected') : 'Not connected'}</span>
        </span>
        {/* Secondary, not the accent: two services on one page would be two primaries. */}
        {connected
          ? <Icon name="CircleCheck" size={18} className="prof-on" />
          : (
            <button type="button" className="btn secondary" onClick={connect} disabled={busy}>
              {busy ? 'Opening…' : 'Connect'}
            </button>
          )}
      </div>
      {connected && (
        <div className="prof-actions">
          <button type="button" className="btn quiet" onClick={disconnect} disabled={busy}>Disconnect</button>
          {extra}
        </div>
      )}
      {error && <p className="sub err">{error}</p>}
    </section>
  )
}

/*
 * Everyone connects their own Strava here, the owner included: the server holds
 * the grant in their own space (POST /api/strava/connect), and Totem reads the
 * owner's from there. The owner's WHOOP is held here too (POST
 * /api/whoop/connect): Totem's sleep habit and Krakatoa's calorie burn read it
 * from this app, so disconnecting stops those as well, and the confirm says so.
 */
export function ConnectionsSection({ who, strava, onPullStrava, pulling }) {
  const showStrava = !who.acting && (who.features.stravaConnect || who.features.strava)
  const showWhoop = who.owner && !who.acting && (who.features.whoopConnect || who.features.whoop)
  return (
    <>
      {showStrava && (
        <ServiceRow name="Strava" icon="Bike" connected={who.features.strava}
          detail={strava?.athlete?.name ? `Connected as ${strava.athlete.name}` : ''}
          connectPath="/api/strava/connect" disconnectPath="/api/strava/disconnect"
          confirmText={`Disconnect Strava? Workouts already attached stay in your log.${who.owner ? ' Totem stops getting your Strava too.' : ''}`}
          extra={(
            <button type="button" className="btn secondary" onClick={() => onPullStrava?.()} disabled={pulling}>
              {pulling ? 'Refreshing…' : 'Refresh'}
            </button>
          )} />
      )}
      {showWhoop && (
        <ServiceRow name="WHOOP" icon="HeartPulse" connected={who.features.whoop}
          connectPath="/api/whoop/connect" disconnectPath="/api/whoop/disconnect"
          confirmText="Disconnect WHOOP? Workouts already attached stay in your log. Totem and Krakatoa stop getting WHOOP too." />
      )}
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
    <section className="prof-sec">
      <div className="section-head"><h3>Whose log</h3></div>
      <div className="list">
        {who.people.map(p => {
          const isOpen = p.id === who.id
          const isMe = p.id === who.real.id
          return (
            <button key={p.id} type="button" className="list-row" disabled={isOpen || Boolean(busy)}
              onClick={() => go(isMe ? null : p.id)}>
              <Icon name={isMe ? 'PersonStanding' : 'Users'} size={20} />
              <span className="list-row-main">
                <span className="list-row-title">
                  {busy === (isMe ? 'me' : p.id) ? 'Switching…'
                    : isMe ? (isOpen ? 'Your log' : 'Back to your log') : (isOpen ? `${p.name}’s log` : `Log for ${p.name}`)}
                </span>
              </span>
              {isOpen ? <span className="list-row-meta">Open</span> : <Icon name="ChevronRight" size={16} className="list-row-chev" />}
            </button>
          )
        })}
      </div>
      {error && <p className="sub err">{error}</p>}
    </section>
  )
}

export function SettingsSection({ status, lastSync, who = currentMe() }) {
  // `toggleAll` was read here and never existed, so the old button did nothing.
  const { allHidden, setAllHidden } = usePrefs()
  const canSignOut = useCanSignOut()

  return (
    <>
      <PeopleCard who={who} />

      <section className="prof-sec">
        <div className="list">
          <div className="list-row prof-static">
            <span className="prof-dot"><span className={`dot ${status}`} /></span>
            <span className="list-row-main"><span className="list-row-title">{syncLabel(status, lastSync) || 'Sync'}</span></span>
          </div>
          <label className="list-row prof-check">
            <Icon name="Info" size={20} />
            <span className="list-row-main">
              <span className="list-row-title">Show explanations</span>
            </span>
            <input type="checkbox" role="switch" className="switch" checked={!allHidden} onChange={() => setAllHidden(!allHidden)} />
          </label>
          {who.real.admin && (
            <a className="list-row" href="/settings">
              <Icon name="Shield" size={20} />
              <span className="list-row-main">
                <span className="list-row-title">Server settings</span>
                <span className="list-row-meta">Sign-in, AI, plan, integrations</span>
              </span>
              <Icon name="ExternalLink" size={16} className="list-row-chev" />
            </a>
          )}
          {canSignOut && (
            <a className="list-row prof-danger" href="/?signout=1">
              <Icon name="LogOut" size={20} />
              <span className="list-row-main"><span className="list-row-title">Sign out of this device</span></span>
            </a>
          )}
        </div>
      </section>

      {/* What the device gives the page — see screeninfo.jsx. */}
      <ScreenCard />
    </>
  )
}
