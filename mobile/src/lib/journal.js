/*
 * The journal: what you did to yourself, and what it did to you.
 *
 * Replaced the coach check-in on 2026-09-15. That card was built around a
 * climbing block — how the fingers read, how the skin read, how long you have at
 * the gym — and the app stopped being about fingers two rewrites ago. This one
 * closely mirrors the WHOOP journal, so patterns can be found in the answers.
 *
 * IT CANNOT BE A SYNC, and that is settled rather than assumed. WHOOP's public
 * API has no journal, behaviour or survey endpoint at all — checked against their
 * live API reference on 2026-09-15 — and it is read-only for user data besides,
 * so there was never a version of this that pulled their answers across or pushed
 * ours back.
 *
 * WHICH IS THE BETTER OUTCOME. The journal's whole purpose is correlating a
 * behaviour against the next morning, and Bushido already caches recovery, HRV and
 * sleep — AND knows what the user trained, which WHOOP does not. So "your recovery is
 * eleven points lower after a drink" is answerable here, and "...and it is worse
 * again when you drank the night before a hard finger day" only is.
 *
 * THREE RULES.
 *
 * **Everything is off until the user turns it on.** Forty-two behaviours on screen is a
 * journal answered once. `tracked` is their list and starts empty.
 *
 * **The user can add their own**, and they are not second-class: a custom metric is the
 * same shape as a catalogued one and charts and correlates identically, and a
 * custom metric can be a slider (a 1–10 scale, say).
 *
 * **A correlation needs enough days to be one.** Two drinks and two hangovers is
 * a coincidence. Below `MIN_DAYS` on either side the answer is "not yet", said
 * out loud, rather than a number that will move by twenty points next week.
 */

import { isDone } from './store.js'

export const JOURNAL_KIND = 'journal'
export const journalId = (iso) => `journal-${iso}`

/* ------------------------------------------------------------- the entries */

export const journalFor = (entries = [], iso) =>
  entries.find(e => e?.kind === JOURNAL_KIND && !e.deleted && e.date === iso) || null

/** What the user answered on a day. `{}` when the user answered nothing. */
export const journalValues = (entries = [], iso) => journalFor(entries, iso)?.data?.values || {}

export const buildJournalEntry = (iso, values) => ({
  id: journalId(iso), kind: JOURNAL_KIND, date: iso, data: { values },
})

/* -------------------------------------------------------------- the fields */

/**
 * The full vocabulary: the plan's catalog plus anything the user invented.
 *
 * Custom metrics live in the LOG rather than in plan.json, because plan.json is
 * content the user edits in a file and these are made on a phone. One entry holds them
 * all, so they sync and merge per-id like everything else.
 */
export const CUSTOM_ID = 'journal-custom'

export const customMetrics = (entries = []) =>
  entries.find(e => e?.id === CUSTOM_ID && !e.deleted)?.data?.metrics || []

export const buildCustomEntry = (metrics) => ({
  id: CUSTOM_ID, kind: JOURNAL_KIND, date: null, data: { metrics },
})

