import { useEffect, useState } from 'react'
import { useStore, doneWhenPlaced } from './lib/store.js'
import { TodayTab, DaySwitcher } from './tabs.jsx'
import { LogTab } from './log.jsx'
import { Icon, BushidoMark, TAB_ICONS } from './lib/icons.jsx'
import { PrefsProvider } from './lib/prefs.jsx'
import { WhoopProvider } from './lib/whoop.jsx'
import { StravaProvider } from './lib/strava.jsx'
import { ProgressView } from './progress.jsx'
import { localIso, fromIso } from './lib/dates.js'
import { streakDays } from './lib/streak.js'
import { ProfileMenu } from './profile.jsx'
import { PlanProvider } from './lib/planctx.jsx'
import { PlanFlow, liftFieldOf } from './planner.jsx'
import { aiOffered } from './lib/plannerapi.js'
import { splitPrescription, circuitPlan, loggedCircuit, circuitFiling } from './lib/prescription.js'
import { optFor } from './lib/menu.js'
import { ActivityChooser, activityFieldOf } from './picker.jsx'
import { QuickLog } from './quicklog.jsx'
import { outWith } from './lib/unlogged.js'
import { placeEntries, planPeople, keepPlanFor, toneFor, plannedItems, shareKept, applyRun } from './lib/trainer.js'
import { PersonDay } from './trainer.jsx'
import * as peopleApi from './lib/peopleapi.js'
import { Modal } from './modal.jsx'
import { currentMe, actAs } from './lib/whoami.js'
import { TimerHost, openTimer } from './timer.jsx'

/*
 * Three tabs, since 2026-10-25 (issue #31): Today, Log, Progress. Bushido is a
 * workout log, and those are the three things a log is for: what is on the day,
 * what was done, and how it is going. Week went with the quotas, and
 * Achievements, Goals and Coach went because they were not used. Gear, Testing
 * and Why live under the profile: reference, not doing.
 */
const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'log', label: 'Log' },
  { id: 'progress', label: 'Progress' },
]

/*
 * What this person's app offers. Every tab is everyone's now; the signature
 * stays because callers (and the iPhone app) still pass features and ownership.
 */
export const tabsFor = () => TABS

/**
 * Says whose log is open when the owner is acting as someone else, on every
 * screen, with the way back. Logging into the wrong log is the failure this
 * whole feature has to make hard, and the avatar alone is too quiet for it.
 */
export function ActingBanner({ me }) {
  const [busy, setBusy] = useState(false)
  if (!me?.acting) return null
  return (
    <div className="acting" role="status">
      <Icon name="Users" size={15} />
      <span>Logging for <strong>{me.name}</strong></span>
      <button className="acting-back" disabled={busy}
        onClick={() => { setBusy(true); actAs(null).catch(() => setBusy(false)) }}>
        {busy ? 'Switching…' : `Back to ${me.real.name || 'me'}`}
      </button>
    </div>
  )
}

/**
 * What the + offers.
 *
 * It began as two things, deliberately. The swap list it replaced showed thirty
 * cards in three ranked groups, which is a menu you read rather than a button you
 * press — and the ranking was the recommender, which is the thing that came off
 * this app. What is left is the actual choice: is this a workout you are about to
 * write down, or one you have already done? "Pick a session" came back the same
 * day because twenty-one climbing cards had no other door, and went again on
 * 2026-10-14 when those cards moved into Log a workout as the Bouldering and Rock
 * climbing folders (see lib/folders.js). "Plan the week" went with the quotas
 * on 2026-10-25.
 *
 * A sheet from the bottom on a phone, because the button is at the bottom and a
 * menu that opens away from your thumb is a menu you reach across the screen for.
 *
 * Log a workout leads (2026-10-25, docs/DESIGN.md D7 and "The + menu, final
 * shape"): writing down what you did is what the + is pressed for most, so it is
 * the first row and the only one in the accent. Logging doors, then planning,
 * then tools. Each door says what it is in one line; the paragraphs that used to
 * sit under each one made the menu something to read rather than to press.
 *
 * `quick` is the quick-log rows (quicklog.jsx), right under Log a workout: the
 * last few activities, one tap each, so "I did a run" is + → Run (docs/DESIGN.md,
 * "Logging in two taps").
 */
