/*
 * Plan the week — the conversation between "+" and a set of quotas. Ported from
 * app/src/weekplanner.jsx.
 *
 * The Week tab already has the steppers; this is the same numbers with an agent
 * beside them, and all three load-bearing rules are the workout planner's:
 *
 * **Nothing is written until the user taps "Set the week".** A turn proposes
 * counts and puts them in the steppers; the quota entry is written once, by
 * their tap, through the same `upsertEntry` the Week tab uses.
 *
 * **The conversation lands on the quota entry** (`data.thread`, `data.why`,
 * `data.title`), the way a prescription keeps its thread.
 *
 * **It does not run on open.** A model call the user did not ask for is forty
 * seconds and a dollar; the screen opens on the numbers and the prompts, and the
 * first turn is theirs.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, mix, radius } from '../theme'
import { Icon } from '../lib/icons'
import { T } from '../ui/Text'
import { Btn, Card, H2, IconBtn, Press } from '../ui/kit'
import { FullScreen } from '../ui/Sheet'
import { impact, success } from '../ui/haptics'
import { Markdown } from '../lib/markdown'
import { requestWeek, weekContext } from '../lib/plannerapi.js'
import {
  progress as quotaProgress, mondayOf, weekDays, shiftWeek, quotaCounts, quotaEntry, suggest,
  buildQuotaEntry,
} from '../lib/quota.js'
import { fromIso } from '../lib/dates.js'
import { achievements, unclaimed } from '../lib/achievements.js'
import { profileFacts } from '../lib/profile.js'
import { StepPage, TalkAsk, TalkPrompts, TalkThread, TurnCount } from './planner'


/** The quick asks. Content would be better; five is not yet enough to earn it. */
const WEEK_PROMPTS = [
  'Draft the week for me',
  'Like last week, but more zone 2',
  'I am short on time this week',
  'Lean toward the half iron',
  'Lean toward the 12a',
]

/**
 * Which Monday to open on. Saturday and Sunday are when a week gets planned, and
 * the week being planned then is the next one. Any other day it is this week.
 */
export function defaultMonday(iso: string) {
  const dow = (fromIso as any)(iso).getDay()  // 0 Sunday … 6 Saturday
  const thisMonday = (mondayOf as any)(iso)
  // `shiftWeek(m, n)` moves n weeks FORWARD (its own tests: -1 is last week).
  return dow === 0 || dow === 6 ? (shiftWeek as any)(thisMonday, 1) : thisMonday
}

const weekLabel = (monday: string) =>
  `${(fromIso as any)(monday).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ` +
  `${(fromIso as any)((weekDays as any)(monday)[6]).toLocaleDateString([], { month: 'short', day: 'numeric' })}`

