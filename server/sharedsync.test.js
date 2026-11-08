/*
 * Shared workouts in sync, as units: structure crosses by uid in both
 * directions, numbers never do, and a stale device can neither resurrect nor
 * drop an exercise. Run: node server/sharedsync.test.js
 *
 * server/http.test.js drives the same rules through a real server.
 */
const { shapeOf, stampData, carry, rebase, intentOf, nextBase, align, syncedLinks, onWrite, receive, flagged, flagChanges, flagCopy, liftedOf } = require('./sharedsync.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log('  ok   ', name) } catch (e) { failed++; console.log('  FAIL ', name, '\n         ', e.message) }
}
const ok = (v, m) => { if (!v) throw new Error(m || 'expected truthy') }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || ''} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

const set = (o = {}) => ({ reps: null, weight: null, seconds: null, distance: null, restSec: null, unit: null, note: '', ...o })
const lift = (uid, name, sets) => ({ uid, kind: 'lift', name, exercise: name.toLowerCase(), group: 'legs', implement: 'barbell', unit: null, note: '', sets })
/** A plan with positional ids, as the app stores it. */
const planOf = (blocks) => ({
  title: 'Legs',
  blocks: blocks.map((b, bi) => ({ id: `b${bi}`, uid: b.uid, name: b.name, note: '', category: null, activity: null,
    ...(b.circuit ? { circuit: b.circuit } : {}),
    items: b.items.map((it, ii) => ({ ...it, id: `b${bi}i${ii}`, sets: it.sets.map((s, si) => ({ ...s, id: `b${bi}i${ii}s${si}` })) })) })),
})
const names = (data) => data.plan.blocks.flatMap(b => b.items.map(i => i.name))
const itemNamed = (data, name) => data.plan.blocks.flatMap(b => b.items).find(i => i.name === name)

/* Alex (owner) and Sam: same exercises, their own numbers. */
const alex = () => ({
  optId: 'planned', done: true,
  out: { rpe: 8, notes: 'heavy', whoop: { strain: 12 } },
  plan: planOf([{ uid: 'B1', name: 'Main', items: [
    lift('SQ', 'Squat', [set({ reps: 5, weight: 100 }), set({ reps: 5, weight: 100 })]),
    lift('DL', 'Deadlift', [set({ reps: 3, weight: 140 })]),
  ] }]),
  run: { sets: { b0i0s0: { reps: 5, weight: 100 }, b0i1s0: { reps: 3, weight: 140 } }, cursor: 'b0i1s0', skipped: [] },
})
const sam = () => ({
  optId: 'planned', done: false, sharedFrom: { id: 'owner', name: 'Alex' },
  out: { rpe: 6 },
  plan: planOf([{ uid: 'B1', name: 'Main', items: [
    lift('SQ', 'Squat', [set({ reps: 8, weight: 40 }), set({ reps: 8, weight: 40 })]),
    lift('DL', 'Deadlift', [set({ reps: 5, weight: 60 })]),
  ] }]),
  run: { sets: { b0i0s0: { reps: 8, weight: 40 } }, cursor: 'b0i0s1', skipped: [] },
})

/** `data` with no numbers in the named exercises' sets: planned, nothing filled in yet. */
const blanked = (data, which) => ({ ...data, plan: { ...data.plan, blocks: data.plan.blocks.map(b => ({ ...b,
  items: b.items.map(i => (which.includes(i.name) ? { ...i, sets: i.sets.map(x => ({ ...x, reps: null, weight: null, seconds: null })) } : i)) })) } })

/** A plan after an edit, re-minting positional ids the way the editor does. */
const edit = (data, fn) => {
  const blocks = fn(data.plan.blocks.map(b => ({ ...b, items: b.items.map(i => ({ ...i, sets: [...i.sets] })) })))
  return { ...data, plan: planOf(blocks) }
}

console.log('sharedsync')

check('an exercise added on one side arrives on the other blank, after the same neighbour', () => {
  const before = alex()
  const after = edit(before, bs => { bs[0].items.splice(1, 0, lift('LU', 'Lunge', [set({ reps: 10, weight: 20 }), set({ reps: 10, weight: 20 })])); return bs })
  const theirs = carry(sam(), shapeOf(before), after)
  eq(names(theirs), ['Squat', 'Lunge', 'Deadlift'])
  eq(itemNamed(theirs, 'Lunge').sets.map(s => [s.reps, s.weight]), [[null, null], [null, null]], 'the owner\'s numbers crossed')
  eq(itemNamed(theirs, 'Squat').sets.map(s => s.weight), [40, 40], 'Sam\'s own weights changed')
  // Sam's logged set followed its exercise across the renumber.
  eq(theirs.run.sets, { b0i0s0: { reps: 8, weight: 40 } })
  eq(theirs.run.cursor, 'b0i0s1')
})

check('the other direction: a set added on Sam\'s side is one blank set on Alex\'s', () => {
  const before = sam()
  const after = edit(before, bs => { bs[0].items[1].sets.push(set({ reps: 5, weight: 60 })); return bs })
  const mine = carry(alex(), shapeOf(before), after)
  eq(itemNamed(mine, 'Deadlift').sets.map(s => [s.reps, s.weight]), [[3, 140], [null, null]])
  eq(mine.run, alex().run, 'Alex\'s run moved although nothing before it did')
})

check('numbers never cross: weights, reps, the run, effort, notes, done, WHOOP', () => {
  const before = alex()
  const after = edit({ ...before, done: false, out: { rpe: 10, notes: 'x', whoop: { strain: 20 }, gear: ['shoes'] },
    run: { sets: { b0i0s1: { reps: 1, weight: 200 } } } }, bs => { bs[0].items[0].sets[0] = { ...bs[0].items[0].sets[0], weight: 180, reps: 1 }; return bs })
  const s = sam()
  ok(carry(s, shapeOf(before), after) === s, 'a change of numbers wrote to Sam\'s side')
})

check('a rename keeps the exercise (same uid), and Sam\'s numbers on it', () => {
  const before = alex()
  const after = edit(before, bs => { bs[0].items[0] = { ...bs[0].items[0], name: 'Back squat' }; return bs })
  const theirs = carry(sam(), shapeOf(before), after)
  eq(names(theirs), ['Back squat', 'Deadlift'])
  eq(itemNamed(theirs, 'Back squat').sets.map(s => s.weight), [40, 40])
  eq(theirs.run.sets, sam().run.sets)
})

check('removed on one side: gone on the other unless the other logged on it', () => {
  const before = alex()
  const after = edit(before, bs => { bs[0].items = []; return bs })
  const theirs = carry(blanked(sam(), ['Squat', 'Deadlift']), shapeOf(before), after)
  // Sam logged a Squat set in the run, so Squat stays on Sam's side; the blank Deadlift goes.
  eq(names(theirs), ['Squat'])
  eq(theirs.run.sets, { b0i0s0: { reps: 8, weight: 40 } })
})

/** `data` as if every number in it had been typed on the sheet (prescription.js `patchSet` marks it). */
const typedAll = (data) => ({ ...data, plan: { ...data.plan, blocks: data.plan.blocks.map(b => ({ ...b,
  items: b.items.map(i => ({ ...i, sets: i.sets.map(x => ({ ...x, typed: true })) })) })) } })

check('#111: an exercise added over there arrives with none of their typed or ticked numbers (the app\'s crossingSet rule)', () => {
  const before = alex()
  const after = edit(before, bs => { bs[0].items.push(lift('BP', 'Bench press', [set({ reps: 10, weight: 135, typed: true, ticked: true }), set({ reps: 10, weight: 135, typed: true })])); return bs })
  const got = itemNamed(carry(sam(), shapeOf(before), after), 'Bench press')
  ok(got, 'the new exercise did not arrive')
  eq(got.sets.map(x => [x.reps, x.weight, x.typed ?? null, x.ticked ?? null]), [[null, null, null, null], [null, null, null, null]], 'a typed number or its marks crossed')
})

check('numbers typed into the plan are logged too: the other side\'s removal never takes them', () => {
  // Sam filled in sets on the sheet without ever starting the runner.
  const typed = typedAll({ ...sam(), run: undefined })
  const before = alex()
  const gone = edit(before, bs => { bs[0].items = []; return bs })
  eq(names(carry(typed, shapeOf(before), gone)), ['Squat', 'Deadlift'], 'an exercise with typed numbers was removed')
  // Fewer sets over there: Sam's typed sets stay, a blank one goes.
  const fewer = edit(before, bs => { bs[0].items[0].sets = [bs[0].items[0].sets[0]]; return bs })
  eq(itemNamed(carry(typed, shapeOf(before), fewer), 'Squat').sets.map(x => x.weight), [40, 40], 'a typed set was dropped')
  const halfTyped = edit(typed, bs => { bs[0].items[0].sets[1] = set({ typed: true }); return bs })
  eq(itemNamed(carry(halfTyped, shapeOf(before), fewer), 'Squat').sets.map(x => x.weight), [40], 'a blank set was kept')
  // A weight alone, reps alone, or a hold's seconds alone is a number someone typed.
  for (const one of [{ weight: 25 }, { reps: 12 }, { seconds: 30 }]) {
    const just = edit(blanked(typed, ['Squat', 'Deadlift']), bs => { bs[0].items[1].sets[0] = set({ ...one, typed: true }); return bs })
    eq(names(carry(just, shapeOf(before), gone)), ['Deadlift'], `${JSON.stringify(one)} did not keep the exercise`)
  }
})

check('targets the plan arrived with are not typed: an untouched copy still follows a removal', () => {
  // Exactly what a share writes: target reps on every set, no weight, nothing typed.
  const untouched = { ...sam(), run: undefined, plan: planOf([{ uid: 'B1', name: 'Main', items: [
    lift('SQ', 'Squat', [set({ reps: 5 }), set({ reps: 5 })]), lift('DL', 'Deadlift', [set({ reps: 3 })])] }]) }
  const before = alex()
  eq(names(carry(untouched, shapeOf(before), edit(before, bs => { bs[0].items.pop(); return bs }))), ['Squat'])
  eq(itemNamed(carry(untouched, shapeOf(before), edit(before, bs => { bs[0].items[0].sets.pop(); return bs })), 'Squat').sets.length, 1)
})

