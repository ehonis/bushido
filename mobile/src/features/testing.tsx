// The plan's tests and the evidence behind it: the profile's Testing and Why
// pages, both under its Climbing row (docs/DESIGN.md D6), the twin of
// app/src/testing.jsx. Moved out of tabs.tsx (2026-10-25).
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors, font, radius, space } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Chip, Empty, Field, H2, SectionHeader } from '../ui/kit'
import { Fold } from '../ui/Fold'
import { success } from '../ui/haptics'
import { Icon, VERDICT_ICONS } from '../lib/icons'
import { LineChart, SERIES } from '../lib/viz'
import { resolveCeiling, cfPctOfMax, cfBand, CF_CORRECTION_KG, CF_PCT_MVC_MEAN, CF_PCT_MVC_SD, CF_NOISE_PCT } from '../lib/force.js'
import { Blurb } from './blurb'
import { DayStepper } from '../ui/DayStepper'
import { NumInput } from './numinput'
import { localIso } from '../lib/dates.js'

// The same one-liner as tabs.tsx's: the local day, not UTC's.
const todayIso = () => localIso()

/* Whether a plan fills each page. The profile leaves out a row with nothing behind it. */
export const hasTests = (plan: any) => Boolean((plan?.tests || []).length || (plan?.testingNotes || []).length)
export const hasEvidence = (plan: any) => Boolean((plan?.evidence || []).length || plan?.exposureBudget || plan?.reframe)

/* ---------------------------------------------------------------- testing */

export function TestingTab({ plan, entries = [], upsertEntry }: { plan: any; entries?: any[]; upsertEntry: (e: any) => void; deleteEntry?: (id: string) => void }) {
  const [active, setActive] = useState<string | null>(null)
  const tests = plan?.tests || []

  // The starter content has no benchmark tests; a plan that defines some fills this in.
  if (!hasTests(plan)) return <Empty icon="Gauge">No tests in this plan</Empty>

  return (
    <>
      {(plan?.testingNotes || []).map((n: any, i: number) => (
        <Blurb key={i} id={`testnote-${i}`} title={n.title}>
          <T size={font.small} dim>{n.body}</T>
        </Blurb>
      ))}

      {tests.map((t: any) => {
        const results = entries
          .filter(e => e.kind === 'test' && e.data?.testId === t.id)
          .sort((a, b) => a.date.localeCompare(b.date))
        return (
          <Card key={t.id}>
            <H2>{t.name}</H2>
            <T size={font.small} dim style={{ marginBottom: space[3] }}>{t.why}</T>

            {t.metrics.map((m: any, mi: number) => {
              const pts = results
                .filter(r => Number.isFinite(Number(r.data?.[m.key])))
                .map(r => ({ x: r.date, y: Number(r.data[m.key]) }))
              return pts.length ? (
                <LineChart key={m.key} points={pts} label={m.label} unit={m.unit || ''}
                  color={SERIES[mi % SERIES.length]} goal={m.goal} />
              ) : null
            })}

            {t.id === 'critical-force' && <CeilingReadout entries={entries} />}

            {active !== t.id && (
              <Btn kind="secondary" style={{ marginTop: space[3] }} title="Run this test" onPress={() => setActive(t.id)} />
            )}

            {active === t.id && <TestRunner test={t} onSave={upsertEntry} onDone={() => setActive(null)} />}
          </Card>
        )
      })}
    </>
  )
}

/** .deflist: a two-column definition list, label left, prose right. */
function Def({ dt, children }: { dt: string; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: space[3] }}>
      <T size={font.small} dim style={{ width: 96 }}>{dt}</T>
      <T size={font.small} style={{ flex: 1 }}>{children}</T>
    </View>
  )
}

/**
 * What the critical-force test actually buys you: a number in kilograms to set
 * the gauge to. Before it was computed here it had to be re-derived by hand from
 * the last result every time, which is how a session ends up trained at the
 * wrong intensity for weeks.
 */
