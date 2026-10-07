/*
 * The few pages the server renders itself: first-run setup, sign-in, and
 * Settings.
 *
 * Plain HTML rather than part of the React app on purpose. These have to work
 * before there is an account, before the app is built, and when the app's own
 * service worker is serving a stale shell. They share the app's Carbon colours
 * so moving between them does not feel like leaving.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const CSS = `
:root{--bg:#0b0c0b;--panel:#131513;--panel-2:#1a1d1a;--line:#272b27;--ink:#e9ece7;--ink-dim:#99a295;--ink-faint:#61695e;--accent:#b8f23d;--good:#6fd66f;--warn:#f0b429;--bad:#e2614f}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 18px 64px}
main.narrow{max-width:400px;padding-top:12vh}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 6px}
p{margin:0 0 12px}
.sub{color:var(--ink-dim);font-size:14px}
.faint{color:var(--ink-faint);font-size:13px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 14px}
label{display:block;font-size:14px;color:var(--ink-dim);margin:12px 0 4px}
label.check{display:flex;gap:8px;align-items:center;color:var(--ink);margin:8px 0}
input[type=text],input[type=password],input[type=url],textarea{width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);color:var(--ink);font:inherit}
input:disabled,textarea:disabled{color:var(--ink-faint)}
textarea{min-height:110px;resize:vertical}
button,.btn{display:inline-block;min-height:40px;padding:8px 16px;border-radius:8px;border:1px solid var(--line);background:var(--panel-2);color:var(--ink);font:inherit;cursor:pointer;text-decoration:none}
button.primary{background:var(--accent);border-color:var(--accent);color:#0b0c0b;font-weight:600}
button:disabled{opacity:.6;cursor:default}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;align-items:center}
.err{color:var(--bad);font-size:14px;margin:10px 0 0}
.ok{color:var(--good);font-size:14px}
.pill{display:inline-block;font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);color:var(--ink-dim)}
.pill.on{border-color:var(--good);color:var(--good)}
.pill.off{color:var(--ink-faint)}
.src{font-size:12px;color:var(--ink-faint);margin-top:3px}
code{font-size:13px;background:var(--panel-2);padding:1px 5px;border-radius:5px}
pre{white-space:pre-wrap;font-size:13px;background:var(--panel-2);padding:10px;border-radius:8px;margin:10px 0 0}
header.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
a{color:var(--accent)}
`

function layout({ title, body, narrow = false, script = '' }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0c0b"><meta name="robots" content="noindex">
<title>${esc(title)} · Bushido</title><link rel="icon" href="/icon.svg"><style>${CSS}</style>
</head><body><main class="${narrow ? 'narrow' : ''}">${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`
}

function setupPage({ token, error = '', minPassword = 8 }) {
  return layout({
    title: 'Set up',
    narrow: true,
    body: `
<h1>Set up Bushido</h1>
<p class="sub">Create the owner account. This is the only account; it signs in to every device you use.</p>
<form method="post" action="/setup" class="card">
  <input type="hidden" name="token" value="${esc(token)}">
  <label for="u">Username</label>
  <input id="u" name="username" type="text" autocomplete="username" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="new-password" minlength="${minPassword}" required>
  <p class="faint" style="margin-top:6px">At least ${minPassword} characters.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <div class="row"><button class="primary" type="submit">Create account</button></div>
</form>`,
  })
}

function setupClosedPage({ hasOwner }) {
  return layout({
    title: 'Set up',
    narrow: true,
    body: hasOwner
      ? `<h1>Already set up</h1><p class="sub">This install has an owner. <a href="/login">Sign in</a>.</p>`
      : `<h1>Setup link needed</h1>
<p class="sub">Open the one-time setup link the server printed when it started. It looks like
<code>http://&lt;host&gt;:8099/setup?token=…</code> and is in the server's log
(<code>journalctl --user -u bushido</code>, <code>docker compose logs</code>, or the terminal running <code>npm start</code>).</p>`,
  })
}

function loginPage({ error = '', next = '/' }) {
  return layout({
    title: 'Sign in',
    narrow: true,
    body: `
<h1>Bushido</h1>
<p class="sub">Sign in to your training log.</p>
<form method="post" action="/login" class="card">
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="u">Username</label>
  <input id="u" name="username" type="text" autocomplete="username" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <div class="row"><button class="primary" type="submit">Sign in</button></div>
</form>`,
  })
}

/* A request that got past the proxy but is not someone this install knows, or not allowed here. */
function refusedPage({ message }) {
  return layout({
    title: 'Not available',
    narrow: true,
    body: `<h1>Bushido</h1><div class="card"><p>${esc(message)}</p><p class="faint">If this is wrong, ask whoever runs this install.</p></div>`,
  })
}

