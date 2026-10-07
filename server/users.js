/*
 * The people who use one install, and how a request says which of them it is.
 *
 * ONE OWNER, SOME OTHERS. The owner is the person who set the install up. Their
 * log stays where it always was (`data/state.json` and the files beside it), so
 * an install that had one user before this existed changes nothing on disk.
 * Everyone else gets a folder of their own, `data/users/<id>/`, holding their
 * log, backups, plan and coach files. Settings, the AI CLI, the push identity
 * and the bridge stay install-wide; integrations that hold someone's account
 * (WHOOP, Strava, linked goals, habit sync, notifications, the brain file) are
 * the owner's and are simply off for anyone else.
 *
 * WHO IS ASKING. Built-in sign-in has one account, the owner. Behind Cloudflare
 * Access (auth mode `proxy`), Access signs every request it lets through with a
 * JWT in `Cf-Access-Jwt-Assertion`; with the team domain and the application's
 * AUD tag configured, that token is verified here against the team's public
 * keys, and its email picks the user from `data/users.json`. The header is
 * never trusted without the signature: anyone who can reach the port directly
 * could send it.
 *
 *   - a valid token for a listed email   that user
 *   - a valid token for anyone else      refused (403)
 *   - a token that does not verify       refused (403): never a fallback to the owner
 *   - no token at all                    the owner, exactly as before (loopback,
 *                                        the tailnet, curl on the box)
 *
 * The last line keeps proxy mode's trust model what it already was: whatever
 * reaches the port without passing through Access is the owner. It does not
 * widen anything.
 *
 * ACTING AS. The owner is an admin and can act as anyone else (a `bushido_as`
 * cookie). Every read and write then goes to that person's folder. The cookie is
 * a preference, not a credential: it is honoured only when the request is
 * already the owner's.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { cookieValue } = require('./auth.js')

const OWNER = 'owner'
const AS_COOKIE = 'bushido_as'
const AS_HOURS = 12
const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const normEmail = (e) => String(e || '').trim().toLowerCase()

function writePrivate(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
}

/** A folder-safe id from a name: "Sam Lee" -> "sam-lee". */
function slug(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {() => string} [o.ownerName]  the owner's name when users.json has none (Settings → About you)
 */
function createUsers({ dataDir, ownerName = () => '' }) {
  const file = path.join(dataDir, 'users.json')
  let doc = null

  function read() {
    if (doc) return doc
    let raw = {}
    try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* none yet: the owner alone */ }
    const list = Array.isArray(raw.users) ? raw.users : []
    const clean = (u) => ({
      id: String(u.id),
      name: String(u.name || '').trim(),
      emails: [...new Set((Array.isArray(u.emails) ? u.emails : []).map(normEmail).filter(e => EMAIL_RE.test(e)))],
    })
    const owner = list.find(u => u?.id === OWNER)
    const others = list.filter(u => u && u.id !== OWNER && ID_RE.test(String(u.id)))
    doc = { users: [clean(owner || { id: OWNER }), ...others.map(clean)] }
    return doc
  }

  const save = (next) => { writePrivate(file, next); doc = null; return read() }

  const view = (u) => (!u ? null : {
    id: u.id,
    name: u.name || (u.id === OWNER ? ownerName() : '') || (u.id === OWNER ? 'Owner' : u.id),
    emails: u.emails,
    admin: u.id === OWNER,
    owner: u.id === OWNER,
  })

  const list = () => read().users.map(view)
  const get = (id) => view(read().users.find(u => u.id === id))
  const owner = () => get(OWNER)

  function byEmail(email) {
    const e = normEmail(email)
    if (!e) return null
    return view(read().users.find(u => u.emails.includes(e)))
  }

  /** Where a user's files live. The owner's are the data dir itself. */
  function dirOf(id) {
    if (id === OWNER) return dataDir
    if (!ID_RE.test(String(id))) throw new Error(`not a user id: ${id}`)
    return path.join(dataDir, 'users', id)
  }

  function checkEmails(emails, exceptId) {
    const out = [...new Set((Array.isArray(emails) ? emails : String(emails || '').split(/[\s,;]+/)).map(normEmail).filter(Boolean))]
    for (const e of out) {
      if (!EMAIL_RE.test(e)) throw new Error(`not an email address: ${e}`)
      const taken = read().users.find(u => u.id !== exceptId && u.emails.includes(e))
      if (taken) throw new Error(`${e} already belongs to ${view(taken).name}`)
    }
    return out
  }

  function add({ name, emails }) {
    const n = String(name || '').trim().slice(0, 80)
    if (!n) throw new Error('give them a name')
    const base = slug(n) || 'user'
    const taken = new Set(read().users.map(u => u.id))
    let id = base === OWNER ? 'owner-2' : base
    for (let i = 2; taken.has(id); i++) id = `${base.slice(0, 28)}-${i}`
    const user = { id, name: n, emails: checkEmails(emails, id) }
    save({ users: [...read().users, user] })
    return get(id)
  }

  function update(id, { name, emails } = {}) {
    const cur = read().users.find(u => u.id === id)
    if (!cur) throw new Error('no such user')
    const next = { ...cur }
    if (name !== undefined) {
      next.name = String(name || '').trim().slice(0, 80)
      if (!next.name && id !== OWNER) throw new Error('give them a name')
    }
    if (emails !== undefined) next.emails = checkEmails(emails, id)
    save({ users: read().users.map(u => (u.id === id ? next : u)) })
    return get(id)
  }

  /** Takes the person off the list. Their folder, and their log in it, stay on disk. */
  function remove(id) {
    if (id === OWNER) throw new Error('the owner cannot be removed')
    if (!read().users.some(u => u.id === id)) throw new Error('no such user')
    save({ users: read().users.filter(u => u.id !== id) })
    return true
  }

  return { file, list, get, owner, byEmail, dirOf, add, update, remove, reload: () => { doc = null } }
}

