/*
 * The daily check-in — the pure half.
 *
 * The check-in replaced the quick log on 2026-08-13. The quick log took two
 * things (bodyweight, a one-line note) and did nothing with either; this takes
 * the same numbers plus a conversation with the coach, and the conversation can
 * change what the day recommends.
 *
 * One entry per day, id `checkin-<date>`, so it merges last-write-wins like
 * everything else and two devices cannot fork the thread:
 *
 *   {
 *     kind: 'checkin', date: '2026-08-13',
 *     data: {
 *       fields:   { weightLb: 150, feeling: 7, sleep: 5, fingers: 2, minutes: 45, where: 'home' },
 *       messages: [
 *         { role: 'you',   text: "can't get to the gym tonight", at: '...' },
 *         { role: 'coach', text: '...', at: '...', model: 'claude-sonnet-5',
 *           applied: [{ optId: 'crawls', points: 12, why: '...' }] },
 *       ],
 *     },
 *   }
 *
 * Three rules live here rather than in the component:
 *
 * 1. THE FIELDS ARE CONTENT. They come from `plan.json` → `checkin.fields`, the
 *    same field types the session logs use, so what the coach asks for can be
 *    revised with no rebuild. DEFAULT_FIELDS exists only for the case where the
 *    plan has not loaded — the app has to work in a basement with a dead link.
 *
 * 2. BODYWEIGHT IS STILL A SERIES. A field declaring `writes: 'bodyweight'`
 *    mirrors into an ordinary `bodyweight` entry, because six months of chart
 *    must not care that the form around it changed. It is keyed by date, so
 *    correcting the number re-writes the day rather than adding a second point.
 *
 * 3. THE MESSAGE IS WRITTEN BEFORE THE REPLY IS ASKED FOR. What the user typed is a
 *    training note whether or not a model was reachable — losing "can't train
 *    today, going Sunday" because the tailnet was down is the one failure that
 *    would make them stop using it.
 *
 * 4. THE FIELDS ARE FACTS, NOT DECORATION. A field declaring `informs` feeds the
 *    recommendation engine directly — `venue` says where the user actually is, `window`
 *    how long the user actually has, `fingers` how they read right now. See dayFacts()
 *    below and the venue/window blocks in lib/recommend.js. For the first two
 *    weeks these fields were collected, shown to the coach and then ignored by
 *    the engine, so the day list cheerfully led with a 75-minute gym session on
 *    an evening the user had told it the user was at home with fifty minutes. Collecting an
 *    answer and then not using it is worse than not asking.
 */

import { localIso } from './dates.js'

export const CHECKIN_VERSION = 1

/** Only used when plan.json has not loaded. The plan is the real definition. */
export const DEFAULT_FIELDS = [
  { key: 'weightLb', type: 'number', label: 'Bodyweight', unit: 'lb', hint: '150', writes: 'bodyweight', optional: true },
  { key: 'feeling', type: 'slider', label: 'How you feel today', min: 1, max: 10, step: 1, default: 6, optional: true,
    scale: ['1 wrecked', '6 fine', '10 flying'] },
]

export const checkinId = (iso) => `checkin-${iso}`

/** The fields to ask for. Content first, code only as the offline fallback. */
export function checkinFields(plan) {
  const fields = plan?.checkin?.fields
  return Array.isArray(fields) && fields.length ? fields : DEFAULT_FIELDS
}

export function checkinFor(entries, iso) {
  return (entries || []).find(e => e.kind === 'checkin' && !e.deleted && e.date === iso) || null
}

/**
 * The thread, oldest first, junk dropped.
 *
 * Every message carries `i`, its index in the STORED array rather than in this
 * filtered one. Taking a suggestion has to write back to the message that
 * offered it, and a dropped junk message between them would otherwise shift
 * every index after it and mark the wrong one.
 */
export function messagesOf(entry) {
  return (entry?.data?.messages || [])
    .map((m, i) => ({ m, i }))
    // A turn that never got an answer has no text and still has to render — it
    // is how the thread says "this one did not go through", and losing it would
    // make a failed send look like one that worked.
    .filter(({ m }) => m && ((typeof m.text === 'string' && m.text.trim()) || m.failed))
    .map(({ m, i }) => ({
      i,
      role: m.role === 'coach' ? 'coach' : 'you',
      text: typeof m.text === 'string' ? m.text : '',
      at: typeof m.at === 'string' ? m.at : null,
      model: typeof m.model === 'string' ? m.model : null,
      applied: Array.isArray(m.applied) ? m.applied.filter(a => a && a.optId) : [],
      // The sessions the coach put forward, and — once the user has tapped one — what
      // that tap did, so it can be undone. They live on the message that offered
      // them, so the thread records both halves: what the user was offered, and which
      // of it the user took.
      suggested: (Array.isArray(m.suggested) ? m.suggested : [])
        .filter(s => s && s.optId && PLACEMENT_ACTIONS.includes(s.action))
        .map(s => ({ ...s, taken: s.taken?.action ? s.taken : null })),
      failed: Boolean(m.failed),
    }))
}

