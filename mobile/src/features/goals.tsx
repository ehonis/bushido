/*
 * Totem's goals, in Bushido. (app/src/goals.jsx)
 *
 * Read-only by design — see lib/goals.js. What it is for is the moment the user
 * writes a mile goal in Totem on a Sunday and sees it on Tuesday in the app
 * they are actually standing in with a bike.
 *
 * TWO MODES. As a card on Today it stayed SILENT whenever it had nothing to say,
 * because a card explaining an empty list every day is worse than no card. A tab
 * cannot do that: a tab you tapped that rendered nothing is indistinguishable
 * from a broken one. So `full` says everything out loud, including why it is empty.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Card, Empty, H2, Sub } from '../ui/kit'
import { Icon } from '../lib/icons'
import { getBaseUrl, serverUrl } from '../lib/connection'
import { bushidoGoalCards, goalNudge, bushidoHost as webHost } from '../lib/goals.js'

/*
 * There is no page host natively, so the saved server's host stands in for
 * `location.host` (AGENTS.md §8.4: VITE_BUSHIDO_HOST first, the page's own host
 * when that is unset).
 */
function bushidoHost(): string {
  let loc: { host: string } | undefined
  try { loc = { host: new URL(getBaseUrl()).host } } catch { loc = undefined }
  return (webHost as any)(loc) || ''
}

/**
 * One number, with its bar. Shared by the goal and by its steps: a number on a
 * step is the same kind of thing as a number on the goal.
 */
function Metric({ m, done }: { m: any; done?: boolean }) {
  return (
    <View style={st.metric}>
      <View style={st.metricTop}>
        <T size={12.5} dim style={{ flex: 1 }}>
          {m.label}
          {/* Whose number it is. A hand-logged metric nobody has touched should not
              look like one a connector is keeping current. */}
          {!m.manual ? <T size={10} color={colors.accent}>{`  ${m.source}`}</T> : null}
        </T>
        <T size={12} tabular numberOfLines={1}>
          {/* A connector that cannot be read is not a zero — rather than an empty
              bar that looks exactly like a bad week. */}
          {m.available
            ? <>{String(m.value)}<T size={12} faint>{`/${m.target} ${m.unit}`}</T></>
            : <T size={12} faint>can’t read</T>}
        </T>
      </View>
      <View style={st.bar} accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: m.available ? m.percent : 0 }}>
        <View style={[st.fill, { width: `${m.available ? m.percent : 0}%`, backgroundColor: done ? colors.good : colors.accent }]} />
      </View>
    </View>
  )
}

const Heading = () => (
  <View style={st.h2Row}>
    <Icon name="Target" size={16} />
    <H2 style={{ marginBottom: 0 }}>Goals from Totem</H2>
  </View>
)

