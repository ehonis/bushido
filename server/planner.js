/*
 * The workout planner — the agent that writes a session before the user does it.
 *
 * Given a session type (legs, say), it takes how much time there is and what the
 * session should accomplish, combines that with what it already knows (previous
 * days' data, current health and vitals), and writes a workout that can be
 * followed set by set.
 *
 * It is a SEPARATE agent from `coach.js` and that is deliberate, for three
 * reasons rather than one:
 *
 *   1. Different output. The coach returns prose with optional offers; this
 *      returns a prescription with a strict schema, and the runner walks that
 *      schema set by set. Sharing one schema would make both worse.
 *   2. Different latency budget. The coach is a conversation the user is having; this
 *      is a button the user pressed while changing into gym shorts. It runs at low
 *      effort against Sonnet and it is told to stop researching and answer.
 *   3. Different write permissions. The coach may append a memory. This one
 *      writes NOTHING — it is `Read`, `Grep`, `Glob` and nothing else. A planner
 *      that can also edit files is a planner with a failure mode nobody asked
 *      for.
 *
 * It reads the same places the coach does: the brain file for who the user is, the log
 * for what the user actually did, the WHOOP cache for how the user slept. Those paths are in
 * the prompt rather than the payload, because "be thorough, go and look" is the
 * whole point — the alternative is handing it a digest and hoping the digest
 * contained the thing that mattered today.
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { who, speaker, notesSection } = require('./prompting.js')
const { plannerFlags } = require('./agentflags.js')

/* --------------------------------------------------------------- the schema */

/*
 * Every number is OPTIONAL rather than nullable.
 *
 * A lift set has reps and weight; a swim set has distance and a send-off; a plank
 * has seconds. One `sets` shape covers all three only if the fields it does not
 * need can simply be absent — and a schema that requires `weight: null` on a
 * swim is a schema the model fills in with 0, which then charts as a set lifted
 * with no load. `normalizePrescription` drops anything that arrives empty anyway.
 */
const SET = {
  type: 'object',
  properties: {
    reps: { type: 'number', description: 'Repetitions in this set.' },
    weight: { type: 'number', description: 'Load in POUNDS, in the units the implement implies — per hand for dumbbells, on the bar for a barbell, added weight for a weighted pull-up.' },
    seconds: { type: 'number', description: 'How long the work lasts, for holds, intervals and carries.' },
    distance: { type: 'number', description: 'Distance covered in this set, in `unit`.' },
    restSec: { type: 'number', description: 'Rest AFTER this set, in seconds. The runner counts it down.' },
    unit: { type: 'string', description: 'yd, m, mi or km. Use yd for a pool unless they swim metric.' },
    note: { type: 'string', description: 'Short cue for this set only — "last one, leave two in the tank".' },
  },
  additionalProperties: false,
}

const ITEM = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['lift', 'interval'], description: 'lift = a movement out of the exercise catalog. interval = anything else: a swim piece, a run rep, a bike block, a carry, a hold.' },
    name: { type: 'string', description: 'What it is called on screen. For a lift this is overwritten by the catalog name, so put the plain name here.' },
    exercise: { type: 'string', description: 'REQUIRED for kind=lift: an exact key from the exercise catalog listed below. An invented key loses the row its history.' },
    implement: { type: 'string', description: 'For kind=lift: an exact implement key from the list below — barbell, dumbbell, cable, machine, bodyweight…' },
    unit: { type: 'string', description: 'Default distance unit for every set in this item.' },
    note: { type: 'string', description: 'One line of technique or intent for this movement.' },
    sets: { type: 'array', items: SET, description: 'One entry per SET they will actually do. Three sets of eight is three entries, not one with reps=8.' },
  },
  required: ['kind', 'name', 'sets'],
  additionalProperties: false,
}