/*
 * Settings is a static shell that reads and writes /api/settings. Everything
 * it shows comes from the server's resolved view, including which values an
 * environment variable is pinning (those fields are read-only here).
 */
const SETTINGS_SCRIPT = String.raw`
const $ = (s) => document.querySelector(s)
const api = async (url, opts = {}) => {
  const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opts })
  const body = await r.json().catch(() => ({}))
  if (r.status === 401) { location.href = '/login?next=/settings'; throw new Error('signed out') }
  if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status))
  return body
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
let view = null

function field(section, key, label, opts = {}) {
  const v = view.settings[section][key]
  const pinned = opts.readonly || (opts.source && opts.source.startsWith('env '))
  const id = section + '.' + key
  const type = opts.secret ? 'password' : 'text'
  const input = opts.textarea
    ? '<textarea id="' + id + '" data-s="' + section + '" data-k="' + key + '"' + (pinned ? ' disabled' : '') + ' placeholder="' + esc(opts.placeholder || '') + '">' + esc(v) + '</textarea>'
    : '<input id="' + id + '" type="' + type + '" data-s="' + section + '" data-k="' + key + '" value="' + esc(v) + '"' + (pinned ? ' disabled' : '') + ' placeholder="' + esc(opts.placeholder || '') + '" autocomplete="off">'
  if (opts.readonly) {
    const shown = opts.value != null ? opts.value : v
    return '<label for="' + id + '">' + esc(label) + '</label><input id="' + id + '" type="text" value="' + esc(shown || '') + '" disabled placeholder="not set">' +
      '<div class="src">' + esc((opts.source && opts.source.startsWith('env ') ? 'Set by ' + opts.source.slice(4) + '. ' : '') + 'Read-only here: set it in the environment or in data/settings.json, then restart.') + '</div>'
  }
  const src = opts.source ? '<div class="src">' + (pinned ? 'Set by ' + esc(opts.source.slice(4)) + ' — change it there.' : esc(opts.note || ('Now: ' + opts.source))) + '</div>' : (opts.note ? '<div class="src">' + esc(opts.note) + '</div>' : '')
  return '<label for="' + id + '">' + esc(label) + '</label>' + input + src
}
function check(section, key, label) {
  const id = section + '.' + key
  return '<label class="check"><input type="checkbox" id="' + id + '" data-s="' + section + '" data-k="' + key + '"' + (view.settings[section][key] ? ' checked' : '') + '> ' + esc(label) + '</label>'
}
const pill = (on, yes, no) => '<span class="pill ' + (on ? 'on' : 'off') + '">' + esc(on ? yes : no) + '</span>'

function collect(card) {
  const patch = {}
  card.querySelectorAll('[data-s]').forEach(el => {
    if (el.disabled) return
    const s = el.dataset.s, k = el.dataset.k
    patch[s] = patch[s] || {}
    patch[s][k] = el.type === 'checkbox' ? el.checked : el.value
  })
  return patch
}
async function save(card, msg) {
  const out = card.querySelector('.msg')
  out.textContent = 'Saving…'; out.className = 'msg faint'
  try { await api('/api/settings', { method: 'PUT', body: JSON.stringify(collect(card)) }); out.textContent = msg || 'Saved.'; out.className = 'msg ok'; await load(false) }
  catch (e) { out.textContent = e.message; out.className = 'msg err' }
}

function render() {
  const e = view.effective, st = view.status
  const welcome = new URLSearchParams(location.search).has('welcome')
  let h = ''
  if (welcome) h += '<div class="card"><h2>You are signed in</h2><p class="sub">Next: point Bushido at an AI below if you want the coach and planners, then open the app and add an achievement on the Achievements tab. Everything else here is optional.</p><a class="btn" href="/">Open the app</a></div>'

  // Account
  h += '<div class="card" id="c-account"><h2>Account</h2>'
  if (view.auth.mode === 'proxy') h += '<p class="sub">Sign-in is off: this server trusts the proxy in front of it (auth mode <code>proxy</code>, from ' + esc(view.auth.source === 'settings' ? 'data/settings.json' : view.auth.source) + '). To turn sign-in on, set <code>BUSHIDO_AUTH=password</code> or remove <code>auth.mode</code> from data/settings.json and restart.</p>'
  else h += '<p class="sub">Signed in as <strong>' + esc(view.auth.user) + '</strong>.</p>' +
    '<label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password">' +
    '<label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password">' +
    '<div class="row"><button id="pw-save">Change password</button><a class="btn" href="/?signout=1">Sign out</a><span class="msg"></span></div>' +
    '<p class="faint">Signing out syncs this device first, then removes the log, its cache and the offline copy from it.</p>'
  h += '</div>'

  // People
  const pp = view.people, ax = pp.access
  h += '<div class="card" id="c-people"><h2>People</h2>' +
    '<p class="sub">Everyone here has their own training log. Behind Cloudflare Access, the email Access signed someone in with says who they are; add the same address to the Access application\'s policy too, or Cloudflare will not let them reach this page. You can act as anyone from the app\'s profile menu to log for them.</p>' +
    '<p>' + pill(ax.enabled, 'Access identifies people', 'Access not set up: everyone is you') + '</p>' +
    field('access', 'team', 'Cloudflare Access team domain', { readonly: true, value: ax.team, source: ax.teamSource }) +
    field('access', 'aud', 'Access application AUD tag', { readonly: true, value: ax.aud, source: ax.audSource })
  for (const u of pp.users) {
    h += '<div class="person" data-id="' + esc(u.id) + '" style="border-top:1px solid var(--line);margin-top:14px;padding-top:6px">' +
      '<label>' + (u.owner ? 'You (owner)' : 'Name') + '</label><input type="text" class="p-name" value="' + esc(u.owner ? (view.settings.athlete.name || '') : u.name) + '"' + (u.owner ? ' disabled placeholder="set under About you"' : '') + '>' +
      '<label>Emails they sign in to Access with</label><input type="text" class="p-emails" value="' + esc(u.emails.join(', ')) + '" placeholder="name@example.com" autocomplete="off">' +
      (u.owner ? '' : '<div class="src">Their log: <code>data/users/' + esc(u.id) + '/</code>. Removing them keeps it on disk.</div>') +
      '<div class="row"><button class="p-save">Save</button>' + (u.owner ? '' : '<button class="p-del">Remove</button>') + '<span class="msg"></span></div></div>'
  }
  h += '<div style="border-top:1px solid var(--line);margin-top:14px;padding-top:6px"><h2 style="margin-top:8px">Add someone</h2>' +
    '<label for="np-name">Name</label><input id="np-name" type="text" autocomplete="off">' +
    '<label for="np-emails">Email they sign in to Access with</label><input id="np-emails" type="text" autocomplete="off" placeholder="name@example.com">' +
    '<div class="row"><button class="primary" id="np-add">Add</button><span class="msg"></span></div></div>'
  h += '</div>'

  // AI
  h += '<div class="card" id="c-ai"><h2>AI</h2>' +
    '<p class="sub">The coach, the workout planner and the week planner run the <a href="https://docs.claude.com/en/docs/claude-code/overview" target="_blank" rel="noopener">Claude Code CLI</a> headless. It is the only backend the code supports. Without it the app works; those three features say so instead.</p>' +
    '<p>' + pill(e.ai.installed, 'CLI found', 'CLI not found') + ' ' + pill(e.ai.apiKeySet, 'API key set', 'no API key') +
    (st.aiVersion ? ' <span class="faint">' + esc(st.aiVersion) + '</span>' : '') + '</p>' +
    field('ai', 'bin', 'Path to the claude binary', { readonly: true, value: e.ai.bin, source: e.ai.binSource }) +
    field('ai', 'apiKey', 'Anthropic API key (optional)', { secret: true, source: e.ai.apiKeySource, note: 'Passed to the CLI as ANTHROPIC_API_KEY. Leave empty to use the CLI\'s own sign-in (run claude once and log in).' }) +
    field('ai', 'model', 'Model', { placeholder: e.ai.defaultModel, note: 'Default ' + e.ai.defaultModel + '. BUSHIDO_COACH_MODEL / BUSHIDO_PLANNER_MODEL override per feature.' }) +
    '<div class="row"><button class="primary save">Save</button><button id="ai-test">Test</button><span class="msg"></span></div><pre id="ai-out" hidden></pre></div>'

  // Athlete
  h += '<div class="card" id="c-you"><h2>About you</h2><p class="sub">Given to the coach and planners with every request. Goals, history, injuries, equipment: whatever you want them to take into account.</p>' +
    field('athlete', 'name', 'Name') +
    field('athlete', 'notes', 'Notes for the coach', { textarea: true, placeholder: 'Training for a first marathon in May. Bad left knee. Dumbbells up to 50 lb at home.' }) +
    '<div class="row"><button class="primary save">Save</button><span class="msg"></span></div></div>'

  // Plan
  h += '<div class="card" id="c-plan"><h2>Training plan' + (pp.planFor ? ' for ' + esc(pp.planFor) : '') + '</h2>' +
    (pp.planFor ? '<p class="sub">You are acting as ' + esc(pp.planFor) + ', so this card is about their plan, not yours.</p>' : '') +
    '<p class="sub">The content file the app runs on: session cards, the activity and lift catalogs, quota categories and seeded achievements.</p>' +
    '<p>Now: <strong>' + esc(e.plan.label) + '</strong> <span class="faint">' + esc(e.plan.file) + '</span></p>' +
    (e.plan.source.startsWith('env ') ? '<p class="faint">Pinned by ' + esc(e.plan.source.slice(4)) + '.</p>' :
    '<div class="row"><a class="btn" href="/api/content" download="plan.json">Download</a>' +
    '<label class="btn" style="margin:0;color:var(--ink)">Import a plan file<input id="plan-file" type="file" accept="application/json,.json" hidden></label>' +
    (e.plan.exampleAvailable ? '<button id="plan-example">Use the example plan</button>' : '') +
    (e.plan.source !== 'starter' ? '<button id="plan-reset">Back to the starter</button>' : '') +
    '<span class="msg"></span></div>' +
    '<p class="faint" style="margin-top:10px">The example is a small invented plan: a first 10K and a strength base. Importing writes <code>data/plan.json</code>; any plan already there is copied to <code>data/backups/plans/</code> first, and your training log is not touched.</p>') +
    '</div>'

  // Integrations
  const t = e.totem
  h += '<div class="card" id="c-int"><h2>Integrations</h2>' +
    '<p class="sub">WHOOP and Strava are read through a <strong>Totem bridge</strong>, a separate service that holds the OAuth grants and exposes them over HTTP. Bushido stores no WHOOP or Strava credentials and cannot connect to either directly yet. With no bridge, the WHOOP and Strava panels stay hidden.</p>' +
    '<p>' + pill(t.enabled, 'bridge configured', 'no bridge') + ' ' + pill(t.whoop, 'WHOOP on', 'WHOOP off') + ' ' + pill(t.strava, 'Strava on', 'Strava off') + ' ' + pill(t.goals, 'goals on', 'goals off') + ' ' + pill(t.habitSync, 'habit sync on', 'habit sync off') + '</p>' +
    field('totem', 'url', 'Bridge URL', { source: t.urlSource, placeholder: 'http://127.0.0.1:8787' }) +
    field('totem', 'secret', 'Bridge secret', { secret: true, source: t.secretSource }) +
    field('totem', 'envFile', 'Or read BRIDGE_SECRET from this .env file', { readonly: true, source: t.envFileSource }) +
    field('totem', 'habit', 'Habit id to mark when you train', { placeholder: 'move-every-day' }) +
    check('totem', 'whoop', 'WHOOP workouts and recovery') +
    check('totem', 'strava', 'Strava activities and gear') +
    check('totem', 'goals', 'Show goals linked to this app') +
    check('totem', 'habitSync', 'Mark the daily habit when a session is logged') +
    '<div class="row"><button class="primary save">Save</button><span class="msg"></span></div></div>'

  // Links
  const l = e.links
  h += '<div class="card" id="c-links"><h2>Other local services</h2><p class="sub">All optional and off unless set. These name files on this server, so they are set in the environment or data/settings.json, not here.</p>' +
    '<p class="faint">Notifications are ' + (st.notify ? 'on' : 'off') + '.</p>' +
    field('links', 'notifyCore', 'Push notification core (directory)', { readonly: true, value: l.notifyCore, source: l.notifyCoreSource }) +
    field('links', 'brainFile', 'Athlete profile file (Markdown) the AI may read', { readonly: true, value: l.brainFile, source: l.brainFileSource }) +
    field('links', 'krakatoaDir', 'Nutrition digest directory the coach may read', { readonly: true, value: l.krakatoaDir, source: l.krakatoaDirSource }) +
    field('notifications', 'tz', 'Timezone for scheduled notifications', { placeholder: e.tz }) +
    '<div class="row"><button class="primary save">Save</button><span class="msg"></span></div></div>'

  h += '<p class="faint">Environment variables always win over these fields. See <code>.env.example</code>.</p>'
  $('#root').innerHTML = h
  wire()
}

function wire() {
  document.querySelectorAll('button.save').forEach(b => b.addEventListener('click', () => save(b.closest('.card'))))
  const pw = $('#pw-save')
  if (pw) pw.addEventListener('click', async () => {
    const out = pw.parentElement.querySelector('.msg')
    try { await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: $('#pw-cur').value, next: $('#pw-new').value }) }); out.textContent = 'Changed. Other devices are signed out.'; out.className = 'msg ok' }
    catch (e) { out.textContent = e.message; out.className = 'msg err' }
  })
  const test = $('#ai-test')
  if (test) test.addEventListener('click', async () => {
    const pre = $('#ai-out'); pre.hidden = false; pre.textContent = 'Running one short request…'; test.disabled = true
    try { const r = await api('/api/settings/ai/test', { method: 'POST', body: '{}' }); pre.textContent = 'OK in ' + r.ms + ' ms, ' + r.model + ': ' + r.reply }
    catch (e) { pre.textContent = e.message }
    finally { test.disabled = false }
  })
  document.querySelectorAll('.person').forEach(row => {
    const out = row.querySelector('.msg')
    const done = (m) => { out.textContent = m; out.className = 'msg ok' }
    const fail = (e) => { out.textContent = e.message; out.className = 'msg err' }
    row.querySelector('.p-save').addEventListener('click', async () => {
      const name = row.querySelector('.p-name')
      const body = { id: row.dataset.id, emails: row.querySelector('.p-emails').value }
      if (!name.disabled) body.name = name.value
      try { await api('/api/settings/users', { method: 'PUT', body: JSON.stringify(body) }); done('Saved.'); await load(false) } catch (e) { fail(e) }
    })
    const del = row.querySelector('.p-del')
    if (del) del.addEventListener('click', async () => {
      if (!confirm('Take ' + row.querySelector('.p-name').value + ' off this install? Their log stays on disk.')) return
      try { await api('/api/settings/users/' + encodeURIComponent(row.dataset.id), { method: 'DELETE' }); await load(false) } catch (e) { fail(e) }
    })
  })
  const add = $('#np-add')
  if (add) add.addEventListener('click', async () => {
    const out = add.parentElement.querySelector('.msg')
    try { await api('/api/settings/users', { method: 'POST', body: JSON.stringify({ name: $('#np-name').value, emails: $('#np-emails').value }) }); await load(false) }
    catch (e) { out.textContent = e.message; out.className = 'msg err' }
  })

  const planMsg = () => $('#c-plan .msg')
  const planAct = async (url, body) => {
    const out = planMsg(); out.textContent = 'Working…'; out.className = 'msg faint'
    try { await api(url, { method: 'POST', body: JSON.stringify(body || {}) }); out.textContent = 'Done. Reload the app to see it.'; out.className = 'msg ok'; await load(false) }
    catch (e) { out.textContent = e.message; out.className = 'msg err' }
  }
  const file = $('#plan-file')
  if (file) file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return
    let plan
    try { plan = JSON.parse(await f.text()) } catch { planMsg().textContent = 'That file is not JSON.'; planMsg().className = 'msg err'; return }
    planAct('/api/plan/import', { plan })
  })
  const ex = $('#plan-example'); if (ex) ex.addEventListener('click', () => planAct('/api/plan/example'))
  const rs = $('#plan-reset'); if (rs) rs.addEventListener('click', () => planAct('/api/plan/reset'))
}

async function load(first = true) {
  try { view = await api('/api/settings'); render() }
  catch (e) { if (first) $('#root').innerHTML = '<p class="err">' + esc(e.message) + '</p>' }
}
load()
`

function settingsPage() {
  return layout({
    title: 'Settings',
    body: `<header class="top"><h1>Settings</h1><a class="btn" href="/">Back to the app</a></header><div id="root"><p class="sub">Loading…</p></div>`,
    script: SETTINGS_SCRIPT,
  })
}

module.exports = { setupPage, setupClosedPage, loginPage, settingsPage, refusedPage, esc }
