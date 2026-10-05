import { useEffect, useState } from 'react'
import { useStore } from './lib/store.js'
import { TodayTab, WeekTab, nameFor } from './tabs.jsx'
import { LogTab } from './log.jsx'
import { Icon, BushidoMark, TAB_ICONS } from './lib/icons.jsx'
import { PrefsProvider } from './lib/prefs.jsx'
import { WhoopProvider } from './lib/whoop.jsx'
import { StravaProvider } from './lib/strava.jsx'
import { ProgressView } from './progress.jsx'
import { AchievementsTab } from './achievements.jsx'
import { TotemGoals } from './goals.jsx'
import { localIso } from './lib/dates.js'
import { streakDays } from './lib/streak.js'
import { ProfileMenu } from './profile.jsx'
import { PlanProvider } from './lib/planctx.jsx'
import { CoachProvider } from './lib/coachapi.jsx'
import { CoachTab, CoachBubble } from './coach.jsx'
import { PlanFlow } from './planner.jsx'
import { WeekPlanFlow } from './weekplanner.jsx'
import { splitPrescription } from './lib/prescription.js'
import { SessionPicker, ActivityChooser, activityFieldOf } from './picker.jsx'
import { extraEntryId } from './lib/store.js'
import { Modal } from './modal.jsx'

/*
 * Four tabs, down from six on 2026-09-15.
 *
 * Gear, Testing and Why all moved under the profile. None of them is touched
 * mid-session — they are reference, not doing — and all three were taking room in
 * a bottom bar used one-handed with chalk on it. What is left is the four screens
 * a session actually passes through.
 */
/*
 * The bar scrolls horizontally, which is what lets there be seven of these on a
 * phone. Order is roughly by how often a session touches them: Today and Week are
 * the two you open mid-workout, Log and Progress after, and the last three are
 * things you sit down with.
 *
 * ACHIEVEMENTS and GOALS are deliberately two tabs and not one. They are the two
 * things this app calls a target and they are genuinely different — an
 * achievement is open-ended and lives here; a Totem goal is a week or a quarter
 * with metrics that expire and lives there. Putting them under one heading would
 * undo the rename that separated them.
 */
const TABS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Week' },
  { id: 'log', label: 'Log' },
  { id: 'progress', label: 'Progress' },
  { id: 'achievements', label: 'Achievements' },
  { id: 'goals', label: 'Goals' },
  { id: 'coach', label: 'Coach' },
]

/**
 * What the + offers.
 *
 * It began as two things, deliberately. The swap list it replaced showed thirty
 * cards in three ranked groups, which is a menu you read rather than a button you
 * press — and the ranking was the recommender, which is the thing that came off
 * this app. What is left is the actual choice: is this a workout you are about to
 * write down, or one you have already done? "Pick a session" came back the same
 * day because twenty-one climbing cards had no other door, and "Plan the week"
 * arrived on 2026-09-19 — the quotas the whole screen is measured against had
 * steppers on the Week tab and nothing to talk to.
 *
 * A sheet from the bottom on a phone, because the button is at the bottom and a
 * menu that opens away from your thumb is a menu you reach across the screen for.
 */