/*
 * `ai`: whether "Write it for me" is on offer (lib/plannerapi.js). Without it the
 * Plan door says only what is there, the same rule as Plan a workout itself (#55).
 */
export function FabMenu({ onClose, onPlan, onLog, onRest, onTimer = null, quick = null, ai = aiOffered(currentMe().features) }) {
  return (
    <div className="fabmenu-scrim" onClick={onClose} role="presentation">
      <div className="fabmenu" onClick={e => e.stopPropagation()} role="dialog" aria-label="Add a workout">
        <button className="fabmenu-row" onClick={onLog}>
          <span className="fabmenu-ico log"><Icon name="NotebookPen" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Log a workout</strong>
            <span className="sub">Something you already did</span>
          </span>
        </button>
        {quick}
        {/* A rest day the user chose is part of the week, and it used to be a link at the
            foot of the old session picker, under thirty cards — which is to say nowhere.
            One tap: choosing it is the whole action, so nothing opens. */}
        {onRest && (
          <button className="fabmenu-row" onClick={onRest}>
            <span className="fabmenu-ico rest"><Icon name="Sunset" size={22} /></span>
            <span className="fabmenu-body">
              <strong>Log a rest day</strong>
              <span className="sub">A day off on purpose</span>
            </span>
          </button>
        )}
        <button className="fabmenu-row" onClick={onPlan}>
          <span className="fabmenu-ico plan"><Icon name="ClipboardCheck" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Plan a workout</strong>
            <span className="sub">{ai ? 'Build it yourself, or have it written for you' : 'Build it yourself'}</span>
          </span>
        </button>
        {/* A timer on its own, for a workout nobody is logging yet. See timer.jsx. */}
        {onTimer && (
          <button className="fabmenu-row" onClick={onTimer}>
            <span className="fabmenu-ico"><Icon name="Timer" size={22} /></span>
            <span className="fabmenu-body">
              <strong>Interval timer</strong>
              <span className="sub">Work, rest and rounds</span>
            </span>
          </button>
        )}
        <button className="fabmenu-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

/**
 * Why rest today — asked before it is logged, not after.
 *
 * A rest day with no reason reads the same in a month whether the user was sick, beat
 * up or just busy, and those are three different things to look back on. The chips are the rest card's own `why` output (plan.json), so the same
 * answer shows up and stays editable in the session sheet afterwards; the box is
 * the ordinary `out.notes`. Both optional — a prompt, not a gate.
 */
export function RestPrompt({ opt, date: initialDate, entryFor, onSave, onClose }) {
  const field = (opt?.outputs || []).find(f => f.key === 'why')
  const today = localIso()
  const [date, setDate] = useState(initialDate || today)
  const existing = entryFor ? entryFor(date) : null
  const [why, setWhy] = useState(existing?.data?.out?.why)
  const [notes, setNotes] = useState(existing?.data?.out?.notes || '')
  // Moving the date onto a day that already rests shows THAT day's answer, so
  // saving edits it rather than overwriting it with what was typed for another.
  useEffect(() => {
    setWhy(existing?.data?.out?.why)
    setNotes(existing?.data?.out?.notes || '')
  }, [existing?.id])
  const save = () => onSave({ date, why: why || undefined, notes: notes.trim() || undefined })

  return (
    <Modal title="Rest day" sub={existing ? 'Already a rest day' : null}
      icon={opt?.icon || 'Sunset'} tone="rest" onClose={onClose}
      footer={
        <button className="btn" onClick={save}>
          <Icon name="Check" size={16} /> {existing ? 'Save' : 'Log the rest day'}
        </button>
      }>
      {/* Any day up to today — a rest day the user forgot to log is still one the
          user took. The day switcher, as on Today, not a browser date box. */}
      <div className="field rest-day">
        <span>Day</span>
        <DaySwitcher value={date} today={today} max={today} onChange={setDate} />
      </div>
      {field && (
        <div className="out-field rest-why">
          <div className="out-label"><span>{field.label}</span></div>
          <div className="out-choices">
            {field.options.map(o => {
              const on = why === o.value
              return (
                <button key={o.value} type="button" className={`out-chip ${on ? 'on' : ''}`}
                  aria-pressed={on} onClick={() => setWhy(on ? undefined : o.value)}>
                  {o.icon && <Icon name={o.icon} size={14} />}
                  <span>{o.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      <label className="notefield">
        <span className="notefield-label">Notes</span>
        <textarea rows={3} value={notes} placeholder="Optional"
          onChange={e => setNotes(e.target.value)} />
      </label>
    </Modal>
  )
}

/**
 * Days in a row, in the header.
 *
 * NO BACKGROUND and no border — it is a reading, not a control, and the only two
 * things in that corner you can press are the profile button and the tabs. Giving
 * it a pill would make it look like a third.
 *
 * Renders NOTHING at zero. "0 days" is not a streak, it is the absence of one,
 * and a counter that sits at zero for a week is a counter the user stops seeing.
 */
function HeaderStreak({ entries }) {
  const n = streakDays(entries)
  if (!n) return null
  return (
    <span className="hdr-streak" title={`${n} day${n === 1 ? '' : 's'} trained in a row`}>
      <Icon name="Flame" size={15} className="hdr-streak-ico" />
      <span className="hdr-streak-n">{n}</span>
    </span>
  )
}

export default function App() {
  const store = useStore()
  const me = currentMe()
  const tabs = tabsFor(me.features, me.owner)
  const [tab, setTab] = useState(() => {
    const want = location.hash.slice(1) || 'today'
    return tabs.some(t => t.id === want) ? want : 'today'
  })
  const [plan, setPlan] = useState(undefined) // undefined = loading, null = absent

  useEffect(() => {
    fetch('/api/content', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(setPlan)
      .catch(() => setPlan(null))
  }, [])

  useEffect(() => { location.hash = tab }, [tab])

  /* ------------------------------------------------------- the + button */

  /*
   * Adding to the day, from anywhere.
   *
   * This is where the swap list, the quota lanes and the "add another session"
   * link all went on 2026-09-17. Today stopped offering sessions, so the way to
   * put one on the day had to stop being part of Today — it is a floating
   * button now, reachable from every tab, with the things the user actually
   * does under it.
   *
   * PLAN one and the planner writes the sets (see planner.jsx). LOG one and the
   * ordinary workout card opens with nothing filled in. Both land as ordinary
   * entries; neither is written by anything except their tap.
   */
  const [fab, setFab] = useState(null)         // null | 'menu' | 'plan' | 'log' | 'rest'
  const [openEntryId, setOpenEntryId] = useState(null)

  /*
   * WHICH DAY a logged workout lands on.
   *
   * Until 2026-10-14 every pick landed on today, whatever day the user was
   * looking at, so Monday's board session could not be logged on Monday. Now Log
   * a workout lands on the day Today is showing (never a future one: you cannot
   * have done tomorrow's workout), from the + button as much as from the day.
   * `climb` is a WHOOP or Strava climb from the unlogged card, attached to
   * whichever card the user picks for it.
   */
  const [viewDay, setViewDay] = useState(null)
  const [logAt, setLogAt] = useState({ date: null, climb: null })
  const logDay = (date) => {
    const today = localIso()
    return date && date <= today ? date : today
  }
  const openLog = (date, { climb = null } = {}) => {
    setLogAt({ date: logDay(date), climb })
    setFab('log')
  }
  const dayLabel = (date) => (date && date !== localIso()
    ? `for ${fromIso(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`
    : null)

  /**
   * Put one or more sessions on today, in one go.
   *
   * BATCHED ON PURPOSE, and the reason is a bug this had for about ten minutes.
   * The first thing on an empty day is the day's MAIN session and everything
   * after is an extra — so placing two sessions means the second has to see the
   * first. Calling a single-place function twice cannot: both read `store.entries`
   * out of the same render's closure, both find an empty day, both mint
   * `daily-<date>`, and the second silently overwrites the first. A gym trip
   * planned as a lift and a run landed as just the run, while the screen said two
   * workouts were on today.
   *
   * So ids are allocated against ONE snapshot plus whatever this call has already
   * written. It is the same stale-closure shape as the runner's double write
   * earlier today, and the same fix: one function that knows about the whole
   * batch, rather than two calls that each know about half of it.
   *
   * `open` and `close` are what the PLANNER needs and nobody else does. Picking a
   * session or an activity is one decision — you chose it, here it is, get on
   * with it — so both default to true. Keeping a plan is not: writing a workout
   * down and starting it are two decisions, and the flow stays up to ask which.
   */
  const placeAll = (items, opts) => placeWritten(items, opts).map(e => e.id)
  const placeWritten = (items, { open = true, close = true, date = localIso() } = {}) => {
    /*
     * The ids and the entry shape are `placeEntries` (lib/trainer.js), the same
     * function the owner planning for someone else runs against THEIR day, so
     * the two cannot mint different ids for the same act. A card that names
     * itself from what you picked says so from the moment it lands, and it is
     * done on today or an earlier day, planned on a later one (AGENTS.md §4).
     */
    const written = placeEntries({ menu: plan?.dailyMenu || [], onDay: store.entries, items, date })
    for (const entry of written) store.upsertEntry(entry)

    if (close) setFab(null)
    if (open && written[0]) setOpenEntryId(written[0].id)
    setTab('today')
    return written
  }

  /**
   * A rest day on the date RestPrompt was given (today from the +, the viewed day
   * from Your day, and the user can change it there), with the why it asked for. Done on arrival (a rest
   * day is done whatever its date) and no sheet opens — the prompt was the form. A day already
   * resting gets its why edited rather than a second rest entry.
   */
  const restOpt = (plan?.dailyMenu || []).find(m => m.role === 'rest' && !m.retired) || null
  const restOn = (date) => restOpt && store.entries.find(e => e.kind === 'daily' && e.date === date
    && !e.deleted && e.data?.optId === restOpt.id)
  const [restDate, setRestDate] = useState(null)
  const askRest = (date) => { setRestDate(date || localIso()); setFab('rest') }
  const takeRest = ({ date, why, notes }) => {
    const hit = restOn(date)
    if (hit) {
      store.upsertEntry({ ...hit,
        data: { ...hit.data, out: { ...(hit.data.out || {}), why, notes } } })
      setFab(null); setTab('today')
      return
    }
    placeAll([{ optId: restOpt.id, data: { out: { why, notes } } }], { open: false, date })
  }

  /** One session. Everything goes through the batch, so ids cannot collide. */
  const placeToday = (optId, data = {}, opts = {}) => placeAll([{ optId, data }], opts)[0] || null

  /**
   * Keep a prescription.
   *
   * The whole thing goes on the entry as `data.plan` — what was ASKED for, kept
   * separate from `out`, which is what happened. `out.category` and
   * `out.activity` are what file it in the Log and Progress filters and pick the
   * log form. See lib/prescription.js and lib/category.js.
   */
  /**
   * Keep a prescription — as one entry per WORKOUT in it.
   *
   * A plan with several kinds of workout in it becomes several separate entries
   * rather than one pooled one, so WHOOP and Strava activities attach to the
   * right workout.
   *
   * The attach argument is the one that settles it. A pooled entry has ONE
   * `out.whoop` and ONE `out.strava`, so a trip that was a lift and a ride has a
   * single slot for two measurements and whichever lands first owns it. Split,
   * each half has its own entry, its own log form and its own place for the watch
   * to attach to, and one entry with one category is what the rest of this app
   * already assumes.
   *
   * `splitPrescription` decides where the seams are; a single-kind plan comes back
   * as one part and behaves exactly as it did. Returns the FIRST id, which is what
   * "start it now" opens.
   */
  const keepPlan = (pres) => {
    const entries = placeWritten(
      plannedItems(splitPrescription(pres)),
      {
        // They land on the day, but nothing opens: the planner's last screen asks
        // whether to go back, plan another or start now. Planning at eight for a
        // session at six is the normal case, and dropping the user into a running
        // timer was the app assuming the answer to a question it never asked.
        open: false, close: false,
      })
    const ids = entries.map(e => e.id)
    return { ids, count: ids.length, first: ids[0] || null, entries }
  }

  /*
   * THE OWNER AS TRAINER (lib/trainer.js, trainer.jsx). Who the owner can plan for:
   * nobody unless this is the owner on the owner's own log with someone else on the
   * install. A plan kept for someone goes into THEIR log through the people
   * endpoints, with the same ids their own "+" would mint against their day.
   */
  const people = planPeople(me)
  const keepPlanForPerson = (person, pres, key = null) => keepPlanFor({
    person, parts: splitPrescription(pres), menu: plan?.dailyMenu || [], date: localIso(),
    owner: { id: me.real.id, name: me.real.name }, api: peopleApi, key,
  })
  /*
   * You and others (#59): the entries just kept, shared with each of them, sync
   * on, through the same `addPerson` as "With …" on the sheet. Each updated entry
   * of yours is written through your own store.
   */
  const shareKeptWith = (others, kept) => shareKept({
    entries: kept, people: others, menu: plan?.dailyMenu || [],
    owner: { id: me.real.id, name: me.real.name }, api: peopleApi, save: store.upsertEntry,
  })
  const [personView, setPersonView] = useState(null) // { person, entryId } — their week, opened from the planner

  /*
   * A circuit from the + timer (issue #68). "Put it on today" places it as a
   * planned workout, as keeping a plan does. Run, it logs itself when it ends:
   * the same planned workout, placed the same way, with its run finished and
   * its log in the same write (`applyRun`, the runner's own), done like any
   * workout finished in the runner. Nothing done, nothing placed. It lands on
   * the day it was started, and is filed by what its exercises are
   * (`circuitFiling`), since a preset says nothing else about it.
   */
  const filingOf = (config) => circuitFiling(config, liftFieldOf(plan),
    { categories: plan?.quotaCategories || [], activities: activityFieldOf(plan)?.activities || [] })
  const placeCircuit = (name, config) =>
    placeWritten(plannedItems(splitPrescription(circuitPlan(name, config, liftFieldOf(plan), filingOf(config)))), { open: false })
  const logCircuit = (name, config, timerRun) => {
    const done = loggedCircuit(name, config, timerRun, liftFieldOf(plan), filingOf(config))
    if (!done) return false
    const menu = plan?.dailyMenu || []
    const [entry] = placeEntries({ menu, onDay: store.entries, items: plannedItems(splitPrescription(done.pres)), date: done.date })
    if (!entry) return false
    store.upsertEntry(applyRun(entry, optFor(menu, entry.data.optId), done.run, { out: { ...entry.data.out, ...done.out }, done: true }))
    return true
  }

  /** "Start it now", from the planner's last screen. */
  const startPlanned = (id) => {
    setFab(null)
    setOpenEntryId(id)
    setTab('today')
  }

  const needsPlan = tab !== 'log'

  return (
    <PrefsProvider settings={store.settings} saveSettings={store.saveSettings}>
    {/* The plan, reachable from the gear picker without threading it through
        five components that have no opinion about it. See lib/planctx.jsx. */}
    <PlanProvider plan={plan}>
    {/* WHOOP wraps everything because the session log is rendered from five
        different places, including the history tab. Outside a provider the hook
        returns "no data", so nothing here is load-bearing. */}
    <WhoopProvider>
    <StravaProvider>
    {/* Three or four tabs fit beside the + in one row at the foot of a phone;
        more than that need the whole width, and with no + (no plan yet) the
        capsule takes the row (styles.css, .tabs). */}
    <div className="app" data-dock={tabs.length > 4 ? 'wide' : plan ? 'compact' : 'alone'}>
      <header className="hdr">
        <h1><BushidoMark size={18} className="hdr-mark" /> Bushido</h1>
        {/*
          * The blurb toggle used to sit here as a small eye, and went on
          * 2026-09-15. It was the same control that already exists in the
          * profile's Settings section, so the header was spending its scarcest
          * space on a duplicate of a setting nobody changes twice.
          *
          * The subtitle — "· 12a & a half iron" — went the same day. It named two
          * achievements as if they were the only two there would ever be, which
          * stopped being true the moment the user could add their own.
          *
          * Where the sync pill used to be. The dot survives on the avatar,
          * because "is my log actually saved" has a real failure mode; the
          * sentence moved into the panel.
          */}
        {/* Next to the profile because it is the same kind of thing — a fact
            about them rather than about the day on screen — and it survived the
            tile row that used to carry it. */}
        <HeaderStreak entries={store.entries} />
        <ProfileMenu me={me} plan={plan} entries={store.entries}
          upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
          status={store.status} lastSync={store.lastSync} />
      </header>
      <ActingBanner me={me} />

      <nav className="tabs" role="tablist">
        {tabs.map(t => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <Icon name={TAB_ICONS[t.id]} size={17} className="tab-ico" />
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      <main>
        {tab === 'log' && (
          <LogTab plan={plan} entries={store.entries} upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry} />
        )}

        {needsPlan && plan === undefined && <div className="empty">Loading plan…</div>}

        {needsPlan && plan === null && (
          <div className="card">
            <h2>Program not generated yet</h2>
            <p className="sub" style={{ margin: 0 }}>
              The API, sync layer, charts and log are live, but the server could not read
              its content file. Import a plan or go back to the starter in{' '}
              <a href="/settings">Settings</a> — these tabs fill in automatically, no rebuild.
              The <strong>Log</strong> tab works right now.
            </p>
          </div>
        )}

        {needsPlan && plan && (
          <>
            {tab === 'today' && (
              <TodayTab plan={plan} entries={store.entries}
                upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
                openEntryId={openEntryId} onOpened={() => setOpenEntryId(null)}
                onPlan={() => setFab('plan')} onLog={openLog}
                onViewDay={setViewDay}
                onRest={restOpt ? askRest : null} />
            )}
            {tab === 'progress' && <ProgressView plan={plan} entries={store.entries} />}
          </>
        )}
      </main>
      {plan && (
        <div className="fabs">
          <button className="fab plus" onClick={() => setFab('menu')} aria-label="Add a workout">
            <Icon name="Plus" size={24} />
          </button>
        </div>
      )}

      {fab === 'menu' && (
        <FabMenu
          onClose={() => setFab(null)}
          onPlan={() => setFab('plan')}
          onLog={() => openLog(tab === 'today' ? viewDay : null)}
          onRest={restOpt ? () => askRest() : null}
          onTimer={() => { setFab(null); openTimer() }}
          quick={
            <QuickLog plan={plan} entries={store.entries} upsertEntry={store.upsertEntry}
              date={logDay(tab === 'today' ? viewDay : null)}
              onPlaced={(id) => { setFab(null); setOpenEntryId(id); setTab('today') }} />
          } />
      )}

      {/*
        * Log a workout: the one door for something already done. The plan's
        * cards are in it as the Bouldering and Rock climbing folders; anything
        * else is the sports catalog, answered before the form opens so the card
        * arrives the right shape. See picker.jsx and lib/folders.js.
        *
        * A climb from the unlogged card lands on its card with the measurement
        * attached, and the sheet opens: the hard-finger question is the reason
        * it goes through a climbing card at all. Done like anything on a day
        * that has arrived; until it is answered, the card's own `fingerLoad`
        * stands in (`isHardEntry`).
        */}
      {fab === 'log' && (
        <ActivityChooser plan={plan} field={activityFieldOf(plan)} entries={store.entries}
          dayLabel={dayLabel(logAt.date)} climbingOnly={Boolean(logAt.climb)}
          onPick={(activity) => placeAll([{ optId: 'log-workout', data: { out: { activity } } }],
            { date: logAt.date || localIso() })}
          onPickCard={(optId) => {
            const opt = (plan?.dailyMenu || []).find(o => o.id === optId)
            const out = logAt.climb && opt ? outWith(opt, {}, logAt.climb) : {}
            placeAll([{ optId, data: { out } }], { date: logAt.date || localIso() })
          }}
          onClose={() => setFab(null)} />
      )}

      {fab === 'rest' && restOpt && (
        <RestPrompt opt={restOpt} date={restDate} entryFor={restOn} onSave={takeRest}
          onClose={() => setFab(null)} />
      )}

      {fab === 'plan' && (
        <PlanFlow plan={plan} entries={store.entries} iso={localIso()}
          onKeep={keepPlan} onStart={startPlanned} onClose={() => setFab(null)}
          people={people} onKeepFor={keepPlanForPerson} onShareWith={shareKeptWith}
          onStartFor={(person, entryId) => {
            setFab(null)
            setPersonView({ person: { ...person, tone: toneFor(people, person.id) }, entryId })
          }} />
      )}

      {personView && (
        <PersonDay person={personView.person} date={localIso()} plan={plan} openId={personView.entryId}
          onClose={() => setPersonView(null)} />
      )}

      {/* The interval timer, from the + menu or any session sheet, and a run that
          was going when the page went away. See timer.jsx. */}
      <TimerHost entries={store.entries} upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
        onLog={plan ? logCircuit : null} onPlace={plan ? placeCircuit : null} />
    </div>
    </StravaProvider>
    </WhoopProvider>
    </PlanProvider>
    </PrefsProvider>
  )
}
