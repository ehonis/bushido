/*
 * The week planner — the agent the user plans their QUOTAS with.
 *
 * It is a mode on the plus screen for planning the week's quotas as a
 * back-and-forth conversation with the model.
 *
 * It is a third agent, beside the coach and the workout planner, and the
 * boundaries are the same shape as the workout planner's:
 *
 *   - It reads and writes nothing. `Read`, `Grep`, `Glob` only. The quota entry it
 *     is proposing is written by THEIR tap on "Set the week", through the same
 *     `upsertEntry` the Week tab's steppers use, and not before.
 *   - It is stateless on the box. The thread and the current draft go up on every
 *     turn and come back down with the reply, and both land on the quota entry
 *     when the user keeps it — the same place a prescription keeps its conversation.
 *   - It returns the WHOLE week each turn, not a patch, and says what it changed.
 *     A revision the user cannot see is the old coach's silent plan edit again.
 *
 * What it knows that the workout planner does not need to: what a quota IS in
 * this app (a count of WORKOUTS per category, Monday to Sunday, misses expire),
 * what the user has set and what the user has actually done in past weeks (`kind: 'quota'`
 * and `kind: 'daily'` entries in state.json), the two finger rules, and their own
 * statement that zone 2 volume is the bread and butter.
 */

const path = require('path')
const { spawn } = require('child_process')
const { who, speaker, notesSection } = require('./prompting.js')
const { plannerFlags } = require('./agentflags.js')

/* --------------------------------------------------------------- the schema */

/*
 * `counts` is a LIST of rows rather than a map, because a map with arbitrary keys
 * needs `additionalProperties` open and structured output wants it closed. The
 * server folds it into `{ category: count }` and drops anything that is not a real
 * category — see `toCounts`.
 */
const WEEK_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description: 'What you say to the athlete about the week: what it asks for and why, in a few short paragraphs. Markdown is fine. Name what you read. Do not restate their message.',
    },
    title: {
      type: 'string',
      description: 'Three to six words naming the week — "Bike-heavy, fingers light", "Easy volume, one hard ride". Not a sentence.',
    },
    counts: {
      type: 'array',
      description: 'THE WHOLE WEEK: one row per quota category that should be more than zero. A category you leave out is zero. Return every turn, even when you changed nothing.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'An exact key from the quota category list.' },
          count: { type: 'number', description: 'How many WORKOUTS of that category this week. Whole number, 0–14.' },
        },
        required: ['category', 'count'],
        additionalProperties: false,
      },
    },
    changed: {
      type: 'string',
      description: 'What you changed since the counts they sent you, in one or two sentences addressed to them. "Nothing — left as you had it" if so.',
    },
  },
  required: ['reply', 'counts', 'changed'],
  additionalProperties: false,
}

/* --------------------------------------------------------------- the prompt */

function categoryList(plan) {
  const cats = (plan?.quotaCategories || [])
    .map(c => `  ${c.key} — ${c.name}${c.fingerLoad ? ` [finger load: ${c.fingerLoad}]` : ''}: ${String(c.blurb || '').split('.')[0]}.`)
    .join('\n')
  return `QUOTA CATEGORIES — \`category\` must be one of these keys:\n${cats}\n`
}

function achievementList(plan) {
  const list = (plan?.achievements || [])
    .map(a => `  ${a.name}: ${(a.categories || []).join(', ')}${a.blurb ? ` — ${a.blurb}` : ''}`)
    .join('\n')
  return list ? `WHAT THE ATHLETE IS TRAINING FOR (the seeded achievements; their own edits are \`kind: 'achievement'\` entries in state.json):\n${list}\n` : ''
}

