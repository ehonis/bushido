/*
 * The write paths of a logged workout, in one place (#76).
 *
 * A workout can be opened from Today or from the Log, and until #76 the two
 * sheets wrote it differently. Today's save went through `applyOut` (the load
 * level, the name, `resolveMinutes`, a weight mode reaching its plan item) and
 * wrote the test result a test session implies; the Log's save spread the out
 * onto the entry and recomputed the name, nothing else. So correcting a MVC-7's
 * added weight from the Log changed the workout and left its test result, and
 * the chart, on the old number. The Log's delete removed the workout and left
 * its test result behind, with no Undo.
 *
 * Every sheet that edits a logged workout takes its writes from here, on the
 * web (tabs.jsx, log.jsx) and on the phone (the same file in mobile/src/lib,
 * byte for byte). What differs between the screens (which day, who may edit)
 * is the caller's; how a workout is written is not.
 *
 * Pure apart from the four functions it is handed: the store's `upsertEntry` and
 * `deleteEntry`, and the platform's `toast` (lib/toast's `pushToast`) with the
 * Undo glyph it draws (lucide's Undo2 on the web; null on the phone, whose host
 * draws Retry's arrow only).
 */

import { optFor } from './menu.js'
import { markDone } from './store.js'
import { testEntryFor, testEntryId, testFor } from './tests.js'
import { titleFor, withCasualName } from './naming.js'
import { applyOut, applyRun, applyPlan } from './trainer.js'

/** The words a removal toast says. */
export const removedText = (name) => (name ? `Removed ${name}` : 'Removed')

/** How long the Undo stays on screen. */
export const UNDO_MS = 6000

export function sessionOps({ plan, entries = [], upsertEntry, deleteEntry, toast = null, undoIcon = null }) {
  const menu = plan?.dailyMenu || []
  const optOf = (entry) => optFor(menu, entry?.data?.optId)
  const live = (id) => entries.find(e => e.id === id && !e.deleted) || null

  /** The id of the test result this entry's session writes, or null. */
  const testIdOf = (entry, opt = optOf(entry)) => {
    const test = testFor(plan, opt)
    return test && entry?.date ? testEntryId(entry.date, test.id) : null
  }

  /*
   * Outputs attach to their own entry. `applyOut` (lib/trainer.js), shared with
   * someone else's side of a workout: the level the out implies (a session that
   * declares `levelFrom` rewrites the day's load from what was logged), the name
   * (a PLANNED session is named by its plan, so "Legs" does not become "Lift"
   * the first time the effort slider moves), `resolveMinutes`, which keeps a
   * correction made before `out.minutesSpent` existed, and a weight mode
   * switched on a logged lift reaching its plan item.
   *
   * A session that IS a test writes its result too, so the Testing series comes
   * from the session actually done (lib/tests.js). When the numbers it needs are
   * all cleared, the result it wrote goes with them: a stale point on the chart
   * is the same wrong answer as a measured zero. That removes data, so it says so
   * with an Undo, which puts back the workout as it was before this save and the
   * result with it.
   */
  const saveOutputs = (entry, out) => {
    const opt = optOf(entry)
    upsertEntry(applyOut(entry, opt, out))
    const result = testEntryFor({ plan, session: opt, date: entry.date, out })
    if (result) { upsertEntry(result); return }
    const id = testIdOf(entry, opt)
    const stored = id ? live(id) : null
    if (!stored) return
    deleteEntry?.(id)
    const test = testFor(plan, opt)
    toast?.(removedText(test?.name ? `the ${test.name} result` : 'the test result'), 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: undoIcon, onClick: () => {
        upsertEntry(entry)
        upsertEntry(stored)
      } },
    })
  }

  /*
   * "Just miles": `training: false` plus the name it gives itself, which is only
   * ever a BLANK name filled and only ever its own taken back (lib/naming.js).
   * Curried, because the sheet hands the switch a one-argument callback.
   */
  const setTraining = (entry, opt = optOf(entry)) => (v) => {
    const casual = v === false
    const out = withCasualName(entry.data?.out || {}, { plan, opt, on: casual })
    upsertEntry({ ...entry, data: {
      ...entry.data, out,
      name: titleFor(opt, out, entry.data?.plan),
      training: casual ? false : undefined,
    } })
  }

  /*
   * Taking a workout out of the log, with an Undo.
   *
   * The entry and everything it wrote go: the test result too, or the chart
   * would keep a point for a session that is no longer in the log. The sheet's
   * confirm asks first; the toast is the way back from a wrong answer, and Undo
   * writes the entry (and its result) back as they were. A tombstone is just a
   * later write, so the restored live entry wins the merge.
   */
  const removeSession = (entry) => {
    const opt = optOf(entry)
    const testId = testIdOf(entry, opt)
    const result = testId ? live(testId) : null
    deleteEntry?.(entry.id)
    if (testId) deleteEntry?.(testId)
    const back = ({ deleted, ...rest }) => rest
    const name = opt ? titleFor(opt, entry.data?.out, entry.data?.plan) : entry.data?.name
    toast?.(removedText(name), 'info', {
      duration: UNDO_MS,
      action: { label: 'Undo', icon: undoIcon, onClick: () => {
        upsertEntry(back(entry))
        if (result) upsertEntry(back(result))
      } },
    })
  }

  /** "Mark done" / "Mark undone" (`markDone`, the only writer of `undone`). */
  const setDone = (entry, done) => upsertEntry(markDone(entry, done))

  /*
   * The runner's ONE write (AGENTS.md §6.2): the position and, in the same
   * write, the outputs, the done flag and a plan that grew a set. `out` is null
   * on a rest-clock nudge, which changes the run and nothing else.
   */
  const saveRun = (entry, run, opts = {}) => upsertEntry(applyRun(entry, optOf(entry), run, opts))

  /** Editing the prescription itself, after it has landed (`applyPlan`). */
  const savePlan = (entry, pres) => upsertEntry(applyPlan(entry, optOf(entry), pres))

  return { saveOutputs, setTraining, removeSession, setDone, saveRun, savePlan }
}
