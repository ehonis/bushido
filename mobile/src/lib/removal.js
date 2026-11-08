/*
 * What a removal says (#77): the exercise, or which set of it, and nothing else
 * the app cannot know.
 *
 * THE RULE, written after two review rounds in which every per-case claim about
 * the other side of a synced workout opened a new case: a removal's toast never
 * says what happened on someone else's side. The server decides that
 * (server/sharedsync.js: set counts are adjusted, and anything they logged on
 * stays), from data this device does not have. So the words are only what is
 * certain, "Removed set 2 of Hip adduction" / "Removed Hip adduction", and on a
 * synced workout one static line that states the rule itself. Undo puts back
 * this side exactly and says nothing about the other.
 *
 * Copied byte for byte to mobile/src/lib (app/libsync.test.js), so the web and
 * the phone say the same words.
 */

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
export const bothWords = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

/**
 * The synced line: who the exercises stay in step with, and that what each of
 * them logged stays theirs. `names` are the other sides ("you" when the owner is
 * looking at someone else's copy).
 */
export function syncLine(names) {
  const who = bothWords(names)
  if (names.length === 1 && names[0] === 'you') return 'Exercises stay in step with you: what you have logged stays on your side.'
  if (names.length === 1) return `Exercises stay in step with ${who}: what ${who} has logged stays on ${who}'s side.`
  return `Exercises stay in step with ${who}: what each of them has logged stays on their side.`
}

/**
 * "Removed Hip adduction" / "Removed set 2 of Hip adduction", then the synced
 * line when `syncedWith` names anyone. `lastTakesItem`: on a plan the last set
 * going takes the exercise with it (`removeSet`); the lift log keeps one blank
 * row instead.
 *
 * @param {any} item
 * @param {number | null} [setIndex]
 * @param {{ lastTakesItem?: boolean, syncedWith?: string[] | null }} [opts]
 */
export function removalWords(item, setIndex = null, { lastTakesItem = true, syncedWith = null } = {}) {
  const name = item?.name || 'the exercise'
  const whole = setIndex === null || setIndex < 0 || (lastTakesItem && (item?.sets?.length || 0) <= 1)
  const said = `Removed ${whole ? name : `set ${setIndex + 1} of ${name}`}`
  return syncedWith?.length ? `${said}. ${syncLine(syncedWith)}` : said
}