/**
 * What a suggestion turns into when the user taps one of its buttons.
 *
 * `main` swaps which session today IS, `add` puts an extra alongside it, and
 * `remove` takes one off — the same three things the day list does when you tap
 * it, writing the same entries with the same ids.
 *
 * The coach never performs one. It names a session and says why; the card draws
 * the buttons; nothing touches the day until the user presses one. That is the
 * whole safety argument now, and it is a much shorter one than gating a model:
 * a suggestion is a sentence, and every change to the log is still their tap.
 * `action` is only which button the coach thinks is the answer — the card offers
 * the others anyway, because it is their day.
 */
export const PLACEMENT_ACTIONS = ['main', 'add', 'remove']

/**
 * Record that the user took a suggestion, or put it back.
 *
 * `taken` carries what the tap displaced, which is the only thing an undo needs:
 * `prevOptId` for a swap, the `slot` a removed session was in. Undoing clears it
 * and leaves the suggestion sitting there to be taken again — the offer did not
 * stop being an offer because the user changed their mind about it.
 */
export function withTaken(entry, iso, messageIndex, suggestionIndex, taken) {
  const messages = (entry?.data?.messages || []).map((m, i) => {
    if (i !== messageIndex || !Array.isArray(m?.suggested)) return m
    return {
      ...m,
      suggested: m.suggested.map((s, j) => (j === suggestionIndex ? { ...s, taken: taken || null } : s)),
    }
  })
  return {
    id: checkinId(iso),
    kind: 'checkin',
    date: iso,
    data: { ...(entry?.data || {}), version: CHECKIN_VERSION, messages },
  }
}

export const fieldsOf = (entry) => entry?.data?.fields || {}

/**
 * The day's hard facts, in the vocabulary the recommender speaks.
 *
 * Which field means what is CONTENT, not code: a check-in field declares
 * `informs: 'venue' | 'window' | 'fingers'` in plan.json, exactly the way the
 * bodyweight field declares `writes: 'bodyweight'`. So the form can be rewritten
 * — renamed keys, new options, a field dropped — without the engine learning a
 * thing, and a plan that declares none of them leaves the engine computing
 * precisely what it computed before this existed.
 *
 * - `venue` is where the user IS. The option's own `value` is the venue string, so it
 *   is matched straight against each session's `sched.venue` and a plan that
 *   adds a "crag" option needs no code change to go with it.
 * - `window` is the minutes the user has, total, for the whole day.
 * - `fingers` is how they read RIGHT NOW, on the plan's 1–5 scale. It is more
 *   current than the worst reading of the last two logged sessions, so it wins.
 *
 * Everything is optional and every field is skippable, so every value here can
 * be null and the caller has to behave exactly as it did before when they are.
 */
export function dayFacts({ plan, entries, iso }) {
  const defs = checkinFields(plan)
  const fields = fieldsOf(checkinFor(entries, iso))
  const value = (informs) => {
    const def = defs.find(f => f.informs === informs)
    return def ? fields[def.key] : undefined
  }

  const venue = value('venue')
  const window = Number(value('window'))
  const fingers = Number(value('fingers'))

  return {
    venue: typeof venue === 'string' && venue.trim() ? venue.trim() : null,
    window: Number.isFinite(window) && window > 0 ? Math.round(window) : null,
    fingers: Number.isFinite(fingers) && fingers > 0 ? Math.round(fingers) : null,
  }
}

/**
 * How a venue reads inside a sentence: "at home", "at the gym", "away".
 *
 * Content, like everything else here — each option in the `informs: 'venue'`
 * field carries its own `phrase`, because gluing a label into prose produces
 * "you're gym tonight". The fallback covers venues no option names at all (the
 * crag), and reads correctly for those because they are places rather than
 * states.
 */
export function venuePhrase(plan, venue) {
  const def = checkinFields(plan).find(f => f.informs === 'venue')
  const hit = (def?.options || []).find(o => o.value === venue)
  return hit?.phrase || (venue ? `at the ${venue}` : '')
}

/**
 * The one-line readout under the card's title — what the coach already knows
 * about today without opening anything.
 */
