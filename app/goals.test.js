/* Totem goals, shown in Bushido:
 *   node app/goals.test.js
 *
 * Read-only: Totem owns goals, Bushido is a second window. The numbers here are
 * Totem's own — nothing in `lib/goals.js` recomputes progress, because a number
 * with two opinions is a number that will disagree with itself.
 *
 * The fixture is the REAL payload shape, copied from a live `GET /api/goals`
 * against the bridge on 2026-09-15, because the whole module is a reader of
 * somebody else's contract.
 */

// The hosts are build-time env; set before the module loads.
process.env.VITE_BUSHIDO_HOST = 'bushido.example.com'
process.env.VITE_BUSHIDO_LEGACY_HOSTS = 'pulse.example.com, old.example.com'
const { isBushidoGoal, bushidoGoals, bushidoGoalCards, goalSummary, goalNudge, BUSHIDO_LINK } = await import('./src/lib/goals.js')

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const eq = (got, want, what = '') => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${what || 'value'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
  }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg) }

const metric = (label, value, target, extra = {}) => ({
  id: `m-${label}`, label, unit: 'mi', targetValue: target, value,
  percent: Math.round((value / target) * 100), sourceKind: 'manual',
  sourceLabel: 'logged by hand', available: true, unavailableReason: null, ...extra,
})
const goal = (title, links, extra = {}) => ({
  id: `g-${title}`, title, notes: '',
  period: { type: 'month', start: '2026-09-01', end: '2026-09-30', label: 'September 2026' },
  periodState: 'active', daysLeft: 16, complete: false, postponedCount: 0,
  metrics: [metric('Miles run', 12, 50)], links, ...extra,
})
const bushidoLink = [{ id: 'l1', kind: 'url', label: 'Bushido', url: `https://${BUSHIDO_LINK}`, todoId: null }]

/* ================================================================ linking === */

check('a goal linked to Bushido is one of ours', () => {
  ok(isBushidoGoal(goal('Run 50 miles', bushidoLink)))
})

check('a goal with no link, or a link elsewhere, is not', () => {
  ok(!isBushidoGoal(goal('Ship the thing', [])))
  ok(!isBushidoGoal(goal('Ship the thing', [{ kind: 'url', url: 'https://github.com/x', label: 'PR' }])))
  ok(!isBushidoGoal(goal('Ship the thing', undefined)))
})

check('a todo link is not a url link', () => {
  // `goal_links` holds both kinds; only a URL can point at this app.
  ok(!isBushidoGoal(goal('x', [{ kind: 'todo', todoId: 't1', label: 'a task', url: null }])))
})

check('the host is matched, not the whole URL', () => {
  // A trailing slash, a path, or one of the app's OLD hostnames must all still
  // count: links already stored in Totem use them (back-compat, see LEGACY_HOSTS).
  for (const url of [
    'https://bushido.example.com',
    'https://bushido.example.com/',
    'https://bushido.example.com/#today',
    'https://pulse.example.com/',
    'https://old.example.com',
  ]) ok(isBushidoGoal(goal('x', [{ kind: 'url', url, label: 'Bushido' }])), url)
})

check('a host is matched exactly, not as a substring', () => {
  for (const url of ['https://bushido.example.com.evil.net/', 'https://evil.net/?u=bushido.example.com', 'not a url']) {
    ok(!isBushidoGoal(goal('x', [{ kind: 'url', url, label: 'x' }])), url)
  }
})

// A second copy of the module, loaded with no host in the build env.
const savedHost = process.env.VITE_BUSHIDO_HOST
delete process.env.VITE_BUSHIDO_HOST
const noHost = await import('./src/lib/goals.js?nohost')
process.env.VITE_BUSHIDO_HOST = savedHost

