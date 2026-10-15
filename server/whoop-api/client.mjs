// whoop-api/client.mjs — OAuth 2 and the WHOOP v2 API, as Bushido holds them.
//
// This used to live in Totem's bridge. The owner's WHOOP grant moved here on
// 2026-10-14, alongside Strava: Bushido is where training and health data live,
// and Totem (the sleep habit), Krakatoa (calorie burn) and this app's own cache
// all read WHOOP through this one client. The logic is the bridge's, unchanged;
// only where the settings and the token file come from differs.
//
// Docs: https://developer.whoop.com/api/
//
// Token handling, the part that bites:
//   * WHOOP ROTATES THE REFRESH TOKEN ON EVERY REFRESH and voids the old pair.
//     Exactly one process may hold the grant, and within it one refresh may run
//     at a time: `accessToken` shares a single in-flight refresh, and nothing
//     else spends the refresh token. Two holders, or two refreshes at once, and
//     one of them silently stops working.
//   * The new pair is written before anything else runs, so a crash between the
//     exchange and the write is the only way to lose it.
//   * A refresh asks for the scope the grant HAS, never a wider one (see
//     `refresh`), and the grant's scope is what gets persisted, not the echo.

import { readFile, mkdir, writeFile, rename, chmod } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'

export const WHOOP_ORIGIN = process.env.WHOOP_API_ORIGIN || 'https://api.prod.whoop.com'
const AUTH_URL = `${WHOOP_ORIGIN}/oauth/oauth2/auth`
const TOKEN_URL = `${WHOOP_ORIGIN}/oauth/oauth2/token`
const API = `${WHOOP_ORIGIN}/developer/v2`

/*
 * `offline` is what makes WHOOP return a refresh token at all. The rest is
 * everything the strap can tell us about training: workouts for per-session
 * heart rate, recovery and cycles for how recovered they arrived, sleep for the
 * nights, and body measurement for max heart rate, without which an average of
 * 132 bpm is a number and not an intensity.
 *
 * Widening this does not widen an existing grant: a refresh can never add a
 * scope. Reconnect after changing it; `status` names what is missing.
 */
export const WHOOP_SCOPES = ['read:sleep', 'read:workout', 'read:recovery', 'read:cycles', 'read:body_measurement', 'offline']

export class WhoopError extends Error {
  constructor(message, { status = null, needsReauth = false, missingScope = null, rateLimited = false } = {}) {
    super(message)
    this.name = 'WhoopError'
    this.status = status
    this.needsReauth = needsReauth
    this.missingScope = missingScope
    this.rateLimited = rateLimited
  }
}

const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

const min = (milli) => (Number.isFinite(Number(milli)) ? Math.round(Number(milli) / 60_000) : null)
const num = (v, dp = 1) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const f = 10 ** dp
  return Math.round(n * f) / f
}
// WHOOP reports energy in kilojoules. Dietary calories are what every other
// fitness surface shows, so both are handed over rather than one being guessed at.
const kcal = (kj) => (Number.isFinite(Number(kj)) ? Math.round(Number(kj) * 0.239006) : null)

/** Shift a bare YYYY-MM-DD by whole days. UTC math so no DST edge can bite. */
export function shiftISODate(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// WHOOP returns a UTC instant plus the offset the band was wearing at the time,
// so the wall clock the wearer actually saw is that instant shifted by the
// offset. Sliced to 10 that's the local date; to 16, the local minute
// ("2026-08-18T22:36"). The minute form deliberately carries no offset suffix:
// it's a clock reading rather than a point in time.
export function localStamp(instant, offset, length) {
  const t = Date.parse(instant)
  if (!Number.isFinite(t)) return null
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(offset || ''))
  const shift = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0
  return new Date(t + shift).toISOString().slice(0, length)
}
export const localDate = (instant, offset) => localStamp(instant, offset, 10)

/**
 * One recovery score per physiological cycle. WHOOP can return an older and a
 * re-scored copy in the same window, so the newest `updated_at` wins. Records
 * with no state predate that field and are accepted; an explicit non-SCORED
 * state is never used.
 */