/* -------------------------------------------------------- Cloudflare Access */

/** "your-team", "your-team.cloudflareaccess.com" or a URL -> the host. */
function accessHost(team) {
  let t = String(team || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
  if (!t) return ''
  if (!t.includes('.')) t = `${t}.cloudflareaccess.com`
  return t
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'))

/**
 * Verifies the JWT Cloudflare Access puts on every request it lets through.
 * RS256 against the team's published keys (cached; refetched at most once a
 * minute when a token names a key we have not seen, which is how a rotation
 * looks from here), then issuer, audience and expiry.
 *
 * @param {object} o
 * @param {() => {team: string, aud: string}} o.settings  read per call
 * @param {typeof fetch} [o.fetchFn]
 * @param {() => number} [o.now]
 * @param {string} [o.certsUrl]  where the keys are, when not the team's own (tests)
 */
function createAccessVerifier({ settings, fetchFn = (...a) => fetch(...a), now = () => Date.now(), certsUrl = '' }) {
  let keys = { host: null, at: 0, byKid: new Map() }
  const KEYS_TTL = 60 * 60 * 1000
  const REFETCH_GAP = 60 * 1000

  async function loadKeys(host, force) {
    const fresh = keys.host === host && now() - keys.at < (force ? REFETCH_GAP : KEYS_TTL)
    if (fresh) return keys.byKid
    const res = await fetchFn(certsUrl || `https://${host}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`could not fetch Access keys: HTTP ${res.status}`)
    const body = await res.json()
    const byKid = new Map()
    for (const jwk of body?.keys || []) {
      if (!jwk?.kid || jwk.kty !== 'RSA') continue
      try { byKid.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' })) } catch { /* skip a key we cannot read */ }
    }
    keys = { host, at: now(), byKid }
    return byKid
  }

  const configured = () => {
    const s = settings()
    return Boolean(accessHost(s.team) && String(s.aud || '').trim())
  }

  /** Resolves `{ email }` for a good token; rejects with a reason for anything else. */
  async function verify(token) {
    const s = settings()
    const host = accessHost(s.team)
    const aud = String(s.aud || '').trim()
    if (!host || !aud) throw new Error('Cloudflare Access is not configured')
    const parts = String(token || '').split('.')
    if (parts.length !== 3) throw new Error('malformed Access token')
    let header, payload
    try { header = b64json(parts[0]); payload = b64json(parts[1]) } catch { throw new Error('malformed Access token') }
    if (header.alg !== 'RS256') throw new Error('unexpected Access token algorithm')

    let byKid = await loadKeys(host, false)
    if (!byKid.has(header.kid)) byKid = await loadKeys(host, true)
    const key = byKid.get(header.kid)
    if (!key) throw new Error('Access token signed by an unknown key')
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))
    if (!ok) throw new Error('Access token signature does not verify')

    const t = Math.floor(now() / 1000)
    if (payload.iss !== `https://${host}`) throw new Error('Access token from another team')
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    if (!auds.includes(aud)) throw new Error('Access token for another application')
    if (!(Number(payload.exp) > t - 30)) throw new Error('Access token expired')
    if (payload.nbf && Number(payload.nbf) > t + 30) throw new Error('Access token not valid yet')
    const email = normEmail(payload.email)
    if (!email) throw new Error('Access token carries no email (a service token?)')
    return { email }
  }

  return { verify, configured }
}

/* ------------------------------------------------------------- identity */

/**
 * Who a request is, after the sign-in gate has let it through.
 *
 * Resolves `{ real, user, acting }` — `real` is the person asking, `user` is
 * whose log the request reads and writes (the same person unless an admin is
 * acting as someone) — or `{ refused: { status, error } }`.
 *
 * @param {object} o
 * @param {object} o.req
 * @param {{ via: string }} o.gate  what auth.check() said
 * @param {string} o.mode            'proxy' or 'password'
 * @param {ReturnType<createUsers>} o.users
 * @param {ReturnType<createAccessVerifier>} o.access
 */
async function identify({ req, gate, mode, users, access }) {
  let real = users.owner()
  const token = req.headers['cf-access-jwt-assertion']
  if (mode === 'proxy' && gate.via === 'proxy' && token && access.configured()) {
    let email
    try {
      ({ email } = await access.verify(Array.isArray(token) ? token[0] : token))
    } catch (err) {
      return { refused: { status: 403, error: `Cloudflare Access sign-in could not be checked: ${err.message}` } }
    }
    real = users.byEmail(email)
    if (!real) return { refused: { status: 403, error: `${email} has no account on this Bushido. The owner can add it in Settings → People.` } }
  }
  let user = real
  const as = cookieValue(req.headers.cookie, AS_COOKIE)
  if (as && real.admin && as !== real.id) user = users.get(as) || real
  return { real, user, acting: user.id !== real.id }
}

function actAsCookie(id, { secure = false } = {}) {
  const parts = [
    `${AS_COOKIE}=${id ? encodeURIComponent(id) : ''}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    id ? `Max-Age=${AS_HOURS * 3600}` : 'Max-Age=0',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

module.exports = {
  createUsers, createAccessVerifier, identify, actAsCookie, accessHost, slug,
  OWNER, AS_COOKIE, AS_HOURS, ID_RE,
}