export const newMetricKey = () => `x-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function allFields(plan, entries = []) {
  const cat = (plan?.journal?.behaviours || []).map(b => ({ ...b, custom: false }))
  const mine = customMetrics(entries).map(m => ({ ...m, custom: true }))
  return [...cat, ...mine]
}

export const fieldOf = (plan, entries, key) => allFields(plan, entries).find(f => f.key === key) || null

/**
 * Which fields the user has chosen to track, in catalog order.
 *
 * A custom metric is tracked by existing — the user made it on purpose, and making them
 * then switch it on would be asking the same question twice.
 */
export function trackedFields(plan, entries = [], tracked = []) {
  const on = new Set(tracked)
  return allFields(plan, entries).filter(f => f.custom || on.has(f.key))
}

/**
 * The fields to actually put on screen today.
 *
 * A field may hang off another (`when: 'alcohol'` — how many drinks is not a
 * question until the user says the user drank). Same rule as the workout card's gates: an
 * unanswered parent hides its children, and hiding one drops its value on save.
 */
export function visibleFields(fields, values = {}) {
  return fields.filter(f => !f.when || Boolean(values[f.when]))
}

export function pruneJournal(fields, values = {}) {
  const next = { ...values }
  for (const f of fields) {
    if (f.when && !next[f.when]) delete next[f.key]
  }
  return next
}

/* ------------------------------------------------------------ correlation */

/** Below this on either side it is a coincidence, not a pattern. */
export const MIN_DAYS = 4

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

/**
 * Was this field "on" for a day? Three shapes, one question.
 *
 * A toggle is itself. A slider or number splits at its own midpoint, so "did a
 * high-stress day cost me" is answerable without them having to decide in advance
 * what counts as high — and the split is reported, because a threshold nobody
 * can see is a finding nobody can check.
 */
export function splitPoint(field) {
  if (field.type === 'toggle') return null
  const lo = num(field.min) ?? 0
  const hi = num(field.max) ?? 10
  return (lo + hi) / 2
}

function isOn(field, value) {
  if (value === undefined || value === null || value === '') return null
  if (field.type === 'toggle') return Boolean(value)
  const n = num(value)
  if (n === null) return null
  return n > splitPoint(field)
}

/**
 * How a behaviour reads against the NEXT MORNING's recovery.
 *
 * Next morning, not the same day, and that is the whole point: what the user did on
 * Tuesday shows up in Wednesday's recovery score, because the score is computed
 * off the night's sleep. Comparing a Tuesday behaviour with Tuesday's recovery
 * would be comparing it with the morning BEFORE it happened.
 *
 * `recoveryByDate` is `{ iso: score }` — built from the WHOOP cache by the caller,
 * so this stays pure and testable.
 */
export function correlate({ plan, entries = [], tracked = [], recoveryByDate = {}, metric = 'recovery' }) {
  const fields = trackedFields(plan, entries, tracked)
  const journals = entries.filter(e => e?.kind === JOURNAL_KIND && !e.deleted && e.date)

  const out = []
  for (const f of fields) {
    if (f.type === 'text') continue      // a note does not correlate
    const on = []; const off = []
    for (const j of journals) {
      const state = isOn(f, j.data?.values?.[f.key])
      if (state === null) continue
      const next = nextDay(j.date)
      const score = num(recoveryByDate[next])
      if (score === null) continue
      ;(state ? on : off).push(score)
    }
    const a = mean(on); const b = mean(off)
    const enough = on.length >= MIN_DAYS && off.length >= MIN_DAYS
    out.push({
      field: f,
      metric,
      on: { n: on.length, mean: a === null ? null : Math.round(a * 10) / 10 },
      off: { n: off.length, mean: b === null ? null : Math.round(b * 10) / 10 },
      delta: enough ? Math.round((a - b) * 10) / 10 : null,
      enough,
      split: splitPoint(f),
      // How many more days of the thinner side it needs before it says anything.
      needs: enough ? 0 : Math.max(MIN_DAYS - on.length, MIN_DAYS - off.length, 0),
    })
  }

  // Biggest effect first, and only among the ones that have earned an answer.
  return out.sort((x, y) => {
    if (x.enough !== y.enough) return x.enough ? -1 : 1
    return Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0)
  })
}

function nextDay(iso) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** `{ iso: recoveryScore }` out of the WHOOP cache. */
export function recoveryIndex(whoop) {
  const out = {}
  for (const r of (whoop?.recovery || [])) {
    const score = num(r?.recovery ?? r?.score ?? r?.recoveryScore)
    if (r?.date && score !== null) out[r.date] = score
  }
  return out
}

/* ------------------------------------------------------------------ streak */

/** How many of the last `days` the user actually journalled. The honest adherence number. */
export function journalStreak(entries = [], iso, days = 14) {
  const have = new Set(entries
    .filter(e => e?.kind === JOURNAL_KIND && !e.deleted && e.date &&
      Object.keys(e.data?.values || {}).length)
    .map(e => e.date))
  let n = 0
  let d = iso
  for (let i = 0; i < days; i++) {
    if (have.has(d)) n++
    const x = new Date(`${d}T12:00:00`)
    x.setDate(x.getDate() - 1)
    d = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  }
  return { filled: n, of: days }
}

export { isDone }
