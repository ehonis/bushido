import { useEffect, useState } from 'react'
import { useStore } from './lib/store.js'
import { TodayTab } from './tabs.jsx'
import { LogTab } from './log.jsx'
import { Icon, BushidoMark, TAB_ICONS } from './lib/icons.jsx'
import { PrefsProvider } from './lib/prefs.jsx'
import { WhoopProvider } from './lib/whoop.jsx'
import { StravaProvider } from './lib/strava.jsx'
import { ProgressView } from './progress.jsx'
import { localIso } from './lib/dates.js'
import { ProfileMenu } from './profile.jsx'
import { PlanProvider } from './lib/planctx.jsx'
import { ActivityChooser, activityFieldOf } from './picker.jsx'
import { QuickLog } from './quicklog.jsx'
import { outWith } from './lib/unlogged.js'
import { toneFor } from './lib/trainer.js'
import { PersonDay } from './trainer.jsx'
import { currentMe } from './lib/whoami.js'
import { openTimer } from './timerbus.js'
import { lazyPart, LoadFailed } from './lazy.jsx'
import { TimerHost } from './timerhost.jsx'
import { FullScreen } from './modal.jsx'
import { tabsFor, HeaderStreak, ActingBanner, FabMenu, RestPrompt } from './shell.jsx'
import { useAppData } from './appdata.jsx'

// Loaded when first drawn (lazy.jsx). Opened by a tap, so a failed load says so in
// its own screen, with Try again and the way out; never over anything else.
const PlanFlow = lazyPart(() => import('./planner.jsx'), 'PlanFlow', {
  failed: (props, retry) => (
    <FullScreen title="Plan a workout" onBack={props.onClose}>
      <LoadFailed what="Plan a workout" onRetry={retry} />
    </FullScreen>
  ),
})

/*
 * The app: the header, the tabs, the + and what it opens. Its state and write
 * paths are appdata.jsx (`useAppData`); the frame's pieces are shell.jsx (#98).
 */
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
  const {
    fab, setFab, openEntryId, setOpenEntryId, showDay, setShowDay, viewDay, setViewDay, logAt, logDay, openLog, dayLabel, placeAll, restOpt, restOn, restDate, askRest, takeRest, keepPlan, people, keepPlanForPerson, shareKeptWith, personView, setPersonView, placeCircuit, logCircuit, startPlanned,
  } = useAppData({ store, plan, me, setTab })

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

      <main data-tab={tab}>
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
                showDay={showDay} onDayShown={() => setShowDay(null)}
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
        <PlanFlow plan={plan} entries={store.entries} iso={localIso()} date={tab === 'today' ? viewDay : null}
          onKeep={keepPlan} onStart={startPlanned} onClose={() => setFab(null)}
          onShowDay={(d) => { setShowDay({ date: d, seq: Date.now() }); setTab('today') }}
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
