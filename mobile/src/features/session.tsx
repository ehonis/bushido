/*
 * The session view (app/src/session.jsx): what you actually follow mid-session.
 *
 * Four things make this different from a description. It opens on THE MOVES — a
 * picture and four short steps per exercise — because the prose sections below
 * were not landing. Loads are resolved into POUNDS ON THE BAR from your logged
 * max, since "80% of MVC-7" is useless standing under the board. The interval
 * blocks state their interval in plain text. And the protocol is split into named
 * sections shown ONE AT A TIME: a twelve-step wall of text is the thing people
 * stop reading halfway through.
 */
import React, { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { colors, mix } from '../theme'
import { T } from '../ui/Text'
import { Btn, Press } from '../ui/kit'
import { Fold } from '../ui/Fold'
import { Icon } from '../lib/icons'
import { MovesList, hasMoves } from './howto'
import { resolveCeiling, CF_CORRECTION_KG } from '../lib/force.js'
import { blockTimers } from '../lib/workout.js'

/** Latest usable max, expressed as TOTAL load on the fingers (bodyweight + added). */
export function resolveMax(entries: any[]) {
  const bw = [...entries].filter(e => e.kind === 'bodyweight')
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.data?.lb

  const test = [...entries].filter(e => e.kind === 'test' && e.data?.testId === 'mvc7')
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  if (test && Number.isFinite(test.data.addedLb)) {
    const b = Number(test.data.bodyweightLb) || bw
    if (b) return { total: Number(test.data.addedLb) + b, bodyweight: b, source: `MVC-7 test ${test.date}` }
  }

  const hang = [...entries].filter(e => e.kind === 'maxhang' && e.data?.edgeMm === 20)
    .sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  if (hang && bw) {
    return { total: Number(hang.data.addedLb) + bw, bodyweight: bw, source: `max hang ${hang.date}` }
  }
  return null
}

/** .load-unknown: an icon and a line saying what would turn this into a number. */
function LoadUnknown({ children }: { children: React.ReactNode }) {
  return (
    <View style={[st.load, st.loadUnknown]}>
      <Icon name="Info" size={14} color={colors.inkDim} style={{ marginTop: 2 }} />
      <T size={13} dim style={{ flex: 1 }}>{children}</T>
    </View>
  )
}

/** "hold 11.2 kg on the gauge" — the dose, resolved, with its offset applied. */
function CeilingLine({ spec, ceiling }: { spec: any; ceiling: any }) {
  if (!ceiling) {
    return (
      <LoadUnknown>
        <T size={13} weight={600} color={colors.ink}>Dosed against your critical force</T>
        {' — run the 4-min all-out test on the Testing tab and this turns into an actual number in kilograms.'}
      </LoadUnknown>
    )
  }
  const offset = Number(spec?.offset) || 0
  const target = Math.round((ceiling.ceiling + offset) * 10) / 10
  const pct = ceiling.mvc ? Math.round((target / ceiling.mvc) * 100) : null

  return (
    <View style={st.load}>
      <View style={st.loadMain}>
        <T size={12} faint tabular>target</T>
        <T size={17} weight={600} tabular>{`${target} kg on the gauge`}</T>
        {pct != null && <T size={12} faint tabular>{`${pct}% of that arm's max`}</T>}
      </View>
      <View style={st.loadHow}>
        <Icon name="Gauge" size={13} color={colors.inkDim} />
        <T size={13} dim>
          {'Ceiling '}
          <T size={13} weight={600} color={colors.accent} tabular>{`${Math.round(ceiling.ceiling * 10) / 10} kg`}</T>
          {offset ? ` ${offset < 0 ? '−' : '+'} ${Math.abs(offset)} kg` : ''}
        </T>
        <T size={11} faint>
          {ceiling.bound === 'cfmin'
            ? `CFmin from ${ceiling.date}`
            : `CF ${ceiling.cf} kg − ${CF_CORRECTION_KG}, tested ${ceiling.date}`}
        </T>
      </View>
    </View>
  )
}

/** "hang 138 lb → take 38 lb off with the pulley" */
function LoadLine({ pct, max }: { pct: number | null | undefined; max: any }) {
  if (pct == null) return null
  if (!max) {
    return (
      <LoadUnknown>
        <T size={13} weight={600} color={colors.ink}>{`${pct}% of max`}</T>
        {' — log an MVC-7 result and this turns into actual pounds.'}
      </LoadUnknown>
    )
  }
  const target = Math.round((pct / 100) * max.total)
  const delta = Math.round(target - max.bodyweight)
  const strong = (s: string) => <T size={13} weight={600} color={colors.accent} tabular>{s}</T>
  return (
    <View style={st.load}>
      <View style={st.loadMain}>
        <T size={12} faint tabular>{`${pct}%`}</T>
        <T size={17} weight={600} tabular>{`${target} lb total on the fingers`}</T>
      </View>
      <View style={st.loadHow}>
        {delta > 1 && <>
          <Icon name="Dumbbell" size={13} color={colors.inkDim} />
          <T size={13} dim>{'Add '}{strong(`${delta} lb`)}{' to the harness'}</T>
        </>}
        {delta < -1 && <>
          <Icon name="Waves" size={13} color={colors.inkDim} />
          <T size={13} dim>{'Counterweight '}{strong(`${Math.abs(delta)} lb`)}{' off with the pulley'}</T>
        </>}
        {Math.abs(delta) <= 1 && <>
          <Icon name="Check" size={13} color={colors.inkDim} />
          <T size={13} dim>Bodyweight, no added load</T>
        </>}
        <T size={11} faint>{`from ${max.source}`}</T>
      </View>
    </View>
  )
}

/**
 * The interval spec as plain text, for reading the session rather than doing it
 * — workout mode is what actually runs the clock.
 *
 * Every part is optional, because the specs are genuinely different shapes: a max
 * hang is one 7-second rep with three minutes between sets, and rendering that as
 * "7s on / 0s off · up to 1 reps" is how you get prose nobody trusts.
 */
function TimingLine({ spec, label }: { spec: any; label: string | null }) {
  const cycles = spec.reps > 1 && spec.rest > 0
  const lead = cycles ? `${spec.work}s on / ${spec.rest}s off` : `${spec.work}s`
  const bits = [
    spec.reps > 1 ? `up to ${spec.reps} reps` : null,
    spec.sets > 1 ? `${spec.sets} sets` : null,
    spec.setRest > 0 ? `${Math.round(spec.setRest / 60)} min between sets` : null,
  ].filter(Boolean)

  return (
    <View style={st.timing}>
      <Icon name="Timer" size={13} color={colors.inkDim} />
      <T size={13} dim style={{ flex: 1 }}>
        {label ? `${label} — ` : null}
        <T size={13} color={colors.ink} tabular>{lead}</T>
        {bits.length ? ` · ${bits.join(' · ')}` : ''}
      </T>
    </View>
  )
}

/** The display name behind a timer's `exercise` key. */
function exerciseName(session: any, key: string) {
  return (session?.logSpec?.exercises || []).find((e: any) => e.key === key)?.name || null
}

/* ------------------------------------------------------------ step parsing */

/** Steps often already carry their own "3." — use it rather than double-numbering. */
const STEP_NUM = /^\s*(\d{1,2})\s*[.)]\s+/