check('with VITE_BUSHIDO_HOST unset, the page\'s own host is matched', () => {
  const mod = noHost
  const here = { host: 'training.example.net' }
  ok(mod.bushidoHost(here) === 'training.example.net', 'the runtime host is not used')
  const link = (url) => goal('x', [{ kind: 'url', url, label: 'x' }])
  ok(mod.isBushidoGoal(link('https://training.example.net/'), mod.goalHosts(here)), 'a link to this page\'s host is not matched')
  ok(mod.isBushidoGoal(link('https://pulse.example.com/'), mod.goalHosts(here)), 'legacy hosts from env stopped counting')
  ok(!mod.isBushidoGoal(link('https://other.example.org/'), mod.goalHosts(here)))
  ok(mod.bushidoHost(undefined) === '', 'no window, no env: no host')
})

check('with no host configured, nothing matches', () => {
  ok(!isBushidoGoal(goal('x', [{ kind: 'url', url: 'https://bushido.example.com', label: 'x' }]), []))
})

/* ============================================================== THE BUG === */

check('THE CRASH: filtering does not hand the array index to `hosts`', () => {
  // `all.filter(isBushidoGoal)` calls back with (element, index, array), so the
  // second parameter arrived as a NUMBER and `0.some(...)` threw — inside a
  // useMemo on first render, which took the entire app down to a blank page.
  // The SSR render suite could not catch it: the fetch never resolves there, so
  // the list was always empty and the callback never ran.
  const cache = { goals: [goal('a', bushidoLink), goal('b', bushidoLink), goal('c', bushidoLink)] }
  eq(bushidoGoals(cache).length, 3)
  // And directly, which is what a future refactor is most likely to get wrong again.
  eq([goal('a', bushidoLink)].filter((g, i, arr) => isBushidoGoal(g)).length, 1)
})

check('an empty or missing cache is empty, not a crash', () => {
  eq(bushidoGoals(null), [])
  eq(bushidoGoals({}), [])
  eq(bushidoGoals({ goals: null }), [])
  eq(bushidoGoalCards(undefined), [])
})

/* =============================================================== ordering === */

check('finished goals sink, and the most urgent leads', () => {
  const cache = { goals: [
    goal('done', bushidoLink, { complete: true, daysLeft: 2 }),
    goal('later', bushidoLink, { daysLeft: 40 }),
    goal('soon', bushidoLink, { daysLeft: 3 }),
  ] }
  eq(bushidoGoals(cache).map(g => g.title), ['soon', 'later', 'done'])
})

/* ================================================================ summary === */

check("the numbers are Totem's, not recomputed", () => {
  // If this module ever starts doing the arithmetic itself, the two will
  // disagree the first time a rollup edge or a Strava source changes.
  const g = goal('Run', bushidoLink, { metrics: [
    { ...metric('Miles', 30, 50), percent: 99 },  // deliberately inconsistent
  ] })
  eq(goalSummary(g).metrics[0].percent, 99, "Totem's percent should win")
})

check('a goal-level percent is the mean across its metrics', () => {
  const g = goal('Both', bushidoLink, { metrics: [metric('a', 25, 50), metric('b', 40, 40)] })
  eq(goalSummary(g).percent, 75)
})

check('a percent is clamped, because a metric can be overshot', () => {
  const g = goal('Over', bushidoLink, { metrics: [{ ...metric('a', 80, 50), percent: 160 }] })
  eq(goalSummary(g).metrics[0].percent, 100)
})

check('a connector-fed metric says so; a hand-logged one does not', () => {
  const g = goal('Ride', bushidoLink, { metrics: [
    { ...metric('Miles', 10, 100), sourceKind: 'strava_distance', sourceLabel: 'Strava' },
  ] })
  const m = goalSummary(g).metrics[0]
  eq(m.manual, false)
  eq(m.source, 'Strava')
})

check('a goal with no metrics still summarises', () => {
  eq(goalSummary(goal('x', bushidoLink, { metrics: [] })).percent, 0)
  eq(goalSummary(goal('x', bushidoLink, { metrics: [], complete: true })).percent, 100)
})

check('a garbage goal does not throw', () => {
  const s = goalSummary({})
  eq(s.title, 'Untitled goal')
  eq(s.metrics, [])
})

