// The plan's tests and the evidence behind it: the profile's Testing and Why
// sections, the twin of app/src/testing.jsx. Moved out of tabs.tsx unchanged
// (2026-10-25, docs/DESIGN.md "Wave 2: who owns which file").
import React, { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { colors } from '../theme'
import { T } from '../ui/Text'
import { Btn, Card, Chip, Field, H2 } from '../ui/kit'
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

/* ---------------------------------------------------------------- testing */

export function TestingTab({ plan, entries = [], upsertEntry }: { plan: any; entries?: any[]; upsertEntry: (e: any) => void; deleteEntry?: (id: string) => void }) {
  const [active, setActive] = useState<string | null>(null)
  const tests = plan?.tests || []

  // The starter content has no benchmark tests; a plan that defines some fills this in.
  if (!tests.length && !(plan?.testingNotes || []).length) {
    return (
      <Card>
        <H2>No tests in this plan</H2>
        <T size={13} dim>
          Benchmark tests come from the training plan. The example plan in Settings has six.
        </T>
      </Card>
    )
  }

  return (
    <>
      {(plan?.testingNotes || []).map((n: any, i: number) => (
        <Blurb key={i} id={`testnote-${i}`} title={n.title}>
          <T size={13} dim>{n.body}</T>
        </Blurb>
      ))}

      {tests.map((t: any) => {
        const results = entries
          .filter(e => e.kind === 'test' && e.data?.testId === t.id)
          .sort((a, b) => a.date.localeCompare(b.date))
        return (
          <Card key={t.id}>
            <H2>{t.name}</H2>
            <T size={13} dim style={{ marginBottom: 14 }}>{t.why}</T>

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

            <Btn kind="ghost" style={{ marginTop: 10 }} title={active === t.id ? 'close' : 'run this test'}
              onPress={() => setActive(active === t.id ? null : t.id)} />

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
    <View style={{ flexDirection: 'row', gap: 14 }}>
      <T size={12} faint style={{ width: 96, paddingTop: 2 }}>{dt}</T>
      <T size={13} style={{ flex: 1 }}>{children}</T>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <Icon name="Gauge" size={14} color={colors.inkFaint} />
        <T size={11} caps faint style={{ flex: 1 }}>Your sub-threshold ceiling</T>
        <T size={11} faint>{`tested ${c.date}`}</T>
      </View>

      <View style={{ flexDirection: 'row', gap: 22, flexWrap: 'wrap', marginBottom: 14 }}>
        <View style={{ gap: 2 }}>
          <T size={30} weight={700} lineHeight={32} tabular>{String(round(c.ceiling))}</T>
          <T size={11} faint>kg ceiling</T>
        </View>
        <View style={{ gap: 2 }}>
          <T size={30} weight={700} lineHeight={32} tabular color={colors.accent}>{String(round(c.ceiling - 2))}</T>
          <T size={11} faint>kg — unilateral target</T>
        </View>
      </View>

      <View style={{ gap: 8 }}>
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

/** .runner-sec: a small-caps heading and its body. */
function RunnerSec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <T size={12} caps faint style={{ marginBottom: 7 }}>{title}</T>
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
        <T size={14}>{test.equipment}</T>
      </RunnerSec>

      <RunnerSec title="Procedure">
        <View style={{ gap: 7 }}>
          {test.procedure.map((s: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 6 }}>
              <T size={14} dim tabular style={{ width: 18 }}>{`${i + 1}.`}</T>
              <T size={14} style={{ flex: 1 }}>{s}</T>
            </View>
          ))}
        </View>
      </RunnerSec>

      {test.cautions?.length > 0 && (
        <RunnerSec title="Don't">
          {test.cautions.map((c: string, i: number) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <T size={14} faint>•</T>
              <T size={14} dim style={{ flex: 1 }}>{c}</T>
            </View>
          ))}
        </RunnerSec>
      )}

      <RunnerSec title="Result">
        <Field label="Date" style={{ marginBottom: 10 }}>
          <DayStepper value={date} max={todayIso()} onChange={setDate} />
        </Field>
        {test.metrics.map((m: any) => (
          <Field key={m.key} label={`${m.label} ${m.unit ? `(${m.unit})` : ''}`} style={{ marginBottom: 10 }}>
            <NumInput value={vals[m.key] ?? ''} blank="" placeholder={m.hint || ''}
              onChange={(v: any) => setVals(prev => ({ ...prev, [m.key]: v }))} />
          </Field>
        ))}
        <Btn title="Save result" onPress={save} />
      </RunnerSec>

      {test.interpretation && (
        <RunnerSec title="Reading the number">
          <T size={14}>{test.interpretation}</T>
        </RunnerSec>
      )}
    </View>
  )
}

/* -------------------------------------------------------------------- why */

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
          <T size={13} dim style={{ marginBottom: plan.exposureBudget.disagreement ? 12 : 0 }}>
            {plan.exposureBudget.body}
          </T>
          {plan.exposureBudget.disagreement && (
            <Fold summary="Where my sources disagreed" style={{ borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 }}>
              <T size={13} dim style={{ marginTop: 6 }}>{plan.exposureBudget.disagreement}</T>
            </Fold>
          )}
        </Blurb>
      )}

      {plan?.reframe && (
        <Blurb id="reframe" title={plan.reframe.title}>
          <T size={13} dim>{plan.reframe.body}</T>
        </Blurb>
      )}

      <Card>
        <H2>What the evidence actually says</H2>
        <T size={13} dim style={{ marginBottom: items.length ? 0 : 12 }}>
          Every claim below was checked against primary sources, and the shaky ones were handed to agents whose
          job was to refute them. Where the honest answer is &ldquo;nobody knows,&rdquo; it says so.
        </T>
        {!items.length && (
          <T size={13} dim>
            {'The standalone evidence index was removed on 2026-09-14 with the rest of the dated block. Nothing was lost: every session still carries its own graded '}
            <T size={13} weight={600} color={colors.ink}>transfer</T>
            {' and '}
            <T size={13} weight={600} color={colors.ink}>summary</T>
            {', which is where these claims were actually read. Open any session and expand '}
            <T size={13} dim style={{ fontStyle: 'italic' }}>the evidence</T>
            {'.'}
          </T>
        )}
      </Card>

      {items.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {['all', 'supported', 'mixed', 'refuted'].map(f => (
            <Chip key={f} label={f} on={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
      )}

      {items.map((e: any, i: number) => {
        const c = VERDICT_COLORS[e.verdict] || colors.inkDim
        return (
          <Card key={i}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 7 }}>
              <View style={[st.badge, { borderColor: c }]}>
                <Icon name={VERDICT_ICONS[e.verdict]} size={12} color={c} />
                <T size={10} caps color={c} lineHeight={13}>{e.verdict}</T>
              </View>
              <T size={14} weight={600} style={{ flex: 1 }}>{e.claim}</T>
            </View>
            <T size={14} dim>{e.reality}</T>
            {e.doThis && (
              <T size={14} style={{ marginTop: 9 }}>
                <T size={14} weight={600}>So:</T>{` ${e.doThis}`}
              </T>
            )}
            {e.sources?.length > 0 && (
              <T size={12} faint style={{ marginTop: 9 }}>{e.sources.join(' · ')}</T>
            )}
          </Card>
        )
      })}
    </>
  )
}
const st = StyleSheet.create({
  ceiling: {
    marginTop: 14, padding: 14, backgroundColor: colors.panel2,
    borderWidth: 1, borderColor: colors.line, borderLeftWidth: 3, borderLeftColor: colors.series3, borderRadius: 9,
  },
  runner: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderRadius: 4, paddingVertical: 3, paddingHorizontal: 7,
  },
})
