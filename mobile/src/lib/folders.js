/*
 * The plan's cards, foldered under the climbing they belong to.
 *
 * Until 2026-10-14 the + button had two doors for one act: *Log a workout* over
 * the 91-sport catalog, and *Pick a session* over the plan's own cards. Two
 * lists for "write down what I did" meant the user had to know which list a
 * thing lived in before finding it, and the second door only ever put a card on
 * TODAY, so a board session from Monday could not be logged on Monday at all.
 *
 * Now there is one door. The plan's cards sit inside it as folders, the way the
 * user thinks about them: by the climbing, not by the plan. A card declares
 * `sched.discipline` as `"bouldering"` or `"rock-climbing"` (hangboard and support
 * work go under rock climbing), or, on an older plan that never declared it, is
 * filed by what it says about itself (`folderOf`, below). A card that is not
 * climbing lands in "From the plan", so a plan with no climbing in it (the
 * example's runs) is not filed under a sport it is not, and a card nobody tagged
 * is still reachable.
 *
 * THE FOLDERS ARE NOT CATALOG ACTIVITIES, and that is the point. Climbing must
 * never be one-tap logged as a generic workout, because the hard-finger question
 * lives on the climbing cards and the finger budget only sees what they log (see
 * AGENTS.md §6.1). A folder is a door to those cards, nothing more: picking from
 * it places the real card, with its protocol, its timer and its question.
 */

export const FOLDERS = [
  { key: 'bouldering', name: 'Bouldering', icon: 'Grid2x2' },
  { key: 'rock-climbing', name: 'Rock climbing', icon: 'Mountain' },
  { key: 'plan', name: 'From the plan', icon: 'Layers' },
]

/*
 * A CARD THAT NEVER SAID WHICH FOLDER (issue #81). `sched.discipline` arrived on
 * 2026-10-14, and a plan written before it, the owner's own included, has none on
 * any card: every climbing card then sat in one "From the plan" folder after the
 * ninety sports, and the Bouldering and Rock climbing doors did not exist. So an
 * undeclared card is filed by what it already says about itself, in this order:
 *
 *   1. Is it climbing at all? Its own `discipline: "climbing"`, its category's
 *      discipline in `quotaCategories`, or `sched.whoopSport: "climbing"`. A card
 *      that says none of these is not guessed into climbing: it stays in "From the
 *      plan", which is still a door (the example's runs, a support circuit).
 *   2. Bouldering if it grades on the V scale and nothing else (every exercise
 *      that logs climbs says `climbLog.scale: "v"`), or calls itself bouldering in
 *      its name. Everything else that is climbing (routes, laps, the hangboard and
 *      the load-cell tests) is Rock climbing, which is where a declared plan puts
 *      hangboard work too.
 *
 * A declared `sched.discipline` always wins, so a plan that says is never second-
 * guessed. Read, never written: the plan file is the owner's, outside the repo.
 */
const declared = (opt) => (FOLDERS.some(f => f.key === opt?.sched?.discipline) ? opt.sched.discipline : null)

/** Does a card say, anywhere, that it is climbing? */
export function isClimbingCard(opt, plan = null) {
  if (!opt) return false
  if (declared(opt) === 'bouldering' || declared(opt) === 'rock-climbing') return true
  if (opt.discipline === 'climbing') return true
  if (opt.sched?.whoopSport === 'climbing') return true
  const cat = (plan?.quotaCategories || []).find(c => c.key === opt.category)
  return cat?.discipline === 'climbing'
}

const BOULDER_WORDS = /\bboulder/i

function inferredFolder(opt, plan) {
  if (!isClimbingCard(opt, plan)) return 'plan'
  const scales = (opt.logSpec?.exercises || []).map(ex => ex?.climbLog?.scale).filter(Boolean)
  if (scales.length && scales.every(s => s === 'v')) return 'bouldering'
  if (!scales.length && BOULDER_WORDS.test(opt.name || '')) return 'bouldering'
  return 'rock-climbing'
}

/**
 * Which folder a card belongs in: what it declares, else what it says about
 * itself (above). Undeclared and not climbing is "From the plan", never nowhere.
 * `plan` lets a card's category speak for it; without it the card alone decides.
 */
export function folderOf(opt, plan = null) {
  return declared(opt) || inferredFolder(opt, plan)
}

/** Is this folder one of the climbing ones (not the catch-all)? */
export const isClimbingFolder = (key) => key === 'bouldering' || key === 'rock-climbing'

/**
 * What a card is found by when the search box is used, beyond its own name and
 * dose: the folder's words, so "boulder", "climb" or "route" reaches every
 * climbing card without the user knowing what the plan called it.
 */
export function folderSearchWords(opt, plan = null) {
  const f = folderOf(opt, plan)
  if (f === 'bouldering') return 'climbing climb bouldering boulder problems'
  if (f === 'rock-climbing') return 'climbing climb rock routes sport lead top rope'
  return ''
}

/**
 * The cards a folder can offer.
 *
 * Not adjuncts (ticked inside the session they ride with), not the rest card (it
 * has its own door), not retired cards (kept only so old days resolve), and not
 * the two containers that declare `sched.repeatVia`: the workout card IS the
 * screen these folders sit in, and the planned card is what *Plan a workout*
 * writes.
 */
export function folderCards(plan) {
  return (plan?.dailyMenu || []).filter(m =>
    m.role !== 'adjunct' && m.role !== 'rest' && !m.retired && !m.sched?.repeatVia)
}

/**
 * The cards grouped by the category each declares, in plan order.
 *
 * Authored, stable and not a ranking: a list that reorders itself under the
 * user's thumb is the thing the swap list was removed for.
 */
export function groupedSessions(plan, cards = folderCards(plan)) {
  const cats = plan?.quotaCategories || []
  const groups = cats
    .map(c => ({
      key: c.key, name: c.name, icon: c.icon,
      items: cards.filter(m => (m.category || m.categoryFrom) === c.key),
    }))
    .filter(g => g.items.length > 0)

  // A card that names no category, or one the plan no longer declares.
  const claimed = new Set(groups.flatMap(g => g.items.map(m => m.id)))
  const rest = cards.filter(m => !claimed.has(m.id))
  if (rest.length) groups.push({ key: '_other', name: 'Everything else', icon: 'Sparkles', items: rest })
  return groups
}

/** The folders with their cards, empty ones dropped (the starter has none). */
export function climbingFolders(plan) {
  const cards = folderCards(plan)
  return FOLDERS
    .map(f => {
      const mine = cards.filter(m => folderOf(m, plan) === f.key)
      return { ...f, count: mine.length, groups: groupedSessions(plan, mine) }
    })
    .filter(f => f.count > 0)
}