/**
 * Many steps open with a shouted label — "COMMON ERROR #2:", "WHY THE LONG
 * RESTS:" — which is the most useful part of the step and the easiest to miss
 * inside a paragraph. Pull it out as a heading. Parenthesised asides are ignored
 * when judging whether the label is really a label.
 */
function splitLead(text: string) {
  const i = text.indexOf(':')
  if (i < 4 || i > 64) return { lead: null, body: text }
  const head = text.slice(0, i)
  const bare = head.replace(/\([^)]*\)/g, '')
  const letters = bare.replace(/[^A-Za-z]/g, '')
  if (letters.length < 4) return { lead: null, body: text }
  if (bare.replace(/[^A-Z]/g, '').length / letters.length < 0.7) return { lead: null, body: text }
  return { lead: head, body: text.slice(i + 1).trim() }
}

function Step({ text, index, stop }: { text: string; index: number; stop: boolean }) {
  const m = STEP_NUM.exec(text)
  const n = m ? m[1] : String(index + 1)
  const { lead, body } = splitLead(m ? text.slice(m[0].length) : text)
  return (
    <View style={st.step}>
      <View style={st.stepN}><T size={11} weight={700} color={colors.accent} tabular lineHeight={13}>{n}</T></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {lead && <T size={11} caps color={stop ? colors.vizCrit : colors.accent} style={{ marginBottom: 3 }}>{lead}</T>}
        <T size={14} lineHeight={22}>{body}</T>
      </View>
    </View>
  )
}