export function indexRecoveryScores(records) {
  const scores = new Map()
  const updatedAt = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    const cycleId = record?.cycle_id
    const raw = record?.score?.recovery_score
    if (cycleId === undefined || cycleId === null || raw === undefined || raw === null) continue
    if (record.score_state && record.score_state !== 'SCORED') continue
    const score = Number(raw)
    if (!Number.isFinite(score)) continue
    const stamp = Date.parse(record.updated_at)
    const priorStamp = updatedAt.get(cycleId)
    if (Number.isFinite(stamp) && Number.isFinite(priorStamp) && stamp < priorStamp) continue
    scores.set(cycleId, Math.min(100, Math.max(0, Math.round(score))))
    updatedAt.set(cycleId, Number.isFinite(stamp) ? stamp : -Infinity)
  }
  return scores
}

/**
 * One workout. `sport_name` rather than `sport_id` (deprecated past 09/01/2025).
 * Zone durations become minutes, because minutes are what a training log deals in.
 */
export function shapeWorkout(record) {
  if (!record) return null
  const score = record.score || {}
  const zones = score.zone_durations || {}
  const start = Date.parse(record.start)
  const end = Date.parse(record.end)
  const zone = (k) => min(zones[k])
  return {
    id: record.id,
    sport: record.sport_name || 'unknown',
    start: record.start,
    end: record.end,
    // The LOCAL date, from WHOOP's own offset for that workout: a 9pm session is
    // that evening's session, not tomorrow's, and a naive UTC date gets that wrong.
    date: localDate(record.start, record.timezone_offset),
    timezoneOffset: record.timezone_offset || null,
    minutes: Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 60_000) : null,
    scoreState: record.score_state || null,
    strain: num(score.strain, 1),
    avgHr: num(score.average_heart_rate, 0),
    maxHr: num(score.max_heart_rate, 0),
    kilojoules: num(score.kilojoule, 0),
    calories: kcal(score.kilojoule),
    // How much of the workout the strap actually recorded. A 40% workout's average
    // heart rate is an average of the part it saw, so this travels with the number.
    percentRecorded: num(score.percent_recorded, 0),
    distanceMeter: num(score.distance_meter, 0),
    altitudeGainMeter: num(score.altitude_gain_meter, 0),
    zones: {
      zero: zone('zone_zero_milli'), one: zone('zone_one_milli'), two: zone('zone_two_milli'),
      three: zone('zone_three_milli'), four: zone('zone_four_milli'), five: zone('zone_five_milli'),
    },
  }
}

/**
 * One night, from one sleep record. `value` picks the headline percentage:
 * 'performance' (slept vs. needed, what WHOOP's own app leads with),
 * 'efficiency' or 'consistency'. Totem's sleep habit is filled from exactly
 * this shape, and this app's sleep card from `sleepNights` below, so the two
 * never disagree.
 */