check('a shared copy\'s own weights count as logged with no typed mark (#80): the owner\'s removal never takes them', () => {
  // The seed's shape: Sam's copy has the share's target reps and Sam's own weights, typed
  // before sets got the mark. The owner's removal of the exercise, or of a set, took them.
  const legacy = { ...sam(), run: undefined, plan: planOf([{ uid: 'B1', name: 'Main', items: [
    lift('SQ', 'Hip thrust', [set({ reps: 10, weight: 50 }), set({ reps: 10, weight: 50 }), set({ reps: 10, weight: 50 })]),
    lift('DL', 'Leg press', [set({ reps: 10, weight: 90 })]),
  ] }]) }
  const before = alex()
  const gone = edit(before, bs => { bs[0].items = []; return bs })
  eq(names(carry(legacy, shapeOf(before), gone)), ['Hip thrust', 'Leg press'], 'an exercise with Sam\'s weights was removed')
  const fewer = edit(before, bs => { bs[0].items[0].sets = [bs[0].items[0].sets[0]]; return bs })
  eq(itemNamed(carry(legacy, shapeOf(before), fewer), 'Hip thrust').sets.map(x => x.weight), [50, 50, 50], 'a set with Sam\'s weight was dropped')
  // A set with only the target reps still follows (the 'targets … untouched copy' case).
  const half = edit(legacy, bs => { bs[0].items[0].sets[2] = set({ reps: 10 }); return bs })
  eq(itemNamed(carry(half, shapeOf(before), fewer), 'Hip thrust').sets.map(x => x.weight), [50, 50], 'a target-only set was kept')
  // The owner's own plan for today, untouched: an unmarked weight there is the planner's target.
  const ownerSide = { ...alex(), done: false, run: undefined }
  const samGone = edit(sam(), bs => { bs[0].items = []; return bs })
  eq(names(carry(ownerSide, shapeOf(sam()), samGone, { date: '2026-11-08', today: '2026-11-08' })), [], 'an untouched plan for today kept the exercise')
})

/* #80, the mirror: what the app reads as lifted (lib/lifts.js liftsDone) is never removed by a carry. */
const TODAY = '2026-11-08'
const legDay = (sets) => ({ optId: 'planned', run: undefined, plan: planOf([{ uid: 'B1', name: 'Main', items: [
  lift('LP', 'Leg press', sets(180)), lift('AD', 'Hip adduction', [set({ reps: 10, weight: 85 }), set({ reps: 10, weight: 85 }), set({ reps: 10, weight: 100 })]),
] }]) })
const three = (w) => [set({ reps: 10, weight: w }), set({ reps: 10, weight: w }), set({ reps: 10, weight: w })]

check('the seed\'s mirror: Sam\'s phone removing Hip adduction never takes the owner\'s logged 85, 85, 100 (#80)', () => {
  // The owner's done entry of a day gone by; its sets carry no typed mark.
  const owner = { ...legDay(three), done: true, out: { activity: 'lift' } }
  const samBefore = { ...legDay(three), sharedFrom: { id: 'owner', name: 'Alex' } }
  const samAfter = edit(samBefore, bs => { bs[0].items = bs[0].items.filter(i => i.name !== 'Hip adduction'); return bs })
  const at = { date: '2026-11-04', today: TODAY }
  const kept = carry(owner, shapeOf(samBefore), samAfter, at)
  eq(itemNamed(kept, 'Hip adduction').sets.map(x => x.weight), [85, 85, 100], 'the owner\'s logged sets were removed')
  // Fewer sets over there: the owner's lifted sets stay too.
  const fewer = edit(samBefore, bs => { bs[0].items[0].sets = [bs[0].items[0].sets[0]]; return bs })
  eq(itemNamed(carry(owner, shapeOf(samBefore), fewer, at), 'Leg press').sets.length, 3, 'a lifted set of the owner\'s was dropped')
  // Marked undone: nothing is read as lifted there, so the removal follows.
  const undone = { ...owner, done: false, undone: true }
  eq(names(carry(undone, shapeOf(samBefore), samAfter, at)), ['Leg press'], 'an undone entry kept an exercise nothing reads as lifted')
})

check('the seed both ways: the owner removing Hip thrust never takes Sam\'s 50s on a past copy (#80)', () => {
  const copy = { ...legDay(() => three(90)), done: false, sharedFrom: { id: 'owner', name: 'Alex' } }
  const ownerBefore = legDay(three)
  const gone = edit(ownerBefore, bs => { bs[0].items = bs[0].items.filter(i => i.name !== 'Leg press'); return bs })
  eq(itemNamed(carry(copy, shapeOf(ownerBefore), gone, { date: '2026-11-04', today: TODAY }), 'Leg press').sets.map(x => x.weight), [90, 90, 90])
})

check('an untouched plan for today, or for a later day, still follows every removal (#80)', () => {
  const plan = { ...legDay(three), done: false }
  const samBefore = { ...legDay(three), sharedFrom: { id: 'owner', name: 'Alex' } }
  const samAfter = edit(samBefore, bs => { bs[0].items = bs[0].items.filter(i => i.name !== 'Hip adduction'); return bs })
  eq(names(carry(plan, shapeOf(samBefore), samAfter, { date: TODAY, today: TODAY })), ['Leg press'], 'an untouched plan for today kept it')
  eq(names(carry(plan, shapeOf(samBefore), samAfter, { date: '2026-11-20', today: TODAY })), ['Leg press'], 'a plan for a later day kept it')
  // On its own day, only what was typed counts: one typed set keeps that exercise, one set of it.
  const touched = edit(plan, bs => { bs[0].items[1].sets[0] = { ...bs[0].items[1].sets[0], typed: true }; return bs })
  const fewer = edit(samBefore, bs => { bs[0].items[1].sets = [bs[0].items[1].sets[0]]; return bs })
  eq(itemNamed(carry(touched, shapeOf(samBefore), fewer, { date: TODAY, today: TODAY }), 'Hip adduction').sets.length, 1)
})

/* liftedOf is the server's copy of lib/lifts.js liftsDone; held equal to it, as drafts.test.js holds rememberedModes. */
const liftsEqual = (async () => {
  const { liftsDone } = await import('../app/src/lib/lifts.js')
  const entry = (id, date, data) => ({ id, kind: 'daily', date, data: { optId: 'planned', ...data } })
  const items = [
    lift('A', 'Squat', [set({ reps: 5, weight: 100 }), set({ reps: 5, weight: null }), set({ reps: null, weight: null })]),
    lift('B', 'Row', [set({ reps: 8, weight: 60, typed: true }), set({ reps: 8, weight: 60 })]),
    lift('C', 'Curl', [set()]),
    { ...lift('D', 'Plank', [set({ seconds: 45 }), set({ seconds: 45, typed: true })]), measure: 'time' },
  ]
  const circuit = { uid: 'K', name: 'Finisher', circuit: { work: 30, rest: 15, rounds: 3 }, items: [lift('E', 'Burpee', [set({ reps: 10 })]), lift('F', 'Crunch', [set()])] }
  const cases = [
    entry('past', '2026-11-04', { done: true, plan: planOf([{ uid: 'B1', name: 'Main', items }, circuit]) }),
    entry('pastPlanned', '2026-11-04', { done: false, plan: planOf([{ uid: 'B1', name: 'Main', items }]) }),
    entry('undone', '2026-11-04', { done: false, undone: true, plan: planOf([{ uid: 'B1', name: 'Main', items }]) }),
    entry('today', TODAY, { done: false, plan: planOf([{ uid: 'B1', name: 'Main', items }, circuit]) }),
    entry('todayDone', TODAY, { done: true, plan: planOf([{ uid: 'B1', name: 'Main', items }, circuit]) }),
    entry('later', '2026-11-20', { done: true, plan: planOf([{ uid: 'B1', name: 'Main', items }]) }),
    entry('logged', '2026-11-04', { done: true, plan: planOf([{ uid: 'B1', name: 'Main', items }]),
      out: { lifts: [{ uid: 'A', key: 'squat', name: 'Squat', sets: [{ reps: '5', weight: '110' }, { reps: '5', weight: '110' }, { reps: '5', weight: '110' }] }] } }),
  ]
  for (const e of cases) {
    const rows = new Map(liftsDone(e, TODAY).filter(r => r.uid).map(r => [r.uid, r.sets.length]))
    const server = liftedOf(e, TODAY)
    const uidOf = new Map(e.data.plan.blocks.flatMap(b => b.items).map(it => [it.id, it.uid]))
    const app = new Map([...rows].map(([u, n]) => [uidOf.get(u) || u, n]))
    const circuitUids = new Set(e.data.plan.blocks.filter(b => b.circuit).flatMap(b => b.items.map(i => i.uid)))
    const want = [...app].map(([u, n]) => [u, circuitUids.has(u) ? 1 : n]).sort()
    const got = [...server].map(([u, idx]) => [u, idx.size]).sort()
    eq(got, want, `${e.id}: the server reads a different lift than the app`)
  }
})()