function Bullet({ text }: { text: string }) {
  const { lead, body } = splitLead(text)
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <T size={14} faint lineHeight={22}>•</T>
      <View style={{ flex: 1, minWidth: 0 }}>
        {lead && <T size={11} caps style={{ marginBottom: 3 }}>{lead}</T>}
        <T size={14} dim lineHeight={22}>{body}</T>
      </View>
    </View>
  )
}

/* -------------------------------------------------------------- sections */

/**
 * Split the protocol into named chunks, in the order you'd actually use them.
 *
 * "The moves" goes first and is what the view opens on. Everything after it is
 * context you may want; this is the part you are standing there executing.
 */
export function buildSections(session: any) {
  const pr = session?.protocol || {}
  const out: any[] = []
  if (hasMoves(session)) out.push({ key: 'moves', title: 'The moves', icon: 'PersonStanding', kind: 'moves', session })
  if (pr.setup?.length) out.push({ key: 'setup', title: 'Before you start', icon: 'ClipboardCheck', kind: 'bullets', items: pr.setup })
  if (pr.warmup?.length) out.push({ key: 'warmup', title: 'Warm-up', icon: 'Sunrise', kind: 'steps', items: pr.warmup })
  for (const [i, b] of ((pr.blocks || []) as any[]).entries()) {
    out.push({ key: `block-${i}`, title: b.name, icon: 'Dumbbell', kind: 'steps', items: b.steps || [],
      loadPct: b.loadPct, loadCeiling: b.loadCeiling, timers: (blockTimers as any)(b), session })
  }
  if (pr.cues?.length) out.push({ key: 'cues', title: 'Cues', icon: 'Target', kind: 'bullets', items: pr.cues })
  if (pr.stopIf?.length) out.push({ key: 'stop', title: 'Stop if', icon: 'TriangleAlert', kind: 'bullets', items: pr.stopIf, tone: 'stop' })
  if (pr.log?.length) out.push({ key: 'log', title: 'Log afterwards', icon: 'NotebookPen', kind: 'bullets', items: pr.log })
  return out
}

/** Short chip labels — "A · Board power-endurance" is too long for a chip. */
function chipLabel(section: any) {
  const t = section.title
  if (!t.includes('·')) return t.length > 22 ? `${t.slice(0, 20)}…` : t
  const [head, tail] = t.split('·').map((s: string) => s.trim())
  return tail.length > 18 ? head : `${head} · ${tail}`
}

export function SectionBody({ section, max, ceiling }: { section: any; max: any; ceiling: any }) {
  const stop = section.tone === 'stop'
  return (
    <View>
      <View style={st.sectTitle}>
        <Icon name={section.icon} size={14} color={stop ? colors.vizCrit : colors.inkFaint} />
        <T size={12} caps color={stop ? colors.vizCrit : colors.inkFaint} style={{ flex: 1 }}>{section.title}</T>
      </View>
      {section.loadPct != null && <LoadLine pct={section.loadPct} max={max} />}
      {section.loadCeiling && <CeilingLine spec={section.loadCeiling} ceiling={ceiling} />}
      {section.kind === 'moves' ? (
        <MovesList session={section.session} />
      ) : section.kind === 'steps' ? (
        <View style={{ gap: 9 }}>
          {section.items.map((s: string, i: number) => <Step key={i} text={s} index={i} stop={stop} />)}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {section.items.map((s: string, i: number) => <Bullet key={i} text={s} />)}
        </View>
      )}
      {section.timers?.map((t: any, i: number) => (
        // A block driving more than one exercise gets one line each, named, or
        // "10s on / 20s off" three times over reads like a mistake.
        <TimingLine key={i} spec={t}
          label={section.timers.length > 1 ? exerciseName(section.session, t.exercise) : null} />
      ))}
    </View>
  )
}

const GRADE_COLORS: Record<string, string> = {
  'rct': colors.vizGood,
  'controlled-trial': colors.vizGood,
  'observational': colors.vizWarn,
  'expert-consensus': colors.vizWarn,
  'coach-convention': colors.inkFaint,
  'unsupported': colors.inkFaint,
}