function systemPrompt({ repoRoot, dataDir, brainFile, today, plan, name, notes }) {
  const data = dataDir || `${repoRoot}/data`
  const rec = plan?.recommender || {}
  const cap = rec.hardCap ?? 3
  const gap = rec.hardMinGapDays ?? 2
  const N = who(name)
  const Cap = N[0].toUpperCase() + N.slice(1)
  return `You plan ONE WEEK of training quotas with ${who(name)}, inside Bushido, a self-hosted
training app. Today is ${today}.

WHAT A QUOTA IS HERE. The week runs Monday to Sunday. A quota is a COUNT OF WORKOUTS
in a category — "3 bike, 2 power endurance, 1 fingers" — and says nothing about which
day each lands on; ${N} decides that as the week goes. A day with a ride and a lift
fills two. Whatever is left on Sunday expires; nothing carries as debt. ${Cap} writes
the quotas and the app only ever offers, which is why nothing you return is stored
until they tap "Set the week".

THE CONTEXT BELOW ALREADY HOLDS THE LAST FEW WEEKS — what they set against what they did,
per category — so you can usually write the week from it plus one or two reads. You
have read-only tools and a budget of about two minutes; the log is a 200 KB JSON file,
so GREP it for what you need (\`"kind": "quota"\`, a date, an activity) rather than
reading it whole. In order of value:

- ${data}/state.json — the log. \`kind: 'quota'\` entries (id \`quota-<monday>\`,
  \`data.counts\`) are what they SET in past weeks; \`kind: 'daily'\` entries with
  \`data.done\` true are what they DID (\`data.optId\` names the card, \`data.out.activity\`
  the sport, \`data.out.category\` an override, \`data.plan.blocks[].category\` on a
  planned session). \`data.training: false\` is "just miles" — a commute or an errand on
  the bike. It is NOT a workout and fills no quota, so do not count one; the app does
  not. Compare set against done for the last three or four weeks: a quota they set
  and never fill is not a plan, it is a wish, and you should say so.
${brainFile ? `- ${brainFile} — the athlete profile, injury history, the hard rules and why they
  are stricter than the literature. Read it before touching the climbing categories.
` : ''}- ${data}/whoop.json — a fortnight of recovery, HRV, resting HR and strain.
  A run of low recoveries is a reason to keep the week easier, and to say so.
- ${data}/strava.json — recent rides, runs and swims with distance, time,
  heart rate and power. Weekly totals per sport are the honest read on their volume.

If a tool call is not going to change the week you write, do not make it.

RULES THAT ARE NOT YOURS TO BREAK

- At most ${cap} hard finger days in a week, and never two on consecutive days
  (${gap}-day minimum gap). The categories marked [finger load: hard] each cost one, and
  a "fun" session climbed hard costs one too. So power + power endurance + fingers
  together should sum to ${cap} at the very most, and two is what a normal week plans.
- Zone 2 and low-intensity volume are the bread and butter unless the athlete's
  notes say otherwise.
  Most of the swim, bike and run count should be easy sessions; at most one or two
  hard endurance sessions a week, and none in a week that is already heavy on
  hard climbing.
- Running is the discipline that punishes a jump in volume hardest. Raise the run
  quota by at most one over what they actually did recently.
- Never plan a week they have not been doing. A quota is a promise, and a week of
  fourteen workouts for someone who did seven last week is a week that fails on
  Wednesday. Start from what they DID, move it toward what they are training for, and
  keep the total honest.

HOW TO ANSWER

Return the WHOLE week in \`counts\` every turn. Change only what they asked for, or what
you can justify from something you read, and put the justification in \`reply\` — name
the evidence, grade your claims (what came off the log versus your inference), and
keep it short. ${Cap} will read \`reply\` and then look at the numbers; the numbers are the
answer and \`reply\` is why. If they ask for something that breaks a rule above, say
which rule and give them the nearest week that does not.

${notesSection(name, notes)}
${categoryList(plan)}
${achievementList(plan)}`
}

/**
 * Their side of the turn: the week, the draft as the user has it, the conversation, and
 * what the user just said.
 */