check('a copy says whether it is in step (#80): set on a carry, switched with the link, never on the owner\'s own entry', () => {
  const copy = { ...sam(), sharedFrom: { id: 'owner', name: 'Alex' } }
  eq(flagged(copy, true).sharedFrom, { id: 'owner', name: 'Alex', sync: true })
  ok(flagged(flagged(copy, true), true).sharedFrom.sync === true, 'flagging twice changed it')
  const own = alex()
  ok(flagged(own, true) === own, 'the owner\'s entry was flagged')
  const before = alex()
  const after = edit(before, bs => { bs[0].items.push(lift('LU', 'Lunge', [set()])); return bs })
  const st = receive({ entries: { d: { id: 'd', kind: 'daily', date: '2026-10-01', updatedAt: '2026-10-01T00:00:00.000Z', data: copy } } }, 'd',
    { before: shapeOf(before), after }, e => Boolean(e.data.sharedFrom))
  eq(st.entries.d.data.sharedFrom.sync, true, 'a carry into the copy did not say it is in step')
  const entry = (links) => ({ id: 'o', kind: 'daily', date: '2026-10-01', data: { sharedWith: links } })
  const prev = { entries: { o: entry([{ id: 'sam', entryId: 'c1', sync: true }, { id: 'jo', entryId: 'c2' }]) } }
  const next = { entries: { o: entry([{ id: 'sam', entryId: 'c1' }, { id: 'kim', entryId: 'c3', sync: true }]) } }
  // Jo's link had sync off: taking Jo off still reaches Jo's copy (#96, `linked`).
  eq(flagChanges(prev, next, ['o']), [{ personId: 'sam', entryId: 'c1', sync: false, linked: true },
    { personId: 'jo', entryId: 'c2', sync: false, linked: false }, { personId: 'kim', entryId: 'c3', sync: true, linked: true }])
  eq(flagChanges(prev, prev, ['o']), [])
  eq(flagChanges(prev, { entries: { o: { ...prev.entries.o, deleted: true } } }, ['o']),
    [{ personId: 'sam', entryId: 'c1', sync: false, linked: false }, { personId: 'jo', entryId: 'c2', sync: false, linked: false }])
  const log = { entries: { c1: { id: 'c1', updatedAt: '2026-10-01T00:00:00.000Z', data: copy } } }
  const f = flagCopy(log, 'c1', false)
  eq([f.entries.c1.data.sharedFrom.sync, f.entries.c1.updatedAt], [false, '2026-10-01T00:00:00.001Z'])
  ok(flagCopy(f, 'c1', false) === f, 'an unchanged flag wrote again')
  // Taken off (#96): stamped `off`, and the stamp goes when a link is back.
  const off = flagCopy(f, 'c1', false, false)
  eq(off.entries.c1.data.sharedFrom, { id: 'owner', name: 'Alex', sync: false, off: true })
  eq(flagCopy(off, 'c1', true, true).entries.c1.data.sharedFrom, { id: 'owner', name: 'Alex', sync: true })
  ok(flagCopy(off, 'c1', false, false) === off, 'an unchanged stamp wrote again')
})

check('a carry that changes something fills in what kind of workout it is on a side that names none (#74)', () => {
  const before = alex()
  const after = { ...edit(before, bs => { bs[0].items.push({ uid: 'u-new', kind: 'lift', name: 'Lunge', exercise: 'lunge', sets: [{ reps: 8, weight: 30 }] }); return bs }),
    out: { activity: 'lift', category: 'lift', rpe: 8 } }
  const bare = { ...sam(), out: {} }
  const theirs = carry(bare, shapeOf(before), after)
  eq(theirs.out, { activity: 'lift', category: 'lift' }, 'the kind did not arrive, or a number came with it')
  const chose = { ...sam(), out: { activity: 'calisthenics' } }
  eq(carry(chose, shapeOf(before), after).out, { activity: 'calisthenics' }, 'a kind their side chose was overwritten')
  const same = { ...before, out: { activity: 'lift', category: 'lift' } }
  ok(carry(bare, shapeOf(before), same) === bare, 'a carry with no change of structure wrote the kind on its own')
})

check('a set the other side added to an interval copies its shape, not a typed mark', () => {
  const plan = { blocks: [{ uid: 'B', name: 'Run', items: [{ uid: 'I', kind: 'interval', name: 'Repeat', unit: 'mi', sets: [{ distance: 1, typed: true, note: 'x' }] }] }] }
  const before = { plan }
  const after = { plan: { blocks: [{ ...plan.blocks[0], items: [{ ...plan.blocks[0].items[0], sets: [{ distance: 1 }, { distance: 1 }] }] }] } }
  const got = carry({ plan }, shapeOf(before), after).plan.blocks[0].items[0].sets
  eq(got.length, 2)
  eq(['typed' in got[1], got[1].note, got[1].distance], [false, '', 1], 'the copied interval set reads as typed into')
})

check('kept sets never make the other side\'s next add an extra set (wantSets)', () => {
  // The owner's typed row stays at 3 while Sam goes 3 -> 1; Sam then adds one (1 -> 2).
  const owner = typedAll({ ...alex(), run: undefined, plan: planOf([{ uid: 'B1', name: 'Main', items: [
    lift('RW', 'Row', [set({ reps: 10, weight: 90 }), set({ reps: 10, weight: 90 }), set({ reps: 10, weight: 90 })])] }]) })
  const three = blanked(owner, ['Row'])
  const one = edit(three, bs => { bs[0].items[0].sets = bs[0].items[0].sets.slice(0, 1); return bs })
  const two = edit(three, bs => { bs[0].items[0].sets = bs[0].items[0].sets.slice(0, 2); return bs })
  let mine = carry(owner, shapeOf(three), one)
  eq(itemNamed(mine, 'Row').sets.length, 3)
  mine = carry(mine, shapeOf(one), two)
  eq(itemNamed(mine, 'Row').sets.length, 3, 'an add on the other side became a fourth set here')
})

check('a set removed here and one added over there: the difference, the removal stays (council r2)', () => {
  // Base 3. This side took one off (2); the other side added one (4): 3, not 4.
  const three = blanked({ ...alex(), run: undefined, plan: planOf([{ uid: 'B1', name: 'Main', items: [lift('RW', 'Row', [set(), set(), set()])] }]) }, ['Row'])
  const two = edit(three, bs => { bs[0].items[0].sets.pop(); return bs })
  const four = edit(three, bs => { bs[0].items[0].sets.push(set()); return bs })
  eq(itemNamed(carry(two, shapeOf(three), four), 'Row').sets.length, 3, 'the carry undid this side\'s removal')
  // The same on a writer's own stale write: stored 2 (rev 2), the device on rev 1 sends 4.
  const rev1 = nextBase('d', null, three)
  const stored = { ...two, syncBase: nextBase('d', rev1, two) }
  const r = rebase(stored, stampData({ ...four, syncBase: rev1 }, stored), 'd')
  eq([r.intent, itemNamed(r.data, 'Row').sets.length], ['stale', 3], 'a stale add undid the removal it had not seen')
  // One side down by two, the other up by one: 2.
  const one = edit(three, bs => { bs[0].items[0].sets = bs[0].items[0].sets.slice(0, 1); return bs })
  eq(itemNamed(rebase({ ...one, syncBase: nextBase('d', rev1, one) }, stampData({ ...four, syncBase: rev1 }, one), 'd').data, 'Row').sets.length, 2)
})

check('an exercise moved into a circuit over there is one set here, typed or not (#68)', () => {
  const C = { work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 }
  const base = { ...alex(), run: undefined, plan: planOf([
    { uid: 'B1', name: 'Main', items: [lift('SQ', 'Squat', [set({ reps: 5 }), set({ reps: 5 }), set({ reps: 5 })])] },
    { uid: 'B2', name: 'Core', circuit: C, items: [lift('CR', 'Crunch', [set()])] },
  ]) }
  const moved = edit(base, bs => { const sq = { ...bs[0].items[0], sets: [bs[0].items[0].sets[0]] }; bs[0].items = []; bs[1].items.push(sq); return bs })
  const theirs = typedAll({ ...base, sharedFrom: { id: 'owner', name: 'Alex' } })
  const got = carry(theirs, shapeOf(base), moved)
  eq(itemNamed(got, 'Squat').sets.length, 1, 'typed sets kept a circuit exercise at three sets')
})

check('the incident: their sets dropped and re-added over there come back blank, never over typed weights', () => {
  // The owner's row at 90 / 90 / 90; on the other side two sets go, then come back.
  const owner = typedAll({ ...alex(), run: undefined, plan: planOf([{ uid: 'B1', name: 'Main', items: [
    lift('RW', 'Row', [set({ reps: 10, weight: 90 }), set({ reps: 10, weight: 90 }), set({ reps: 10, weight: 90 })])] }]) })
  const three = { ...blanked(owner, ['Row']), sharedFrom: { id: 'owner', name: 'Alex' } }
  const one = edit(three, bs => { bs[0].items[0].sets = bs[0].items[0].sets.slice(0, 1); return bs })
  const again = edit(three, bs => bs)
  let mine = carry(owner, shapeOf(three), one)
  mine = carry(mine, shapeOf(one), again)
  eq(itemNamed(mine, 'Row').sets.map(x => x.weight), [90, 90, 90], 'typed weights were lost')
})

check('switched to a circuit over there: one set per exercise here too, typed numbers or not (#68)', () => {
  // A circuit's exercise has one set saying how it is timed; the rounds are the circuit's.
  const C = { work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 }
  const before = alex()
  const on = edit(before, bs => { bs[0] = { ...bs[0], circuit: C, items: bs[0].items.map(i => ({ ...i, sets: i.sets.slice(0, 1) })) }; return bs })
  const theirs = carry({ ...sam(), run: undefined }, shapeOf(before), on)
  eq(theirs.plan.blocks[0].circuit, C)
  eq(theirs.plan.blocks[0].items.map(i => i.sets.length), [1, 1], 'a typed set kept a second set in a circuit')
})

check('a piece\'s targets are its shape, not a log: an interval still goes when the other side removes it', () => {
  const piece = { uid: 'RN', kind: 'interval', name: 'Run', unit: 'mi', note: '', sets: [set({ distance: 1, seconds: 480 })] }
  const withPiece = (data) => edit(data, bs => { bs[0].items.push({ ...piece }); return bs })
  const before = withPiece(alex())
  const gone = edit(before, bs => { bs[0].items.pop(); return bs })
  eq(names(carry(withPiece(sam()), shapeOf(before), gone)), ['Squat', 'Deadlift'])
})

