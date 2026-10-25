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

/*
 * The visual system's tokens (docs/DESIGN.md, "Visual system"), copied by value
 * from app/src/styles.css :root. Copied rather than linked on purpose: these
 * pages must render with no dist/ and under a stale service worker, so they can
 * depend on nothing but this string. A token changed there is changed here too.
 */
const CSS = `
:root{--bg:#0b0c0b;--panel:#131513;--panel-2:#1a1d1a;--panel-3:#232723;--line:#272b27;--line-strong:#363c35;
--ink:#e9ece7;--ink-dim:#99a295;--ink-faint:#808a7c;--accent:#b8f23d;--on-accent:#0f1409;
--accent-soft:#2d3623;--accent-line:#72923e;--good:#6fd66f;--warn:#f0b429;--bad:#e2614f;--viz-crit:#e2564e;
--fs-caption:12px;--fs-small:13px;--fs-body:15px;--fs-input:16px;--fs-title:17px;--fs-heading:22px;
--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-6:24px;--r-control:10px;--r-card:12px;--r-pill:999px;--tap:44px}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:var(--fs-body)/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
main{max-width:640px;margin:0 auto;padding:var(--sp-6) var(--sp-4) 64px}
main.narrow{max-width:400px;padding-top:12vh}
.mark{display:flex;align-items:center;gap:var(--sp-2);font-size:var(--fs-title);font-weight:600;margin:0 0 var(--sp-6)}
.mark img{width:22px;height:22px}
h1{font-size:var(--fs-heading);font-weight:600;line-height:1.25;margin:0 0 var(--sp-1)}
h2{font-size:var(--fs-title);font-weight:600;line-height:1.25;margin:0 0 var(--sp-1)}
p{margin:0 0 var(--sp-3)}
.sub{color:var(--ink-dim);font-size:var(--fs-small)}
.faint{color:var(--ink-faint);font-size:var(--fs-small)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-card);padding:var(--sp-4);margin:0 0 var(--sp-3)}
label{display:block;font-size:var(--fs-small);color:var(--ink-dim);margin:var(--sp-3) 0 6px}
label.check{display:flex;gap:var(--sp-2);align-items:center;color:var(--ink);font-size:var(--fs-body);min-height:var(--tap);margin:var(--sp-2) 0}
label.check input{width:22px;height:22px;margin:0;accent-color:var(--accent)}
input[type=text],input[type=password],input[type=url],textarea{width:100%;min-height:var(--tap);padding:10px 12px;border-radius:var(--r-control);border:1px solid var(--line);background:var(--panel-2);color:var(--ink);font:inherit;font-size:var(--fs-input)}
input::placeholder,textarea::placeholder{color:var(--ink-faint)}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:-1px}
input:disabled,textarea:disabled{color:var(--ink-faint)}
textarea{min-height:110px;resize:vertical}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-2);min-height:var(--tap);padding:0 var(--sp-4);border-radius:var(--r-control);border:1px solid var(--line-strong);background:var(--panel-3);color:var(--ink);font:inherit;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.ghost,.btn.ghost{background:transparent;color:var(--ink-dim)}
button.bad{background:transparent;border-color:var(--line-strong);color:var(--viz-crit)}
button:disabled{opacity:.4;cursor:not-allowed}
button:focus-visible,.btn:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
form.card button.primary{width:100%;margin-top:var(--sp-4)}
.row{display:flex;gap:var(--sp-2);flex-wrap:wrap;margin-top:var(--sp-4);align-items:center}
.msg{font-size:var(--fs-small)}
.err{color:var(--bad);font-size:var(--fs-small);margin:var(--sp-3) 0 0}
.ok{color:var(--good);font-size:var(--fs-small)}
.pill{display:inline-flex;align-items:center;font-size:var(--fs-caption);padding:2px var(--sp-2);border-radius:var(--r-pill);border:1px solid var(--line);color:var(--ink-dim)}
.pill.on{border-color:var(--accent-line);background:var(--accent-soft);color:var(--ink)}
.pill.off{color:var(--ink-faint)}
.src{font-size:var(--fs-caption);color:var(--ink-faint);margin-top:var(--sp-1)}
.person,.add{border-top:1px solid var(--line);margin-top:var(--sp-4);padding-top:var(--sp-1)}
.add h2{margin-top:var(--sp-3)}
code{font-size:var(--fs-small);background:var(--panel-2);padding:1px 5px;border-radius:4px}
pre{white-space:pre-wrap;font-size:var(--fs-small);background:var(--panel-2);padding:10px;border-radius:var(--r-control);margin:10px 0 0}
header.top{display:flex;justify-content:space-between;align-items:center;gap:var(--sp-3);margin-bottom:var(--sp-4)}
header.top h1{margin:0}
a{color:var(--ink);text-underline-offset:2px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`