const BLOCK = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Warm-up, Main, Accessory, Cool-down — whatever the session actually has.' },
    note: { type: 'string', description: 'What this block is for, in one sentence. Anything without sets goes here rather than becoming an item.' },
    category: { type: 'string', description: 'Which quota category THIS BLOCK fills — exact key from the list below. A block with a category BECOMES ITS OWN WORKOUT on the day: a trip that is lifting then a run lands as a lift entry and a run entry, each with its own log and its own quota. A warm-up or cool-down that belongs to the block beside it must leave this out, or it becomes a third workout nobody did.' },
    activity: { type: 'string', description: 'The activity key for THIS BLOCK, from the list below — it decides what the block\'s own log form asks for. `run` on a run block, `lift` on a lifting block. Leave it out on a block with no category.' },
    items: { type: 'array', items: ITEM },
  },
  required: ['name', 'items'],
  additionalProperties: false,
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short and in their words — "Legs", "2,000 yd threshold", "Push day". Not a sentence.' },
    category: { type: 'string', description: 'The quota category key this fills. Exact key from the list below.' },
    activity: { type: 'string', description: 'The activity catalog key, which decides the log form. Exact key from the list below.' },
    focus: { type: 'string', description: 'What they said they wanted to accomplish, in a few words.' },
    minutes: { type: 'number', description: 'How long this will actually take, including rest. Must fit the budget they gave.' },
    why: { type: 'string', description: 'One short paragraph: why THIS session, today, given the log and the recovery. Name the evidence you read. If you are guessing, say so.' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Up to four short cues for the whole session.' },
    changed: { type: 'string', description: 'REVISIONS ONLY: what you changed and why, in one or two sentences, addressed to the athlete. Leave out on a first draft.' },
    blocks: { type: 'array', items: BLOCK },
  },
  required: ['title', 'minutes', 'why', 'blocks'],
  additionalProperties: false,
}

/**
 * The same schema, with `changed` REQUIRED.
 *
 * It was optional on both paths for one planning run and the model simply left it
 * out — which is the normal fate of an optional field whose absence costs the
 * model nothing. The screen then had a revision it could not describe, and "it
 * changed something, we are not sure what" is the exact failure this field exists
 * to prevent. A first draft still must not have it (there is nothing to have
 * changed), so the two paths get two schemas rather than one loose one.
 */
const REVISE_SCHEMA = {
  ...PLAN_SCHEMA,
  required: [...PLAN_SCHEMA.required, 'changed'],
}

/* --------------------------------------------------------------- the prompt */

/** The exercise catalog, compact, so it does not have to grep for a key. */
function liftCatalog(plan) {
  const field = liftField(plan)
  if (!field) return ''
  const byGroup = new Map()
  for (const ex of field.exercises || []) {
    const g = ex.group || 'Other'
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(ex.key)
  }
  const groups = [...byGroup.entries()]
    .map(([g, keys]) => `  ${g}: ${keys.join(', ')}`)
    .join('\n')
  const impls = (field.implements || []).map(i => `${i.value} (${i.label})`).join(', ')
  return `EXERCISE CATALOG — \`exercise\` must be one of these keys, exactly:\n${groups}\n\nIMPLEMENTS — \`implement\` must be one of these keys:\n  ${impls}\n`
}

const liftField = (plan) => {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'lifts') return f
  }
  return null
}

const activityField = (plan) => {
  for (const opt of plan?.dailyMenu || []) {
    for (const f of opt.outputs || []) if (f.type === 'activity') return f
  }
  return null
}

/** The activity keys, so `activity` resolves to a real form shape. */
function activityCatalog(plan) {
  const f = activityField(plan)
  if (!f) return ''
  const keys = (f.activities || []).map(a => `${a.key}`).join(', ')
  return `ACTIVITY KEYS — \`activity\` must be one of these, exactly:\n  ${keys}\n`
}

function categoryList(plan) {
  const cats = (plan?.quotaCategories || [])
    .map(c => `  ${c.key} — ${c.name}: ${String(c.blurb || '').split('.')[0]}.`)
    .join('\n')
  return `QUOTA CATEGORIES — \`category\` must be one of these keys:\n${cats}\n`
}