check('fewer sets never takes a logged set', () => {
  const before = alex()
  const after = edit(before, bs => { bs[0].items[0].sets = [bs[0].items[0].sets[0]]; return bs })
  const s = sam()
  s.run.sets = { b0i0s0: { reps: 8 }, b0i0s1: { reps: 8 } }
  eq(itemNamed(carry(s, shapeOf(before), after), 'Squat').sets.length, 2, 'a logged set was dropped')
  eq(itemNamed(carry(blanked({ ...sam(), run: undefined }, ['Squat']), shapeOf(before), after), 'Squat').sets.length, 1, 'an unlogged set was not dropped')
})

check('a reorder on one side is followed on the other', () => {
  const before = alex()
  const after = edit(before, bs => { bs[0].items.reverse(); return bs })
  const theirs = carry(sam(), shapeOf(before), after)
  eq(names(theirs), ['Deadlift', 'Squat'])
  eq(theirs.run.sets, { b0i1s0: { reps: 8, weight: 40 } }, 'the run did not follow the move')
})

check('a stale device does not resurrect a removed exercise it has not logged on', () => {
  // The stale phone was given base rev 1 (with Deadlift); since then Deadlift was removed (rev 2).
  const old = { ...alex(), run: { sets: { b0i0s0: { reps: 5, weight: 100 } } } }
  const rev1 = nextBase('d', null, old)
  const stored = edit(alex(), bs => { bs[0].items.pop(); return bs })
  const storedData = { ...stored, syncBase: nextBase('d', rev1, stored) }
  // It still has Deadlift (nothing logged on it) and its old base, and changes a weight.
  const stale = edit({ ...old, syncBase: rev1 }, bs => { bs[0].items[0].sets[0] = { ...bs[0].items[0].sets[0], weight: 105 }; return bs })
  eq(intentOf(storedData, stale, 'd'), 'stale')
  const r = rebase(storedData, stampData(stale, storedData), 'd')
  eq(names(r.data), ['Squat'], 'the removed exercise came back')
  eq(itemNamed(r.data, 'Squat').sets[0].weight, 105, 'the stale device\'s own number was lost')
})

check('a stale device keeps an exercise it logged on that was removed meanwhile, on its own side, uncarried', () => {
  // X1: Sam logs a 140 kg deadlift set offline (base rev 1); the other side removes Deadlift (rev 2).
  const old = alex()
  const rev1 = nextBase('d', null, old)
  const stored = edit(alex(), bs => { bs[0].items.pop(); return bs })
  const storedData = { ...stored, run: null, syncBase: nextBase('d', rev1, stored) }
  const offline = { ...old, syncBase: rev1, run: { sets: { b0i1s0: { reps: 3, weight: 140 } } } }
  const r = rebase(storedData, stampData(offline, storedData), 'd')
  eq([r.intent, names(r.data)], ['stale', ['Squat', 'Deadlift']], 'the logged deadlift was dropped')
  eq(Object.values(r.data.run.sets), [{ reps: 3, weight: 140 }])
  eq(names(r.carry), ['Squat'], 'the kept exercise was carried back to the side that removed it')
})

check('a stale device does not drop an exercise the other side added', () => {
  const old = alex()
  const stored = edit(old, bs => { bs[0].items.push(lift('LU', 'Lunge', [set()])); return bs })
  const rev1 = nextBase('d', null, old)
  const stale = { ...old, syncBase: rev1, out: { rpe: 9 } }
  const merged = rebase({ ...stored, syncBase: nextBase('d', rev1, stored) }, stampData(stale, stored), 'd').data
  eq(names(merged), ['Squat', 'Deadlift', 'Lunge'])
  eq(merged.out.rpe, 9)
})

check('an up-to-date device is plain last-write-wins, and its change is what travels', () => {
  const stored = { ...alex(), syncBase: nextBase('d', null, alex()) }
  const sent = edit(stored, bs => { bs[0].items.pop(); return bs })
  const r = rebase(stored, sent, 'd')
  eq([r.intent, names(r.data), names(r.carry), r.data.plan], ['current', ['Squat'], ['Squat'], sent.plan])
  eq(r.data.run.sets, { b0i0s0: { reps: 5, weight: 100 } }, 'the run should be re-keyed onto what it sent')
})

check('items arriving without a uid take the uid of the same-named item they replace', () => {
  const stored = alex()
  const strip = edit(stored, bs => bs.map(b => ({ ...b, uid: undefined, items: b.items.map(i => ({ ...i, uid: undefined })) })))
  const stamped = stampData(strip, stored)
  eq(shapeOf(stamped).plan[0].items.map(i => i.uid), ['SQ', 'DL'])
  eq(stamped.plan.blocks[0].uid, 'B1')
  const fresh = stampData(edit(stamped, bs => { bs[0].items.push(lift(undefined, 'Lunge', [set()])); return bs }), stored)
  ok(itemNamed(fresh, 'Lunge').uid && !['SQ', 'DL'].includes(itemNamed(fresh, 'Lunge').uid), 'a new item was not given its own uid')
})

check('switching sync on aligns uids by name and adds only what Sam lacks', () => {
  const s = sam()
  // An older copy: no uids, and missing Deadlift; Sam added a plank of their own.
  s.plan = planOf([{ uid: undefined, name: 'Main', items: [
    lift(undefined, 'Squat', [set({ weight: 40 })]),
    { ...lift(undefined, 'Plank', [set({ seconds: 60 })]), kind: 'interval' },
  ] }])
  s.run = { sets: { b0i0s0: { reps: 8, weight: 40 } } }
  const out = align(alex(), s)
  // Deadlift lands after its neighbour on Alex's side; Sam's own plank stays where it was.
  eq(names(out), ['Squat', 'Deadlift', 'Plank'])
  eq(itemNamed(out, 'Squat').uid, 'SQ')
  eq(itemNamed(out, 'Squat').sets.map(x => x.weight), [40, null], 'Squat did not get Alex\'s second set, blank')
  eq(itemNamed(out, 'Deadlift').sets.map(x => x.weight), [null])
  eq(out.run.sets, { b0i0s0: { reps: 8, weight: 40 } })
})

check('logged lifts (no plan) sync by uid the same way', () => {
  const mine = { out: { lifts: [{ uid: 'squat-1', key: 'squat', name: 'Squat', sets: [{ reps: '5', weight: '100' }] }] } }
  const theirs = { sharedFrom: { id: 'owner' }, out: { rpe: 4, lifts: [{ uid: 'squat-1', key: 'squat', name: 'Squat', sets: [{ reps: '8', weight: '40' }] }] } }
  const next = { out: { lifts: [
    { uid: 'squat-1', key: 'squat', name: 'Squat', sets: [{ reps: '5', weight: '100' }, { reps: '5', weight: '100' }] },
    { uid: 'bench-1', key: 'bench', name: 'Bench', sets: [{ reps: '5', weight: '80' }] },
  ] } }
  const got = carry(theirs, shapeOf(mine), next)
  eq(got.out.lifts.map(l => [l.uid, l.sets]), [
    ['squat-1', [{ reps: '8', weight: '40' }, { reps: '', weight: '' }]],
    ['bench-1', [{ reps: '', weight: '' }]],
  ])
  eq(got.out.rpe, 4)
  // Removing Squat on Alex's side leaves Sam's (marked) Squat alone.
  const gone = carry(got, shapeOf(next), { out: { lifts: [next.out.lifts[1]] } })
  eq(gone.out.lifts.map(l => l.uid), ['squat-1', 'bench-1'])
})

check('a side with no plan yet gets the other\'s exercises, never its draftId', () => {
  const owner = { ...alex(), plan: { ...alex().plan, draftId: 'd-owner-1' } }
  const theirs = carry({ sharedFrom: { id: 'owner' }, out: {} }, null, owner)
  eq(names(theirs), ['Squat', 'Deadlift'])
  ok(!('draftId' in theirs.plan), 'the owner\'s draft id went into Sam\'s log')
})

check('done, undone and doneAt never cross, whichever way and however it lands', () => {
  const DONE_KEYS = ['done', 'undone', 'doneAt']
  const doneOf = (d) => JSON.stringify(Object.fromEntries(DONE_KEYS.filter(k => k in d).map(k => [k, d[k]])))
  // The sender has ticked it (doneAt), the receiver tapped "Mark undone"; and the reverse.
  const pairs = [
    [{ done: true, doneAt: '2026-10-25T10:00:00.000Z' }, { done: false, undone: true }],
    [{ done: false, undone: true }, { done: true, doneAt: '2026-10-24T09:00:00.000Z' }],
    [{ done: true, doneAt: '2026-10-25T10:00:00.000Z' }, { done: false }],
  ]
  for (const [sent, kept] of pairs) {
    const before = { ...alex(), ...sent }
    const after = edit(before, bs => { bs[0].items.push(lift('LU', 'Lunge', [set()])); bs[0].items[0].sets.push(set()); return bs })
    const target = { ...sam(), ...kept }
    for (const [how, got] of [
      ['carry', carry(target, shapeOf(before), after)],
      ['align', align(after, target)],
      ['receive', receive({ entries: { d: { id: 'd', kind: 'daily', updatedAt: 'a', data: target } } }, 'd', { before: shapeOf(before), after, at: 'b' }, () => true).entries.d.data],
      ['a plan-less side', carry({ sharedFrom: { id: 'owner' }, out: {}, ...kept }, null, after)],
    ]) {
      ok(names(got).includes('Lunge'), `${how}: the structure did not arrive, so this proves nothing`)
      eq(doneOf(got), how === 'a plan-less side' ? JSON.stringify(kept) : doneOf(target), `${how} changed the receiving side's done state`)
      for (const k of DONE_KEYS) ok(!JSON.stringify(got.syncBase ?? shapeOf(got)).includes(`"${k}"`), `${how}: ${k} in the structure`)
    }
  }
})

