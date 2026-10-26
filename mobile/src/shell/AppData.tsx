// What App.jsx holds, for every native screen: the store, the plan, which
// overlay the + opened, which session sheet to open next, and the write paths
// that put sessions on the day (placeAll and friends, ported verbatim with their
// reasons). The web passes these down as props from one component; here the
// tabs are separate routes, so they read them from this context instead, and
// pass them on as the same props the web components take.
//
// The providers App.jsx wraps everything in (prefs, plan, WHOOP, Strava)
// are mounted here too, in the same order.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { useStore, doneWhenPlaced } from '../lib/store.js'
import { PrefsProvider } from '../lib/prefs.jsx'
import { PlanProvider } from '../lib/planctx.jsx'
import { WhoopProvider } from '../lib/whoop.jsx'
import { StravaProvider } from '../lib/strava.jsx'
import { localIso, fromIso } from '../lib/dates.js'
import { splitPrescription } from '../lib/prescription.js'
import { currentMe } from '../lib/whoami.js'
import * as trainerLib from '../lib/trainer.js'
import * as peopleApi from '../lib/peopleapi.js'

// Default parameters in the ported JS narrow TypeScript's inference (mobile/AGENTS.md).
const { placeEntries, planPeople, keepPlanFor, plannedItems, shareKept } = trainerLib as any
import { onForeground } from '../lib/foreground'

export type TabId = 'today' | 'log' | 'progress'
/** null | 'menu' | 'plan' | 'log' | 'rest' */
export type Fab = null | 'menu' | 'plan' | 'log' | 'rest'

export interface AppData {
  store: ReturnType<typeof useStore>
  /** undefined while loading, null when the server could not read its content file. */
  plan: any
  reloadPlan: () => void
  me: ReturnType<typeof currentMe>
  fab: Fab
  setFab: (f: Fab) => void
  /** The + button: opens the menu, remembering which tab it was pressed on. */
  openMenu: (fromTab: string) => void
  /** Which tab the + menu was opened from (Log a workout uses Today's day only from Today). */
  menuFrom: string | null
  /** The day Today is showing (TodayTab reports it through `onViewDay`). */
  viewDay: string | null
  setViewDay: (iso: string) => void
  /** Where Log a workout lands, and the WHOOP/Strava climb it is for, if any. */
  logAt: { date: string | null; climb: any }
  openLog: (date?: string | null, opts?: { climb?: any }) => void
  /** "for Mon, Oct 12" when a date is not today; null for today. */
  dayLabel: (date: string | null) => string | null
  openEntryId: string | null
  setOpenEntryId: (id: string | null) => void
  setTab: (t: TabId) => void
  placeAll: (items: { optId: string; data?: any }[], opts?: { open?: boolean; close?: boolean; date?: string }) => string[]
  placeToday: (optId: string, data?: any, opts?: { open?: boolean; close?: boolean; date?: string }) => string | null
  keepPlan: (pres: any) => { ids: string[]; count: number; first: string | null; entries: any[] }
  startPlanned: (id: string) => void
  /** Who the owner can plan for (lib/trainer.js): nobody unless this is the owner, on the owner's own log, with someone else on the install. */
  people: { id: string; name: string }[]
  /** Keep a plan in someone else's log, through the people endpoints. */
  keepPlanFor: (person: { id: string; name: string }, pres: any, key?: string | null) => Promise<{ ids: string[]; count: number; first: string | null }>
  /** You and others (#59): the entries just kept, shared with each of them, sync on. */
  shareKeptWith: (others: { id: string; name: string }[], kept: any[]) => Promise<{ entries: any[]; failed: { person: any; error: string }[] }>
  restOpt: any
  restOn: (date: string) => any
  restDate: string | null
  askRest: (date?: string) => void
  takeRest: (r: { date: string; why?: string; notes?: string }) => void
}

const Ctx = createContext<AppData | null>(null)

