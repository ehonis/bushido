/*
 * What a session adds up to, in words, on one line.
 *
 * Pulled out of `tabs.jsx` on 2026-09-21 because the day list stopped being the
 * only place that asks. The quota bars ask it too: pressing a bar opens onto the
 * workouts that filled it, and a row reading "Lunch Ride With friends · 45 min"
 * is a row that has not said which ride it was — pressing a bar felt like it
 * went nowhere, partly because there was nothing on the row worth arriving at.
 *
 * Pure, and takes the resolved card rather than the menu, so it has no opinion
 * about where an entry came from.
 */
// Native: the web's app/src/setlog.jsx is features/setlog.tsx here.
import { totalSets, totalReps } from '../features/setlog'
import { liftsLine } from './lifts.js'

/** "8:04 /mi" from distance and time — the number you'd have worked out anyway. */
function paceLabel(out) {
  const mi = Number(out.distance)
  const min = Number(out.duration)
  if (!(mi > 0) || !(min > 0)) return null
  const per = min / mi
  return `${Math.floor(per)}:${String(Math.round((per % 1) * 60)).padStart(2, '0')} /mi`
}

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

/** The one-line readout of a session, wherever one is listed. */
export function sessionStats(entry, opt) {
  if (opt?.role === 'rest') return restStats(entry, opt)
  const out = entry?.data?.out || {}
  const bits = []
  const mins = entry?.data?.minutes ?? opt?.minutes
  if (mins) bits.push(`${mins} min`)
  if (Number(out.distance) > 0) bits.push(`${out.distance} mi`)
  const pace = paceLabel(out)
  if (pace) bits.push(pace)
  if (Number(out.speed) > 0) bits.push(`${out.speed} mph`)
  if (Number(out.elevation) > 0) bits.push(`${out.elevation} ft up`)
  const sets = totalSets(out)
  const reps = totalReps(out)
  if (sets) bits.push(`${sets} set${sets === 1 ? '' : 's'}${reps ? `, ${reps} reps` : ''}`)
  // A lift session's exercises are their own list, not the plan's set log — see
  // lib/lifts.js. "6 exercises · 18 sets · 4,120 lb" in one bit.
  const lifting = liftsLine(out)
  if (lifting) bits.push(lifting)
  if (Number.isFinite(out.intensity)) bits.push(`intensity ${out.intensity}/4`)
  if (Number.isFinite(out.rpe)) bits.push(`RPE ${out.rpe}`)
  if (Number.isFinite(out.fingers)) bits.push(`fingers ${out.fingers}/5`)
  return bits
}