check('what arrives from the other side is an allowlist: no implement, run, note or junk of theirs', () => {
  const junk = { kind: 'lift', name: 'Lunge', exercise: 'lunge', group: 'legs', unit: null,
    implement: 'dumbbell', implementLabel: 'Dumbbell', weightLabel: 'per hand', note: 'mine', run: { sets: { x: 1 } }, junk: 'x', done: true,
    sets: [{ reps: 10, weight: 30, note: 'hard', junk: 'x' }] }
  const piece = { kind: 'interval', name: 'Row', exercise: null, group: null, unit: 'm', implement: 'erg', junk: 'x',
    sets: [{ distance: 500, restSec: 60, weight: 5, unit: 'm', note: 'go', junk: 'x' }] }
  const before = alex()
  const after = edit(before, bs => { bs[0].items.push({ ...junk, uid: 'LU' }, { ...piece, uid: 'RW' }); return bs })
  const got = carry(sam(), shapeOf(before), after)
  const lunge = itemNamed(got, 'Lunge')
  const { id: _i, ...lungeKeys } = lunge
  eq(Object.keys(lungeKeys).sort(), ['exercise', 'group', 'implement', 'implementLabel', 'kind', 'name', 'note', 'sets', 'uid', 'unit', 'weightLabel'])
  eq([lunge.implement, lunge.implementLabel, lunge.weightLabel, lunge.note], ['', null, null, ''], 'the sender\'s implement or note arrived')
  eq(lunge.sets.map(({ id: _x, ...s }) => s), [{ reps: null, weight: null, seconds: null, distance: null, restSec: null, unit: null, note: '' }])
  const row = itemNamed(got, 'Row')
  eq([row.implement, row.unit, 'junk' in row], ['', 'm', false])
  eq(row.sets.map(({ id: _x, ...s }) => s), [{ reps: null, weight: null, seconds: null, distance: 500, restSec: 60, unit: 'm', note: '' }],
    'an interval should keep its shape and nothing else')
  ok(!JSON.stringify(got.plan).includes('junk') && !('run' in lunge), 'junk crossed')
  // Logged lifts the same way.
  const lifted = { out: { lifts: [{ uid: 'b-1', key: 'bench', name: 'Bench', group: 'chest', implement: 'dumbbell', implementLabel: 'Dumbbell', junk: 'x', sets: [{ reps: '5', weight: '80' }] }] } }
  const l = carry({ sharedFrom: { id: 'owner' }, out: { lifts: [] } }, { lifts: [] }, lifted).out.lifts[0]
  eq(l, { uid: 'b-1', key: 'bench', name: 'Bench', group: 'chest', implement: '', sets: [{ reps: '', weight: '' }] })
  // A plan-less side takes what the session is, not the sender's reasoning or conversation.
  const talked = { ...after, plan: { ...after.plan, why: 'their recovery was low', notes: ['theirs'], thread: [{ role: 'you', text: 'hi' }], model: 'm', junk: 'x' } }
  const fresh = carry({ sharedFrom: { id: 'owner' }, out: {} }, null, talked)
  eq([fresh.plan.title, fresh.plan.why, fresh.plan.notes, 'thread' in fresh.plan, 'junk' in fresh.plan, 'model' in fresh.plan], ['Legs', '', [], false, false, false])
})

check('what a weight means is each person\'s own: a mode never crosses, a carried lift arrives in the default (#58)', () => {
  const one = { implement: 'dumbbell', implementLabel: 'Dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell' }
  // A new exercise in a mode on Alex's side: on Sam's, no implement and no mode.
  const before = alex()
  const added = edit(before, bs => { bs[0].items.push({ ...lift('BS', 'Bulgarian split squat', [set({ reps: 8, weight: 25 })]), ...one }); return bs })
  const got = itemNamed(carry(sam(), shapeOf(before), added), 'Bulgarian split squat')
  ok(got, 'the exercise did not arrive, so this proves nothing')
  eq([got.implement, got.weightLabel, 'weightMode' in got], ['', null, false], 'the sender\'s mode crossed')
  // Alex switching an exercise both have is not structure: nothing to carry, and
  // Sam's own mode on it stays whatever Alex does.
  const both = edit(alex(), bs => { bs[0].items[0] = { ...bs[0].items[0], ...one }; return bs })
  eq(shapeOf(both), shapeOf(alex()), 'a mode is in the shape, so a switch would be carried')
  const samSide = edit(sam(), bs => { bs[0].items[0] = { ...bs[0].items[0], weightMode: 'side', weightLabel: 'lb per side' }; return bs })
  const renamed = edit(both, bs => { bs[0].items[0] = { ...bs[0].items[0], name: 'Back squat', weightMode: 'total' }; return bs })
  const kept = itemNamed(carry(samSide, shapeOf(both), renamed), 'Back squat')
  ok(kept, 'the rename did not arrive, so this proves nothing')
  eq([kept.weightMode, kept.weightLabel], ['side', 'lb per side'], 'Sam\'s mode followed Alex\'s')
  // Logged lifts the same way, in both directions.
  const theirs = { uid: 'b-1', key: 'bss', name: 'BSS', group: 'legs', ...one, sets: [{ reps: '8', weight: '25' }] }
  const arrived = carry({ sharedFrom: { id: 'owner' }, out: { lifts: [] } }, { lifts: [] }, { out: { lifts: [theirs] } }).out.lifts[0]
  eq(arrived, { uid: 'b-1', key: 'bss', name: 'BSS', group: 'legs', implement: '', sets: [{ reps: '', weight: '' }] })
  const mine = { ...theirs, weightMode: 'pair', weightLabel: 'lb per hand', sets: [{ reps: '10', weight: '20' }] }
  const base = { lifts: [{ uid: 'b-1', key: 'bss', name: 'BSS', group: 'legs', sets: 1 }] }
  const after = { out: { lifts: [{ ...theirs, name: 'Bulgarian split squat' }] } }
  const row = carry({ sharedFrom: { id: 'owner' }, out: { lifts: [mine] } }, base, after).out.lifts[0]
  eq([row.name, row.weightMode, row.weightLabel], ['Bulgarian split squat', 'pair', 'lb per hand'])
})

check('a hold is structure; its seconds are numbers and stay on their own side, like reps (#63)', () => {
  // A plan: Alex adds a plank held for 45 s. Sam gets a plank held for time, no seconds.
  const before = alex()
  const plank = { ...lift('PL', 'Plank', [set({ seconds: 45 }), set({ seconds: 45, weight: 25 })]), measure: 'time', implement: 'bodyweight' }
  const added = edit(before, bs => { bs[0].items.push(plank); return bs })
  eq(shapeOf(added), shapeOf(edit(before, bs => { bs[0].items.push({ ...plank, measure: undefined }); return bs })),
    'measure is not in the shape, so every stored base still compares equal')
  const got = itemNamed(carry(sam(), shapeOf(before), added), 'Plank')
  ok(got, 'the plank did not arrive, so this proves nothing')
  eq(got.measure, 'time', 'it arrived as reps')
  eq(got.sets.map(s => [s.reps, s.seconds, s.weight]), [[null, null, null], [null, null, null]], 'Alex\'s seconds crossed')
  // Sam held it for 30 s; Alex adds a set. Sam's 30 stays, the new set is blank.
  const samHas = edit(carry(sam(), shapeOf(before), added), bs => { bs[0].items[2].sets[0] = { ...bs[0].items[2].sets[0], seconds: 30 }; return bs })
  const more = edit(added, bs => { bs[0].items[2].sets.push(set({ seconds: 60 })); return bs })
  const after = itemNamed(carry(samHas, shapeOf(added), more), 'Plank')
  eq(after.sets.map(s => s.seconds), [30, null, null], 'Sam\'s seconds changed or Alex\'s arrived')
  eq(after.measure, 'time')
  // Swapped for another exercise over there: the hold goes with the old exercise.
  const swapped = edit(added, bs => { const { measure: _m, ...it } = bs[0].items[2]; bs[0].items[2] = { ...it, name: 'Dead bug', exercise: 'dead-bug' }; return bs })
  const bug = itemNamed(carry(samHas, shapeOf(added), swapped), 'Dead bug')
  ok(bug && !('measure' in bug), 'a swap to a reps exercise kept the hold')

  // Logged lifts: a held row arrives with blank seconds, and grows blank seconds.
  const held = { uid: 'p-1', key: 'plank', name: 'Plank', group: 'Core', implement: 'bodyweight', sets: [{ seconds: '45', weight: '' }, { seconds: '40', weight: '' }] }
  const arrived = carry({ sharedFrom: { id: 'owner' }, out: { lifts: [] } }, { lifts: [] }, { out: { lifts: [held] } }).out.lifts[0]
  eq(arrived, { uid: 'p-1', key: 'plank', name: 'Plank', group: 'Core', implement: '', sets: [{ seconds: '', weight: '' }, { seconds: '', weight: '' }] })
  const samRow = { ...held, sets: [{ seconds: '30', weight: '' }, { seconds: '', weight: '' }] }
  const base = { lifts: [{ uid: 'p-1', key: 'plank', name: 'Plank', group: 'Core', sets: 2 }] }
  const three = { out: { lifts: [{ ...held, sets: [...held.sets, { seconds: '35', weight: '' }] }] } }
  const row = carry({ sharedFrom: { id: 'owner' }, out: { lifts: [samRow] } }, base, three).out.lifts[0]
  eq(row.sets, [{ seconds: '30', weight: '' }, { seconds: '', weight: '' }, { seconds: '', weight: '' }])
  // Seconds are a logged number: taking the exercise out over there keeps Sam's.
  const gone = carry({ sharedFrom: { id: 'owner' }, out: { lifts: [samRow] } }, base, { out: { lifts: [] } }).out.lifts
  eq(gone.map(l => l.uid), ['p-1'], 'a hold Sam logged seconds on was removed by the other side')
  // A plank logged as reps before it was a hold is reps on the way over too.
  const legacy = { ...held, sets: [{ reps: '60', weight: '' }] }
  eq(carry({ sharedFrom: { id: 'owner' }, out: { lifts: [] } }, { lifts: [] }, { out: { lifts: [legacy] } }).out.lifts[0].sets, [{ reps: '', weight: '' }])
})