export function useApp(): AppData {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

/** Where each web tab lives in the app. */
export const TAB_ROUTES: Record<TabId, string> = {
  today: '/', log: '/log', progress: '/progress',
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const store = useStore()
  const me = currentMe()
  const [plan, setPlan] = useState<any>(undefined) // undefined = loading, null = absent

  const loadPlan = useCallback(() => {
    fetch('/api/content', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setPlan((was: any) => p ?? (was || null)))
      .catch(() => setPlan((was: any) => was || null))
  }, [])
  // The web reads the content file once per page load. An app stays open for
  // days, so it re-reads on coming back too: a plan imported in Settings shows up.
  useEffect(() => { loadPlan(); return onForeground(loadPlan) }, [loadPlan])

  const setTab = useCallback((t: TabId) => { router.navigate(TAB_ROUTES[t] as any) }, [])

  const [fab, setFab] = useState<Fab>(null)
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)
  const [menuFrom, setMenuFrom] = useState<string | null>(null)
  const openMenu = (fromTab: string) => { setMenuFrom(fromTab); setFab('menu') }

  /*
   * WHICH DAY a logged workout lands on. Until 2026-10-14 every pick landed on
   * today, whatever day the user was looking at, so Monday's board session could
   * not be logged on Monday. Now Log a workout lands on the day Today is showing
   * (never a future one: you cannot have done tomorrow's workout). `climb` is a
   * WHOOP or Strava climb from the unlogged card, attached to whichever card the
   * user picks for it.
   */
  const [viewDay, setViewDay] = useState<string | null>(null)
  const [logAt, setLogAt] = useState<{ date: string | null; climb: any }>({ date: null, climb: null })
  const logDay = (date?: string | null) => {
    const today = localIso()
    return date && date <= today ? date : today
  }
  const openLog: AppData['openLog'] = (date, { climb = null } = {}) => {
    setLogAt({ date: logDay(date), climb })
    setFab('log')
  }
  const dayLabel: AppData['dayLabel'] = (date) => (date && date !== localIso()
    ? `for ${(fromIso as any)(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`
    : null)

  /**
   * Put one or more sessions on today, in one go. BATCHED ON PURPOSE: ids are
   * allocated against ONE snapshot plus whatever this call has already written,
   * so two sessions placed together cannot both mint `daily-<date>`. See App.jsx.
   */
  const entriesRef = useRef(store.entries)
  entriesRef.current = store.entries
  const placeAll: AppData['placeAll'] = (items, opts) => placeWritten(items, opts).map((e) => e.id)
  const placeWritten = (items: { optId: string; data?: any }[], { open = true, close = true, date = localIso() }: { open?: boolean; close?: boolean; date?: string } = {}): any[] => {
    // `placeEntries` (lib/trainer.js), the same function the owner planning for
    // someone else runs against THEIR day, so the two mint the same ids. Done on
    // today or an earlier day, planned on a later one (AGENTS.md §4).
    const written: any[] = placeEntries({ menu: plan?.dailyMenu || [], onDay: entriesRef.current, items, date })
    for (const entry of written) store.upsertEntry(entry)

    if (close) setFab(null)
    if (open && written[0]) setOpenEntryId(written[0].id)
    setTab('today')
    return written
  }

  const restOpt = (plan?.dailyMenu || []).find((m: any) => m.role === 'rest' && !m.retired) || null
  const restOn = (date: string) => restOpt && store.entries.find((e: any) => e.kind === 'daily' && e.date === date
    && !e.deleted && e.data?.optId === restOpt.id)
  const [restDate, setRestDate] = useState<string | null>(null)
  const askRest = (date?: string) => { setRestDate(date || localIso()); setFab('rest') }
  const takeRest: AppData['takeRest'] = ({ date, why, notes }) => {
    const hit = restOn(date)
    if (hit) {
      store.upsertEntry({ ...hit, data: { ...hit.data, out: { ...(hit.data.out || {}), why, notes } } })
      setFab(null); setTab('today')
      return
    }
    placeAll([{ optId: restOpt.id, data: { out: { why, notes } } }], { open: false, date })
  }

  const placeToday: AppData['placeToday'] = (optId, data = {}, opts = {}) => placeAll([{ optId, data }], opts)[0] || null

  /** Keep a prescription, as one entry per WORKOUT in it (see App.jsx keepPlan). */
  const keepPlan = (pres: any) => {
    const entries = placeWritten(
      plannedItems(splitPrescription(pres)),
      // They land on the day, but nothing opens: the planner's last screen asks.
      { open: false, close: false },
    )
    const ids = entries.map((e) => e.id)
    return { ids, count: ids.length, first: ids[0] || null, entries }
  }

  /*
   * THE OWNER AS TRAINER (lib/trainer.js, features/trainer.tsx): a plan kept for
   * someone goes into THEIR log through the people endpoints, with the ids their
   * own + would mint against their day.
   */
  const people = planPeople(me)
  const keepPlanForPerson: AppData['keepPlanFor'] = (person, pres, key = null) => keepPlanFor({
    person, parts: splitPrescription(pres), menu: plan?.dailyMenu || [], date: localIso(),
    owner: { id: me.real.id, name: me.real.name }, api: peopleApi, key,
  })

  /* You and others (#59): shared with each of them through the same `addPerson` as "With …". */
  const shareKeptWith: AppData['shareKeptWith'] = (others, kept) => shareKept({
    entries: kept, people: others, menu: plan?.dailyMenu || [],
    owner: { id: me.real.id, name: me.real.name }, api: peopleApi, save: store.upsertEntry,
  })

  /** "Start it now", from the planner's last screen. */
  const startPlanned = (id: string) => {
    setFab(null)
    setOpenEntryId(id)
    setTab('today')
  }

  const value: AppData = {
    store, plan, reloadPlan: loadPlan, me, fab, setFab, openMenu, menuFrom, viewDay, setViewDay,
    logAt, openLog, dayLabel, openEntryId, setOpenEntryId, setTab,
    placeAll, placeToday, keepPlan, startPlanned, people, keepPlanFor: keepPlanForPerson, shareKeptWith,
    restOpt, restOn, restDate, askRest, takeRest,
  }

  return (
    <PrefsProvider settings={store.settings} saveSettings={store.saveSettings}>
      <PlanProvider plan={plan}>
        <WhoopProvider>
          <StravaProvider>
            <Ctx.Provider value={value}>{children}</Ctx.Provider>
          </StravaProvider>
        </WhoopProvider>
      </PlanProvider>
    </PrefsProvider>
  )
}

/** The same props the web's tab components take, from the context. */
export function useStoreProps() {
  const { store } = useApp()
  return useMemo(() => ({
    entries: store.entries, upsertEntry: store.upsertEntry, deleteEntry: store.deleteEntry,
    settings: store.settings, saveSettings: store.saveSettings,
  }), [store.entries, store.upsertEntry, store.deleteEntry, store.settings, store.saveSettings])
}
