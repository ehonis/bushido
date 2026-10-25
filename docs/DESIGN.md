# The overhaul: decisions and how the work is split

This is the source of truth for the multi-agent overhaul. Read it after `AGENTS.md`. Where a
change below reverses something `AGENTS.md` says, the PR that implements it also rewrites that
part of `AGENTS.md` (and `mobile/AGENTS.md`) so the two never disagree. If your change would
contradict this file, say so in the issue before writing it.

## What the owner asked for

1. **Shared workouts sync.** Two people on the same workout share its STRUCTURE; each keeps
   their own numbers.
2. **Always know whose side you are on.** In a shared workout, the person you are viewing stays
   visible at the top while you scroll, and when you come back later.
3. **The other person's history.** Opening an exercise on someone else's side shows what THEY
   did last time, not nothing.
4. **Done by default.** A workout is done once its day has arrived; the owner can mark it undone.
5. **AI drafts survive leaving the page.** Drafting a workout with the model keeps a draft you
   can come back to.
6. **A real UI pass** across the web app and the iPhone app. Same functionality, much better
   screens.

## Decisions

### D1. Two-way live sync of structure (shared workouts)

- A shared workout has a **Sync** toggle (on by default when someone is added). While on, the
  workout's structure is one thing seen from two sides: adding, removing, renaming, reordering
  exercises or blocks, and changing set COUNTS, on EITHER side, appears on the other.
- **Never synced:** reps, weights, grades, times per set, effort/RPE, felt, notes, gear, `done`,
  WHOOP/Strava snapshots. These are each person's own (`AGENTS.md` §6.4 still holds: the other
  side's numbers may show as placeholders, never values).
- Both logs stay separate files (`AGENTS.md` §3: one device never mixes two logs). Sync is a
  server-side write into the other person's entry through the existing people route, merged by
  structure identity (stable exercise/block ids), not by position. A set added on one side
  appears as a blank set on the other.
- Turning Sync off freezes each side where it is. "Copy my exercises" goes away while Sync is
  on (it is what Sync does continuously).
- Last-write-wins still applies per entry; structural merges must not drop the other side's
  numbers for exercises that still exist on both.

### D2. Done once the day arrives

- Creating an entry for **today or an earlier day** writes `done: true`. An entry dated in the
  **future** is written `done: false` and counts as done from its day on (a pure read rule, so
  nothing has to wake up at midnight to flip it). An explicit "mark undone" (`done: false`
  written by a tap) always wins and is never flipped back.
- Today has to tell these apart. Suggested shape: future-dated planned entries carry
  `data.plannedFor`/`done: false`, and `isDone()` treats `done: false` with no explicit-undo
  marker as done once `date <= today`. The implementing PR decides the exact shape, justifies
  it, and keeps `isDone()` the single statement of it (web `lib/store.js`, server copy in
  `server/server.js`, mobile copy).
- Everything that keys off a TRANSITION to done (the "logged" push, habit sync) must still fire
  exactly once.
- `AGENTS.md` §4 "Planning is not completing" is rewritten by this PR.

### D3. AI drafts are server-side

