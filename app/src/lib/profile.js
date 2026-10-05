/*
 * Who the user is — the facts the app should know and was previously guessing at.
 *
 * Added 2026-09-15 with the profile page. Before it, the app knew their bodyweight
 * (a real series, charted, going back to July) and nothing else: their height, their
 * heart rates, their FTP and their current grades were either absent or buried in
 * `content/plan.json` as prose written once in August.
 *
 * THREE STORES, AND WHICH ONE A FACT BELONGS IN IS THE WHOLE DESIGN.
 *
 * **Series** — bodyweight. Facts that move and whose history is the point. These
 * already live as dated entries (`kind: 'bodyweight'`) and this file does not
 * touch them: a profile page that overwrote a chart's history to show one number
 * would be a bad trade. The page reads the latest and writes a new point.
 *
 * **Standing facts** — height, resting and max HR, FTP, ape index, current
 * grades. One value at a time, edited rarely, no history worth keeping. One
 * `kind: 'profile'` entry holding all of them, so it syncs and merges per-id like
 * everything else in the log.
 *
 * **Settings** — units, blurbs. Already in the synced settings blob (see
 * prefs.jsx), and stay there. They are preferences about the app rather than
 * facts about them, and the distinction is worth keeping even though both end up
 * on the same page.
 *
 * STRAVA IS A SOURCE, NOT AN OWNER. It knows their name, their picture, their weight
 * and their FTP. Name and picture come from it outright — there is nowhere else to
 * get them. Weight and FTP it merely OFFERS: the value on screen is their if the user has
 * set one, Strava's if the user has not, and the difference is labelled. Silently
 * preferring Strava's 149 lb over a number the user typed this morning is the same
 * mistake as a pre-filled duration confirmed without being read.
 */

export const PROFILE_ID = 'profile'
export const PROFILE_KIND = 'profile'

export function profileEntry(entries = []) {
  return entries.find(e => e?.id === PROFILE_ID && e.kind === PROFILE_KIND && !e.deleted) || null
}

/** The standing facts the user has set. `{}` when the user has set none. */
export const profileFacts = (entries = []) => profileEntry(entries)?.data?.facts || {}

export const buildProfileEntry = (facts) => ({
  id: PROFILE_ID,
  kind: PROFILE_KIND,
  // Undated on purpose: this is not something that happened on a day, and dating
  // it would put it in the log feed between two workouts.
  date: null,
  data: { facts },
})

/* ------------------------------------------------------------ the athlete */

const nonEmpty = (v) => v !== undefined && v !== null && v !== ''

/**
 * Name and avatar, from Strava, with an honest fallback.
 *
 * `profileMedium` is the one to render — the large one is 300px for a 32px slot.
 * Initials when there is no picture, and "You" when there is no Strava at all,
 * because a header that says `null` is worse than a header that says nothing.
 */
export function athleteOf(strava) {
  const a = strava?.athlete || null
  const name = a?.name || a?.firstname || null
  return {
    name: name || 'You',
    firstName: a?.firstname || (name ? String(name).split(' ')[0] : null),
    avatar: a?.profileMedium || a?.profile || null,
    initials: name
      ? String(name).split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
      : null,
    connected: Boolean(a),
  }
}

/* --------------------------------------------------------------- the facts */

/**
 * One field's value, and where it came from.
 *
 * The provenance is not decoration. `own` is a number the user gave; `strava` is one it
 * is showing on their behalf and will keep updating; `none` is a blank the user should
 * fill. The screen renders all three differently for the same reason `filledBy`
 * tags a WHOOP-filled distance — a value the user did not give must never look like one
 * the user did.
 */
export function factValue(field, { facts = {}, strava = null, entries = [] }) {
  const own = facts[field.key]
  if (nonEmpty(own)) return { value: own, source: 'own' }

  if (field.from === 'strava-weight') {
    const lb = strava?.athlete?.weightLb
    if (nonEmpty(lb)) return { value: lb, source: 'strava' }
  }
  if (field.from === 'strava-ftp') {
    const ftp = strava?.athlete?.ftp
    if (nonEmpty(ftp)) return { value: ftp, source: 'strava' }
  }
  if (field.from === 'bodyweight') {
    // The live series, which is the real answer for weight — the profile shows
    // the latest point and writing a new one goes back into the same series.
    const latest = [...entries]
      .filter(e => e?.kind === 'bodyweight' && !e.deleted && e.date && Number(e.data?.lb) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .at(-1)
    if (latest) return { value: Number(latest.data.lb), source: 'logged', date: latest.date }
  }
  return { value: null, source: 'none' }
}

/**
 * The profile form, as content.
 *
 * Declared here rather than in plan.json because — unlike a session or an activity
 * — these are not training content and there is no reason to revise them without a
 * rebuild. They are the app's own vocabulary for a person.
 */
export const PROFILE_GROUPS = [
  {
    key: 'body',
    name: 'Body',
    icon: 'HeartPulse',
    blurb: 'What the numbers get divided by. Bodyweight is a series and lives in the '
         + 'log; the rest are standing facts.',
    fields: [
      { key: 'weightLb', label: 'Bodyweight', unit: 'lb', type: 'number',
        from: 'bodyweight', writes: 'bodyweight', eg: '186',
        hint: 'Logs a new point in the series the charts already use.' },
      { key: 'heightIn', label: 'Height', unit: 'in', type: 'number', eg: '71' },
      { key: 'restingHr', label: 'Resting HR', unit: 'bpm', type: 'number', eg: '48',
        hint: 'WHOOP measures this nightly — this is for your own reference.' },
      { key: 'maxHr', label: 'Max HR', unit: 'bpm', type: 'number', eg: '190',
        hint: 'The one that turns a heart rate into a zone.' },
      { key: 'ftp', label: 'FTP', unit: 'w', type: 'number', from: 'strava-ftp', eg: '220',
        hint: 'Set it on Strava and it shows here automatically.' },
    ],
  },
  {
    key: 'climbing',
    name: 'Climbing',
    icon: 'Mountain',
    blurb: 'Where you actually are, as opposed to where the goal is.',
    fields: [
      { key: 'redpoint', label: 'Redpoint grade', type: 'text', eg: '5.11c' },
      { key: 'flash', label: 'Flash / onsight', type: 'text', eg: '5.10d' },
      { key: 'boulder', label: 'Boulder grade', type: 'text', eg: 'V6' },
      { key: 'apeIndex', label: 'Ape index', unit: 'in', type: 'number', eg: '+2',
        hint: 'Wingspan minus height. Positive is longer arms.' },
      { key: 'climbingSince', label: 'Climbing since', type: 'text', eg: '2023' },
    ],
  },
]