/** The evidence note, which is background rather than instruction. */
export function EvidenceNote({ evidence, open = false }: { evidence: any; open?: boolean }) {
  if (!evidence) return null
  const c = GRADE_COLORS[evidence.grade] || colors.inkDim
  return (
    <Fold
      open={open}
      style={st.evNote}
      headStyle={{ minHeight: 26 }}
      summary={(
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={[st.grade, { borderColor: c }]}>
            <T size={10} caps color={c} lineHeight={13}>{String(evidence.grade).replace(/-/g, ' ')}</T>
          </View>
          <T size={12} faint>why this is in the menu</T>
        </View>
      )}
    >
      <T size={13} dim style={{ marginTop: 8 }}>
        <T size={13} weight={600} color={colors.ink}>Transfer to climbing:</T>{` ${evidence.transfer}`}
      </T>
      <T size={13} dim style={{ marginTop: 8 }}>{evidence.summary}</T>
      {evidence.sources?.length > 0 && <T size={11} faint style={{ marginTop: 8 }}>{evidence.sources.join(' · ')}</T>}
    </Fold>
  )
}

/* ---------------------------------------------------------------- session */

/**
 * One section on screen at a time, picked from a chip row. `variant="full"`
 * adds prev/next stepping.
 */
export function SessionView({ session, entries, variant = 'compact', showEvidence = true }: {
  session: any
  entries: any[]
  variant?: 'compact' | 'full'
  showEvidence?: boolean
}) {
  const sections = buildSections(session)
  const [active, setActive] = useState(sections[0]?.key || null)
  const max = resolveMax(entries)
  const ceiling = (resolveCeiling as any)(entries)
  const pr = session?.protocol

  if (!pr) return <T size={13} dim>{session?.dose}</T>

  const idx = Math.max(0, sections.findIndex(s => s.key === active))
  const current = sections[idx]

  return (
    <View style={st.sess}>
      {pr.duration && (
        <View style={st.sessDur}>
          <Icon name="Timer" size={13} color={colors.inkFaint} />
          <T size={12} faint>{pr.duration}</T>
        </View>
      )}

      {showEvidence && <EvidenceNote evidence={session.evidence} />}

      {sections.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -2, marginBottom: 14, flexGrow: 0 }}
          contentContainerStyle={{ gap: 6, padding: 2 }}>
          {sections.map(s => {
            const on = s.key === current?.key
            const stop = s.tone === 'stop'
            return (
              <Press key={s.key} haptic onPress={() => setActive(s.key)}
                accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={[st.chip, on && {
                  borderColor: stop ? colors.vizCrit : colors.accent,
                  backgroundColor: mix(stop ? colors.vizCrit : colors.accent, 12, colors.panel2),
                }]}>
                <Icon name={s.icon} size={13} color={on ? colors.ink : colors.inkFaint} />
                <T size={12} weight={500} color={on ? colors.ink : colors.inkFaint}>{chipLabel(s)}</T>
              </Press>
            )
          })}
        </ScrollView>
      )}

      {current && <SectionBody section={current} max={max} ceiling={ceiling} />}

      {variant === 'full' && sections.length > 1 && (
        <View style={st.sectStep}>
          <Btn kind="ghost" flex icon="ChevronLeft" title="Back" disabled={idx === 0}
            onPress={() => setActive(sections[idx - 1].key)} />
          <T size={12} faint tabular>{`${idx + 1} / ${sections.length}`}</T>
          <Btn kind="ghost" flex title="Next" disabled={idx === sections.length - 1}
            onPress={() => setActive(sections[idx + 1].key)}>
            <Icon name="ChevronRight" size={16} color={colors.inkDim} />
          </Btn>
        </View>
      )}
    </View>
  )
}

const st = StyleSheet.create({
  sess: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  sessDur: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 14 },
  load: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    paddingVertical: 11, paddingHorizontal: 12, marginBottom: 12,
  },
  loadUnknown: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  loadMain: { flexDirection: 'row', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' },
  loadHow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  timing: {
    flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    paddingVertical: 9, paddingHorizontal: 11,
  },
  sectTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 11 },
  step: {
    flexDirection: 'row', gap: 11, alignItems: 'flex-start',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    paddingVertical: 11, paddingHorizontal: 12,
  },
  stepN: {
    width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: mix(colors.accent, 16, colors.panel),
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    paddingVertical: 7, paddingHorizontal: 12, minHeight: 36,
  },
  sectStep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  evNote: {
    marginBottom: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    paddingVertical: 9, paddingHorizontal: 11, backgroundColor: colors.panel2,
  },
  grade: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
})