export function FabMenu({ onClose, onPlan, onLog, onPickSession, onPlanWeek, onRest }) {
  return (
    <div className="fabmenu-scrim" onClick={onClose} role="presentation">
      <div className="fabmenu" onClick={e => e.stopPropagation()} role="dialog" aria-label="Add a workout">
        <button className="fabmenu-row" onClick={onPlan}>
          <span className="fabmenu-ico plan"><Icon name="Sparkles" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Plan a workout</strong>
            <span className="sub">
              Say what you are doing, then build it yourself — the exercises, sets and
              weights — or let the model read your log and write it for you.
            </span>
          </span>
        </button>
        <button className="fabmenu-row" onClick={onLog}>
          <span className="fabmenu-ico log"><Icon name="NotebookPen" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Log a workout</strong>
            <span className="sub">
              Something you already did. Pick it out of 91 activities and the form arrives
              the right shape.
            </span>
          </span>
        </button>
        <button className="fabmenu-row" onClick={onPickSession}>
          <span className="fabmenu-ico pick"><Icon name="Layers" size={22} /></span>
          <span className="fabmenu-body">
            <strong>Pick a session</strong>
            <span className="sub">
              The plan&rsquo;s own: max hangs, the board, 4&times;4s, ARC laps, the load-cell
              tests — protocol, cues and timer included.
            </span>
          </span>
        </button>
        {/* A rest day the user chose is part of the week, and it used to be a link at the
            foot of "Pick a session", under thirty cards — which is to say nowhere.
            One tap: choosing it is the whole action, so nothing opens. */}
        {onRest && (
          <button className="fabmenu-row" onClick={onRest}>
            <span className="fabmenu-ico rest"><Icon name="Sunset" size={22} /></span>
            <span className="fabmenu-body">
              <strong>Log a rest day</strong>
              <span className="sub">
                A day off on purpose. It counts as chosen rather than missed, and does not
                mark Move Every Day.
              </span>
            </span>
          </button>
        )}
        {onPlanWeek && (
          <button className="fabmenu-row" onClick={onPlanWeek}>
            <span className="fabmenu-ico week"><Icon name="CalendarRange" size={22} /></span>
            <span className="fabmenu-body">
              <strong>Plan the week</strong>
              <span className="sub">
                Talk the quotas through. It reads what you set and what you actually did, how
                you are recovering, and proposes the counts &mdash; you set them.
              </span>
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
 * up or just busy, and those are three different things for the coach and for
 * them. The chips are the rest card's own `why` output (plan.json), so the same
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
    <Modal title="Rest day" sub={existing ? 'Already a rest day — change the why' : 'Why are you resting?'}
      icon={opt?.icon || 'Sunset'} tone="rest" onClose={onClose}
      footer={
        <button className="btn" onClick={save}>
          <Icon name="Check" size={16} /> {existing ? 'Save' : 'Log the rest day'}
        </button>
      }>
      {/* Any day up to today — a rest day the user forgot to log is still one the user took. */}
      <label className="field" style={{ marginBottom: 10 }}>
        Day
        <input type="date" value={date} max={today}
          onChange={e => e.target.value && setDate(e.target.value)} />
      </label>
      {field && (
        <div className="out-field">
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
        <span className="notefield-label">In your own words</span>
        <textarea rows={3} value={notes} placeholder="Optional — what's going on?"
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
  const [tab, setTab] = useState(() => location.hash.slice(1) || 'today')
  const [plan, setPlan] = useState(undefined) // undefined = loading, null = absent
  // Today's coach note. Absent is the normal case — most days the user has not talked
  // to the coach at all — and absent has to mean "the app behaves exactly as it
  // did before", so this stays null and every reader treats null as no advice.
  // See lib/coach.js.
  //
  // A check-in is what writes it, which is why setCoach goes down to the Today
  // tab: the card has to show what the conversation just decided without a
  // reload. One document per day, revised in place as the user talks.
  const [coach, setCoach] = useState(null)

  useEffect(() => {
    fetch('/api/content', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(setPlan)
      .catch(() => setPlan(null))
  }, [])

  /*
   * THE COACH IS OFF.
   *
   * Switched off on 2026-09-14 as part of the pivot, deliberately rather than by
   * accident. `coach/CHECKIN.md` and `server/chat.js` are written around the
   * eleven-week climbing block — its phases, its week focus, the trip it counted
   * down to — and every one of those is now deleted. Left running it would have
   * gone on confidently referencing a training block that does not exist, which
   * is worse than silence: wrong advice delivered fluently is harder to ignore
   * than no advice.
   *
   * Nothing else had to change to turn it off, because the coach was always
   * built so that its failure mode is that nothing happens. `coach` stays null,
   * `coachNudges` returns an empty map, and every term that reads it computes
   * exactly what the app computed before the coach existed. The check-in card
   * still saves the hard fields and the message; it just does not get a reply.
   *
   * To bring it back: rewrite CHECKIN.md for the achievements and a quota week, then
   * restore this effect. The hard blocks are enforced before any nudge is read,
   * so a rewritten coach still cannot produce an illegal day.
   */
  const COACH_ENABLED = false

  useEffect(() => {
    if (!COACH_ENABLED) return
    const load = () => fetch('/api/coach', { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setCoach(d && typeof d === 'object' ? d : null))
      .catch(() => {})
    load()
    // A check-in on one device should show up on the other. It is one small
    // file, so re-read it whenever the app comes back to the foreground.
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [])

  useEffect(() => { location.hash = tab }, [tab])

  /*
   * Taking a session the coach offered.
   *
   * The coach does not write this — their tap does, through an ordinary entry with
   * `done: false`, exactly as picking one off the day list produces. So there is
   * no such thing as a coach's write to the log: it lands as something the user chose
   * and can edit or delete like anything else.
   */
  const placeFromCoach = (s) => {
    const opt = (plan?.dailyMenu || []).find(o => o.id === s.optId)
    if (!opt) return
    const date = localIso()
    const id = s.action === 'main' ? `daily-${date}` : `daily-${date}-${opt.id}`
    store.upsertEntry({
      id, kind: 'daily', date,
      data: {
        optId: opt.id, name: opt.name, minutes: opt.minutes, level: opt.level ?? 1,
        done: false, out: {}, slot: s.action === 'main' ? 'main' : 'extra',
      },
    })
    setTab('today')
  }

  /* ------------------------------------------------------- the + button */

  /*
   * Adding to the day, from anywhere.
   *
   * This is where the swap list, the quota lanes and the "add another session"
   * link all went on 2026-09-17. Today stopped offering sessions, so the way to
   * put one on the day had to stop being part of Today — it is a button beside
   * the coach bubble now, reachable from every tab, with the two things the user
   * actually does under it.
   *
   * PLAN one and the planner writes the sets (see planner.jsx). LOG one and the
   * ordinary workout card opens with nothing filled in. Both land as ordinary
   * entries; neither is written by anything except their tap.
   */
  const [fab, setFab] = useState(null)         // null | 'menu' | 'plan' | 'pick' | 'log' | 'week'
  const [openEntryId, setOpenEntryId] = useState(null)

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
  const placeAll = (items, { open = true, close = true, date = localIso() } = {}) => {
    const onDay = store.entries.filter(e => e.kind === 'daily' && e.date === date && !e.deleted)
    const written = []

    for (const { optId, data = {} } of items) {
      const opt = (plan?.dailyMenu || []).find(o => o.id === optId)
      if (!opt) continue
      const seen = [...onDay, ...written]
      const hasMain = seen.some(e => e.data?.slot !== 'extra')
      const id = hasMain ? extraEntryId(date, opt.id, seen, { fresh: true }) : `daily-${date}`
      const out = data.out || {}
      const entry = {
        id, kind: 'daily', date,
        data: {
          optId: opt.id,
          // A card that names itself from what you picked says so from the moment
          // it lands — the workout card arrives already called "Mountain bike"
          // rather than "Log a workout" on the day list behind the sheet.
          name: nameFor(opt, out),
          minutes: opt.minutes, level: opt.level ?? 1,
          // Putting a session on the day does NOT complete it — that is a
          // separate tap. A rest day is the exception: choosing it is the whole
          // action.
          done: opt.role === 'rest',
          slot: hasMain ? 'extra' : 'main',
          ...data,
          out,
        },
      }
      written.push(entry)
      store.upsertEntry(entry)
    }

    if (close) setFab(null)
    if (open && written[0]) setOpenEntryId(written[0].id)
    setTab('today')
    return written.map(e => e.id)
  }

  /**
   * A rest day on the date RestPrompt was given (today from the +, the viewed day
   * from Your day, and the user can change it there), with the why it asked for. Done on arrival (placeAll's
   * rest exception) and no sheet opens — the prompt was the form. A day already
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
   * `out.activity` are what make it count toward a quota and pick the log form;
   * `out.category` is the per-entry override the quota reader already honours, so
   * a swim day that is really the cardio can say so without anything else
   * changing. See lib/prescription.js and lib/quota.js.
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
   * to attach to — and the quota question answers itself, because one entry with
   * one category is what the rest of this app already assumes.
   *
   * `splitPrescription` decides where the seams are; a single-kind plan comes back
   * as one part and behaves exactly as it did. Returns the FIRST id, which is what
   * "start it now" opens.
   */
  const keepPlan = (pres) => {
    const ids = placeAll(
      splitPrescription(pres).map(part => ({
        optId: 'planned',
        data: {
          name: part.pres.title,
          minutes: part.pres.minutes || null,
          plan: part.pres,
          out: {
            ...(part.activity ? { activity: part.activity } : {}),
            ...(part.category ? { category: part.category } : {}),
          },
        },
      })),
      {
        // They land on the day, but nothing opens: the planner's last screen asks
        // whether to go back, plan another or start now. Planning at eight for a
        // session at six is the normal case, and dropping the user into a running
        // timer was the app assuming the answer to a question it never asked.
        open: false, close: false,
      })
    return { ids, count: ids.length, first: ids[0] || null }
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
    <CoachProvider>
    {/* WHOOP wraps everything because the session log is rendered from five
        different places, including the history tab. Outside a provider the hook
        returns "no data", so nothing here is load-bearing. */}
    <WhoopProvider>
    <StravaProvider>
    <div className="app">
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
        <ProfileMenu plan={plan} entries={store.entries}
          upsertEntry={store.upsertEntry} deleteEntry={store.deleteEntry}
          status={store.status} lastSync={store.lastSync} />
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map(t => (
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
                settings={store.settings} saveSettings={store.saveSettings}
                openEntryId={openEntryId} onOpened={() => setOpenEntryId(null)}
                onPlan={() => setFab('plan')} onLog={() => setFab('log')}
                onPickSession={() => setFab('pick')}
                onRest={restOpt ? askRest : null}
                onSetWeek={() => setTab('week')} />
            )}
            {tab === 'week' && (
              <WeekTab plan={plan} entries={store.entries} upsertEntry={store.upsertEntry} />
            )}
            {tab === 'progress' && <ProgressView plan={plan} entries={store.entries} />}
            {tab === 'achievements' && (
              <AchievementsTab plan={plan} entries={store.entries} upsertEntry={store.upsertEntry} />
            )}
            {/* Totem's, and read-only. `full` because on its own tab there is no
                reason to hide the explanation the way a card on Today had to. */}
            {tab === 'goals' && <TotemGoals full />}
            {tab === 'coach' && <CoachTab plan={plan} onPlace={placeFromCoach} />}
          </>
        )}
      </main>
      {/*
        * The two floating buttons, in one row so they cannot overlap and so the
        * phone's bottom-right corner has one thing in it rather than two things
        * that happen to be near each other. The + is the accent one: it is the
        * action, and the coach is the thing you ask when you do not know what the
        * action is.
        */}
      {tab !== 'coach' && plan && (
        <div className="fabs">
          <button className="fab plus" onClick={() => setFab('menu')} aria-label="Add a workout">
            <Icon name="Plus" size={24} />
          </button>
          <CoachBubble plan={plan} onPlace={placeFromCoach} />
        </div>
      )}

      {fab === 'menu' && (
        <FabMenu
          onClose={() => setFab(null)}
          onPlan={() => setFab('plan')}
          onLog={() => setFab('log')}
          onPickSession={() => setFab('pick')}
          onRest={restOpt ? () => askRest() : null}
          onPlanWeek={() => setFab('week')} />
      )}

      {/*
        * The week's quotas, talked through. Writes the same `quota-<monday>` entry
        * the Week tab's steppers write, and only on their tap — see weekplanner.jsx.
        */}
      {fab === 'week' && (
        <WeekPlanFlow plan={plan} entries={store.entries} iso={localIso()}
          upsertEntry={store.upsertEntry}
          onPlan={() => setFab('plan')}
          onClose={() => setFab(null)} />
      )}

      {/*
        * Log a workout: the SAME screen as "pick a session", over the sports
        * catalog instead of the plan's cards, because the two are the same action
        * over two different lists. This used to create an entry and drop the user
        * into a form whose first question was a collapsed search box. Now the
        * question is answered before the form opens, so the card arrives the
        * right shape.
        */}
      {fab === 'log' && (
        <ActivityChooser plan={plan} field={activityFieldOf(plan)}
          onPick={(activity) => placeToday('log-workout', { out: { activity } })}
          onClose={() => setFab(null)} />
      )}

      {/*
        * The plan's own sessions. This is the route the swap list used to be, and
        * it had to come back: taking that list off Today left twenty-one climbing
        * cards in plan.json with nowhere to press. It does not rank them — see
        * sessionpicker.jsx.
        */}
      {fab === 'rest' && restOpt && (
        <RestPrompt opt={restOpt} date={restDate} entryFor={restOn} onSave={takeRest}
          onClose={() => setFab(null)} />
      )}

      {fab === 'pick' && (
        <SessionPicker plan={plan}
          onPick={(optId) => placeToday(optId)}
          onClose={() => setFab(null)} />
      )}

      {fab === 'plan' && (
        <PlanFlow plan={plan} entries={store.entries} iso={localIso()}
          onKeep={keepPlan} onStart={startPlanned} onClose={() => setFab(null)} />
      )}
    </div>
    </StravaProvider>
    </WhoopProvider>
    </CoachProvider>
    </PlanProvider>
    </PrefsProvider>
  )
}
