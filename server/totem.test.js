#!/usr/bin/env node
/*
 * Regression tests for the Totem habit rollup.
 *
 * These exist because two bugs shipped here and both produced *false training
 * history*, which is worse than no history:
 *
 *   1. Any daily entry marked the habit complete. Swapping your main session or
 *      adding an extra creates an entry, so planning a day silently claimed you
 *      had trained it.
 *   2. Sync ran per entry, so on a two-session day the last write won and the
 *      other session's note was discarded.
 *
 * Run: node server/totem.test.js
 */

const { habitBodyForDay } = require('./server.js')

let failed = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(ok ? `  ok    ${label}` : `  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`)
}

const S = (id, date, data, deleted) => [id, { id, kind: 'daily', date, data, deleted }]

const state = {
  entries: Object.fromEntries([
    // Swapped a main in and added an extra. Neither actually done.
    S('daily-2026-08-05', '2026-08-05',
      { slot: 'main', optId: 'four-by-four', name: 'Bouldering 4×4s', done: false, out: {} }),
    S('daily-2026-08-05-fun-boulder', '2026-08-05',
      { slot: 'extra', optId: 'fun-boulder', name: 'Bouldering with friends', done: false, out: {} }),
    // Written before `done` existed — only ever created by pressing "log this".
    S('daily-2026-08-03', '2026-08-03',
      { optId: 'hard-home', name: 'Max hangs + repeaters', out: { rpe: 7, fingers: 2 } }),
    // A finished two-session day, notes on both.
    S('daily-2026-08-06', '2026-08-06',
      { slot: 'main', optId: 'four-by-four', name: 'Bouldering 4×4s', done: true,
        out: { rpe: 8, fingers: 3, notes: 'Grip opened on circuit 4.' } }),
    S('daily-2026-08-06-fun-boulder', '2026-08-06',
      { slot: 'extra', optId: 'fun-boulder', name: 'Bouldering with friends', done: true,
        out: { rpe: 6, intensity: 3, notes: 'Fun, stayed off the hard stuff.' } }),
    // Rest is a real choice, but it is the one thing that does not count as movement.
    S('daily-2026-08-07', '2026-08-07', { optId: 'off', name: 'Rest day', done: true, out: {} }),
    // Tombstoned.
    S('daily-2026-08-08', '2026-08-08', { optId: 'hard-gym', name: 'Gym', done: true, out: {} }, true),
  ]),
}

console.log('planning is not completing')
eq('swapped + added but not done => count 0', habitBodyForDay('2026-08-05', state).count, 0)
eq('...and an empty note, so Totem drops the day', habitBodyForDay('2026-08-05', state).note, '')
eq('legacy entry with no done flag still counts', habitBodyForDay('2026-08-03', state).count, 1)
eq('tombstoned entry contributes nothing', habitBodyForDay('2026-08-08', state),
  { id: 'move-every-day', date: '2026-08-08', count: 0, note: '' })
eq('a day with nothing on it', habitBodyForDay('2026-08-20', state).count, 0)

console.log('\nmultiple sessions in one day are combined, not overwritten')
const day = habitBodyForDay('2026-08-06', state)
eq('two done sessions => count 2', day.count, 2)
eq('both session names present',
  [day.note.includes('Bouldering 4×4s'), day.note.includes('Bouldering with friends')], [true, true])
eq('both free-text notes present',
  [day.note.includes('Grip opened on circuit 4.'), day.note.includes('Fun, stayed off the hard stuff.')], [true, true])
eq('main comes before the extra', day.note.indexOf('4×4') < day.note.indexOf('friends'), true)
eq('per-session stats carried', [day.note.includes('RPE 8'), day.note.includes('intensity 3/4')], [true, true])

console.log('\nrest days')
eq('rest does not count as a session', habitBodyForDay('2026-08-07', state).count, 0)
eq('but is still recorded, so the day is not blank',
  habitBodyForDay('2026-08-07', state).note.includes('Rest day'), true)

console.log('\nthe habit is "Move Every Day", so everything that is not rest counts')
const moved = {
  entries: Object.fromEntries([
    // A run, logged through the free-form card, which renames itself from the
    // activity you picked. Nothing about it is climbing.
    S('daily-2026-08-11', '2026-08-11',
      { slot: 'main', optId: 'other-training', name: 'Run', minutes: 38, done: true,
        out: { activity: 'run', distance: 4.2, duration: 38, effort: 3, rpe: 6, notes: 'Legs felt good.' } }),
    // ...plus a hip session on top of it.
    S('daily-2026-08-11-hips', '2026-08-11',
      { slot: 'extra', optId: 'hips', name: 'Hip Abduction Block', done: true, out: { rpe: 3 } }),
  ]),
}
const run = habitBodyForDay('2026-08-11', moved)
eq('a run marks the habit like anything else', run.count, 2)
eq('and it goes in by the name you picked, not the card name', run.note.includes('Run'), true)
eq('with its numbers alongside', run.note.includes('RPE 6'), true)

console.log('\nTotem caps the note at 500 chars')
const big = {
  entries: Object.fromEntries(Array.from({ length: 6 }, (_, i) =>
    S(`x${i}`, '2026-08-09',
      { optId: 'four-by-four', name: `Session number ${i}`, done: true,
        out: { rpe: 8, notes: 'x'.repeat(160) } }))),
}
const bn = habitBodyForDay('2026-08-09', big).note
eq('stays under the cap', bn.length <= 500, true)
eq('every session survives the trim',
  Array.from({ length: 6 }, (_, i) => bn.includes(`Session number ${i}`)).every(Boolean), true)
eq('free text is what gets dropped, not sessions', bn.includes('xxxx'), false)

console.log(failed ? `\n${failed} test(s) failed` : '\nall totem rollup tests pass')
process.exit(failed ? 1 : 0)
