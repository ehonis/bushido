/*
 * What a rest day says, on one line.
 *
 * This file used to hold `sessionStats`, the one-line readout of any session,
 * pulled out of `tabs.jsx` on 2026-09-21 for the quota bars. The bars went in
 * #31 and nothing called it after (regrade F10, #97): each list now builds its
 * own line from the shared readers (`climbLine`, `liftedLine`, `loggedMinutes`),
 * so it was removed rather than left to drift from them.
 *
 * Pure, and takes the resolved card rather than the menu, so it has no opinion
 * about where an entry came from.
 */

/**
 * A rest day has no numbers, so its readout is WHY: the reason chip RestPrompt
 * asked for (the rest card's `why` output, labelled from plan.json) and what the user
 * wrote. Without this the row read "Rest day" and nothing else, and the answer the user
 * had just given was only findable by opening the sheet (2026-09-25).
 */
export function restStats(entry, opt) {
  const out = entry?.data?.out || {}
  const field = (opt?.outputs || []).find(f => f.key === 'why')
  const why = field?.options?.find(o => o.value === out.why)?.label || null
  const note = typeof out.notes === 'string' ? out.notes.trim() : ''
  return [why, note ? (note.length > 80 ? `${note.slice(0, 79)}…` : note) : null].filter(Boolean)
}
