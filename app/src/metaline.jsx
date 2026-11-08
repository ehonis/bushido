/*
 * A row's meta line, shared by Today's day list and the session sheet's header.
 * Its own file since #73 so the sheet (sheet.jsx) and Today (tabs.jsx) can both use
 * it without importing each other.
 */

/** A meta line's pieces: "1 exercise · 3 sets" counts as two, blanks as none. */
export const metaParts = (bits) => (bits || []).filter(Boolean).flatMap(b => String(b).split(' · '))

/**
 * "1 exercise · 3 sets · about 45 min · with Sam", which wraps only BETWEEN its
 * pieces (each is `white-space: nowrap`, the dot ending the line it is on), so a
 * long one reads as two tidy lines on a phone instead of breaking "45 / min".
 */
export function MetaLine({ bits }) {
  const parts = metaParts(bits)
  return parts.map((p, i) => (
    <span key={i}>
      <span className="meta-bit">{p}{i < parts.length - 1 ? ' ·' : ''}</span>
      {i < parts.length - 1 ? ' ' : ''}
    </span>
  ))
}