/* ================================================================== steps === */

check('steps come from `subGoals`, the field Totem actually sends', () => {
  // It read `goal.steps` for a week — a field the bridge has never sent — so every
  // step and every number on one was dropped and the section never appeared.
  const g = goal('Complete cardio goals', bushidoLink, {
    metrics: [],
    subGoals: [
      { id: 's1', title: '2 bike rides (10+ miles)', complete: false, abandoned: false,
        metrics: [metric('rides', 1, 2), metric('miles', 12, 20)],
        progress: { fraction: 0.55, percent: 55 } },
      { id: 's2', title: '1 swim', complete: true, abandoned: false, metrics: [], progress: { percent: 100 } },
    ],
  })
  const card = goalSummary(g)
  eq(card.steps.map(s => s.title), ['2 bike rides (10+ miles)', '1 swim'])
  eq(card.steps[0].metrics.map(m => m.label), ['rides', 'miles'], 'a step keeps all of its numbers')
  eq(card.steps[0].percent, 55)
  eq(card.steps[1].complete, true)
})

check("the goal's own percent wins over the mean, because the steps are in it", () => {
  // A goal whose numbers all live on its steps has no metrics of its own, and the
  // mean of nothing is 0 — which is how a week of real riding read as untouched.
  const g = goal('Cardio', bushidoLink, {
    metrics: [],
    progress: { percent: 56 },
    subGoals: [{ id: 's1', title: 'rides', metrics: [metric('rides', 1, 2)], progress: { percent: 56 } }],
  })
  eq(goalSummary(g).percent, 56)
})

check('a goal with no steps still summarises, and a garbage one does not throw', () => {
  eq(goalSummary(goal('x', bushidoLink)).steps, [])
  eq(goalSummary({}).steps, [])
})

check('an unreadable number on a step is not a zero', () => {
  const g = goal('Cardio', bushidoLink, {
    metrics: [],
    subGoals: [{ id: 's1', title: 'ride', progress: { percent: 0 }, metrics: [
      { ...metric('Strava miles', 0, 50), available: false, unavailableReason: 'not connected' },
    ] }],
  })
  const m = goalSummary(g).steps[0].metrics[0]
  eq(m.available, false)
  eq(m.unavailable, 'not connected')
})

/* ================================================================= nudges === */

check('a nudge only appears when there is something to say', () => {
  const fine = goalSummary(goal('x', bushidoLink, { daysLeft: 20, metrics: [metric('a', 40, 50)] }))
  eq(goalNudge(fine), null, '20 days left and 80% done needs no comment')

  const behind = goalSummary(goal('x', bushidoLink, { daysLeft: 3, metrics: [metric('a', 5, 50)] }))
  ok(/3 days left/.test(goalNudge(behind)), goalNudge(behind))

  eq(goalNudge(goalSummary(goal('x', bushidoLink, { complete: true }))), null, 'a finished goal is not nagged')
})

check('a goal whose numbers are all on its steps still gets a nudge', () => {
  // The nudge used to require metrics on the goal itself, which is the one shape
  // that never has them.
  const behind = goalSummary(goal('Cardio', bushidoLink, {
    metrics: [], daysLeft: 2, progress: { percent: 20 },
    subGoals: [{ id: 's1', title: 'rides', metrics: [metric('rides', 0, 2)], progress: { percent: 0 } }],
  }))
  ok(/2 days left/.test(goalNudge(behind)), String(goalNudge(behind)))
})

check('a repeatedly postponed goal is named as one', () => {
  // Totem's own schema comment calls postponed_count "the most useful number in
  // the table" for exactly this reason.
  const pushed = goalSummary(goal('x', bushidoLink, { postponedCount: 4, daysLeft: 20 }))
  ok(/Pushed 4 times/.test(goalNudge(pushed)), goalNudge(pushed))
})

console.log(failed ? `\n${failed} goals test(s) failed` : '\nall goals tests pass')
process.exit(failed ? 1 : 0)
