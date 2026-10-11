/*
 * The activity catalog — every sport the app can log, and the form each one gets.
 *
 * It exists so any sport can be logged, including every sport WHOOP can record
 * (a dance session, for example), not just a fixed handful.
 *
 * The thing that made it urgent is in the real data. `data/whoop.json` holds six
 * distinct sports, and three of them — `dance`, `mountain-biking` and WHOOP's own
 * generic `activity` — mapped to NOTHING in the old nine-value `activity` choice.
 * Attaching one of those workouts filled in no activity at all, so the card stayed
 * blank and every field stayed hidden behind a gate that could never pass.
 *
 * MODELLED ON THE LIFT CATALOG, deliberately. `lifts.js` already solved this exact
 * problem for two hundred exercises: the vocabulary is CONTENT, it lives on the
 * field's own spec in plan.json, and adding to it is an edit with no rebuild. The
 * same rule applies here, for the same reason — "every sport you can think of" is
 * a list that is wrong the day it ships.
 *
 * Four routing fields do all the work:
 *
 *   shape       which of `plan.formShapes` the user gets — distance | pool | lift | time
 *   category    the quota category it fills (see quota.js)
 *   discipline  what it spaces against (see recommend.js)
 *   whoop       the WHOOP `sport_name` values that resolve here
 *
 * CLIMBING IS NOT IN HERE, and that is the one absence worth defending. The
 * climbing sessions are dailyMenu cards, they ask the hard-finger question, and
 * that answer is what the injury budget counts. A second way to log climbing is a
 * way for a hard finger day to land somewhere the budget cannot see it — which is
 * the same argument the old card's SPORT_CHOICE made when it mapped climbing to
 * null, and it survives the rewrite unchanged.
 */

/** The catalog off a `type: "activity"` field. Empty rather than undefined. */
export function catalogOf(field) {
  return {
    activities: field?.activities || [],
    groups: field?.groups || [],
  }
}

/** One activity by key, or null. */
export function activityOf(field, key) {
  if (!key) return null
  return catalogOf(field).activities.find(a => a.key === key) || null
}

/** "Mountain bike", or the raw key if the catalog no longer knows it. */
export function activityLabel(field, key) {
  return activityOf(field, key)?.name || key || ''
}

/** The quick-picks, in catalog order. Their own six sports, not a guess at everyone's. */
export const pinnedActivities = (field) => catalogOf(field).activities.filter(a => a.pinned)

/** Catalog grouped for a picker, in the plan's group order, empty groups dropped. */
export function groupedActivities(field) {
  const { activities, groups } = catalogOf(field)
  return groups
    .map(name => ({ name, items: activities.filter(a => a.group === name) }))
    .filter(g => g.items.length)
}

/*
 * Search.
 *
 * Same three-tier ranking as the lift chooser, and the same reason: with ninety-one
 * entries a substring match on its own puts "Race walk" above "Run" for the query
 * "ru", which is the kind of thing that makes a picker feel broken. Prefix beats
 * word-start beats substring, and `aka` is searched so "mtb", "erg", "zwift" and
 * "cold plunge" all land where they should.
 */
export function searchActivities(field, query) {
  const { activities } = catalogOf(field)
  const q = String(query || '').trim().toLowerCase()
  if (!q) return []
  const scored = []
  for (const a of activities) {
    const names = [a.name, ...(a.aka || [])].map(s => String(s).toLowerCase())
    let best = 0
    for (const n of names) {
      if (n.startsWith(q)) best = Math.max(best, 3)
      else if (n.split(/[\s-]+/).some(w => w.startsWith(q))) best = Math.max(best, 2)
      else if (n.includes(q)) best = Math.max(best, 1)
    }
    if (String(a.group).toLowerCase().includes(q)) best = Math.max(best, 1)
    if (best) scored.push({ a, best })
  }
  // Shortest name wins a tie before alphabetical does. "ru" must return Run
  // before Ruck: both are prefix matches, and sorting equal scores by name puts
  // Ruck first purely because c sorts before n.
  return scored
    .sort((x, y) => y.best - x.best || x.a.name.length - y.a.name.length ||
                    x.a.name.localeCompare(y.a.name))
    .map(s => s.a)
}

/* ------------------------------------------------------------ derived gates */

/*
 * The gate keys a field may test that are NOT answers the user typed.
 *
 * A field could in principle gate on `activity` directly — `when: { activity:
 * ["run", "trail-run", "treadmill-run", ...] }` — and for nine activities that is
 * what the old card did. For ninety-one it is unmaintainable: adding one sport
 * would mean remembering to add its key to every field that applies to it, and the
 * failure mode is a silently missing field months later. So fields gate on what the
 * CATALOG says about the activity instead, and this resolver is what answers them.
 *
 * Derived, never stored. The alternative — writing `shape` onto the entry when the user
 * picks an activity — would mean a catalog correction never reaches the sessions
 * already logged against it, which is the same mistake as storing a computed
 * average speed. See the note at the top of outputs.js.
 */
export const DERIVED_GATES = ['shape', 'category', 'discipline', 'elevation', 'incline', 'indoor', 'openWater']

/**
 * A resolver for `fieldVisible`, bound to one session's catalog.
 *
 * Returns undefined for anything that is not a catalog fact, which `fieldVisible`
 * treats as unanswered — so a gate on a key this does not know hides its field
 * rather than showing it. Unanswered is hidden, everywhere, for the reason the
 * card opens as a single question.
 */
export function gateResolver(session) {
  const field = (session?.outputs || []).find(o => o.type === 'activity')
  if (!field) return null
  return (key, out) => {
    if (!DERIVED_GATES.includes(key)) return undefined
    const a = activityOf(field, out?.activity)
    return a ? a[key] : undefined
  }
}

/* ------------------------------------------------------- what an entry was */

/**
 * The catalog entry behind a logged workout, or null.
 *
 * `categoryFrom: "activity"` on the session is what says "ask the catalog" — the
 * climbing cards name their category outright and never come through here.
 */
export function loggedActivity(opt, out) {
  if (opt?.categoryFrom !== 'activity' && opt?.disciplineFrom !== 'activity') return null
  const field = (opt?.outputs || []).find(o => o.type === 'activity')
  return activityOf(field, out?.activity)
}

/**
 * What DISCIPLINE a logged session belongs to — the same indirection as
 * `loggedActivity`, and the answer the quick names and the spacing rules read.
 *
 * Lives here rather than in `quota.js` because two callers now want it without
 * the menu in hand: `disciplineOf(entry, menu)` resolves the card first and then
 * asks this, and `naming.js` already has the card.
 */
export function disciplineFor(opt, out) {
  if (opt?.disciplineFrom === 'activity') return loggedActivity(opt, out)?.discipline || null
  return opt?.discipline || null
}