/* The app's mark and name over the narrow pages, as the app's own header shows them.
   The mark is a built asset, so with no dist/ it removes itself and the name stays. */
const MARK = '<div class="mark"><img src="/icon.svg" alt="" width="22" height="22" onerror="this.remove()">Bushido</div>'

function layout({ title, body, narrow = false, script = '' }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b0c0b"><meta name="robots" content="noindex">
<title>${esc(title)} · Bushido</title><link rel="icon" href="/icon.svg"><style>${CSS}</style>
</head><body><main class="${narrow ? 'narrow' : ''}">${narrow ? MARK : ''}${body}</main>${script ? `<script>${script}</script>` : ''}</body></html>`
}

function setupPage({ token, error = '', minPassword = 8 }) {
  return layout({
    title: 'Set up',
    narrow: true,
    body: `
<h1>Set up Bushido</h1>
<p class="sub">Create the owner account. It signs in on every device you use.</p>
<form method="post" action="/setup" class="card">
  <input type="hidden" name="token" value="${esc(token)}">
  <label for="u">Username</label>
  <input id="u" name="username" type="text" autocomplete="username" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="new-password" minlength="${minPassword}" required>
  <p class="src">At least ${minPassword} characters.</p>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <button class="primary" type="submit">Create account</button>
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
<h1>Sign in</h1>
<p class="sub">To your training log.</p>
<form method="post" action="/login" class="card">
  <input type="hidden" name="next" value="${esc(next)}">
  <label for="u">Username</label>
  <input id="u" name="username" type="text" autocomplete="username" required autofocus>
  <label for="p">Password</label>
  <input id="p" name="password" type="password" autocomplete="current-password" required>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <button class="primary" type="submit">Sign in</button>
</form>`,
  })
}

/* A request that got past the proxy but is not someone this install knows, or not allowed here. */
function refusedPage({ message }) {
  return layout({
    title: 'Not available',
    narrow: true,
    body: `<h1>Not available</h1><div class="card"><p>${esc(message)}</p><p class="faint" style="margin:0">If this is wrong, ask whoever runs this install.</p></div>`,
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
  if (welcome) h += '<div class="card"><h2>You are signed in</h2><p class="sub">Next: point Bushido at an AI below if you want it to write workouts for you, then open the app and log one. Everything else here is optional.</p><a class="btn" href="/">Open the app</a></div>'

  // Account
  h += '<div class="card" id="c-account"><h2>Account</h2>'
  if (view.auth.mode === 'proxy') h += '<p class="sub">Sign-in is off: this server trusts the proxy in front of it (auth mode <code>proxy</code>, from ' + esc(view.auth.source === 'settings' ? 'data/settings.json' : view.auth.source) + '). To turn sign-in on, set <code>BUSHIDO_AUTH=password</code> or remove <code>auth.mode</code> from data/settings.json and restart.</p>'
  else h += '<p class="sub">Signed in as <strong>' + esc(view.auth.user) + '</strong>.</p>' +
    '<label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password">' +
    '<label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password">' +
    '<div class="row"><button id="pw-save">Change password</button><a class="btn ghost" href="/?signout=1">Sign out</a><span class="msg"></span></div>' +
    '<p class="src">Signing out saves this device\'s log to the server first, then takes it off the device.</p>'
  h += '</div>'

  // People
  const pp = view.people, ax = pp.access
  h += '<div class="card" id="c-people"><h2>People</h2>' +
    '<p class="sub">Each person has their own log; Cloudflare Access says who is who.</p>' +
    '<p>' + pill(ax.enabled, 'Access identifies people', 'Access not set up: everyone is you') + '</p>' +
    field('access', 'team', 'Cloudflare Access team domain', { readonly: true, value: ax.team, source: ax.teamSource }) +
    field('access', 'aud', 'Access application AUD tag', { readonly: true, value: ax.aud, source: ax.audSource })
  for (const u of pp.users) {
    h += '<div class="person" data-id="' + esc(u.id) + '">' +
      '<label>' + (u.owner ? 'You (owner)' : 'Name') + '</label><input type="text" class="p-name" value="' + esc(u.owner ? (view.settings.athlete.name || '') : u.name) + '"' + (u.owner ? ' disabled placeholder="set under About you"' : '') + '>' +
      '<label>Emails they sign in to Access with</label><input type="text" class="p-emails" value="' + esc(u.emails.join(', ')) + '" placeholder="name@example.com" autocomplete="off">' +
      (u.owner ? '' : '<div class="src">Add the same address to the Access application\'s policy, or Cloudflare will not let them in.</div>') +
      (u.owner ? '' : '<div class="src">Their log: <code>data/users/' + esc(u.id) + '/</code>. Removing them keeps it on disk.</div>') +
      '<div class="row"><button class="p-save">Save</button>' + (u.owner ? '' : '<button class="p-del bad">Remove</button>') + '<span class="msg"></span></div></div>'
  }
  h += '<div class="add"><h2>Add someone</h2>' +
    '<label for="np-name">Name</label><input id="np-name" type="text" autocomplete="off">' +
    '<label for="np-emails">Email they sign in to Access with</label><input id="np-emails" type="text" autocomplete="off" placeholder="name@example.com">' +
    '<div class="row"><button id="np-add">Add</button><span class="msg"></span></div></div>'
  h += '</div>'

  // AI
  h += '<div class="card" id="c-ai"><h2>AI</h2>' +
    '<p class="sub">The workout planner (Plan a workout → Write it for me) runs the <a href="https://docs.claude.com/en/docs/claude-code/overview" target="_blank" rel="noopener">Claude Code CLI</a> headless. It is the only backend the code supports. Without it the app works and you build workouts yourself.</p>' +
    '<p>' + pill(e.ai.installed && Boolean(st.aiVersion), 'CLI found', e.ai.installed ? 'CLI found, but it will not run' : 'CLI not found') + ' ' + pill(e.ai.apiKeySet, 'API key set', 'no API key') +
    (st.aiVersion ? ' <span class="faint">' + esc(st.aiVersion) + '</span>' : '') + '</p>' +
    field('ai', 'bin', 'Path to the claude binary', { readonly: true, value: e.ai.bin, source: e.ai.binSource }) +
    field('ai', 'apiKey', 'Anthropic API key (optional)', { secret: true, source: e.ai.apiKeySource, note: 'Passed to the CLI as ANTHROPIC_API_KEY. Leave empty to use the CLI\'s own sign-in (run claude once and log in).' }) +
    field('ai', 'model', 'Model', { placeholder: e.ai.defaultModel, note: 'Default ' + e.ai.defaultModel + '. BUSHIDO_PLANNER_MODEL overrides it.' }) +
    // The page's one primary: the welcome card names AI as the next step, and every other
    // card's Save is an ordinary button (one accent per screen, docs/DESIGN.md).
    '<div class="row"><button class="primary save">Save</button><button id="ai-test">Test</button><span class="msg"></span></div><pre id="ai-out" hidden></pre></div>'

  // Athlete
  h += '<div class="card" id="c-you"><h2>About you</h2><p class="sub">Given to the workout planner with every request. Goals, history, injuries, equipment: whatever you want it to take into account.</p>' +
    field('athlete', 'name', 'Name') +
    field('athlete', 'notes', 'Notes for the planner', { textarea: true, placeholder: 'Training for a first marathon in May. Bad left knee. Dumbbells up to 50 lb at home.' }) +
    '<div class="row"><button class="save">Save</button><span class="msg"></span></div></div>'

  // Plan
  h += '<div class="card" id="c-plan"><h2>Training plan' + (pp.planFor ? ' for ' + esc(pp.planFor) : '') + '</h2>' +
    (pp.planFor ? '<p class="sub">You are acting as ' + esc(pp.planFor) + ', so this card is about their plan, not yours.</p>' : '') +
    '<p class="sub">The content file the app runs on: session cards, the activity and lift catalogs and the categories workouts file under.</p>' +
    '<p>Now: <strong>' + esc(e.plan.label) + '</strong> <span class="faint">' + esc(e.plan.file) + '</span></p>' +
    (e.plan.source.startsWith('env ') ? '<p class="faint">Pinned by ' + esc(e.plan.source.slice(4)) + '.</p>' :
    '<div class="row"><a class="btn" href="/api/content" download="plan.json">Download</a>' +
    '<label class="btn" style="margin:0;color:var(--ink);font-size:var(--fs-body)">Import a plan file<input id="plan-file" type="file" accept="application/json,.json" hidden></label>' +
    (e.plan.exampleAvailable ? '<button id="plan-example">Use the example plan</button>' : '') +
    (e.plan.source !== 'starter' ? '<button id="plan-reset">Back to the starter</button>' : '') +
    '<span class="msg"></span></div>' +
    '<p class="faint" style="margin-top:10px">The example is a small invented plan: a first 10K and a strength base. Importing writes <code>data/plan.json</code>; any plan already there is copied to <code>data/backups/plans/</code> first, and your training log is not touched.</p>') +
    '</div>'

  // Integrations
  const t = e.totem
  h += '<div class="card" id="c-int"><h2>Integrations</h2>' +
    '<p class="sub">The daily habit is marked on a <strong>Totem bridge</strong>, a separate service reached over HTTP. WHOOP and Strava do not: they are connected here, in the cards below.</p>' +
    '<p>' + pill(t.enabled, 'bridge configured', 'no bridge') + ' ' + pill(t.habitSync, 'habit sync on', 'habit sync off') + '</p>' +
    field('totem', 'url', 'Bridge URL', { source: t.urlSource, placeholder: 'http://127.0.0.1:8787' }) +
    field('totem', 'secret', 'Bridge secret', { secret: true, source: t.secretSource }) +
    field('totem', 'envFile', 'Or read BRIDGE_SECRET from this .env file', { readonly: true, source: t.envFileSource }) +
    field('totem', 'habit', 'Habit id to mark when you train', { placeholder: 'move-every-day' }) +
    check('totem', 'habitSync', 'Mark the daily habit when a session is logged') +
    '<div class="row"><button class="save">Save</button><span class="msg"></span></div></div>'

  // Strava, everyone's own
  const sa = e.strava
  h += '<div class="card" id="c-strava"><h2>Strava</h2>' +
    '<p class="sub">Everyone on this install, you included, connects their own Strava account from Profile → Connections in the app, through a Strava API app you create at <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a>. A new app accepts only one athlete (you) until you raise it to ten from that page. Set its Authorization Callback Domain to the host people open Bushido on. Totem reads your Strava from here.</p>' +
    '<p>' + pill(sa.configured, 'Strava app set', 'no Strava app') + '</p>' +
    field('strava', 'clientId', 'Client ID', { source: sa.clientIdSource }) +
    field('strava', 'clientSecret', 'Client secret', { secret: true, source: sa.secretSource }) +
    field('strava', 'redirectUri', 'Redirect URI (optional)', { source: sa.redirectUriSource, placeholder: (sa.publicUrl || 'https://bushido.example.com') + '/strava/callback', note: 'Leave empty to use the address the person opened the app on.' }) +
    '<div class="row"><button class="save">Save</button><span class="msg"></span></div></div>'

  // WHOOP, the owner's
  const wa = e.whoop
  h += '<div class="card" id="c-whoop"><h2>WHOOP</h2>' +
    '<p class="sub">Your WHOOP, connected from Profile → Connections in the app through a WHOOP app you create at <a href="https://developer.whoop.com" target="_blank" rel="noopener">developer.whoop.com</a>. Add its Redirect URL exactly as shown below. Bushido is the only holder of the grant: Totem\'s sleep habit and Krakatoa read WHOOP from here, with <code>BUSHIDO_API_TOKEN</code>.</p>' +
    '<p>' + pill(wa.configured, 'WHOOP app set', 'no WHOOP app') + ' ' + pill(wa.linked, 'connected', 'not connected') + '</p>' +
    field('whoop', 'clientId', 'Client ID', { source: wa.clientIdSource }) +
    field('whoop', 'clientSecret', 'Client secret', { secret: true, source: wa.secretSource }) +
    field('whoop', 'redirectUri', 'Redirect URI (optional)', { source: wa.redirectUriSource, placeholder: (wa.publicUrl || 'https://bushido.example.com') + '/whoop/callback', note: 'Leave empty to use the address you opened the app on. WHOOP needs the exact URL listed in its app.' }) +
    '<div class="row"><button class="save">Save</button><span class="msg"></span></div></div>'

  // Links
  const l = e.links
  h += '<div class="card" id="c-links"><h2>Other local services</h2><p class="sub">All optional and off unless set. These name files on this server, so they are set in the environment or data/settings.json, not here.</p>' +
    '<p class="faint">Notifications are ' + (st.notify ? 'on' : 'off') + '.</p>' +
    field('links', 'notifyCore', 'Push notification core (directory)', { readonly: true, value: l.notifyCore, source: l.notifyCoreSource }) +
    field('links', 'brainFile', 'Athlete profile file (Markdown) the AI may read', { readonly: true, value: l.brainFile, source: l.brainFileSource }) +
    field('notifications', 'tz', 'Timezone for scheduled notifications', { placeholder: e.tz }) +
    '<div class="row"><button class="save">Save</button><span class="msg"></span></div></div>'

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
    body: `<header class="top"><h1>Settings</h1><a class="btn ghost" href="/">Back to the app</a></header><div id="root"><p class="sub">Loading…</p></div>`,
    script: SETTINGS_SCRIPT,
  })
}

module.exports = { setupPage, setupClosedPage, loginPage, settingsPage, refusedPage, esc }