export function summarise(fields, defs) {
  const bits = []
  for (const f of defs || []) {
    const v = fields?.[f.key]
    if (v === undefined || v === null || v === '') continue
    if (f.type === 'choice') {
      const label = (f.options || []).find(o => o.value === v)?.label
      if (label) bits.push(label.toLowerCase())
      continue
    }
    if (f.type === 'toggle') { if (v) bits.push(f.label.toLowerCase()); continue }
    if (f.type === 'slider') { bits.push(`${shortLabel(f)} ${v}/${f.max}`); continue }
    bits.push(`${v}${f.unit ? ` ${f.unit}` : ''}`)
  }
  return bits
}

/** "How you feel today" -> "feel". Sliders need a word, not a sentence. */
function shortLabel(field) {
  const words = String(field.label || field.key).toLowerCase().split(/\s+/)
  return words.find(w => !['how', 'you', 'your', 'the', 'today', 'right', 'now'].includes(w)) || words[0]
}

/** "150 lb · feel 6/10 · 2 messages" — a check-in, in one line of history. */
export function checkinLine(entry, plan) {
  const said = messagesOf(entry).filter(m => m.text)
  const bits = summarise(fieldsOf(entry), checkinFields(plan))
  if (said.length) bits.push(`${said.length} message${said.length === 1 ? '' : 's'}`)
  return bits.join(' · ') || 'nothing filled in'
}

/**
 * The entry to write for a set of field values. Whatever else changed, the
 * thread is preserved — a slider drag must never eat the conversation.
 */
export function withFields(entry, iso, fields) {
  return {
    id: checkinId(iso),
    kind: 'checkin',
    date: iso,
    data: { ...(entry?.data || {}), version: CHECKIN_VERSION, fields },
  }
}

/** The entry to write for one more message on the thread. */
export function withMessage(entry, iso, message) {
  const prior = entry?.data?.messages || []
  return {
    id: checkinId(iso),
    kind: 'checkin',
    date: iso,
    data: {
      ...(entry?.data || {}),
      version: CHECKIN_VERSION,
      fields: entry?.data?.fields || {},
      messages: [...prior, { at: new Date().toISOString(), ...message }],
    },
  }
}

/**
 * Bodyweight, mirrored out to the series it has always lived in.
 *
 * Returns null when there is nothing to write, so the caller can keep the same
 * shape whether or not the plan declares a bodyweight field.
 */
export function bodyweightEntry(fields, defs, iso) {
  const def = (defs || []).find(f => f.writes === 'bodyweight')
  if (!def) return null
  const lb = Number(fields?.[def.key])
  if (!Number.isFinite(lb) || lb <= 0) return null
  return { id: `bodyweight-${iso}`, kind: 'bodyweight', date: iso, data: { lb } }
}

/**
 * What the app already believes about today, sent along with the message.
 *
 * The coach is given the screen the user is looking at rather than being asked to
 * recompute it: the recommendation is the app's, the reasons are the app's, and
 * a coach arguing with a recommendation it guessed at would be worse than no
 * coach. It is context for the prompt and nothing else — nothing here is
 * trusted, because the reply's only power is a capped nudge.
 */
export function dayContext({ rec, mainEntry, extraEntries = [], menu = [], iso = localIso(), facts = null }) {
  const name = (id) => menu.find(m => m.id === id)?.name || id
  const onDay = [mainEntry, ...extraEntries].filter(Boolean).map(e => ({
    optId: e.data?.optId || null,
    name: e.data?.name || name(e.data?.optId),
    slot: e.data?.slot === 'extra' ? 'extra' : 'main',
    done: e.data?.done !== false,
  }))
  return {
    iso,
    // The same three facts the engine is scoring with. A coach that proposes a
    // gym session into an evening the engine has already ruled out would have
    // its placement refused, and would then have to explain a refusal it could
    // have seen coming.
    facts: facts || undefined,
    recommended: rec?.opt ? { optId: rec.opt.id, name: rec.opt.name, minutes: rec.opt.minutes } : null,
    why: rec?.why || null,
    // The engine's own arithmetic, so the coach argues with the reasoning rather
    // than with the answer. Every term already carries the sentence that
    // justifies it — that is the whole convention this leans on.
    reasons: (rec?.reasons || [])
      .filter(r => r?.text)
      .slice(0, 10)
      .map(r => `${r.points > 0 ? '+' : ''}${r.points}: ${r.text}`),
    displaced: rec?.displaced?.opt
      ? { optId: rec.displaced.opt.id, name: rec.displaced.opt.name, why: rec.displaced.why }
      : null,
    onDay,
  }
}
