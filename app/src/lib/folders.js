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
 * work go under rock climbing). A card that declares neither lands in "From the
 * plan", so a plan with no climbing in it (the example's runs) is not filed under
 * a sport it is not, and a card nobody tagged is still reachable.
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

/** Which folder a card belongs in. Undeclared is "From the plan", never nowhere. */
export function folderOf(opt) {
  const d = opt?.sched?.discipline
  return FOLDERS.some(f => f.key === d) ? d : 'plan'
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
      const mine = cards.filter(m => folderOf(m) === f.key)
      return { ...f, count: mine.length, groups: groupedSessions(plan, mine) }
    })
    .filter(f => f.count > 0)
}