export function nightFromRecord(record, { value: valueField = 'performance' } = {}) {
  if (!record || record.nap === true) return null
  // PENDING_SCORE / UNSCORABLE nights have no numbers worth writing.
  if (record.score_state && record.score_state !== 'SCORED') return null
  const score = record.score || {}
  const stages = score.stage_summary || {}
  const parts = {
    deep: min(stages.total_slow_wave_sleep_time_milli),
    rem: min(stages.total_rem_sleep_time_milli),
    light: min(stages.total_light_sleep_time_milli),
    awake: min(stages.total_awake_time_milli),
  }
  for (const key of Object.keys(parts)) if (parts[key] === null) delete parts[key]

  const pick = {
    performance: score.sleep_performance_percentage,
    efficiency: score.sleep_efficiency_percentage,
    consistency: score.sleep_consistency_percentage,
  }[valueField] ?? score.sleep_performance_percentage
  const value = Number.isFinite(Number(pick)) ? Math.round(Number(pick) * 10) / 10 : null
  if (value === null && !Object.keys(parts).length) return null

  const asleepMin = ['deep', 'rem', 'light'].reduce((sum, key) => sum + (parts[key] || 0), 0)

  // Everything WHOOP scores that isn't the headline number or a stage. Keys are
  // kebab-case because Totem's habit store normalizes keys that way and would
  // flatten camelCase to mush ("respiratoryRate" -> "respiratoryrate").
  const need = score.sleep_needed || {}
  const stats = {
    efficiency: num(score.sleep_efficiency_percentage, 1),
    consistency: num(score.sleep_consistency_percentage, 1),
    'respiratory-rate': num(score.respiratory_rate, 1),
    cycles: num(stages.sleep_cycle_count, 0),
    disturbances: num(stages.disturbance_count, 0),
    // in-bed is the whole window; asleep is that minus awake/no-data. The gap
    // between them is the restlessness the stack can't show on its own.
    'in-bed': min(stages.total_in_bed_time_milli),
    needed: min(
      (Number(need.baseline_milli) || 0)
      + (Number(need.need_from_sleep_debt_milli) || 0)
      + (Number(need.need_from_recent_strain_milli) || 0)
      + (Number(need.need_from_recent_nap_milli) || 0),
    ),
    debt: min(need.need_from_sleep_debt_milli),
    'strain-need': min(need.need_from_recent_strain_milli),
  }
  for (const key of Object.keys(stats)) if (stats[key] === null) delete stats[key]

  // The wall-clock window, anchored to the record's own offset, so a night slept
  // in another timezone still reads as the clock the wearer woke up to.
  const startStamp = localStamp(record.start, record.timezone_offset, 16)
  const endStamp = localStamp(record.end, record.timezone_offset, 16)

  return {
    id: record.id,
    // WHOOP publishes a sleep the moment it thinks you woke, then revises the
    // same record (same id) when you actually get up. This is how a revision shows.
    updatedAt: typeof record.updated_at === 'string' ? record.updated_at : null,
    cycleId: record.cycle_id ?? null,
    date: localDate(record.start, record.timezone_offset),
    wakeDate: localDate(record.end, record.timezone_offset),
    value,
    parts,
    stats,
    window: startStamp && endStamp ? { start: startStamp, end: endStamp } : null,
    totalMin: asleepMin || null,
  }
}

/**
 * The nights for display, newest first: one per wake date (the main sleep wins),
 * the same calendar as `recovery`.
 */
export function sleepNights(records) {
  const byDate = new Map()
  for (const record of records) {
    const night = nightFromRecord(record)
    if (!night?.wakeDate) continue
    const prior = byDate.get(night.wakeDate)
    if (!prior || (night.totalMin || 0) > (prior.totalMin || 0)) byDate.set(night.wakeDate, night)
  }
  return [...byDate.values()]
    .sort((a, b) => b.wakeDate.localeCompare(a.wakeDate))
    .map((n) => ({
      date: n.wakeDate,
      score: n.value,
      asleepMin: n.totalMin,
      inBedMin: n.stats['in-bed'] ?? null,
      neededMin: n.stats.needed ?? null,
      debtMin: n.stats.debt ?? null,
      efficiency: n.stats.efficiency ?? null,
      consistency: n.stats.consistency ?? null,
      respiratoryRate: n.stats['respiratory-rate'] ?? null,
      disturbances: n.stats.disturbances ?? null,
      stages: n.parts,
      bedtime: n.window?.start ?? null,
      wake: n.window?.end ?? null,
    }))
}