function systemPrompt({ repoRoot, dataDir, brainFile, today, plan, name, notes }) {
  const data = dataDir || `${repoRoot}/data`
  const N = who(name)
  const Cap = N[0].toUpperCase() + N.slice(1)
  return `You write ONE workout for ${N}, inside Bushido, a self-hosted training app.
Today is ${today}.

${Cap} has said what kind of session they want, how long they have, and what they
want out of it. Your job is to hand back a session they can walk straight into —
every set written down, every load a number, every rest a number.

GO AND LOOK FIRST. You have read-only tools and a budget of a couple of minutes.
In rough order of value:

- ${data}/state.json — the actual training log. What ${N} lifted last time
  for these movements, at what load, for how many reps, and how hard it felt
  (\`out.rpe\`) is the single most useful thing you can read. \`out.lifts\` is the
  per-exercise record; \`out.improve\` is the athlete saying what to change.
${brainFile ? `- ${brainFile} — the athlete profile: ability, diagnosed weaknesses, injury
  history, the gear actually owned, and the training rules that are stricter
  than the literature. Read it before you prescribe anything loaded.
` : ''}- ${data}/whoop.json — last night's recovery, HRV, sleep and strain.
  A red recovery is a reason to cut volume, and you should say so in \`why\`.
- ${data}/strava.json — recent rides and runs, if the session is one.

If a tool call is not going to change what you write, do not make it. ${Cap} is
standing in gym clothes waiting.

RULES THAT ARE NOT YOURS TO BREAK

- Prescribe only equipment the athlete's notes or profile say is available. If
  neither says, assume an ordinary gym and name what you assumed in \`why\`.
- Never prescribe a fourth hard finger day in a week, or a hard finger day the
  day after another. If what was asked for would be one, say so in \`why\` and
  write the session that CAN be done.
- Load comes from the log, not from a formula. If they benched 3×8 at 95 last week
  and it was an RPE 7, write 3×8 at 100 and say that is what you did. If you have
  no history for a movement, leave \`weight\` out entirely rather than inventing
  one — a blank box they fill in beats a number they confirm without reading.
- Fit the time budget including rest. Count it: sets × (work + rest). A
  forty-five minute session with 4 minutes of rest between 20 sets does not fit.

HOW TO WRITE IT

One entry in \`sets\` per set they will actually do — three sets of eight is three
entries. Put rest on the set it FOLLOWS. Anything without sets (a mobility flow,
"swim easy until you feel loose") belongs in the block's \`note\`, not as an item.

\`why\` is one short paragraph and it is the part ${N} will actually read. Name what
you looked at. Grade your claims: say which came off the log and which is your
inference. Do not open by restating what was asked for.

ENDURANCE SESSIONS — SWIM, BIKE, RUN

Zone 2 and low-intensity volume are the bread and butter of endurance training
unless the athlete's notes say otherwise. Roughly four endurance sessions in five
should be easy. Write a hard one only when the kind they picked IS hard (tempo,
threshold, VO2, hills, intervals) or when they ask for it, and even then keep the
warm-up and cool-down honest and easy.

- ZONES ARE THE ATHLETE'S, NOT A TABLE'S. Their max heart rate is in
  ${data}/whoop.json (\`maxHeartRate\`), and what they ACTUALLY held on recent
  rides and runs — heart rate, power, speed — is in ${data}/strava.json and
  on the log entries (\`out.whoop\`, \`out.strava\`). Zone 2 is roughly 60–70% of
  max heart rate, conversational the whole way; say the number you are using and say
  it is an estimate unless the notes give a lab-tested zone.
- A KIND THAT NAMES NO SPORT ("Zone 2", "Long & easy", "Tempo", "Brick"…) means YOU
  choose swim, bike or run. Choose from what the week still owes (in the context
  below), then from what they have NOT done in the last two days, then from what
  they said they want. Name the choice and the reason in \`why\`, set \`activity\`
  and \`category\` to match, and write the session in that sport's language.
- WRITE A RIDE OR RUN AS \`interval\` ITEMS: a warm-up piece, the main pieces, a
  cool-down piece. Every set has \`seconds\` (or \`distance\` + \`unit\`) and a \`note\`
  carrying the effort — a heart-rate band, an RPE, a cadence, a pace. Rest between
  intervals goes in \`restSec\` on the piece it follows. An easy ride is ONE long piece,
  not sixty one-minute pieces.
- WRITE A SWIM AS POOL SETS IN YARDS: \`distance\` + \`unit: "yd"\`, \`reps\` for a
  repeated set, and \`restSec\` for the rest at the wall. Include drills by name in
  the item's \`note\`. If the notes say swimming is new, technique pieces before hard pieces.
- A BRICK IS TWO BLOCKS — a bike block with \`category: "bike"\` and a run block with
  \`category: "run"\` — so it lands as two workouts the watch can attach to.
- RUNNING VOLUME IS WHAT INJURES RUNNERS FASTEST: no run longer than about a
  quarter more than the longest of the last three weeks, and say when you are
  holding it there on purpose.

EVERY BLOCK WITH A \`category\` BECOMES ITS OWN WORKOUT ON THE DAY. A gym trip that is
legs then twenty minutes running lands as TWO entries — a lift and a run — each with
its own log, its own quota and its own place for the watch to attach a measurement
to. So give a \`category\` and an \`activity\` to every block that is genuinely a
separate workout, and give neither to a warm-up, a cool-down or an accessory block
that belongs to the one beside it. Getting this wrong in either direction is worse
than coarse: a split warm-up is a workout nobody did, and a lift and a run pooled
into one entry is a ride the watch cannot find a home for.

${notesSection(name, notes)}
${categoryList(plan)}
${activityCatalog(plan)}
${liftCatalog(plan)}`
}

/**
 * What the user typed, plus the little the app knows for free.
 *
 * `kinds` is a LIST so one gym trip can be planned as several workouts at once,
 * without the user having to describe the extra ones to the model. A gym trip is
 * legs AND core AND ten minutes on the bike, and typing the second and third into
 * the goal box as prose was doing the picker's job by hand.
 *
 * ONE session, not three. The time budget is for the whole trip, and the blocks
 * are how the parts are kept apart — which is what `blocks` was always for.
 */
