/*
 * The AI coach — an agent that can go and look things up.
 *
 * Rebuilt 2026-09-15. What it replaced ran ONE headless turn with `--tools ''`,
 * fed a fat pre-built digest, and wrote a coach note for the day. That shape was
 * right for "read my week and nudge tomorrow" and wrong for an open-ended way of
 * asking about training: one that is thorough when gathering information, can
 * draw on Totem memory and any other source, and can write memories of its own.
 *
 * So it gets tools, and the digest stops being the whole world — it becomes a
 * starting point the agent can go past. It can read their brain, grep this repo,
 * search the web, and append a dated memory.
 *
 * FOUR THINGS IT CANNOT DO, and each is a line in the spawn below rather than an
 * instruction in a prompt, because a prompt is a request and a flag is a rule.
 *
 *   1. It cannot run shell commands. `Bash` is denied outright.
 *   2. It cannot edit code or content. `Edit` is denied; `Write` is scoped to the
 *      brain's projects directory, which is a git repo the user can revert.
 *   3. It cannot touch the training log. `data/state.json` is the one file in
 *      this system with no upstream copy, and nothing it does goes near it.
 *   4. It cannot change their day. It OFFERS sessions; they land only when the user taps
 *      one, through the same code path their own taps go through. The two
 *      unbypassable finger rules are enforced in `recommend.js` before any
 *      suggestion is read, so a coach that hallucinated a fourth hard day this
 *      week would produce a card that refuses to place itself.
 *
 * THREADS ARE FILES, not log entries. A conversation is not training history: it
 * does not chart, does not merge per-entry, and would bloat `state.json` — which
 * every device downloads in full on every sync — with text nobody queries. One
 * JSON per thread under `data/coach/`, listed newest first.
 */

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const { who, speaker, notesSection } = require('./prompting.js')
const { coachFlags } = require('./agentflags.js')

const MAX_MESSAGES = 200      // per thread, oldest trimmed
const MAX_TEXT = 8000         // per message
const CONTEXT_TURNS = 24      // how much of the thread the agent is handed

/* ------------------------------------------------------------- the schema */

/*
 * Prose plus optional offers. Structured output AND tools together, which the
 * CLI supports — the alternative was having it emit a fenced block we parse out
 * of the prose, and a contract that depends on a model formatting a code fence
 * correctly is a contract that breaks on a Tuesday.
 */
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    title: { type: 'string' },
    sessions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          optId: { type: 'string' },
          action: { type: 'string', enum: ['main', 'add'] },
          why: { type: 'string' },
        },
        required: ['optId', 'action', 'why'],
        additionalProperties: false,
      },
    },
    wroteMemory: { type: 'string' },
  },
  required: ['reply'],
  additionalProperties: false,
}

/* -------------------------------------------------------------- the store */

const threadFile = (dir, id) => path.join(dir, `${sane(id)}.json`)

/** Ids come off the wire. Anything that could climb out of the directory is refused. */
function sane(id) {
  const s = String(id || '').trim()
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(s)) throw new Error('bad thread id')
  return s
}

const newThreadId = () =>
  `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* it exists */ }
}

function readThread(dir, id) {
  try { return JSON.parse(fs.readFileSync(threadFile(dir, id), 'utf8')) } catch { return null }
}

function writeThread(dir, thread) {
  ensureDir(dir)
  const next = { ...thread, messages: (thread.messages || []).slice(-MAX_MESSAGES) }
  const tmp = `${threadFile(dir, thread.id)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, threadFile(dir, thread.id))
  return next
}