function CeilingReadout({ entries }: { entries: any[] }) {
  const c: any = (resolveCeiling as any)(entries)
  if (!c) return null

  const round = (n: number) => Math.round(n * 10) / 10
  const pct = (cfPctOfMax as any)(c)
  const band = (cfBand as any)(pct)

  return (
    <View style={st.ceiling}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[3] }}>
        <Icon name="Gauge" size={16} color={colors.series3} />
        <T size={font.body} weight={600} style={{ flex: 1 }}>Your ceiling</T>
        <T size={font.caption} dim>{`tested ${c.date}`}</T>
      </View>

      <View style={{ flexDirection: 'row', gap: space[6], flexWrap: 'wrap', marginBottom: space[4] }}>
        <View style={{ gap: 2 }}>
          <T size={font.display} weight={600} lineHeight={34} tabular>{String(round(c.ceiling))}</T>
          <T size={font.caption} dim>kg ceiling</T>
        </View>
        <View style={{ gap: 2 }}>
          <T size={font.display} weight={600} lineHeight={34} tabular color={colors.accent}>{String(round(c.ceiling - 2))}</T>
          <T size={font.caption} dim>kg — unilateral target</T>
        </View>
      </View>

      <View style={{ gap: space[2] }}>
        <Def dt="How">
          {c.cfMin != null
            ? `CFmin ${round(c.cfMin)} kg vs CF ${round(c.cf)} − ${CF_CORRECTION_KG} = ${round(c.corrected)} kg. The lower one binds${c.bound === 'cfmin' ? ' — that is CFmin' : ' — that is the corrected CF'}.`
            : `CF ${round(c.cf)} kg − ${CF_CORRECTION_KG} = ${round(c.corrected)} kg. Log CFmin from the same test and this uses whichever is lower.`}
        </Def>
        {pct != null && (
          <Def dt="CF vs your max">
            {`${pct}% of ${round(c.mvc)} kg. Climbers average ${CF_PCT_MVC_MEAN} ± ${CF_PCT_MVC_SD}% (Fryer 2019), so `}
            {band === 'below' ? 'this sits below that band — the endurance-limited pattern this whole block targets.'
              : band === 'above' ? 'this sits above that band, which is not the pattern this block assumes.'
              : 'this sits inside the normal band.'}
          </Def>
        )}
        <Def dt="Trust">
          {`One test. Test-retest CV for this protocol is ${CF_NOISE_PCT}% (McClean 2023), so treat anything inside roughly ±${round(c.cf * (CF_NOISE_PCT / 100))} kg as unchanged until a third test agrees.`}
        </Def>
      </View>
    </View>
  )
}

/** .runner-sec: a section head and its body. */
function RunnerSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: space[4] }}>
      <SectionHeader title={title} style={{ marginTop: space[4] }} />
      {children}
    </View>
  )
}

function TestRunner({ test, onSave, onDone }: { test: any; onSave: (e: any) => void; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, any>>({})
  const [date, setDate] = useState(todayIso)

  const save = () => {
    const data: any = { testId: test.id }
    for (const m of test.metrics) if (vals[m.key] !== '' && vals[m.key] != null) data[m.key] = Number(vals[m.key])
    onSave({ kind: 'test', date, data })
    success()
    onDone()
  }

  return (
    <View style={st.runner}>
      <RunnerSec title="Equipment">
        <T size={font.body}>{test.equipment}</T>
      </RunnerSec>

      <RunnerSec title="Steps">
        <View style={{ gap: space[2] }}>
          {test.procedure.map((s: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <T size={font.body} dim tabular style={{ width: 20 }}>{`${i + 1}.`}</T>
              <T size={font.body} style={{ flex: 1 }}>{s}</T>
            </View>
          ))}
        </View>
      </RunnerSec>

      {test.cautions?.length > 0 && (
        <RunnerSec title="Don’t">
          {test.cautions.map((c: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: space[2] }}>
              <T size={font.body} faint>•</T>
              <T size={font.body} dim style={{ flex: 1 }}>{c}</T>
            </View>
          ))}
        </RunnerSec>
      )}

      <RunnerSec title="Result">
        <Field label="Date" style={{ marginBottom: space[3] }}>
          <DayStepper value={date} max={todayIso()} onChange={setDate} />
        </Field>
        {test.metrics.map((m: any) => (
          <Field key={m.key} label={`${m.label} ${m.unit ? `(${m.unit})` : ''}`} style={{ marginBottom: space[3] }}>
            <NumInput value={vals[m.key] ?? ''} blank="" placeholder={m.hint || ''}
              onChange={(v: any) => setVals(prev => ({ ...prev, [m.key]: v }))} />
          </Field>
        ))}
        <View style={{ flexDirection: 'row', gap: space[2], justifyContent: 'flex-end' }}>
          <Btn kind="ghost" title="Cancel" onPress={onDone} />
          <Btn title="Save result" onPress={save} />
        </View>
      </RunnerSec>

      {test.interpretation && (
        <RunnerSec title="Reading the number">
          <T size={font.body}>{test.interpretation}</T>
        </RunnerSec>
      )}
    </View>
  )
}

