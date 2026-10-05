/*
 * Shared bits of the AI prompts: who the athlete is, and what they told us.
 *
 * The prompts were written for one person. They no longer carry their name, their
 * facts or their pronouns: the name and anything personal come from Settings →
 * About you, and everything else says "they" or "the athlete", so a fresh
 * install's coach knows only what its owner wrote there.
 */

/** The athlete's name for prose, or a neutral stand-in. */
const who = (name) => (String(name || '').trim() || 'the athlete')

/** The athlete's name as a speaker label in a transcript. */
const speaker = (name) => (String(name || '').trim() || 'Athlete')

/** The owner's own notes, as a prompt section — or nothing when there are none. */
function notesSection(name, notes) {
  const text = String(notes || '').trim()
  if (!text) return ''
  return `WHAT ${who(name).toUpperCase()} HAS TOLD YOU ABOUT THEMSELVES

These are their own words from Settings. Treat them as facts about this athlete
that outrank any general rule of thumb below.

${text}
`
}

module.exports = { who, speaker, notesSection }