/** Every thread, newest first, without their messages. */
function listThreads(dir) {
  ensureDir(dir)
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const t = readThread(dir, f.slice(0, -5))
    if (!t?.id) continue
    out.push({
      id: t.id,
      title: t.title || 'Untitled',
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messages: (t.messages || []).length,
      // The last thing said, for the list. Trimmed hard: this is a subtitle.
      last: (t.messages || []).at(-1)?.text?.slice(0, 140) || '',
    })
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function deleteThread(dir, id) {
  try { fs.unlinkSync(threadFile(dir, id)); return true } catch { return false }
}

/* -------------------------------------------------------------- the prompt */

/**
 * What the agent is told before it starts looking.
 *
 * Deliberately short on data and long on WHERE THE DATA IS. The old coach was
 * handed a digest of everything because it had no way to go and get anything;
 * this one is handed the paths and told to look, which is the whole point of
 * giving it tools. A fat digest would also crowd out the thing it is worst at
 * having less of: the conversation.
 */
/*
 * Krakatoa — a separate food-log app. Bushido does not own it and must not write
 * to it; when a digest directory is configured (Settings, or BUSHIDO_KRAKATOA_DIR),
 * the coach may read the DIGEST it publishes, a pre-computed fortnight rather
 * than a log that grows without limit. Off unless configured.
 *
 * The brain file is the same: an optional athlete profile in another repo. When
 * it is set the coach may read it and append dated memories beside it; when it
 * is not, the coach has no write access anywhere.
 */
function systemPrompt({ repoRoot, dataDir, brainFile, krakatoaDir, planFile, today, name, notes }) {
  const data = dataDir || `${repoRoot}/data`
  const brainDir = brainFile ? path.dirname(brainFile) : null
  const sources = [
    brainFile && `- ${brainFile}
  ${who(name)}'s athlete profile: ability, diagnosed weaknesses, physiology, injury
  history, baselines, gear owned, hard training rules and why they are stricter
  than the literature. READ THIS FIRST for anything about them as an athlete.
- ${brainDir}/
  The rest of that notebook — other projects, preferences, history. Grep it.`,
    `- ${planFile || `${repoRoot}/content/starter.json`}
  The app's content: every session with its protocol and evidence, the activity
  catalog, the quota categories, the achievements, the recommender's weights.`,
    `- ${data}/state.json
  The actual training log. READ ONLY. Never write to it — it is the one file
  here with no upstream copy.`,
    `- ${data}/whoop.json, ${data}/strava.json
  Cached WHOOP recovery/HRV/sleep and Strava rides/runs/gear, when connected.
  Either may be absent.`,
    krakatoaDir && `- ${krakatoaDir}/digest.json
  WHAT THEY ATE, from a separate food-log app: today's foods in full, a
  fortnight of daily totals, targets, and the average over the days actually
  logged. It may be absent or days old, and absent means nothing was logged,
  never that nothing was eaten.`,
    `- ${repoRoot}/README.md and ${repoRoot}/docs/
  How the app itself works, if asked.`,
  ].filter(Boolean).join('\n')

  const writing = brainDir
    ? `WHAT YOU MAY WRITE

You may append to files under ${brainDir}/ — that is how you remember something
durable about them. Append a DATED bullet in the existing style; never rewrite or
delete what is there. Say so in \`wroteMemory\` when you do, in one line, so the
change is visible.

You may not write anywhere else. You have no shell.`
    : `WHAT YOU MAY WRITE

Nothing. You have read-only tools and no shell. Leave \`wroteMemory\` empty.`

  return `You are ${who(name)}'s training and health coach inside Bushido, a self-hosted
health app. Today is ${today}.

You have tools. USE THEM before answering anything factual — being thorough is
the job, and a confident answer you did not check is worse than "let me look".

WHERE THINGS ARE

${sources}

${notesSection(name, notes)}
${writing}

OFFERING SESSIONS

You can put session cards under your reply via \`sessions\`. \`optId\` must be a
real id from the content file's dailyMenu. They do NOT change the day — the athlete
taps one, or does not. Two rules in this app are unbypassable and enforced in code
before your suggestion is read: no hard finger day the day after another, and at
most three a week. Do not argue with them; if what you want to suggest is blocked,
say that plainly and suggest the thing that CAN be done.

HOW TO TALK

Direct, specific, and willing to say "I do not know" or "that is not what the
data says". Grade claims — if something is your inference rather than something
you read, say which. Do not pad. Do not open with a summary of what was just asked.`
}

/** The conversation so far, as the user message. */
function conversationPrompt(thread, question, context, name) {
  const turns = (thread.messages || []).slice(-CONTEXT_TURNS)
    .map(m => `${m.role === 'user' ? speaker(name) : 'You'}: ${m.text}`)
    .join('\n\n')
  return [
    context ? `Context the app already knows:\n${context}` : '',
    turns ? `The conversation so far:\n\n${turns}` : '',
    `${speaker(name)} says:\n${question}`,
  ].filter(Boolean).join('\n\n---\n\n')
}

/* --------------------------------------------------------------- the turn */

/**
 * One agent turn, with tools.
 *
 * The allow/deny lists are the security boundary and they are here rather than in
 * the prompt on purpose: a prompt is a request and a flag is a rule. `Write` is
 * scoped by path so the only thing it can create is a memory, in a git repo.
 */
function askCoach({
  bin, model, effort, timeoutMs, repoRoot, dataDir, brainFile, krakatoaDir, planFile,
  today, thread, question, context, name, notes, env,
}) {
  // See server/agentflags.js: too-broad directories are refused, and secrets
  // files are denied by rule.
  const flags = coachFlags({ repoRoot, dataDir: dataDir || path.join(repoRoot, 'data'), brainFile, krakatoaDir, planFile })
  for (const r of flags.refused) console.log(`[bushido] coach: refused ${r}`)
  const safeBrain = flags.writeDir ? brainFile : null
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [
      '--print',
      '--model', model,
      '--effort', effort,
      '--output-format', 'json',
      '--no-session-persistence',
      // It reads the repo from its cwd and anything configured outside it via
      // --add-dir. Write is granted only into a safe brain directory.
      ...flags.args,
      '--append-system-prompt', systemPrompt({ repoRoot, dataDir, brainFile: safeBrain, krakatoaDir, planFile, today, name, notes }),
      '--json-schema', JSON.stringify(REPLY_SCHEMA),
    ], { cwd: repoRoot, env: env || process.env, stdio: ['pipe', 'pipe', 'pipe'] })

    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('the coach took too long — try a narrower question'))
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
      try { doc = JSON.parse(out) } catch { return reject(new Error('the coach did not return JSON')) }
      const reply = doc.structured_output || safeParse(doc.result)
      if (!reply || typeof reply !== 'object' || !reply.reply) {
        return reject(new Error('the coach returned nothing usable'))
      }
      resolve({ reply, model: doc.model || model, cost: doc.total_cost_usd ?? null })
    })

    child.stdin.end(conversationPrompt(thread, question, context, name))
  })
}

function safeParse(s) {
  try { return JSON.parse(String(s)) } catch { return null }
}

/* ---------------------------------------------------------------- append */

const trim = (s) => String(s || '').slice(0, MAX_TEXT)

/**
 * Add a turn to a thread and save it.
 *
 * Their message is written BEFORE the agent is asked, in the caller — same rule the
 * old check-in had: with the box unreachable the user loses the reply and never the
 * thing the user typed.
 */
function appendMessage(thread, message) {
  const next = {
    ...thread,
    updatedAt: new Date().toISOString(),
    messages: [...(thread.messages || []), { ...message, text: trim(message.text) }],
  }
  return next
}

const newThread = (title) => ({
  id: newThreadId(),
  title: title || 'New chat',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [],
})

module.exports = {
  REPLY_SCHEMA, MAX_MESSAGES, CONTEXT_TURNS,
  newThread, newThreadId, sane,
  readThread, writeThread, listThreads, deleteThread, appendMessage,
  systemPrompt, conversationPrompt, askCoach,
}