- Starting "Write it for me" creates a **draft** stored on the server (beside the log, per
  person's space, not an entry and not in `state.json`). The model run is tied to the draft, not
  to the open page, so leaving, backgrounding the phone or switching devices loses nothing.
- The planner shows drafts in progress and finished-but-not-kept drafts; tapping one reopens it
  at the step it was on (working, review, revise thread). Keeping a draft places it exactly as
  today; discarding deletes it.
- Nothing is written to the log until the owner taps (`AGENTS.md` §7 still holds).

### D4. One visual system, two renderers

- The web (`app/src/styles.css`) and the iPhone app (`mobile/src/theme.ts`, `mobile/src/ui/`)
  share one set of design tokens (colour, type scale, spacing, radius, elevation) and one set of
  component patterns. The foundation PR defines them and records them here under **Visual
  system** below; screen PRs only consume them.
- The viz palette rules still apply (`npm run palette`, `AGENTS.md` §6.10).
- Phone-first, one-handed, 44px targets, 16px inputs (`AGENTS.md` §6.7). Calm, dense where the
  data is, not decorative. No hand-drawn icons (lucide, then tabler).

### D5. The iPhone app ships over the air

- **No native changes in `mobile/`**: no new native dependency, no `app.json`/`app.config.js`
  plugin or permission change, nothing that changes the Expo fingerprint
  (`runtimeVersion.policy: "fingerprint"`). JavaScript and assets that already exist only. If a
  change truly needs native code, stop and say so in the issue.
- The web stays the spec for behaviour; the overhaul redesigns both together, so a screen PR
  changes the web screen and its `mobile/src/features` twin in the same PR.

### D6. A workout log, not a climbing tool: what goes

The owner's direction (2026-10-25): Bushido is now a plain, very easy to use workout logging app.
Measured from the live log, the last 30 days were free-form workouts, rest days, planned
workouts and shared workouts, with WHOOP/Strava attached. These features are **removed from the
app** (UI, routes, prompts, tests that pin them, AGENTS.md sections). Data they already stored
stays on disk untouched and is simply no longer shown:

- Daily check-in (`checkin.jsx`, check-in entries, the dormant check-in coach `/api/chat`).
- Journal (`journal.jsx`, `lib/journal.js`).
- Achievements (`achievements.jsx`, `lib/achievements.js`, the tab).
- Linked goals (`goals.jsx`, `lib/goals.js`, `/api/goals`, the tab, goal-pace notifications).
- Quotas and Plan the week (`quotabars.jsx`, `lib/quota.js`, `weekplanner.jsx`,
  `server/weekplanner.js`, the Week tab, quota entries, planner prompt text about "what the
  week still owes").
- The AI coach chat (`coach.jsx`, `server/coach.js`, the tab, the coach note). AI "Write it for
  me" workout planning STAYS.
- Climbing-specific prominence: force/MVC tests, the critical-force ceiling and climbing-only
  charts no longer lead any screen. Climbing cards stay pickable (grouped under Climbing, after
  the general ways to log), and their history still reads. The hard-finger blocks may stay in
  `lib/` where they guard placement, but nothing climbing-specific is shown above ordinary
  workout logging.

Stays: Today, Log, Progress (general charts), Log a workout, Pick a session, Plan a workout (by
hand or AI), rest days, the runner, shared workouts / people, WHOOP, Strava, gear, body weight,
notifications (minus goal pace), Settings.

Navigation after the cut: **Today, Log, Progress** (the Week tab goes with quotas). The + menu
holds only what remains.

### D7. Intuitive first

Every screen should be obvious to someone who has never seen it: one primary action per
screen, plain labels instead of jargon ("sRPE", "slot", "adjunct", "repeaters" never appear as
UI words), no more than two taps to log the common case, nothing hidden behind an unlabeled
icon. When in doubt, remove a control rather than explain it.

### D8. The workout timer is a general interval timer

The workout-mode timer becomes a general interval timer, usable for any workout and not only
climbing cards: work/rest/rounds/sets/rest-between-sets, count-in, optional named intervals, presets
the user saves, big glanceable display, cues (beeps on web, haptics on the phone via the existing
`lib/cues`). Highly customisable but with a one-screen default that starts in one tap. The clock
rules in `AGENTS.md` §6.5 that still make sense (absolute instants so it survives backgrounding,
count-up when no rest is given) stay; the content-declared climbing timers still work as presets.

## Visual system

(Filled in by the foundation PR: tokens, type scale, spacing, components, and the per-screen
audit that the wave-2 screen issues are written from.)

## Working on the overhaul

- Claim your issue with a comment. Stay in your owned paths; if you must touch another issue's
  path, keep the change minimal and say so in the PR.
- Branch from fresh `origin/main`, push to `origin` only, open a PR with `Closes #N`.
- `nice -n 10` for installs, builds and tests. Tests never reach the network.
- Before opening the PR: `npm test` at the repo root, `npm run build`, and
  `npm --prefix mobile run typecheck` if you touched `mobile/`.
- UI work is looked at, not just tested: screenshot the web screens you changed at phone width
  (the `ui-screenshot` skill) and attach or describe them in the PR. A throwaway server uses its
  own port and its own temporary data dir, and is stopped when you finish.
- Never start anything against the live data or the mini.