/* -------------------------------------------------------------------- why */

const VERDICTS = [
  { key: 'all', label: 'All' },
  { key: 'supported', label: 'Supported' },
  { key: 'mixed', label: 'Mixed' },
  { key: 'refuted', label: 'Refuted' },
]
const VERDICT_LABEL: Record<string, string> = Object.fromEntries(VERDICTS.map(v => [v.key, v.label]))

const VERDICT_COLORS: Record<string, string> = {
  supported: colors.vizGood,
  mixed: colors.vizWarn,
  refuted: colors.vizCrit,
}

export function WhyTab({ plan }: { plan: any }) {
  const [filter, setFilter] = useState('all')
  const items = (plan?.evidence || []).filter((e: any) => filter === 'all' || e.verdict === filter)

  return (
    <>
      {plan?.exposureBudget && (
        <Blurb id="exposure-budget" title={plan.exposureBudget.title}>
          <T size={font.small} dim style={{ marginBottom: plan.exposureBudget.disagreement ? space[3] : 0 }}>
            {plan.exposureBudget.body}
          </T>
          {plan.exposureBudget.disagreement && (
            <Fold summary="Where my sources disagreed" headStyle={{ minHeight: 44 }} style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space[2] }}>
              <T size={font.small} dim style={{ marginTop: 6 }}>{plan.exposureBudget.disagreement}</T>
            </Fold>
          )}
        </Blurb>
      )}

      {plan?.reframe && (
        <Blurb id="reframe" title={plan.reframe.title}>
          <T size={font.small} dim>{plan.reframe.body}</T>
        </Blurb>
      )}

      {!(plan?.evidence || []).length && !plan?.exposureBudget && !plan?.reframe && (
        <Empty icon="FlaskConical">No evidence notes in this plan</Empty>
      )}

      {(plan?.evidence || []).length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] }}>
          {VERDICTS.map(f => (
            <Chip key={f.key} label={f.label} on={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </View>
      )}

      {items.map((e: any, i: number) => {
        const c = VERDICT_COLORS[e.verdict] || colors.inkDim
        return (
          <Card key={i}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2], marginBottom: space[2] }}>
              <View style={[st.badge, { borderColor: c }]}>
                <Icon name={VERDICT_ICONS[e.verdict]} size={12} color={c} />
                <T size={font.caption} color={c}>{VERDICT_LABEL[e.verdict] || e.verdict}</T>
              </View>
              <T size={font.body} weight={600} style={{ flex: 1 }}>{e.claim}</T>
            </View>
            <T size={font.body} dim>{e.reality}</T>
            {e.doThis && (
              <T size={font.body} style={{ marginTop: space[2] }}>
                <T size={font.body} weight={600}>So:</T>{` ${e.doThis}`}
              </T>
            )}
            {e.sources?.length > 0 && (
              <T size={font.caption} faint style={{ marginTop: space[2] }}>{e.sources.join(' · ')}</T>
            )}
          </Card>
        )
      })}
    </>
  )
}
const st = StyleSheet.create({
  ceiling: {
    marginTop: space[4], padding: space[4], backgroundColor: colors.panel2,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
  },
  runner: { marginTop: space[4], borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space[2] },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: space[1],
    borderWidth: 1, borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space[2],
  },
})