check('a circuit\'s timing is structure, both ways; the seconds each person did stay on their own side (#68)', () => {
  const C = { work: 40, rest: 20, rounds: 3, roundRest: 60, countIn: 10 }
  // A block written before circuits has the shape it always had: no key.
  ok(!('circuit' in shapeOf(alex()).plan[0]), 'every stored base would stop comparing equal')
  // Alex switches the block to a circuit, one set per exercise.
  const before = alex()
  const on = edit(before, bs => { bs[0] = { ...bs[0], circuit: C, items: bs[0].items.map(i => ({ ...i, sets: i.sets.slice(0, 1) })) }; return bs })
  const theirs = carry(sam(), shapeOf(before), on)
  eq(theirs.plan.blocks[0].circuit, C, 'the circuit did not reach Sam')
  // Sam runs it: seconds per round on Sam's own run, nowhere else.
  const ran = { ...theirs, run: { sets: { b0i0s0: { seconds: 120, rounds: [40, 40, 40], at: 1 } }, skipped: [], circuit: null } }
  // Sam makes it four rounds; Alex gets four rounds and none of Sam's seconds.
  const more = edit(ran, bs => { bs[0] = { ...bs[0], circuit: { ...bs[0].circuit, rounds: 4 } }; return bs })
  const mine = carry(on, shapeOf(ran), more)
  eq(mine.plan.blocks[0].circuit.rounds, 4, 'a change of rounds did not cross')
  eq(mine.run, on.run, 'Sam\'s seconds reached Alex\'s run')
  ok(!JSON.stringify(mine.plan).includes('120'), 'Sam\'s seconds reached Alex\'s plan')
  // And Alex's own run, with Alex's seconds, does not travel the other way.
  const alexRan = { ...mine, run: { sets: { b0i0s0: { seconds: 99, rounds: [33, 33, 33], at: 2 } } } }
  const back = carry(more, shapeOf(mine), edit(alexRan, bs => { bs[0] = { ...bs[0], name: 'Core' }; return bs }))
  eq(back.run.sets.b0i0s0.rounds, [40, 40, 40], 'Sam\'s own seconds were lost')
  eq(back.plan.blocks[0].name, 'Core')
  // Switched off over there: off here.
  const off = edit(mine, bs => { const { circuit: _c, ...b } = bs[0]; bs[0] = b; return bs })
  ok(!('circuit' in carry(more, shapeOf(mine), off).plan.blocks[0]), 'switching the circuit off did not cross')
  // A circuit block added on one side arrives on the other a circuit.
  const added = edit(before, bs => [...bs, { uid: 'B2', name: 'Abs', circuit: C, items: [lift('CR', 'Crunch', [set()])] }])
  eq(carry(sam(), shapeOf(before), added).plan.blocks[1].circuit, C, 'a new circuit block arrived as a plain one')
})

check('a writer\'s own hold survives its own write with a stale base (#63 review)', () => {
  // Rev 1: Plank in reps. Rev 2 (stored): a Dead bug arrived. Alex's device,
  // still on rev 1, makes the plank a 45 s hold and writes.
  const id = 'daily-2026-10-26'
  const p = (items) => ({ optId: 'planned', plan: planOf([{ uid: 'B1', name: 'Main', items }]) })
  const plankReps = lift('PL', 'Plank', [set({ reps: 1 }), set({ reps: 1 })])
  const v1 = p([plankReps])
  const base1 = nextBase(id, null, v1)
  const v2 = p([plankReps, lift('DB', 'Dead bug', [set()])])
  const stored = { ...v2, syncBase: nextBase(id, base1, v2) }
  const held = { ...plankReps, measure: 'time', sets: [set({ seconds: 45 }), set({ seconds: 45 })] }
  const r = rebase(stored, { ...p([held]), syncBase: base1 }, id)
  const mine = itemNamed(r.data, 'Plank')
  eq([mine.measure, mine.sets.map(s => s.seconds)], ['time', [45, 45]], 'the writer\'s hold was dropped while its seconds stayed')
  eq(names(r.data), ['Plank', 'Dead bug'])
})

check('a writer from before holds, which sends no measure key, never turns a stored hold into reps (#63 follow-up)', () => {
  const id = 'daily-2026-10-26'
  const p = (items) => ({ optId: 'planned', plan: planOf([{ uid: 'B1', name: 'Main', items }]) })
  const hold = { ...lift('PL', 'Plank', [set(), set()]), measure: 'time' }
  const v1 = p([hold])
  const stored = { ...v1, syncBase: nextBase(id, null, v1) }
  // The old app dropped the key it does not know and wrote the plank back, blank.
  const { measure: _m, ...unaware } = hold
  for (const [label, base] of [['current base', stored.syncBase], ['no base', undefined]]) {
    const r = rebase(stored, { ...p([unaware]), syncBase: base }, id)
    eq(itemNamed(r.data, 'Plank').measure, 'time', `${label}: the hold became reps`)
  }
  // An app that knows says so, and is heard: counted in reps from now on.
  const said = rebase(stored, { ...p([{ ...hold, measure: 'reps' }]), syncBase: stored.syncBase }, id)
  eq(itemNamed(said.data, 'Plank').measure, 'reps')
  // A different exercise in that place takes its own (no hold).
  const swapped = rebase(stored, { ...p([{ ...unaware, name: 'Dead bug', exercise: 'dead-bug' }]), syncBase: stored.syncBase }, id)
  ok(!('measure' in itemNamed(swapped.data, 'Dead bug')), 'a swapped-in reps exercise kept the hold')
})

