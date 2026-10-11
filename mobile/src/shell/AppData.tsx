// What App.jsx holds, for every native screen: the store, the plan, which
// overlay the + opened, which session sheet to open next, and the write paths
// that put sessions on the day (placeAll and friends, ported verbatim with their
// reasons). The web passes these down as props from one component; here the
// tabs are separate routes, so they read them from this context instead, and
// pass them on as the same props the web components take.
//
// The providers App.jsx wraps everything in (prefs, plan, coach, WHOOP, Strava)
// are mounted here too, in the same order.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { useStore, extraEntryId } from '../lib/store.js'
import { PrefsProvider } from '../lib/prefs.jsx'
import { PlanProvider } from '../lib/planctx.jsx'
import { CoachProvider } from '../lib/coachapi.jsx'
import { WhoopProvider } from '../lib/whoop.jsx'
import { StravaProvider } from '../lib/strava.jsx'
import { localIso } from '../lib/dates.js'
import { nameFor } from '../lib/naming.js'
import { splitPrescription } from '../lib/prescription.js'
import { currentMe } from '../lib/whoami.js'
import { onForeground } from '../lib/foreground'

export type TabId = 'today' | 'week' | 'log' | 'progress' | 'achievements' | 'goals' | 'coach'
/** null | 'menu' | 'plan' | 'pick' | 'log' | 'week' | 'rest' */
export type Fab = null | 'menu' | 'plan' | 'pick' | 'log' | 'week' | 'rest'

export interface AppData {
  store: ReturnType<typeof useStore>
  /** undefined while loading, null when the server could not read its content file. */
  plan: any
  reloadPlan: () => void
  me: ReturnType<typeof currentMe>
  fab: Fab
  setFab: (f: Fab) => void
  openEntryId: string | null
  setOpenEntryId: (id: string | null) => void
  setTab: (t: TabId) => void
  placeAll: (items: { optId: string; data?: any }[], opts?: { open?: boolean; close?: boolean; date?: string }) => string[]
  placeToday: (optId: string, data?: any, opts?: { open?: boolean; close?: boolean; date?: string }) => string | null
  placeFromCoach: (s: { optId: string; action?: string }) => void
  keepPlan: (pres: any) => { ids: string[]; count: number; first: string | null }
  startPlanned: (id: string) => void
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
  today: '/', week: '/week', log: '/log', progress: '/progress',
  achievements: '/achievements', goals: '/goals', coach: '/coach',
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

  /*
   * Taking a session the coach offered. The coach does not write this; the
   * tap does, through an ordinary entry with `done: false`.
   */
  const placeFromCoach = (s: { optId: string; action?: string }) => {
    const opt = (plan?.dailyMenu || []).find((o: any) => o.id === s.optId)
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

  const [fab, setFab] = useState<Fab>(null)
  const [openEntryId, setOpenEntryId] = useState<string | null>(null)

  /**
   * Put one or more sessions on today, in one go. BATCHED ON PURPOSE: ids are
   * allocated against ONE snapshot plus whatever this call has already written,
   * so two sessions placed together cannot both mint `daily-<date>`. See App.jsx.
   */
  const entriesRef = useRef(store.entries)
  entriesRef.current = store.entries
  const placeAll: AppData['placeAll'] = (items, { open = true, close = true, date = localIso() } = {}) => {
    const onDay = entriesRef.current.filter((e: any) => e.kind === 'daily' && e.date === date && !e.deleted)
    const written: any[] = []

    for (const { optId, data = {} } of items) {
      const opt = (plan?.dailyMenu || []).find((o: any) => o.id === optId)
      if (!opt) continue
      const seen = [...onDay, ...written]
      const hasMain = seen.some((e) => e.data?.slot !== 'extra')
      const id = hasMain ? extraEntryId(date, opt.id, seen, { fresh: true }) : `daily-${date}`
      const out = data.out || {}
      const entry = {
        id, kind: 'daily', date,
        data: {
          optId: opt.id,
          name: nameFor(opt, out),
          minutes: opt.minutes, level: opt.level ?? 1,
          // Putting a session on the day does NOT complete it. A rest day is the
          // exception: choosing it is the whole action.
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
    return written.map((e) => e.id)
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
    const ids = placeAll(
      splitPrescription(pres).map((part: any) => ({
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
      // They land on the day, but nothing opens: the planner's last screen asks.
      { open: false, close: false },
    )
    return { ids, count: ids.length, first: ids[0] || null }
  }

  /** "Start it now", from the planner's last screen. */
  const startPlanned = (id: string) => {
    setFab(null)
    setOpenEntryId(id)
    setTab('today')
  }

  const value: AppData = {
    store, plan, reloadPlan: loadPlan, me, fab, setFab, openEntryId, setOpenEntryId, setTab,
    placeAll, placeToday, placeFromCoach, keepPlan, startPlanned,
    restOpt, restOn, restDate, askRest, takeRest,
  }

  return (
    <PrefsProvider settings={store.settings} saveSettings={store.saveSettings}>
      <PlanProvider plan={plan}>
        <CoachProvider>
          <WhoopProvider>
            <StravaProvider>
              <Ctx.Provider value={value}>{children}</Ctx.Provider>
            </StravaProvider>
          </WhoopProvider>
        </CoachProvider>
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