export function createWhoopClient({
  clientId: clientIdOption,
  clientSecret: clientSecretOption,
  redirectUri: redirectUriOption,
  tokensFile,
  scopes = WHOOP_SCOPES,
  log = () => {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const wanted = Array.isArray(scopes) ? scopes : String(scopes).split(/\s+/).filter(Boolean)
  const WANTED = wanted.join(' ')
  // Each may be a value or a function returning one, so credentials entered in
  // Settings take effect without a restart.
  const read = (v) => (typeof v === 'function' ? v() : v)
  const clientId = () => read(clientIdOption) || ''
  const clientSecret = () => read(clientSecretOption) || ''
  const redirectUri = () => read(redirectUriOption) || ''
  const configured = () => Boolean(clientId() && clientSecret())

  // ---- token file -----------------------------------------------------------

  async function readTokens() {
    try { return JSON.parse(await readFile(tokensFile, 'utf8')) } catch { return null }
  }
  async function writeTokens(tokens) {
    await mkdir(dirname(tokensFile), { recursive: true })
    const tmp = `${tokensFile}.${randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify(tokens, null, 2), { mode: 0o600 })
    await rename(tmp, tokensFile)
    await chmod(tokensFile, 0o600).catch(() => {})
  }

  /*
   * Record that the stored grant is dead and only a re-authorization will fix
   * it. "Connected" means only that a refresh token is on disk, which stays true
   * after WHOOP has rotated it away; this flag is what says otherwise. Merged
   * into the file so the status can still show when the grant was made; any
   * successful exchange writes a fresh object, which clears it.
   */
  async function markNeedsReauth(reason) {
    const tokens = await readTokens()
    if (!tokens) return
    await writeTokens({
      ...tokens,
      needsReauth: true,
      lastError: truncate(reason || 'the saved WHOOP grant is no longer valid', 300),
      lastErrorAt: new Date(now()).toISOString(),
    })
  }

  /*
   * POST to the token endpoint and persist whatever comes back.
   *
   * `grantedScope` exists because a refresh response is not a reliable record of
   * what the grant can do: persisting its echo could quietly shrink a five-scope
   * grant to `offline`. The caller passes the scope the grant really holds.
   *
   * Retries a 5xx once. A gateway error is ambiguous (the origin may or may not
   * have rotated before the edge gave up), but retrying is still strictly better:
   * if the rotation never happened the retry fixes it, and if it did we were
   * already broken and the retry just returns the same 400.
   */
  async function tokenExchange(params, { grantedScope = null } = {}) {
    const body = new URLSearchParams({ ...params, client_id: clientId(), client_secret: clientSecret() })
    let r
    let text = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      r = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
      })
      text = await r.text()
      if (r.status < 500 || attempt === 2) break
      log(`token endpoint returned ${r.status}; retrying once`)
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    let tok = null
    try { tok = JSON.parse(text) } catch {}
    if (!r.ok || !tok?.access_token) {
      const reason = tok?.error_description || tok?.error || truncate(text, 200)
      // Only `invalid_grant` means the refresh token itself is dead. During a
      // WHOOP outage their edge returns 502s and generic `invalid_request` 400s
      // for minutes at a time and the same grant works afterwards; latching
      // "reconnect" on those would send the owner to fix a connection that was fine.
      const dead = params.grant_type === 'refresh_token' && tok?.error === 'invalid_grant'
      const fix = dead ? ' — the saved refresh token is no longer valid, reconnect WHOOP' : ''
      const message = `WHOOP token exchange failed (HTTP ${r.status})${reason ? ` — ${reason}` : ''}${fix}`
      if (dead) await markNeedsReauth(message)
      throw new WhoopError(message, { status: r.status, needsReauth: dead })
    }
    const saved = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token || params.refresh_token || '',
      scope: grantedScope || tok.scope || WANTED,
      token_type: tok.token_type || 'Bearer',
      expires_at: now() + (Number(tok.expires_in) || 3600) * 1000,
      updatedAt: new Date(now()).toISOString(),
    }
    await writeTokens(saved)
    return saved
  }

  // ---- OAuth -------------------------------------------------------------------

  const sessions = new Map() // state -> { createdAt }

  function startAuth() {
    if (!configured()) throw new WhoopError('add the WHOOP client ID and secret in Bushido Settings → WHOOP first (developer.whoop.com → your app)')
    const state = randomBytes(16).toString('hex')
    for (const [k, v] of sessions) if (now() - v.createdAt > 15 * 60 * 1000) sessions.delete(k)
    sessions.set(state, { createdAt: now() })
    const url = new URL(AUTH_URL)
    url.searchParams.set('client_id', clientId())
    url.searchParams.set('redirect_uri', redirectUri())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', WANTED)
    url.searchParams.set('state', state)
    return { ok: true, authUrl: url.toString(), redirectUri: redirectUri() }
  }

  // The callback is reached through sign-in, but the unguessable `state` is
  // still what ties it to a start.
  async function completeAuth(query) {
    const state = query.get('state') || ''
    const code = query.get('code') || ''
    const err = query.get('error') || ''
    if (err) return { ok: false, message: `Authorization was denied (${err}).` }
    if (!sessions.has(state)) return { ok: false, message: 'This sign-in link expired or was already used. Start again from Settings.' }
    if (!code) return { ok: false, message: 'The callback had no authorization code.' }
    try {
      const tokens = await tokenExchange({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })
      sessions.delete(state)
      if (!tokens.refresh_token) return { ok: false, message: 'WHOOP returned no refresh token — make sure the app requests the "offline" scope.' }
      return { ok: true, message: 'WHOOP connected.' }
    } catch (e) {
      return { ok: false, message: e.message }
    }
  }

  // One refresh at a time. When the app, Totem's sleep sync and Krakatoa all
  // find the access token expired in the same second, only the first refresh can
  // succeed; the rest would present a voided token and get a 400. Everyone who
  // arrives while a refresh is in flight waits for that one instead.
  let refreshing = null

  async function accessToken() {
    const tokens = await readTokens()
    if (!tokens?.refresh_token) throw new WhoopError('WHOOP is not connected yet — connect it in Bushido: profile → Settings', { needsReauth: true })
    if (tokens.access_token && tokens.expires_at > now() + 60_000) return tokens.access_token
    if (!refreshing) refreshing = refresh(tokens).finally(() => { refreshing = null })
    return refreshing
  }

  async function refresh(tokens) {
    // A caller that read the file just before another refresh finished holds a
    // refresh token WHOOP has already voided. The file has the new pair: use it.
    const current = await readTokens()
    if (current?.refresh_token && current.refresh_token !== tokens.refresh_token && current.expires_at > now() + 60_000) return current.access_token
    // The scope this grant ACTUALLY has, not the one we would like it to have:
    // a refresh cannot widen a grant, and RFC 6749 §6 treats the scope on a
    // refresh as the scope being requested, so asking for `offline` alone (as
    // WHOOP's docs show) can hand back a token that can't read sleep.
    const scope = tokens.scope || WANTED
    const refreshed = await tokenExchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope }, { grantedScope: scope })
    return refreshed.access_token
  }

  async function grantedScopes() {
    const tokens = await readTokens()
    return new Set(String(tokens?.scope || '').split(/\s+/).filter(Boolean))
  }

  // Fail with the fix rather than with a 403 from inside a fetch.
  async function requireScopes(needed) {
    const granted = await grantedScopes()
    const missing = needed.filter((s) => !granted.has(s))
    if (missing.length) {
      throw new WhoopError(`this WHOOP connection was authorized without ${missing.join(', ')} — reconnect WHOOP in Bushido to grant it`, { missingScope: missing[0], needsReauth: true })
    }
  }

  /*
   * Forget the grant. WHOOP's revoke endpoint is best-effort: whatever it says,
   * the file is the connection, and it goes.
   */
  async function disconnect() {
    const tokens = await readTokens()
    let revoked = false
    if (tokens?.refresh_token) {
      try {
        const token = await accessToken()
        const r = await fetchImpl(`${API}/user/access`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })
        revoked = r.ok
      } catch (e) {
        log(`revoke failed: ${e.message || e}`)
      }
    }
    await writeTokens({ disconnectedAt: new Date(now()).toISOString(), revoked })
    return { ok: true, revoked }
  }

  // ---- API -------------------------------------------------------------------

  /** One paginated collection, following next_token. `limit` caps at 25. */
  async function collection(pathname, { start, end, pages = 8 } = {}) {
    const token = await accessToken()
    const records = []
    let nextToken = ''
    for (let page = 0; page < pages; page++) {
      const url = new URL(`${API}${pathname}`)
      if (start) url.searchParams.set('start', start)
      if (end) url.searchParams.set('end', end)
      url.searchParams.set('limit', '25')
      if (nextToken) url.searchParams.set('nextToken', nextToken)
      const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } })
      if (r.status === 401) throw new WhoopError('WHOOP rejected the token — reconnect WHOOP in Bushido', { status: 401, needsReauth: true })
      if (r.status === 403) throw new WhoopError(`WHOOP refused ${pathname} — reconnect WHOOP in Bushido to grant the scope`, { status: 403, needsReauth: true })
      if (r.status === 429) throw new WhoopError('WHOOP rate limit hit — try again in a minute', { status: 429, rateLimited: true })
      if (!r.ok) throw new WhoopError(`WHOOP ${pathname} failed (HTTP ${r.status})`, { status: r.status })
      const data = await r.json()
      records.push(...(Array.isArray(data.records) ? data.records : []))
      nextToken = data.next_token || ''
      if (!nextToken) break
    }
    return records
  }

  /** Max heart rate, height and weight. A missing one costs a denominator, never the whole pull. */
  async function body() {
    try {
      const token = await accessToken()
      const r = await fetchImpl(`${API}/user/measurement/body`, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } })
      if (!r.ok) return null
      const b = await r.json()
      // At 0dp a 1.80 m athlete is 2 m tall and an 84.4 kg one weighs 84.
      const kg = num(b?.weight_kilogram, 2)
      const m = num(b?.height_meter, 3)
      return {
        maxHeartRate: num(b?.max_heart_rate, 0),
        weightKg: kg,
        weightLb: kg === null ? null : Math.round(kg * 2.20462 * 10) / 10,
        heightM: m,
        heightIn: m === null ? null : Math.round(m * 39.3701 * 10) / 10,
      }
    } catch {
      return null
    }
  }

  /**
   * Workouts, one row per day for how recovered they were and what the day
   * cost, and the nights. What this app caches, and what Krakatoa reads its
   * calorie burn from.
   *
   * Recovery is scored against a physiological CYCLE, not a calendar day, so
   * cycles are fetched too and used to date the recoveries, joining on
   * `cycle_id` rather than `created_at` (when WHOOP computed the number, which
   * can land either side of midnight).
   */
  async function training({ days = 14 } = {}) {
    await requireScopes(['read:workout', 'read:recovery', 'read:cycles', 'read:sleep'])
    // A day either side: a workout at 23:40 local sits outside a naive UTC window.
    const span = Math.min(Math.max(Math.round(Number(days)) || 14, 1), 60)
    const start = new Date(now() - (span + 1) * 86_400_000).toISOString()
    const end = new Date(now() + 86_400_000).toISOString()

    const [rawWorkouts, cycles, recoveries, sleeps, measured] = await Promise.all([
      collection('/activity/workout', { start, end }),
      collection('/cycle', { start, end }),
      collection('/recovery', { start, end }),
      collection('/activity/sleep', { start, end }),
      body(),
    ])

    const workouts = rawWorkouts
      .map(shapeWorkout)
      .filter((w) => w && w.date)
      .sort((a, b) => String(b.start).localeCompare(String(a.start)))

    // A cycle is dated by the morning you woke up into it, the wake time of the
    // sleep it contains, NOT by the cycle's own `start`: WHOOP opens a cycle at
    // sleep onset, so `start` is the evening before. Dating by `start` filed
    // today's recovery under yesterday, and a bedtime either side of midnight put
    // two cycles on one date where the second overwrote the first. Joining
    // through the sleep also keeps this on the same calendar as Totem's sleep habit.
    const wakeDateOfCycle = new Map()
    const longestSleep = new Map()
    for (const sleep of sleeps) {
      if (sleep?.nap === true || !sleep?.cycle_id) continue
      const date = localDate(sleep.end, sleep.timezone_offset)
      const len = Date.parse(sleep.end) - Date.parse(sleep.start)
      if (!date || !Number.isFinite(len)) continue
      if ((longestSleep.get(sleep.cycle_id) ?? -1) >= len) continue
      longestSleep.set(sleep.cycle_id, len)
      wakeDateOfCycle.set(sleep.cycle_id, date)
    }

    // No sleep to join means the night is still PENDING_SCORE or outside the
    // window. An evening start still means "the next day"; the cutoff is 18:00
    // so a mid-afternoon boundary fragment isn't pushed onto a real day.
    const cycleDate = (c) => {
      const joined = wakeDateOfCycle.get(c.id)
      if (joined) return joined
      const stamp = localStamp(c.start, c.timezone_offset, 16)
      if (!stamp) return null
      const date = stamp.slice(0, 10)
      return Number(stamp.slice(11, 13)) >= 18 ? shiftISODate(date, 1) : date
    }

    const dateOfCycle = new Map()
    const dayOf = new Map()
    // Oldest first, merging rather than replacing, so a fresher read lands and
    // can't blank a field it doesn't carry.
    for (const c of [...cycles].sort((a, b) => String(a.start).localeCompare(String(b.start)))) {
      const date = cycleDate(c)
      if (!date) continue
      dateOfCycle.set(c.id, date)
      const score = c.score || {}
      dayOf.set(date, {
        ...(dayOf.get(date) || {}),
        date,
        strain: num(score.strain, 1),
        dayAvgHr: num(score.average_heart_rate, 0),
        dayMaxHr: num(score.max_heart_rate, 0),
        kilojoules: num(score.kilojoule, 0),
        calories: kcal(score.kilojoule),
      })
    }
    for (const r of recoveries) {
      const date = dateOfCycle.get(r.cycle_id)
      if (!date) continue
      const score = r.score || {}
      dayOf.set(date, {
        ...(dayOf.get(date) || { date }),
        // WHOOP says outright when it does not trust its own number yet.
        calibrating: score.user_calibrating === true,
        recovery: num(score.recovery_score, 0),
        hrv: num(score.hrv_rmssd_milli, 1),
        restingHr: num(score.resting_heart_rate, 0),
        spo2: num(score.spo2_percentage, 1),
        skinTempC: num(score.skin_temp_celsius, 1),
      })
    }

    return {
      ok: true,
      fetchedAt: new Date(now()).toISOString(),
      days: span,
      maxHeartRate: measured?.maxHeartRate ?? null,
      body: measured,
      workouts,
      recovery: [...dayOf.values()].sort((a, b) => b.date.localeCompare(a.date)),
      sleep: sleepNights(sleeps),
    }
  }

  /**
   * Every scored night overlapping [start, end], one per sleep record, each
   * carrying `stats.recovery` from its cycle. What Totem's sleep habit is filled
   * from; Totem picks one per date and decides what to write.
   *
   * Sequential on purpose: the second call reuses the token the first fetched.
   */
  async function nights({ start, end, value = 'performance' } = {}) {
    await requireScopes(['read:sleep', 'read:recovery'])
    const records = await collection('/activity/sleep', { start, end, pages: 10 })
    const recoveries = await collection('/recovery', { start, end, pages: 10 })
    const scores = indexRecoveryScores(recoveries)
    const out = []
    for (const record of records) {
      const night = nightFromRecord(record, { value })
      if (!night) continue
      const recovery = scores.get(record?.cycle_id)
      if (recovery !== undefined) night.stats.recovery = recovery
      out.push(night)
    }
    return out
  }

  async function status() {
    const tokens = await readTokens()
    const granted = await grantedScopes()
    const missingScopes = wanted.filter((s) => !granted.has(s))
    const connected = Boolean(tokens?.refresh_token)
    const needsReauth = Boolean(tokens?.needsReauth)
    const state = !configured() ? 'unconfigured'
      : !connected ? 'disconnected'
      : needsReauth ? 'needs-reauth'
      : missingScopes.length ? 'missing-scopes'
      : 'ready'
    const DETAIL = {
      unconfigured: 'Add the WHOOP client ID and secret in Bushido Settings → WHOOP, then connect.',
      disconnected: 'Not connected yet.',
      'needs-reauth': 'WHOOP rejected the saved grant. Reconnecting is the only fix.',
      'missing-scopes': `Authorized without ${missingScopes.join(', ')}. Reconnect to grant it.`,
      ready: 'Connected.',
    }
    return {
      configured: configured(),
      // `connected` only means a refresh token is on disk; it stays true after
      // WHOOP rotates that token away. `state` and `needsReauth` are the health check.
      connected,
      needsReauth,
      state,
      detail: DETAIL[state],
      lastError: tokens?.lastError || null,
      lastErrorAt: tokens?.lastErrorAt || null,
      connectedAt: tokens?.updatedAt || null,
      scopes: [...granted],
      missingScopes,
    }
  }

  return { configured, status, startAuth, completeAuth, disconnect, accessToken, training, sleepNights: nights }
}