check('THE RULE: only a write whose base lines up with the stored entry changes or carries structure', () => {
  // Rev 1: Squat, Deadlift. Since then Row arrived from the other side: rev 2.
  const old = alex()
  const rev1 = nextBase('d', null, old)
  const now = edit(old, bs => { bs[0].items.push(lift('RW', 'Row', [set()])); return bs })
  const rev2 = nextBase('d', rev1, now)
  // Every device below takes Deadlift out and logs a squat at 105.
  const logged = (data) => edit(data, bs => {
    bs[0].items = bs[0].items.filter(i => i.name !== 'Deadlift')
    bs[0].items[0] = { ...bs[0].items[0], sets: bs[0].items[0].sets.map((x, i) => (i ? x : { ...x, weight: 105 })) }
    return bs
  })
  const fromOld = (syncBase) => { const d = { ...logged(old), run: { sets: { b0i0s0: { reps: 5, weight: 105 } } } }; if (syncBase !== undefined) d.syncBase = syncBase; return d }
  const fromNow = { ...logged(now), syncBase: rev2, run: { sets: { b0i0s0: { reps: 5, weight: 105 } } } }
  const write = (stored, sent) => {
    const was = { id: 'd', kind: 'daily', date: '2026-10-25', updatedAt: '2026-10-25T10:00:00.000Z', data: stored }
    const e = { ...was, updatedAt: '2026-10-25T10:05:00.000Z', data: sent }
    const r = onWrite({ entries: { d: was } }, { entries: { d: e } }, ['d'], () => ({ wasSynced: true, to: [{ personId: 'sam', entryId: 'd' }] }))
    return { got: r.state.entries.d.data, carries: r.carries, intent: rebase(stored, stampData(sent, stored), 'd').intent }
  }
  const rows = [
    // [stored base, incoming, intent, names written, names carried (null: nothing carried)]
    ['present', 'none', { ...now, syncBase: rev2 }, fromOld(undefined), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['present', 'matching', { ...now, syncBase: rev2 }, fromNow, 'current', ['Squat', 'Row'], ['Squat', 'Row']],
    ['present', 'stale', { ...now, syncBase: rev2 }, fromOld(rev1), 'stale', ['Squat', 'Row'], ['Squat', 'Row']],
    ['present', 'foreign: another entry', { ...now, syncBase: rev2 }, fromOld({ ...rev1, of: 'daily-other' }), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['present', 'foreign: newer than stored', { ...now, syncBase: rev2 }, fromOld({ ...rev1, rev: 7 }), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['present', 'foreign: same rev, other shape', { ...now, syncBase: rev2 }, fromOld({ ...rev1, rev: 2 }), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['present', 'foreign: not a base', { ...now, syncBase: rev2 }, fromOld(shapeOf(old)), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['none', 'none', now, fromOld(undefined), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['none', 'matching', now, { ...fromNow }, 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['none', 'stale', now, fromOld(rev1), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
    ['none', 'foreign', now, fromOld({ ...rev1, of: 'daily-other' }), 'numbers', ['Squat', 'Deadlift', 'Row'], null],
  ]
  for (const [storedBase, sentBase, stored, sent, intent, written, carried] of rows) {
    const at = `stored base ${storedBase}, incoming ${sentBase}`
    const { got, carries, intent: was } = write(stored, sent)
    eq(was, intent, `${at}: intent`)
    eq(names(got), written, `${at}: structure written`)
    // The device's numbers always land.
    eq([itemNamed(got, 'Squat').sets[0].weight, Object.values(got.run.sets)], [105, [{ reps: 5, weight: 105 }]], `${at}: its numbers`)
    if (carried === null) eq(carries.length, 0, `${at}: carried a write with no structural intent`)
    else {
      eq(carries.length, 1, `${at}: carry`)
      eq(names(carry(blanked(sam(), ['Deadlift']), carries[0].before, carries[0].after)), carried.filter(n => n !== 'Row'), `${at}: what reached the other side`)
    }
  }
})

check('a numbers-only write never loses a set it logged, and does not carry it', () => {
  const old = alex()
  const rev1 = nextBase('d', null, old)
  // Stored (rev 2): the other side took Deadlift out. A device with NO base logged on Deadlift.
  const stored = edit(old, bs => { bs[0].items.pop(); return bs })
  const storedData = { ...stored, syncBase: nextBase('d', rev1, stored) }
  const { syncBase: _b, ...noBase } = { ...old, run: { sets: { b0i1s0: { reps: 3, weight: 150 } } } }
  const r = rebase(storedData, stampData(noBase, storedData), 'd')
  eq([r.intent, names(r.data), r.carry], ['numbers', ['Squat', 'Deadlift'], null])
  eq(Object.values(r.data.run.sets), [{ reps: 3, weight: 150 }])
  // With a stale base that had Deadlift, the same: logged data is never removed by anyone else's write.
  const stale = rebase(storedData, stampData({ ...noBase, syncBase: rev1 }, storedData), 'd')
  eq([stale.intent, names(stale.data), names(stale.carry)], ['stale', ['Squat', 'Deadlift'], ['Squat']])
})

check('a receipt for every write: a device that kept editing never applies its last change twice', () => {
  // One device: Squat at 2 sets (rev 1). It adds a set and sends (W1); before the answer
  // lands it adds another, so it keeps its own copy, and with it the base W1 carried.
  let at = 0
  const stamp = () => `2026-10-25T10:0${at++}:00.000Z`
  const land = (stored, data) => {
    const was = { id: 'd', kind: 'daily', date: '2026-10-25', updatedAt: stored.updatedAt, data: stored.data }
    const e = { ...was, updatedAt: stamp(), data }
    const r = onWrite({ entries: { d: was } }, { entries: { d: e } }, ['d'], () => ({ wasSynced: true, to: [{ personId: 'sam', entryId: 'd' }] }))
    return { stored: r.state.entries.d, ack: r.acks.d || null }
  }
  const sets = (data) => itemNamed(data, 'Squat').sets.length
  const base0 = alex()
  const stored0 = { updatedAt: stamp(), data: { ...base0, syncBase: nextBase('d', null, base0) } }
  const plus = (data) => edit(data, bs => { bs[0].items[0].sets.push(set()); return bs })
  const minus = (data) => edit(data, bs => { bs[0].items[0].sets.pop(); return bs })
  const w1 = plus(stored0.data)
  const one = land(stored0, w1)
  eq([sets(one.stored.data), one.ack], [3, one.stored.data.syncBase], 'the receipt of a write that stood is the stored base')
  // Without the receipt the old base reads W1 again: an add is held to what was asked
  // (wantSets), but a set taken off after W1 comes back. That is what the receipt is for.
  eq(sets(land(one.stored, plus(w1)).stored.data), 4)
  const back = land(one.stored, minus(w1))
  eq(sets(back.stored.data), 3, 'a set taken off after W1 comes back without the receipt')
  // With it, the next write is only what changed since W1.
  const acked = (data) => ({ ...data, syncBase: one.ack })
  eq(sets(land(one.stored, acked(plus(w1))).stored.data), 4, 'one more set is one more set')
  eq(sets(land(one.stored, acked(minus(w1))).stored.data), 2, 'a set taken off stays off')
})

check('a receipt when the other side\'s change met the write: the base it sent, with what it sent', () => {
  // Rev 1: Squat, Deadlift. Row arrives from the other side (rev 2). The device, still on
  // rev 1, adds a squat set (stale), then adds another while that is on the way.
  const base1 = alex()
  const rev1 = nextBase('d', null, base1)
  const withRow = edit(base1, bs => { bs[0].items.push(lift('RW', 'Row', [set()])); return bs })
  const was = { id: 'd', kind: 'daily', date: '2026-10-25', updatedAt: '2026-10-25T10:00:00.000Z', data: { ...withRow, syncBase: nextBase('d', rev1, withRow) } }
  const links = () => ({ wasSynced: true, to: [{ personId: 'sam', entryId: 'd' }] })
  const w1 = edit({ ...base1, syncBase: rev1 }, bs => { bs[0].items[0].sets.push(set()); return bs })
  const r1 = onWrite({ entries: { d: was } }, { entries: { d: { ...was, updatedAt: '2026-10-25T10:01:00.000Z', data: w1 } } }, ['d'], links)
  const stored = r1.state.entries.d
  eq([names(stored.data), itemNamed(stored.data, 'Squat').sets.length, stored.data.syncBase.rev], [['Squat', 'Deadlift', 'Row'], 3, 3])
  eq(r1.acks.d, { of: 'd', rev: 1, ...shapeOf(stampData(w1, was.data)) }, 'the receipt is what W1 said, on the base it said it from')
  const w2 = edit({ ...w1, syncBase: r1.acks.d }, bs => { bs[0].items[0].sets.push(set()); return bs })
  const r2 = onWrite({ entries: { d: stored } }, { entries: { d: { ...stored, updatedAt: '2026-10-25T10:02:00.000Z', data: w2 } } }, ['d'], links)
  eq([names(r2.state.entries.d.data), itemNamed(r2.state.entries.d.data, 'Squat').sets.length], [['Squat', 'Deadlift', 'Row'], 4],
    'the second write added one set and kept the Row it never saw')
})

check('no receipt for a write whose structure did not count, or one last-write-wins turned away', () => {
  const old = alex()
  const rev1 = nextBase('d', null, old)
  const now = edit(old, bs => { bs[0].items.pop(); return bs })
  const was = { id: 'd', kind: 'daily', date: '2026-10-25', updatedAt: '2026-10-25T10:00:00.000Z', data: { ...now, syncBase: nextBase('d', rev1, now) } }
  const links = () => ({ wasSynced: true, to: [] })
  const { syncBase: _b, ...noBase } = edit(old, bs => { bs[0].items[0].sets.push(set()); return bs })
  const r = onWrite({ entries: { d: was } }, { entries: { d: { ...was, updatedAt: '2026-10-25T10:01:00.000Z', data: noBase } } }, ['d'], links)
  eq(r.acks, {}, 'a numbers-only write got a receipt')
  const kept = onWrite({ entries: { d: was } }, { entries: { d: was } }, ['d'], links)
  eq(kept.acks, {}, 'a write that did not land got a receipt')
})

/*
 * #105: copies shared before uids existed. The seed's copies from Oct 13 to Oct 24
 * have no uid anywhere and no syncBase, on either side; one of them is three
 * "Round N of 3" blocks with the same exercise names, and a plan can have Back
 * squat in its main block and again in a circuit. A first write must never add,
 * move or duplicate an exercise, and its numbers land on the exercise it wrote them on.
 */
const preUid = (o = {}) => ({ uid: undefined, ...o })
const strip = (data) => ({ ...data, plan: planOf(data.plan.blocks.map(b => ({ ...b, uid: undefined, items: b.items.map(i => ({ ...i, uid: undefined })) }))) })
const squatDay = (extra = {}) => ({
  optId: 'planned', done: false, ...extra,
  plan: planOf([
    preUid({ name: 'Main', items: [lift(undefined, 'Back squat', [set({ reps: 5 }), set({ reps: 5 }), set({ reps: 5 })]), lift(undefined, 'Romanian deadlift', [set({ reps: 8 })])] }),
    preUid({ name: 'Finisher', circuit: { work: 40, rest: 20, rounds: 3 }, items: [lift(undefined, 'Back squat', [set()]), lift(undefined, 'Lunge', [set()])] }),
  ]),
})
const roundsDay = (extra = {}) => {
  const round = (n) => preUid({ name: `Round ${n} of 3`, items: ['Crunch', 'Rest / transition', 'Dead bug', 'Rest / transition'].map(nm => ({ ...lift(undefined, nm, [set({ seconds: 40 })]), kind: 'interval' })) })
  return { optId: 'planned', done: false, ...extra, plan: planOf([preUid({ name: 'Warm-up', items: [] }), round(1), round(2), round(3)]) }
}
const ownerOf = (data) => ({ ...data, sharedWith: [{ id: 'sam', entryId: 'd', sync: true }] })
const copyOf = (data) => ({ ...data, sharedFrom: { id: 'owner', name: 'Alex' } })
/** One write through onWrite: the stored entry, the same entry as its device sends it after `change`. */
const firstWrite = (stored, change, linksOf) => {
  const was = { id: 'd', kind: 'daily', date: '2026-10-22', updatedAt: '2026-10-22T10:00:00.000Z', data: stored }
  const sent = JSON.parse(JSON.stringify(stored))
  change(sent)
  const r = onWrite({ entries: { d: was } }, { entries: { d: { ...was, updatedAt: '2026-10-22T10:05:00.000Z', data: sent } } }, ['d'], linksOf)
  return { ...r, got: r.state.entries.d.data, sent }
}
const shapeNames = (data) => data.plan.blocks.map(b => `${b.name}[${b.items.map(i => `${i.name}:${i.sets.length}`).join(',')}]`)
const ownerLinks = () => ({ wasSynced: true, to: [{ personId: 'sam', entryId: 'd' }] })
const copyLinks = (ownerData) => () => ({ wasSynced: true, ref: ownerData, to: [{ ownerEntryId: 'd' }] })

check('pre-uid copies (#105): the runner\'s first write marks Back squat in its own block, and adds nothing, on either side', () => {
  for (const [side, stored, links] of [
    ['owner', ownerOf(squatDay()), ownerLinks],
    ['Sam', copyOf(squatDay()), copyLinks(ownerOf(squatDay()))],
  ]) {
    const { got, carries } = firstWrite(stored, d => { d.run = { sets: { b0i0s0: { reps: 5, weight: 60 } }, cursor: 'b0i0s1' } }, links)
    eq(shapeNames(got), shapeNames(stored), `${side}: the structure changed`)
    eq(got.run.sets, { b0i0s0: { reps: 5, weight: 60 } }, `${side}: the mark left the main block's Back squat`)
    eq(carries.length, 0, `${side}: a numbers-only write carried`)
    ok(got.plan.blocks.every(b => b.uid) && got.plan.blocks.flatMap(b => b.items).every(i => i.uid), `${side}: not stamped`)
    eq(got.syncBase.rev, 1, `${side}: no base written`)
  }
})

check('pre-uid copies (#105): a number typed on the sheet lands on the exercise it was typed into, on either side', () => {
  for (const [side, stored, links] of [
    ['owner', ownerOf(squatDay()), ownerLinks],
    ['Sam', copyOf(squatDay()), copyLinks(ownerOf(squatDay()))],
  ]) {
    const { got } = firstWrite(stored, d => { Object.assign(d.plan.blocks[0].items[0].sets[0], { weight: 40, typed: true }) }, links)
    eq(shapeNames(got), shapeNames(stored), `${side}: the structure changed`)
    eq(got.plan.blocks.map(b => b.items.map(i => i.sets.map(s => s.weight))), [[[40, null, null], [null]], [[null], [null]]], `${side}: the typed 40 was lost or moved`)
    ok(got.plan.blocks[0].items[0].sets[0].typed, `${side}: lost its typed mark`)
  }
})

check('pre-uid copies (#105): the seed\'s three rounds with the same names, a mark and a typed number stay in their round', () => {
  for (const [side, stored, links] of [
    ['owner', ownerOf(roundsDay()), ownerLinks],
    ['Sam', copyOf(roundsDay()), copyLinks(ownerOf(roundsDay()))],
  ]) {
    const { got } = firstWrite(stored, d => {
      d.run = { sets: { b2i0s0: { seconds: 40 } }, cursor: 'b2i1s0' }
      Object.assign(d.plan.blocks[3].items[2].sets[0], { seconds: 35, typed: true })
    }, links)
    eq(shapeNames(got), shapeNames(stored), `${side}: the structure changed`)
    eq(Object.keys(got.run.sets), ['b2i0s0'], `${side}: the mark moved to another round`)
    eq(got.plan.blocks.map(b => b.items.map(i => i.sets[0].seconds)), [[], [40, 40, 40, 40], [40, 40, 40, 40], [40, 40, 35, 40]], `${side}: a number landed in another round`)
    // Every exercise has a uid of its own: none is shared across rounds.
    const uids = got.plan.blocks.flatMap(b => b.items.map(i => i.uid))
    eq(new Set(uids).size, uids.length, `${side}: two exercises took one uid`)
  }
})

check('pre-uid copies (#105): the first write is no more than a normal synced write: uids and a base on what was sent', () => {
  const stored = copyOf(squatDay())
  const { got, sent } = firstWrite(stored, d => { Object.assign(d.plan.blocks[0].items[0].sets[0], { weight: 40, typed: true }); d.out = { rpe: 7 } }, copyLinks(ownerOf(squatDay())))
  const { syncBase: _b, ...rest } = got
  const noUids = (x) => JSON.parse(JSON.stringify(x), (k, v) => (k === 'uid' ? undefined : v))
  eq(noUids(rest), noUids(sent), 'the write rewrote more than uids and the base')
})

check('pre-uid copies (#105): whichever side is written first, both sides stamp the same uids, and a later change crosses once', () => {
  // Sam writes first: the owner's entry is still unstamped, so there is nothing to take uids from.
  const samFirst = firstWrite(copyOf(squatDay()), d => { d.run = { sets: { b0i0s0: { reps: 5 } } } }, copyLinks(ownerOf(squatDay()))).got
  const ownerAfter = firstWrite(ownerOf(squatDay()), d => { d.run = { sets: { b0i1s0: { reps: 8 } } } }, ownerLinks).got
  const uidsOf = (data) => data.plan.blocks.map(b => [b.uid, b.items.map(i => i.uid)])
  eq(uidsOf(samFirst), uidsOf(ownerAfter), 'the two sides minted different uids for the same exercises')
  // The owner, now up to date, takes the circuit's Back squat out and adds a Step-up; Sam's side follows, nothing doubled.
  const stored = { id: 'd', kind: 'daily', date: '2026-10-22', updatedAt: '2026-10-22T11:00:00.000Z', data: ownerAfter }
  const sent = edit(ownerAfter, bs => { bs[1].items.splice(0, 1); bs[1].items.push(lift(undefined, 'Step-up', [set()])); return bs })
  const r = onWrite({ entries: { d: stored } }, { entries: { d: { ...stored, updatedAt: '2026-10-22T11:05:00.000Z', data: { ...sent, syncBase: ownerAfter.syncBase } } } }, ['d'], ownerLinks)
  eq(r.carries.length, 1)
  // On a day still to come, so nothing on Sam's side reads as lifted (`liftedOf`) and the removal follows.
  const st = receive({ entries: { d: { id: 'd', kind: 'daily', date: '2026-10-22', updatedAt: '2026-10-22T10:05:00.000Z', data: samFirst } } }, 'd', { ...r.carries[0], today: '2026-10-20' }, e => Boolean(e.data.sharedFrom))
  eq(shapeNames(st.entries.d.data), ['Main[Back squat:3,Romanian deadlift:1]', 'Finisher[Lunge:1,Step-up:1]'])
  eq(st.entries.d.data.run.sets, { b0i0s0: { reps: 5 } }, 'Sam\'s mark moved')
})

check('pre-uid copies (#105): a uid is never taken from another block, even where the names match', () => {
  // Stored and stamped. A device from before uids took the main block's Back squat out, offline.
  const stored = stampData(squatDay())
  const [mainSquat, circuitSquat] = [stored.plan.blocks[0].items[0].uid, stored.plan.blocks[1].items[0].uid]
  const device = edit(strip(stored), bs => { bs[0].items.splice(0, 1); return bs })
  const stamped = stampData(device, stored)
  eq(stamped.plan.blocks[1].items[0].uid, circuitSquat, 'the circuit\'s Back squat lost its uid')
  ok(!stamped.plan.blocks.flatMap(b => b.items).some(i => i.uid === mainSquat), 'the main block\'s uid was given to an exercise in another block')
  // And on receive: an unstamped copy takes the sender's uids by block, not by name across the plan.
  const copy = { id: 'd', kind: 'daily', date: '2026-10-22', updatedAt: '2026-10-22T10:00:00.000Z', data: copyOf(edit(squatDay(), bs => { bs[0].items.splice(0, 1); return bs })) }
  const after = edit(stored, bs => { bs[1].items[1] = { ...bs[1].items[1], name: 'Walking lunge' }; return bs })
  const st = receive({ entries: { d: copy } }, 'd', { before: shapeOf(stored), after }, e => Boolean(e.data.sharedFrom))
  eq(shapeNames(st.entries.d.data), ['Main[Romanian deadlift:1]', 'Finisher[Back squat:1,Walking lunge:1]'])
  eq(st.entries.d.data.plan.blocks[1].items[0].uid, circuitSquat)
})

check('only links with sync on are synced; older shares are not', () => {
  const e = { id: 'daily-1', data: { sharedWith: [{ id: 'sam', entryId: 'daily-1', sync: true }, { id: 'robin', entryId: 'daily-1' }] } }
  eq(syncedLinks(e), [{ id: 'sam', entryId: 'daily-1' }])
  eq(syncedLinks({ ...e, deleted: true }), [])
})

check('onWrite: a synced entry is rebased, stamped and carried; with sync off nothing is', () => {
  const was = { id: 'd', kind: 'daily', date: '2026-10-25', updatedAt: '2026-10-25T10:00:00.000Z', data: { ...alex(), syncBase: nextBase('d', null, alex()) } }
  const sent = { ...was, updatedAt: '2026-10-25T10:01:00.000Z', data: edit(was.data, bs => { bs[0].items.pop(); return bs }) }
  const linksOf = () => ({ wasSynced: true, to: [{ personId: 'sam', entryId: 'd' }] })
  const r = onWrite({ entries: { d: was } }, { entries: { d: sent } }, ['d'], linksOf)
  eq(r.state.entries.d.data.syncBase, nextBase('d', was.data.syncBase, sent.data))
  eq(r.state.entries.d.data.syncBase.rev, 2, 'a changed structure is the next revision of the base')
  eq(r.carries.length, 1)
  eq(r.carries[0].before, shapeOf(was.data))
  const off = onWrite({ entries: { d: was } }, { entries: { d: sent } }, ['d'], () => null)
  eq([off.carries.length, off.state.entries.d === sent], [0, true], 'sync off still carried or rewrote')
})

check('receive: lands on a shared copy just past its OWN instant, never the sender\'s; never on an entry they logged themselves', () => {
  const copy = { id: 'd', kind: 'daily', updatedAt: '2026-10-25T09:00:00.000Z', data: blanked(sam(), ['Deadlift']) }
  const before = alex()
  const after = edit(before, bs => { bs[0].items.pop(); return bs })
  const c = { before: shapeOf(before), after, at: '2026-10-25T10:00:00.000Z' }
  const st = receive({ entries: { d: copy } }, 'd', c, e => Boolean(e.data.sharedFrom))
  eq(names(st.entries.d.data), ['Squat'])
  // The sender wrote at 10:00; the copy was last saved at 09:00. A stamp past 10:00 would
  // beat a write Sam saved at 09:30 but sends later (offline), and drop Sam's numbers.
  eq(st.entries.d.updatedAt, '2026-10-25T09:00:00.001Z')
  eq(st.entries.d.data.syncBase, { of: 'd', rev: 1, ...shapeOf(st.entries.d.data) })
  const own = { entries: { d: { ...copy, data: { ...sam(), sharedFrom: undefined } } } }
  ok(receive(own, 'd', c, e => Boolean(e.data.sharedFrom)) === own, 'wrote into an entry Sam logged themselves')
})

liftsEqual.then(() => console.log('  ok    liftedOf reads what lib/lifts.js liftsDone reads, case for case (#80)'))
  .catch(e => { failed++; console.log('  FAIL  liftedOf reads what lib/lifts.js liftsDone reads, case for case (#80)\n         ', e.message) })
  .then(() => { if (failed) { console.log(`\n${failed} failed`); process.exit(1) } })