export function TotemGoals({ compact = false, full = false }: { compact?: boolean; full?: boolean }) {
  const [cache, setCache] = useState<any>(null)
  const [state, setState] = useState('loading')

  useEffect(() => {
    let live = true
    fetch('/api/goals', { cache: 'no-cache' } as any)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) { setCache(d); setState(d ? 'ok' : 'error') } })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [])

  const cards = useMemo(() => (bushidoGoalCards as any)(cache), [cache])

  // Nothing linked is the normal state until the user links one. It says how
  // ONCE, when the bridge answered and there is genuinely nothing.
  if (state === 'loading') return full ? <Empty>Loading goals…</Empty> : null

  if (state !== 'ok') {
    if (!full) return null
    return (
      <Card>
        <Heading />
        <Sub style={{ marginBottom: 0 }}>
          Could not reach Totem. These are read over the same bridge as WHOOP and
          Strava, so if those are also stale it is the bridge rather than the goals.
        </Sub>
      </Card>
    )
  }

  // No bridge configured: an optional feature this install has not turned on, so
  // the compact card says nothing and the full one says where.
  if (cache?.configured === false) {
    if (!full) return null
    return (
      <Card>
        <Heading />
        <Sub style={{ marginBottom: 0 }}>
          {'Off. Goals are read from a Totem bridge, which this install does not have. Set one up in '}
          <T size={13} color={colors.accent} accessibilityRole="link"
            onPress={() => { WebBrowser.openBrowserAsync(serverUrl('/settings')).catch(() => {}) }}>
            Settings → Integrations
          </T>
          {' to show them here.'}
        </Sub>
      </Card>
    )
  }

  if (!cards.length) {
    if (compact) return null
    const host = bushidoHost()
    return (
      <Card>
        <Heading />
        <Sub style={{ marginBottom: 0 }}>
          None linked yet. Goals live in Totem — press the <T size={13} weight={700}>Bushido</T> button on
          a goal there and it shows up here with its progress. By hand, that is:{' '}
          {host
            ? <T size={13} mono style={st.code}>{`goals__link_goal(id, kind: 'url', url: 'https://${host}')`}</T>
            : 'link it to this app’s URL.'}
        </Sub>
      </Card>
    )
  }

  return (
    <Card>
      <Heading />
      {cards.map((card: any, i: number) => {
        const nudge = (goalNudge as any)(card)
        return (
          <View key={card.id} style={[st.goal, i === 0 && st.goalFirst, card.complete && { opacity: 0.65 }]}>
            <View style={st.goalHead}>
              <T size={14} weight={700} style={{ flex: 1 }}>{card.title}</T>
              <T size={17} tabular color={card.complete ? colors.good : colors.accent}>{`${card.percent}%`}</T>
            </View>
            <T size={11} faint style={{ marginBottom: 8 }}>
              {card.period}
              {/* A window that has closed says so. "0 days left" on last week's goal
                  reads like a countdown still running, and last week is the only
                  place to see what did not happen. */}
              {card.complete ? ' · done'
                : card.periodState === 'expired' ? ' · ended'
                : card.daysLeft !== null ? ` · ${card.daysLeft} day${card.daysLeft === 1 ? '' : 's'} left` : ''}
            </T>

            {card.metrics.map((m: any) => <Metric key={m.id} m={m} done={card.complete} />)}

            {/* The steps, and the numbers on them. Usually where the countable thing
                actually is; shown with their own bars because a step at one ride of
                two is neither done nor untouched. */}
            {card.steps.length > 0 && (
              <View style={st.steps}>
                {card.steps.map((step: any) => (
                  <View key={step.id}
                    style={[st.step, step.complete && { borderLeftColor: colors.good }, step.abandoned && { opacity: 0.55 }]}>
                    <View style={st.stepHead}>
                      <T size={11} color={step.complete ? colors.good : colors.inkFaint}>{step.complete ? '✓' : '○'}</T>
                      <T size={12.5} style={[{ flex: 1 }, step.abandoned && { textDecorationLine: 'line-through' }]}
                        color={step.abandoned ? colors.inkFaint : step.complete ? colors.inkDim : colors.ink}>
                        {step.title || 'unnamed step'}
                      </T>
                      {/* Only where it says something the tick does not. */}
                      {!step.complete && !step.abandoned && step.metrics.length > 0 && (
                        <T size={11} faint tabular>{`${step.percent}%`}</T>
                      )}
                      {step.abandoned && <T size={11} faint>not doing</T>}
                    </View>
                    {step.metrics.map((m: any) => <Metric key={m.id} m={m} done={card.complete} />)}
                  </View>
                ))}
              </View>
            )}

            {nudge ? <T size={11.5} color={colors.warn} style={{ marginTop: 8 }}>{nudge}</T> : null}
          </View>
        )
      })}
      <Sub size={11} style={{ marginTop: 12 }}>
        Written and edited in Totem; shown here. The numbers are Totem's own, including
        anything a connector is feeding.{full ? ' Press the Bushido button on a goal in Totem to link or unlink it.' : ''}
      </Sub>
    </Card>
  )
}

const st = StyleSheet.create({
  h2Row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  goal: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line },
  goalFirst: { borderTopWidth: 0, paddingTop: 0 },
  goalHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  metric: { marginTop: 7, gap: 3 },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { height: 5, borderRadius: 999, backgroundColor: colors.panel2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  steps: { marginTop: 10, gap: 9 },
  step: { paddingLeft: 9, borderLeftWidth: 2, borderLeftColor: colors.line },
  stepHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  code: { backgroundColor: colors.panel2 },
})