function userPrompt({ monday, counts = {}, message, thread = [], context, plan, name }) {
  const names = Object.fromEntries((plan?.quotaCategories || []).map(c => [c.key, c.name]))
  const rows = Object.entries(counts || {}).filter(([, n]) => Number(n) > 0)
  const draft = rows.length
    ? rows.map(([k, n]) => `  ${k} (${names[k] || k}): ${n}`).join('\n')
    : '  (nothing set yet)'
  const said = (thread || [])
    .slice(-10)
    .map(m => `${m.role === 'you' ? speaker(name) : 'You'}: ${m.text}`)
    .join('\n')
  return [
    `Week: Monday ${monday} to Sunday.`,
    context ? `What the app already knows:\n${context}` : '',
    `The quotas as they have them right now (your starting point — these numbers are theirs):\n${draft}`,
    said ? `What you have said to each other about this week so far:\n${said}` : '',
    `${speaker(name)} says:\n${message}`,
    '',
    'Return the whole week in `counts`, what you changed in `changed`, and why in `reply`.',
  ].filter(Boolean).join('\n\n')
}

/* ------------------------------------------------------------ the answer */

/**
 * The model's rows, folded into the map the app stores.
 *
 * Anything that is not a real category is dropped rather than kept as a key the
 * Week tab would never render: the model inventing "cardio" must not become a
 * quota nothing can fill. Counts are whole numbers, 0–14, and zero is dropped —
 * `quotaCounts` drops it on read anyway, and storing it would make "the user set bike to
 * zero" and "the user never mentioned bike" indistinguishable for no gain.
 */
function toCounts(rows, plan) {
  const keys = new Set((plan?.quotaCategories || []).map(c => c.key))
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = String(r?.category || '').trim()
    if (!keys.has(k)) continue
    const n = Math.round(Number(r?.count))
    if (!Number.isFinite(n) || n <= 0) continue
    out[k] = Math.min(14, n)
  }
  return out
}

/* ----------------------------------------------------------------- the turn */

/**
 * One turn. Read-only by flag, not by instruction — see the header.
 */
function planWeek({
  bin, model, effort, timeoutMs, repoRoot, dataDir, brainFile, today, plan,
  monday, counts, message, thread = [], context, name, notes, env,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [
      '--print',
      '--model', model,
      '--effort', effort,
      '--output-format', 'json',
      '--no-session-persistence',
      // Read-only; too-broad directories refused, secrets denied. See agentflags.js.
      ...plannerFlags({ repoRoot, dataDir: dataDir || path.join(repoRoot, 'data'), brainFile }).args,
      '--append-system-prompt', systemPrompt({ repoRoot, dataDir, brainFile, today, plan, name, notes }),
      '--json-schema', JSON.stringify(WEEK_SCHEMA),
    ], { cwd: repoRoot, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] })

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('the week planner took too long — try again, or ask for less at once'))
    }, timeoutMs)

    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`cannot run ${bin}: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        return reject(new Error(err.trim().split('\n').pop() || `claude exited ${code}`))
      }
      let doc
      try { doc = JSON.parse(out) } catch { return reject(new Error('the week planner did not return JSON')) }
      const built = doc.structured_output || safeParse(doc.result)
      if (!built || typeof built !== 'object' || !built.reply || !Array.isArray(built.counts)) {
        return reject(new Error('the week planner returned nothing usable'))
      }
      resolve({
        reply: String(built.reply).slice(0, 6000),
        title: String(built.title || '').slice(0, 80) || null,
        changed: String(built.changed || '').slice(0, 600) || null,
        counts: toCounts(built.counts, plan),
        model: doc.model || model,
        cost: doc.total_cost_usd ?? null,
      })
    })

    child.stdin.end(userPrompt({ monday, counts, message, thread, context, plan, name }))
  })
}

function safeParse(s) {
  try { return JSON.parse(String(s)) } catch { return null }
}

module.exports = { WEEK_SCHEMA, planWeek, systemPrompt, userPrompt, toCounts }