export function WeekPlanFlow({ plan, entries = [], iso, upsertEntry, onClose, onPlan = null }: any) {
  const [monday, setMonday] = useState(() => defaultMonday(iso))
  const thisMonday = (mondayOf as any)(iso)
  const isCurrent = monday === thisMonday

  const stored: Record<string, number> = useMemo(() => (quotaCounts as any)(entries, monday), [entries, monday])
  const existing: any = useMemo(() => (quotaEntry as any)(entries, monday), [entries, monday])
  const offer: any = useMemo(() => (suggest as any)({ plan, entries, iso: monday }), [plan, entries, monday])
  const week: any = useMemo(() => (quotaProgress as any)({ plan, entries, iso: monday }), [plan, entries, monday])

  // The boxes. Seeded from what the user SET for that week (or its thread, if it
  // was planned here before), never from the suggestion.
  const [draft, setDraft] = useState<Record<string, number>>(() => stored)
  const [thread, setThread] = useState<any[]>(() => existing?.data?.thread || [])
  const [why, setWhy] = useState<string | null>(() => existing?.data?.why || null)
  const [title, setTitle] = useState<string | null>(() => existing?.data?.title || null)
  const [model, setModel] = useState<string | null>(() => existing?.data?.model || null)
  // What the last turn moved, so the rows can say "was 2".
  const [before, setBefore] = useState<Record<string, number> | null>(null)
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState('plan')  // plan | set
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const changeWeek = (m: string) => {
    abort.current?.abort()
    setMonday(m)
    const e: any = (quotaEntry as any)(entries, m)
    setDraft((quotaCounts as any)(entries, m))
    setThread(e?.data?.thread || [])
    setWhy(e?.data?.why || null)
    setTitle(e?.data?.title || null)
    setModel(e?.data?.model || null)
    setBefore(null)
    setError(null)
  }

  const set = (key: string, n: number) => {
    const next = { ...draft }
    if (n > 0) next[key] = n
    else delete next[key]
    setDraft(next)
  }

  const total = Object.values(draft).reduce((a, b) => a + b, 0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored) || (thread.length > 0 && !existing?.data?.thread)

  const ask = async (message: string) => {
    const said = String(message || '').trim()
    if (!said || asking) return
    impact()
    setText('')
    setError(null)
    setAsking(true)
    // Their message goes on immediately: a turn is tens of seconds of an agent
    // reading three weeks of their log.
    const pending = [...thread, { role: 'you', text: said, at: new Date().toISOString() }]
    setThread(pending)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const res: any = await (requestWeek as any)({
        monday, counts: draft, message: said, thread,
        context: (weekContext as any)({ week, monday, iso, plan, entries }),
        signal: ctrl.signal,
      })
      setBefore(draft)
      setDraft(res.counts || {})
      setWhy(res.reply || null)
      if (res.title) setTitle(res.title)
      if (res.model) setModel(res.model)
      setThread([...pending, {
        role: 'coach',
        text: res.changed || 'Left as you had it.',
        at: new Date().toISOString(),
      }])
    } catch (e: any) {
      if (ctrl.signal.aborted) return
      setError(e.message)
      // Put their message back in the box rather than losing it to a failed turn.
      setThread(thread)
      setText(said)
    } finally {
      if (!ctrl.signal.aborted) setAsking(false)
    }
  }

  /** The one write. Same builder, same entry id, as the Week tab's steppers. */
  const keep = () => {
    impact()
    upsertEntry((buildQuotaEntry as any)(monday, draft, {
      ...(thread.length ? { thread } : {}),
      ...(why ? { why } : {}),
      ...(title ? { title } : {}),
      ...(model ? { model } : {}),
    }))
    success()
    setStep('set')
  }

  const achs: any[] = useMemo(() => (achievements as any)(plan, entries, (profileFacts as any)(entries)), [plan, entries])
  const cats: any[] = plan?.quotaCategories || []
  const catsOf = (a: any) => cats.filter(c => a.categories.includes(c.key))
  const loose: any[] = useMemo(() => (unclaimed as any)(plan, achs), [plan, achs])

  const Row = (c: any) => {
    const n = draft[c.key] || 0
    const was = before ? (before[c.key] || 0) : null
    const moved = was !== null && was !== n
    const state = isCurrent ? (week.byKey[c.key] || { done: 0 }) : { done: 0 }
    return (
      <View key={c.key} style={st.row}>
        <Icon name={c.icon} size={16} color={colors.inkFaint} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <T size={14} weight={600} numberOfLines={1}>{c.name}</T>
          {moved && <T size={11} faint>was {was}</T>}
        </View>
        {state.done > 0 ? <T size={11} dim>{`${state.done} done`}</T> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <IconBtn icon="Minus" size={14} color={colors.ink} label={`one fewer ${c.name}`}
            disabled={!n} onPress={() => set(c.key, Math.max(0, n - 1))} />
          <T size={17} tabular align="center" style={{ minWidth: 30 }}
            color={moved ? colors.accent : colors.ink} weight={moved ? 600 : undefined}>{n || '–'}</T>
          <IconBtn icon="Plus" size={14} color={colors.ink} label={`one more ${c.name}`}
            onPress={() => set(c.key, n + 1)} />
        </View>
      </View>
    )
  }

  if (step === 'set') {
    return (
      <FullScreen title="Week is set" sub={weekLabel(monday)} icon="CalendarRange" onBack={onClose}>
        <View style={st.kept}>
          <Icon name="CircleCheck" size={44} color={colors.vizGood} />
          <T size={22} weight={600} lineHeight={27} align="center" style={{ marginTop: 14, marginBottom: 8 }}>
            {title || 'The week is set'}
          </T>
          <T size={12.5} dim lineHeight={19} align="center">
            {total} workout{total === 1 ? '' : 's'} asked for, {weekLabel(monday)}. Nothing is on a day
            yet — the bars on Today fill as you log, and the Week tab is where these live now.
          </T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 28 }}>
            {onPlan && (
              <Btn icon="Sparkles" title="Plan the first workout" onPress={onPlan} style={{ minHeight: 56 }} />
            )}
            <Btn kind="ghost" icon="House" title="Back to today" onPress={onClose} />
          </View>
        </View>
      </FullScreen>
    )
  }

  return (
    <FullScreen title="Plan the week" sub={weekLabel(monday)} icon="CalendarRange" onBack={onClose} scroll={false}>
      <StepPage
        foot={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn kind="ghost" title="Close" onPress={onClose} />
            <Btn icon="CalendarRange" onPress={keep} disabled={!total && !dirty} style={{ flex: 1, minHeight: 54 }}
              title={`${existing ? 'Update the week' : 'Set the week'} · ${total}`} />
          </View>
        }
      >
        <View style={st.weeks}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[[true, 'This week', thisMonday], [false, 'Next week', (shiftWeek as any)(thisMonday, 1)]].map(([cur, lbl, m]: any) => {
              const on = cur ? isCurrent : !isCurrent
              return (
                <Press key={lbl} haptic onPress={() => changeWeek(m)} accessibilityRole="tab"
                  accessibilityState={{ selected: on }} style={[st.week, on && st.weekOn]}>
                  <T size={13} weight={600} color={on ? colors.accent : colors.inkDim}>{lbl}</T>
                </Press>
              )
            })}
          </View>
          <T size={12} faint>
            {isCurrent
              ? `${week.doneTotal} of ${week.plannedTotal || '–'} filled · ${week.days.filter((d: string) => d > iso).length} days left`
              : 'nothing has happened yet'}
          </T>
        </View>

        <View style={st.talk}>
          <View style={st.talkHead}>
            <Icon name="MessagesSquare" size={15} color={colors.accent} />
            <T size={13.5} weight={600} style={{ flex: 1 }}>
              {why ? 'What it proposes — and what to change' : 'Talk the week through'}
            </T>
            {thread.length > 0 && <TurnCount n={Math.ceil(thread.length / 2)} />}
          </View>
          <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            {!why && !thread.length && (
              <T size={13} dim lineHeight={19.5} style={{ marginBottom: 10 }}>
                It reads what you set and what you actually did the last few weeks, how you have
                been recovering, and what you are training for — then proposes the counts below.
                You move any of them, and nothing is written until you set the week.
              </T>
            )}

            {why ? <View style={{ marginBottom: 4 }}><Markdown text={why} size={13.5} color={colors.inkDim} /></View> : null}

            <TalkThread thread={thread} asking={asking} thinking="Reading your last few weeks…" />

            {error && (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <Icon name="TriangleAlert" size={13} color={colors.bad} style={{ marginTop: 3 }} />
                <T size={12.5} color={colors.bad} style={{ flex: 1 }}>{error} — the numbers below are unchanged.</T>
              </View>
            )}

            {!asking && <TalkPrompts prompts={WEEK_PROMPTS} onAsk={ask} />}

            <TalkAsk text={text} setText={setText} asking={asking} onAsk={ask} label="Ask"
              placeholder="or say it — “gym Thursday, long ride Sunday, keep the fingers light”" />
          </View>
        </View>

        {!Object.keys(draft).length && offer.source !== 'empty' && (
          <Press haptic onPress={() => { setBefore(null); setDraft(offer.counts) }} style={st.restbtn}>
            <Icon name="Repeat" size={17} color={colors.inkFaint} />
            <T size={14} faint>
              {offer.source === 'last-week'
                ? 'Start from last week\'s quotas'
                : 'Start from what you actually did last week'}
            </T>
          </Press>
        )}

        <Card>
          <H2>{title || 'What this week asks for'}</H2>
          <T size={13} dim style={{ marginBottom: 14 }}>
            Counts of <T size={13} dim weight={700}>workouts</T>, not days. Move any number — what it proposed is a
            proposal, and what you set is the week.
          </T>

          {achs.map((a: any, i: number) => (
            <View key={a.id} style={{ marginTop: i === 0 ? 8 : 18 }}>
              <GroupHead icon={a.icon} name={a.name} />
              {catsOf(a).map(Row)}
            </View>
          ))}

          {loose.length > 0 && (
            <View style={{ marginTop: achs.length ? 18 : 8 }}>
              <GroupHead icon="Sparkles" name="Nothing in particular" />
              {loose.map(Row)}
            </View>
          )}
        </Card>
      </StepPage>
    </FullScreen>
  )
}

/** .wk-card .quotagroup h3 */
function GroupHead({ icon, name }: { icon: string; name: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 4 }}>
      <Icon name={icon} size={15} color={colors.inkFaint} />
      <T size={12} caps faint style={{ letterSpacing: 0.7 }}>{name}</T>
    </View>
  )
}

const st = StyleSheet.create({
  weeks: { gap: 8, marginBottom: 16 },
  week: {
    minHeight: 38, paddingHorizontal: 14, borderRadius: radius.pill, justifyContent: 'center',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line,
  },
  weekOn: { borderColor: colors.accent, backgroundColor: mix(colors.accent, 12, colors.panel2) },
  talk: {
    marginBottom: 20, borderRadius: 12, overflow: 'hidden',
    backgroundColor: mix(colors.accent, 7, colors.panel2), borderWidth: 1, borderColor: mix(colors.accent, 24, colors.line),
  },
  talkHead: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 11, paddingHorizontal: 12, minHeight: 44 },
  restbtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginBottom: 14,
    padding: 14, minHeight: 44, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  kept: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 8 },
})