function userPrompt({ kinds = [], minutes, goal, context }) {
  const list = kinds.filter(Boolean)
  const head = list.length > 1
    ? [
        `Session: ONE gym trip covering all ${list.length} of these, in this order:`,
        ...list.map((k, i) => `  ${i + 1}. ${k}`),
        'Give each its own block. The time budget below is for the WHOLE trip, not for each —',
        'count it, and if they do not all fit say which you cut and why in `why` rather than',
        'writing a session that cannot be finished.',
      ].join('\n')
    : `Session: ${list[0] || 'a workout'}`

  return [
    head,
    `Time available: ${minutes} minutes`,
    goal ? `What they want out of it: ${goal}` : 'They did not say what they want out of it — pick the obvious thing and say why in `why`.',
    context ? `\nWhat the app already knows about right now:\n${context}` : '',
    '\nWrite the session.',
  ].filter(Boolean).join('\n')
}

/**
 * Changing a plan the user already has.
 *
 * Once a plan had been created there used to be no way to follow up with the
 * model, and that made the planner a vending machine — the one
 * thing you always want to say to a written session is "that's too much" or "swap
 * the front squat", and the only answers on offer were *redo it from scratch* or
 * *edit fourteen steppers by hand*.
 *
 * It returns the WHOLE plan rather than a patch. A diff format would be smaller
 * and would need its own parser, its own failure modes and its own tests, and the
 * thing being revised is a hundred lines of JSON that the model is already
 * perfectly able to re-emit. `changed` is what it says it did, and that is what
 * the screen shows them — a revision the user cannot see is the same problem the coach's
 * silent plan edits had.
 */
function revisePrompt({ plan, message, thread = [], name }) {
  const said = thread
    .slice(-8)
    .map(m => `${m.role === 'you' ? speaker(name) : 'You'}: ${m.text}`)
    .join('\n')
  return [
    `You already wrote ${who(name)} this session. Here it is, exactly as they have it now —`,
    'they may have edited numbers themselves since you wrote it, and those edits are theirs:',
    '',
    JSON.stringify(plan, null, 2),
    '',
    said ? `What you have said to each other about it so far:\n${said}\n` : '',
    `${speaker(name)} now says:\n${message}`,
    '',
    'Return the WHOLE session again, revised. Keep everything they did not ask you to',
    'change — including their own edits to the numbers. Put what you changed and why in',
    '`changed`, addressed to them, in one or two sentences. If what they asked for is a bad',
    'idea say so in `changed` and do it anyway, unless it breaks one of the rules above,',
    'in which case do not do it and say which rule.',
  ].filter(Boolean).join('\n')
}

/* ----------------------------------------------------------------- the turn */

/**
 * One planning turn.
 *
 * Read-only by flag, not by instruction. `Write`, `Edit` and `Bash` are all
 * denied outright — this agent produces JSON and touches nothing.
 */
function planWorkout({
  bin, model, effort, timeoutMs, repoRoot, dataDir, brainFile, today, plan,
  kinds = [], minutes, goal, context, revise = null, name, notes, env,
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
      '--json-schema', JSON.stringify(revise ? REVISE_SCHEMA : PLAN_SCHEMA),
    ], { cwd: repoRoot, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] })

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('the planner took too long — try again, or give it a narrower goal'))
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
      try { doc = JSON.parse(out) } catch { return reject(new Error('the planner did not return JSON')) }
      const built = doc.structured_output || safeParse(doc.result)
      if (!built || typeof built !== 'object' || !Array.isArray(built.blocks) || !built.blocks.length) {
        return reject(new Error('the planner returned nothing usable'))
      }
      resolve({
        plan: { ...built, createdAt: new Date().toISOString(), model: doc.model || model },
        cost: doc.total_cost_usd ?? null,
      })
    })

    // Same agent, same tools, same schema — a revision is a planning run that
    // starts from a plan instead of from a blank page.
    child.stdin.end(revise
      ? revisePrompt({ ...revise, name })
      : userPrompt({ kinds, minutes, goal, context }))
  })
}

function safeParse(s) {
  try { return JSON.parse(String(s)) } catch { return null }
}

/**
 * What a planning run costs to keep. Nothing — unlike a coach thread, a
 * prescription IS a log entry the moment the user keeps it, so there is no file store
 * here and no cleanup to do.
 */
const readPlanJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

module.exports = {
  PLAN_SCHEMA, REVISE_SCHEMA, planWorkout, systemPrompt, userPrompt, revisePrompt,
  liftField, activityField, readPlanJson,
}
