/*
 * A row's meta line (app/src/metaline.jsx), shared by Today's day list and the
 * session sheet's header. Its own file since #73 so the sheet (sheet.tsx) and
 * Today (tabs.tsx) can both use it without importing each other.
 */

/**
 * "1 exercise · 3 sets · about 45 min · with Sam" that wraps only BETWEEN its
 * pieces: the spaces inside a piece, and before each dot, are non-breaking (the
 * web's `.meta-bit`), so a long line reads as two tidy lines, never "45 / min".
 */
export const metaText = (bits: (string | null | undefined)[]) => {
  const parts = bits.filter(Boolean).flatMap((b) => String(b).split(' · '))
  return parts.map((p, i) => p.replace(/ /g, '\u00a0') + (i < parts.length - 1 ? '\u00a0·' : '')).join(' ')
}
