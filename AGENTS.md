# AGENTS.md — Bushido

Working notes for any person or AI agent changing this repository.

If AGENTS.local.md exists, read it too: it holds the owner's deployment-specific notes.

Bushido is a self-hosted, single-owner health and training log: a phone-first React PWA
(`app/`) served by a zero-dependency Node server (`server/`), backed by one JSON file. The
[README](README.md) is the public front page; [`docs/features.md`](docs/features.md)
describes each part of the app; [`docs/operations.md`](docs/operations.md) covers files,
sign-in, the API, sync and backups; [`deploy/README.md`](deploy/README.md) covers the
systemd unit and upgrades. This file is the part those do not say: the invariants, the
reasons behind the design, and the things that have been removed on purpose.

---

## 0. If you read nothing else

1. **Build before you say it is done.** A change under `app/src` is not live until
   `npm run build` has written `dist/`. Content files are read at runtime; app code is not.
2. **Run `npm test` at the repo root** after any change to the app, the server or a
   content file. It runs every app suite, the SSR smoke render of every tab, and every
   server suite (including `server/http.test.js`, which boots real servers).
3. **Two rules block; everything else advises.** No hard finger day the day after
   another, and no more than `recommender.hardCap` in a week. Nothing may bypass them.
4. **Nothing the AI produces is written until the user taps.** The coach and planners
   return offers; the app's own write paths place them.
5. **AI runs are constrained by `--allowedTools` / `--disallowedTools`, not by prompt
   text.** No AI run can write `data/state.json` or the plan file.
6. **Resolve an entry's session with `optFor`, never a raw `menu.find`.**
7. **`data.done` is the only thing that means "I did this."** Use `isDone()`.
8. **WHOOP/Strava caches are disposable; the snapshot on an entry is the user's log.**
9. **Every integration is optional and off on a fresh install.** Code must work with no
   bridge, no notify core, no brain file, no AI CLI, and the starter content.
10. **Many removals are pinned by tests that assert an ABSENCE.** If a smoke case fails
    because something reappeared, the test is right. See §2 and §10.

---

## 1. Where things live

### Top level

| Path | What |
|---|---|
| `app/` | React 19 + Vite frontend. `app/src/` is the UI; `app/src/lib/` is the pure logic, tested without a DOM. |
| `server/` | Plain Node `http`/`fs`/`crypto`, no npm dependencies. |
| `content/starter.json` | What a fresh install runs on: catalogs and the rest card, no programme. **Generated.** |
| `examples/plan.json` | A small, invented example plan (Settings → "Use the example plan"). **Generated.** |
| `examples/coach/CHECKIN.md` | Prompt for the dormant check-in coach (§7). |
| `test/fixtures/plan.json` | A large synthetic climbing-and-triathlon programme used by the test suites (smoke render, every app suite, `starter.test.mjs`) and by `starter.build.mjs` / `muscles.build.mjs`. The canonical fixture, and the source both generated files are built from. |
| `data/` | Runtime state. Gitignored. Never commit, delete or rewrite it (§4). |
| `deploy/bushido.service` | The systemd user unit. |
| `scripts/start.js` | `npm start`: builds the app if there is no build, then runs the server. |
| `Dockerfile`, `docker-compose.yml` | Container path; data in a volume at `/data`, no Claude CLI in the image. |
| `.github/workflows/ci.yml` | CI: app tests, server tests, build. |

### Server

| File | What |
|---|---|
| `server/server.js` | Routes, static serving of `dist/`, the state store and merge, habit sync, notification wiring. |
| `server/auth.js` | Single-owner sign-in (§3). |
| `server/users.js` | The people on an install, Cloudflare Access token checks, acting as someone (§3). |
| `server/config.js` | Settings, env precedence, first-start migration, which plan file is in use (§3). |
| `server/pages.js` | The server-rendered `/setup`, `/login` and `/settings` pages. Plain HTML on purpose: they must work before there is an account, before the app is built, and when a stale service worker is serving an old shell. |
| `server/agentflags.js` | The permission flags every model run is spawned with: refused directories, the brain Write grant, the secrets deny list (§7). Tested by `agentflags.test.js`. |
| `server/prompting.js` | Shared prompt pieces: the athlete's name and notes from Settings, gender-neutral fallbacks. |
| `server/coach.js` | The AI coach: an agent with read-only tools, threads in `data/coach/`. |
| `server/planner.js` | Plan a workout (`/api/plan/workout`, `/api/plan/revise`). |
| `server/weekplanner.js` | Plan the week (`/api/plan/week`). |
| `server/chat.js` | The old check-in coach (`/api/chat`). Switched off (§7). |
| `server/whoop.js`, `server/strava.js` | Pure matching, snapshot and card-filling logic for each service. |
| `server/notify.js`, `notify-facts.js`, `notify-categories.js` | Push notifications on top of an external notify core (§8). |

### App: the files you will most often need

| Thing | Path | Notes |
|---|---|---|
| Render smoke suite | `app/smoke.jsx` | `npm run smoke` in `app/`. Mounts every tab and session viewer against real content. |
| Store, merge, `isDone`, `isTraining`, entry ids | `app/src/lib/store.js` | The server has a matching copy of `isDone` in `server/server.js`. |
| Session lookup | `app/src/lib/menu.js` | `optFor(menu, optId)`; renamed cards declare old ids as `aka`. |
| Quotas | `app/src/lib/quota.js`, `app/src/quotabars.jsx` | The week. Quota set = entry `quota-<monday>`. |
| Recommendation engine | `app/src/lib/recommend.js` | Pure. Not shown on Today any more (§10), but it is where the two finger rules live. |
| Activity catalog | `app/src/lib/activities.js`, `app/src/activitypicker.jsx` | 91 sports, their form shape, quota category, WHOOP/Strava names. Content-driven. |
| Lifts | `app/src/lib/lifts.js`, `app/src/liftlog.jsx` | Catalog search, logged-lift shape, arithmetic. `liftlog.jsx` is only an adapter. |
| One exercise card | `app/src/exercises.jsx` | `ExerciseCard`, `ExerciseSection`, `ExercisePicker`, `Stepper`, `STEP`. **Shared by the lift log and the planner's editor.** |
| Which fields a card asks | `app/src/lib/outputs.js` | `when` gates, `pruneHidden`, derived placeholders. |
| Minutes | `app/src/lib/minutes.js` | Precedence of time sources; `minutesSourceOf()` is the single statement of it. |
| Naming | `app/src/lib/naming.js` | `nameFor`, `titleFor`, `out.title`, quick-name chips. |
| Grades | `app/src/lib/grades.js` | The only grade scales in the app. |
| Prescriptions | `app/src/lib/prescription.js` | The model under planning and the runner. Pure; `now` is an argument. |
| Runner | `app/src/runner.jsx` | Set-by-set screen for a planned session. One writer. |
| Workout mode | `app/src/workout.jsx`, `app/src/lib/workout.js` | The climbing cards' interval timer. |
| Planner UI | `app/src/planner.jsx`, `app/src/lib/plannerapi.js` | + → Plan a workout; `BuildStep` (by hand) and `AskStep`/`ReviewStep` (by model). |
| Week planner UI | `app/src/weekplanner.jsx` | + → Plan the week. |
| Pickers | `app/src/picker.jsx` | `PickerScreen`, `SessionPicker`, `ActivityChooser`. Declaration order, no ranking. |
| Unlogged workouts | `app/src/lib/unlogged.js`, `app/src/unlogged.jsx` | What WHOOP/Strava saw that the log lacks; `pairUp`, `mergeTargets`, `outWith()`. |
| Session sheet / edit panel | `app/src/sessionlog.jsx` | `SessionLog`, `SessionDetails`, `DetailsSheet`, `NameField`. |
| Log feed | `app/src/log.jsx` | Newest first; the open sheet is keyed by ID. |
| Progress | `app/src/lib/scope.js`, `app/src/lib/metrics.js`, `app/src/progress.jsx` | Charts declare when they apply. |
| Gear | `app/src/lib/gear.js`, `app/src/gear.jsx`, `app/src/gearpicker.jsx` | Two origins (§6.9). |
| Profile | `app/src/lib/profile.js`, `app/src/profile.jsx` | A `Popover`, not a `FullScreen`. |
| Achievements | `app/src/lib/achievements.js`, `app/src/achievements.jsx` | The editable goals. Content seeds + store edits + tombstones, merged at read time. |
| Linked goals | `app/src/lib/goals.js`, `app/src/goals.jsx` | Read-only goals from the bridge (§8.4). |
| Journal | `app/src/lib/journal.js`, `app/src/journal.jsx` | Behaviours correlated with the next morning's recovery. Native: WHOOP has no journal API. |
| Coach UI | `app/src/coach.jsx`, `app/src/lib/coachapi.jsx`, `app/src/lib/markdown.jsx` | Markdown is hand-rolled and renders to React elements, never HTML. |
| Number inputs | `app/src/numinput.jsx`, `app/src/lib/numtext.js` | Text inputs that own their text (§6.4). |
| Body diagram | `app/src/lib/bodymap.jsx`, `app/muscles.build.mjs` | `react-body-highlighter` + `free-exercise-db`; nothing hand-drawn. |
| How-to figures | `app/src/howto.jsx`, `app/src/lib/figures.jsx` | Registry of SVG figures named by content. |
| Palette | `app/src/styles.css` `:root`, `app/validate_palette.js` | `npm run palette`; a real gate (§6.10). |
| Notifications client | `app/src/lib/push.js`, `app/src/notifications.jsx` | |
| Device screen probe | `app/src/screeninfo.jsx` | Measures the iOS safe-area bug on the device (§10.5). |
| Whose log this is | `app/src/lib/whoami.js` | Decided before the store mounts; per-person cache key; `X-Bushido-User` on every API call (§3). |

---

## 2. Running, building, testing

```bash
npm install && npm start      # builds on first run, serves on :8099
npm run dev                   # Vite on :5173, proxies /api and sign-in to :8099 (run npm start alongside)
npm run build                 # app/ → dist/
npm test                      # app suites + palette + SSR smoke + server suites
node app/starter.build.mjs    # regenerate content/starter.json and examples/plan.json
```

- **A change under `app/src` is invisible until built.** The server serves `dist/` from
  disk, so no restart is needed after a build, but without one the running app is the old
  bundle while every test passes. To confirm a deploy picked it up, check that the
  `assets/…` hash in the served `index.html` changed.
- **Content files need no rebuild** — they are fetched at runtime — but run `npm test`
  after editing one anyway: the suites walk every session set by set and catch a bad
  property access in hand-written JSON here rather than on a phone mid-session.
- `npm test` at the root = `npm --prefix app test` then every `server/*.test.js`. The app
  half includes `handoff.test.js`, the palette check, the per-area suites
  (`test:rec`, `test:quota`, `test:ach`, `test:streak`, `test:gear`, `test:progress`,
  `test:workout`, `test:coach`, `test:checkin`, `test:lifts`, `test:presc`,
  `test:naming`, `test:md`, `test:goals`, `test:starter`) and the smoke suite. Run a
  single suite while iterating; run the whole thing before you finish.
- **The generated content must not drift.** `app/starter.test.mjs` fails if
  `content/starter.json` or `examples/plan.json` no longer match what
  `app/starter.build.mjs` produces from `test/fixtures/plan.json`. Edit the fixture's
  shared parts (catalogs, recommender, journal, quick names, planner kinds), re-run the
  build script, and commit all three. The build script also scrubs design-history quotes
  that name a real person; the starter must never seed achievements.
- **Prompts are tested for neutrality.** `server/prompts.test.js` builds every AI prompt
  as a fresh install would and fails on a gendered pronoun or a personal name.
- `server/http.test.js` boots real servers on temporary data directories and drives
  setup, sign-in and the defaults end to end. `server/config.test.js` and
  `server/auth.test.js` cover precedence, migration and sessions.

### What the smoke suite is for, and how to extend it

The smoke suite (`app/smoke.jsx`) server-renders every tab, sheet and flow against real
content. It is the main defence for this codebase, and it has had to learn three lessons:

- **A missing door is invisible to a render test.** "The picker renders" passes when a
  card is unreachable. Reachability cases diff the content against what a screen lists
  (`SessionPicker(every startable session is in it)`, the planner kinds, figures named vs
  figures registered). **Any new route into the menu needs that kind of assertion.**
- **A removal still renders.** The only way to catch a re-addition is to assert the
  absence (`TodayTab(empty day offers nothing)`, `SessionSheet(no add-ons, no strap)`,
  `Sheet(no second route to a second session)`, `SessionLog(the name box is not in the
  form)`, `Sheet(a lift-only session offers no clock)`).
- **A control that moved needs a test at its new address**, or the move is
  indistinguishable from a deletion (`SessionSheet(rename and remove live in the header)`,
  `SessionDetails(name, gear, just miles and time spent, all in one place)`). Pin moves
  from both sides.

What SSR cannot catch: anything that only happens after a fetch resolves (the list is
empty during SSR, so callbacks never run), stale-closure double writes, and anything
depending on the iOS safe area. Two real bugs (a dead "mark set" button, a vanished
warm-up block) shipped with green suites and were found by screenshotting the running
app. For UI work, look at it.

---

## 3. Sign-in, Settings and configuration

### Sign-in (`server/auth.js`)

- **One owner account.** On first start with no owner the server prints a one-time
  `/setup?token=…` link; only that link opens `/setup`, so the first person to find the
  port cannot claim it.
- The password is hashed with scrypt and stored in `data/auth.json` (mode 0600) beside
  the key that signs session cookies. The cookie (`bushido_session`) is HMAC-signed,
  httpOnly, `SameSite=Lax`, `Secure` behind https, and lasts 30 days. Changing the
  password bumps a version in the cookie, which signs every other device out. Repeated
  wrong passwords lock that address out briefly.
- **Bearer tokens** for machine callers: `Authorization: Bearer <secret>` with
  `BUSHIDO_API_TOKEN` only. The Totem bridge secret is not accepted: it is for
  Bushido calling Totem, and nothing calls Bushido with it.
- **Sign-out takes the log off the device** (`app/src/lib/signout.js`, run from
  `main.jsx` on `/?signout=1` before the store mounts): freeze every tab's cache writes,
  flush, confirm before losing unsynced entries, retire this device's push subscription
  (best effort, bounded), `POST /api/auth/logout` (revokes, sends
  `Clear-Site-Data: "cache"`), and only on its confirmation clear `bushido:`/`rung:`
  storage and every cache except `bushido-shell-*`. Every cache write in `lib/store.js`
  goes through `makeLocalPersist`, which refuses while signed out or signing out; keep
  it that way. Tested by `app/signout.test.js`.
- **`BUSHIDO_AUTH=proxy` disables login** for an install behind something that already
  authenticates every request. In that mode anyone who can reach the port owns the log.
- **An install upgraded from before sign-in existed** gets `"auth": { "mode": "proxy" }`
  written into `data/settings.json` by the first-start migration, so an upgrade cannot
  lock the owner out. `BUSHIDO_AUTH` beats the file in both directions
  (`BUSHIDO_AUTH=password` forces sign-in on). **The browser cannot change the auth mode**
  — `config.update()` deliberately ignores it; that is a decision for whoever controls the
  server's files or environment.
- Lost password: stop, delete `data/auth.json`, start, use the new setup link. The log is
  untouched.
- Signed out, `/api/*` answers `401` with `X-Bushido-Auth: login` and pages redirect to
  `/login` (or `/setup`). Built assets are public.

### Settings (`/settings`, `server/pages.js` + `server/config.js`)

Stored in `data/settings.json` (0600). Sections:

| Section | Holds |
|---|---|
| Account | Change password; shows the auth mode and its source (read-only). |
| AI | Claude Code CLI path, optional API key (passed to the CLI as `ANTHROPIC_API_KEY`), model, and a **Test** button (`POST /api/settings/ai/test`). |
| About you | Name and free-text notes given to every AI prompt. |
| Training plan | Download; import a file; use the example; back to the starter. Replacing `data/plan.json` copies the old one to `data/backups/plans/` (never rotated) first. The log is never touched. |
| Integrations | Totem bridge URL, secret or `.env` file to read `BRIDGE_SECRET` from, habit id, and toggles for WHOOP, Strava, linked goals and habit sync. |
| Other local services | Notify core directory, athlete-profile (brain) file, nutrition digest directory, timezone. |

Secrets (`ai.apiKey`, `totem.secret`) are never sent to the browser; they are masked, and
a masked value posted back is ignored.

### More than one person (`server/users.js`, `app/src/lib/whoami.js`)

- **The owner's files never move.** The owner's space is the data dir itself; anyone
  else's is `data/users/<id>/` with the same file names. `spaceFor()` in `server.js` is
  the only place a log, backup, plan or coach path is built; do not reintroduce a
  module-level `STATE_FILE`.
- **Identity is a verified Cloudflare Access JWT, never a bare header.** Present but
  invalid, or valid for an unknown email, is a `403`, never a fallback to the owner.
  Absent is the owner, which is exactly plain proxy mode's existing trust.
- **One device never mixes two logs.** Whose log is open is decided before the store
  mounts; a switch is a full reload; each person has their own cache key (the owner keeps
  `bushido:cache-v1`); every API call carries `X-Bushido-User` and the server refuses a
  mismatch with `409 switched`. All four are load-bearing.
- **Integrations and AI are the owner's.** `featuresFor(space)` turns WHOOP, Strava,
  goals, habit sync, notifications and AI off for anyone else, which must render exactly
  like an install that never set them up. Habit sync and the "logged" push run only for
  the owner's writes.
- **Only the owner is an admin**: Settings, People and acting-as are refused to anyone
  else. The `bushido_as` cookie is honoured only when the real requester is the owner.
- Pinned by `server/users.test.js`, the people cases in `server/http.test.js`,
  `app/whoami.test.js` and the `tabsFor`/`PlanFlow(no AI…)`/`ActingBanner`/`PeopleCard`
  smoke cases.

### Precedence

**Environment variable → `data/settings.json` → default.** Every resolved value carries
its source, and the Settings page shows "set by BUSHIDO_X" and disables the field rather
than offering an input that silently does nothing. Keep that property when adding a
setting: add it to `blank()`, resolve it through `src()`, surface the source. Every
variable is listed in `.env.example`.

**Which content file the app runs on** (`config.planFile()`), first match wins:

1. `BUSHIDO_PLAN_FILE`, or `BUSHIDO_CONTENT_DIR/plan.json`
2. `data/plan.json` — the owner's own plan (imported in Settings, or carried over by the
   migration). Untracked.
3. `plan.file` in settings
4. `content/starter.json`

There is no `content/plan.json` in the repository any more. Nothing in the repo should
assume which plan an install runs on; code must work against the starter.

### Defaults off

A **fresh install** (no `data/state.json`) gets: sign-in on; no AI unless a `claude` CLI
is found (`CLAUDE_BIN`, `~/.local/bin/claude`, then `PATH`); no bridge, so WHOOP, Strava
and linked goals are hidden and habit sync is off; no notify core and therefore **no
timers at all**; no brain file; no nutrition digest; starter content. AI routes answer
`503` with `code: "ai-not-configured"` and the UI says to set AI up; nothing else is
affected.

An **existing install** (`state.json` present, no `settings.json`, no `auth.json`) is
migrated once, and the migration does exactly two things: it writes `auth.mode: "proxy"`
(the old version had no login, so an upgrade must not lock the owner out; a data dir with
an owner account is never switched to proxy), and it copies a legacy tracked
`content/plan.json` into `data/plan.json` if that file is absent. A `git pull` deletes
that file first, so in practice the owner restores it with
`git show 'HEAD@{1}:content/plan.json' > data/plan.json` (deploy/README.md); the server
warns at start-up when a migrated install is running on the starter. Every other setting
(bridge, notify core, brain file, nutrition digest, timezone, About you) starts off or
blank, exactly as on a fresh install, and is configured in Settings. After that first
write, `settings.json` is the only answer. Keep the migration that small: no deployment
paths or personal values belong in code.

When adding an integration: off by default, configurable in Settings with an env
override, and its absence must render exactly like the app before it existed.

---

## 4. Data, sync and history

- `data/state.json` is the training log and the one file with no upstream copy. Every
  write snapshots the previous state to `data/backups/` (last 60 kept). Back up with
  `GET /api/export`, not by copying files. Never hand-edit, delete or "clean up" it.
- **Sync is last-write-wins per entry id**, on each entry's own `updatedAt`. The client
  runs the identical merge locally. Deletes are tombstones so a stale device cannot
  resurrect them. The client keeps a `localStorage` cache and an outbox; the service
  worker never serves `/api/state` from cache, because a stale log that looks live is
  worse than an honest failure.
- The client PUTs the whole log on sync. "Newer than what is on disk" is therefore not
  "new": anything that fires on a change (notifications, habit sync) must compare against
  the previous state and act only on a real transition (`completedDailyEntries`).
- **Entry ids are derivable on purpose.** `daily-<date>` is the main session;
  `daily-<date>-<optId>` an extra; a repeatable card's further copies take
  `-2`, `-3`… (`extraEntryId` in `lib/store.js` is the only thing that mints one, and only
  on an explicit "log another"). Two offline devices doing the same act compute the same
  id, so the merge has something to agree about.
- **Planning is not completing.** Creating an entry writes `done: false`; only an explicit
  tap sets `done: true`. Use `isDone()` — never entry existence — for streaks, load,
  hard-day counts, charts, habit sync and notifications. An absent `done` means true
  (older entries predate the flag). Getting this wrong once wrote false training history.
- **Nothing rewrites history to suit a component.** Old shapes are read as they are
  (positional lift sets, `out.notes` on old entries, `out.intensity`/`out.effort`, the
  retired `hard-home` card id). New code adapts to stored data, not the reverse.
- Non-log state lives beside the log: `data/coach/` (coach threads, not entries),
  `data/coach.json` (dated coach note), `data/whoop.json`, `data/strava.json`,
  `data/goals.json` (caches), `data/vapid.json` (push identity — **deleting it silently
  breaks every subscription**), `data/push-subscriptions.json` (a secret: endpoint + keys
  is enough to push to a device).

---

## 5. Content: the plan file is the content API

No training content is hardcoded in the app. Sessions, catalogs, quota categories,
achievements seeds, planner kinds, quick names, gear kinds, journal behaviours, check-in
fields and recommender weights all come from the content file, so the programme can change
with no rebuild.

- **Sessions** are objects in `dailyMenu` with `role` (`session` / `adjunct` / `rest`), a
  `protocol`, `outputs` (log fields) and `logSpec` (per-set logging). Output types:
  `slider`, `toggle`, `choice`, `grade`, number; `optional: true` stops a field blocking
  "logged". An output with `chart` becomes a progress chart. `levelFrom`, `nameFrom` and
  `minutesFrom` let a session rewrite its own entry from what was logged.
- **Every menu session needs a `sched` block** (category, venue, finger load,
  `repeatable`, sport declarations); the suite fails otherwise.
- **A session is never deleted, only `retired: true`.** Every logged entry's `optId`
  resolves against `dailyMenu`; removing a card orphans every day it was trained. A
  renamed card lists its old ids in `aka`; a card that inherits history from a split card
  lists them in `priorIds` (history only — only one card may answer to an id). Charts that
  span a split read both ids, or the series truncates and looks like a month off.
- **Every exercise has a `how`**: a `figure`, a one-line `gist`, three to five short
  `steps`, the one `watch` error, optional `easier`. The length limits in
  `workout.test.js` are the feature: long protocol prose demonstrably did not get read
  mid-session. Figures are hand-written SVG in `lib/figures.jsx` because accurate,
  licensable photos of these drills mostly do not exist and the app must work offline;
  the smoke suite checks every named figure exists and every figure is used.
- **Every claim is graded and sourced.** `evidence.grade` is one of `rct`,
  `controlled-trial`, `observational`, `mechanistic`, `expert-consensus`, `folklore`;
  `transfer` states what is assumed versus demonstrated. Verify citations against the
  paper, not a summary — secondary summaries have had sample sizes wrong. If you cannot
  source a session, say so in it.
- **The catalogs are content.** The 91-activity catalog (`outputs[].type: "activity"`),
  the lift catalog (`type: "lifts"`: exercises, implements, groups) and the per-climb
  `styles` vocabulary live on their fields. Both WHOOP and Strava mappings read the
  activity catalog, so there is one list, not three. Adding a sport or a movement is a
  content edit.
- **`plannerKinds`** are grouped by discipline (`groups`), with `collapsed: true` groups
  rendered as `<details>` so every card stays in the page for the reachability test. Every
  `activity`, `category` and `icon` a kind names must be real (`hasIcon` in
  `lib/icons.jsx`); the smoke suite checks it.
- Personal facts about a user do not belong in content. Content is programming; who the
  athlete is comes from Settings → About you (and optionally a brain file).

---

## 6. Conventions and invariants

### 6.1 Safety rules

- **Two rules block. Everything else advises.** No hard finger day the day after another
  (`hardMinGapDays`) and no more than `hardCap` a week. They are enforced in
  `lib/recommend.js` before any suggestion is read, so a hallucinated extra hard day
  produces a card that refuses to place itself. Per-discipline spacing, whole-body load
  and every AI nudge are weighted terms with a sentence attached and a tap through them.
  Do not soften the two blocks.
- **`isHardEntry()` is the most load-bearing predicate in the app.** Order: a session that
  cannot load the fingers never counts; then what the user logged (`out.hardFingers`,
  pre-filled from `sched.fingerLoad`); then the plan's declaration.
- **Climbing is not in the activity catalog and must not be added.** Climbing sessions are
  `dailyMenu` cards that ask the hard-finger question; a second way to log climbing is a
  way for a hard finger day to land where the budget cannot see it. Hence
  `choiceForSport` returns null for climbing sports, the unlogged-workout card never
  offers a climbing workout, and `laneCandidates` never falls back to the workout card for
  a climbing category.
- **The finger budget counts what was LOGGED, never what was offered.** Alternatives and
  suggestions must not consume it.
- **A training load the app computes must never be invented.** `resolveCeiling()`
  (`lib/force.js`) returns the critical-force-derived ceiling — CFmin or CF−6 kg,
  whichever is lower, offset per block via `loadCeiling` — and returns **null with the UI
  saying so** when no test is logged.
- **Critical-force charts carry a ±21% band** (the measured test-retest CV). Do not narrow
  bands to make a trend look real; no noise band belongs on a grade chart.

### 6.2 Resolving and accounting

- **Always `optFor(menu, optId)` for entries.** A raw `menu.find` against a renamed card
  returns nothing, and the failure is a silent wrong answer, not a crash: entries vanish
  from filters and day lists, and `isHardEntry` falling through once turned bike rides
  into hard finger days. Lookups starting from the PLAN (`mutex`, `stacksWith`,
  `addAgain`) are fine as they are.
- **A day is a list of sessions.** Day-level accounting (load calendar, hard-day count)
  takes the heaviest session; training load sums them. Only cards with
  `sched.repeatable: true` may appear twice (the free-form workout card and the
  `planned` container; `lifts.test.js` pins that they are the only two).
- **Never pass a function with optional parameters straight to `.filter`/`.map`.** The
  index lands in the second parameter. This once blanked the whole app inside a
  `useMemo`, and SSR could not catch it. Wrap: `.filter(g => isX(g))`.
- **A component holding a copy of a synced entry is showing the past.** Re-derive from
  `entries` every render and key open sheets by ID. Batch multi-entry writes (`placeAll`)
  so the second write sees the first. Give a screen ONE writer (`onRun(run, { out, done })`
  in the runner). Each of these was a real bug.

### 6.3 Quotas and "just miles"

- **The week is quotas, not a template.** A quota is a count of workouts in a category for
  a Monday–Sunday week, written by the user, never by the app. Misses expire on Sunday; no
  debt carries. A quota set is an ordinary entry (`quota-<monday>`), so it syncs like
  anything else.
- **A quota counts workouts, per block.** `categoriesOf(entry, menu)` returns every
  category an entry fills (a planned trip with a lift and a ride fills two); two blocks of
  the same category are still one. `categoryOf` stays single-valued for spacing and
  filters.
- **The quota bars are a reading.** Pressing a bar shows what filled it; nothing on it
  presses into a new session. Planned-but-not-done sessions draw a dotted continuation
  (`pendingShown`) that never touches `done`, `remaining`, `owed` or the complete tick, and
  is clamped to what is still owed.
- **"Just miles" / warm-up are not training.** `data.training: false` (`isTraining`)
  counts for gear mileage, streak, habit and Progress miles, and is excluded from training
  load (sRPE, load calendar, recommender ceiling) **and from quotas**. One place enforces
  the quota half — `weekDaily` in `lib/quota.js` — so the bars, Week tab, planners and
  week planner all agree. Absent means training. Marking one also names it (`out.titleFrom:
  'casual'` → "Commute", `'warmup'` → "Warm-up"), and unticking removes only the app's name.

### 6.4 Logging forms

- **What a card asks follows what was answered.** An output field declares `when`
  (`{ "activity": ["run","bike"] }`, `"*"` for "once answered", or `{ shape: [...] }`
  resolved by `gateResolver` in `lib/activities.js`, which must be passed wherever outputs
  render or prune). Unanswered fields are hidden; **a hidden field's value is dropped** by
  `pruneHidden` (hidden data that still charts is a log disagreeing with itself). Only
  fields that declare `when` are pruned.
- **A number the app could guess is a placeholder, never a value.** Estimated duration,
  derived speed, an unanswered slider: pre-filled numbers get confirmed without reading.
  A blank `felt` is unanswered, not "spot on". The exception is the runner, which shows a
  target the user asked for; the target stays on `data.plan`.
- **A number box is a text box that owns its text** (`NumInput`). Do not put
  `type="number"` back on a weight box: a controlled numeric input eats the trailing dot
  in "37.". Blank is `null` except in the lift log (`''`). Nothing negative, one dot, comma
  is a dot.
- **Time spent is app-level** (`out.minutesSpent`) on every card. Precedence lives in
  `lib/minutes.js`: typed → session-declared (`minutesFrom`) → attached WHOOP → attached
  Strava moving time → workout-mode clock → the card's estimate. A typed zero is an
  answer; a measured zero is not. `resolveMinutes()` preserves an old typed correction
  (`minutesSource: 'typed'`) against recomputation. Several attached measurements SUM.
- **A rename lives on the OUT** (`out.title`), because saving any output recomputes
  `data.name`. Order: the user's words > the planner's title > the card.
- **Grades are picked off a ladder, never typed.** `lib/grades.js` owns the only scales:
  routes 5.7–5.12 with −/plain/+ stored as `base.tenth` with 1/2/3 (5.10− = `10.1`),
  boulders V0–V10 as integers. Off-ladder legacy values are shown raw and never rounded
  onto a rung. `grades` is the one logged field that is a LIST (one per rep, kept the
  length of `reps` by `fitGrades()`; `writeSet()` skips `Number()` on it). Charts plot the
  rung index (`gradeIndex`/`rungLabel`), never the decimal.
- **Per-climb detail on fun days is opt-in per entry.** Off by default; presence of the
  `climbs` list is the state; turning it off strips it. While on, the count is stepped
  (`stepClimbs()`), never typed, because typing "12" passes through "1" and refits the
  list. Charts take the harder of the session-level field and the per-climb detail.
- **Lifts are chosen at log time**, so they are `out.lifts` (one record per exercise with
  `implement` and `sets: [{ reps, weight }]`), not `out.sets`. Rows store their own
  `name`/`implementLabel` so retiring a catalog entry never blanks history. The exercise
  is searched, not scrolled (`searchExercises`: name-prefix > word-prefix > alias >
  substring > group, every word must match). A new exercise has one blank set; adding a
  set copies the previous one. `weightLabel` per implement says what the number means;
  `liftVolume` does not double dumbbells.
- **Lifts have no rest intervals.** `restSec` is dropped in `normalizeSet` on the way in,
  not hidden. Interval pieces keep their rest.
- **Adding a set copies what was done** (`addSetLike` in the runner, appended, so no ids
  renumber).

### 6.5 Workout mode and the runner

- **Workout mode exists to run a clock.** `hasWorkout()` offers it only where content
  declares a `timer`/`timers` or the session logs its own rest; `logSpec.workout`
  overrides. Removing it removes only the timer, never the set log.
- **The logSpec gives the shape; the timer gives durations.** `timer.exercise` links them;
  where they disagree the LOG wins. `timer.reps`/`timer.sets` are prose only; do not
  "fix" that redundancy.
- **A rep is only a rep if a clock can end it** (`timingFor()`); otherwise the set is one
  continuous unit. `workout.test.js` pins both directions.
- **A rest with no source in the plan counts UP, never down.** Programmed rests are
  deliberate; inventing one is worse than none. `nextRest` exists only where the plan
  states it. `COUNT_IN`/`LEAD_IN` are the app's own skippable numbers.
- **If the screen says tap something, that something is a button** — on count-up phases
  the clock is the button; countdowns stay inert so a stray tap mid-hang costs nothing.
- **The runner's rest clock is an absolute instant** (`data.run.restUntil`) on a synced
  entry; everything subtracts, nothing counts down. That is how it survives the app
  closing or switching devices, and why `prescription.js` takes `now`.
- **`data.plan` is what was asked for; `out` is what happened.** Never the same field.
- **A lift always offers a weight box**, even when the prescription has no load
  (`setFieldsFor()` decides for both editor and runner).
- **Lift-only planned sessions are not runnable** (`runnable(opt, pres)`, `isLiftOnly`,
  judged on blocks that name a category).

### 6.6 Planning (by hand or by model)

- **One door, two routes.** + → Plan a workout → pick kinds → **Build it myself**
  (`BuildStep`) or **Write it for me** (`AskStep` → `Working` → `ReviewStep`). Both
  produce the same object (`blankPrescription()` matches `normalizePrescription`), the
  same editor, the same entry. `BuildStep` has nothing that claims a model reasoned about
  it; the revise panel on the entry still works for either.
- **Kinds are a list**; the seam is the BLOCK, not the author. `splitPrescription()` cuts
  at block categories (consecutive same-category blocks merge; uncategorised blocks join
  a neighbour) and `placeAll()` writes one entry per part, so each part gets its own WHOOP
  and Strava slot and quota.
- **`blockSurvives` has a `keep` arm**: picked-but-empty blocks survive edits, and
  `dropEmptyBlocks` runs on the way out in `keep()`. Both pinned in
  `prescription.test.js`.
- **A block survives on its items OR its note** (warm-ups are prose).
- **Pieces** (`appendPiece`) are the non-lift way in: shape (time / distance / reps)
  chosen when added; they arrive with a target number. `STEP` scales with unit and value.
- **Keeping a plan and starting it are two decisions** (`KeptStep`; `placeToday({ open,
  close })` defaults true, only the planner passes false). The smoke case pins "Nothing
  has started".
- **Containers repeat via their own screen.** `planned` and `log-workout` declare
  `sched.repeatVia` (`"plan"`/`"log"`); "and another one" routes through `addAgain`.

### 6.7 Naming, display, layout

- **Reference is a popover; doing is a page.** `FullScreen` is for a session in progress;
  `Popover` (modal.jsx) anchors on desktop and becomes a bottom sheet under 640px.
- **`FullScreen` tabs are `{ key, icon, label }`**, not `{ id, label }`; `id` renders an
  empty panel with no error.
- **The header holds the avatar and nothing else** unless something beats it.
- **One-handed, phone, mid-session, chalky hands:** 44px tap targets, 16px inputs (no iOS
  zoom), the modal locks to its close button once data is being entered, workout mode's
  how-to opens during rests and shrinks during work.
- **Everything folds.** Only the first exercise in a session opens (plus the one just
  added). `PlanTalk` is collapsed with its turn count visible.
- **Reorder is within a block** (`moveItem` returns the landing id, because ids are
  positional; `moveLift` mints uids instead).

### 6.8 Charts

- **A chart declares when it applies** (`metrics.js` registry of `{ applies, series }`);
  the page draws whichever apply and have data. Two points minimum for a line.
- Training load is sRPE (RPE × minutes), which is why minutes are measured when possible.

### 6.9 Gear

- **Two origins, never merged.** Strava owns bikes and shoes (`source: 'strava'`,
  read-only name and odometer); everything else is local and counted from the log.
  Local use with no Strava activity attached is shown as a separate gap, never added to
  the odometer (that would double count).
- **A default nobody chose is not a default.** `defaultGearFor` returns the `primary` item
  or the only one of its kind, else nothing.
- **Units belong to the gear KIND** (`gearKinds`): miles, hours, reps. `gear.js` knows
  nothing about specific equipment.

### 6.10 Palette

**Never change a viz colour without `npm run palette`.** It checks contrast against the
panel, all-pairs separation under the three dichromacies, and a monotonic load ramp, and it
is part of `npm test`. It has already caught a shipped palette failing.

---

## 7. AI runs

Every AI feature spawns one headless Claude Code CLI run (`claude --print`, JSON schema
for the reply) with the configured binary, model and environment (`config.ai()`;
`spawnEnv()` adds a stored API key). Without a CLI those routes answer 503 and nothing
else changes.

**The boundary is flags, not prompt text.** A prompt is a request; a flag is a rule. All
of them are built in `server/agentflags.js`:

- A brain or food-log directory that is the filesystem root, `$HOME` or an ancestor of it
  is refused outright (no `--add-dir`, no `Write`), as is a `Write` grant on a directory
  that contains the repo or the data dir.
- Every run denies `Read` of `auth.json`, `settings.json`, `vapid.json`,
  `push-subscriptions.json` in the data dir, any `.env`, `~/.claude/**` and `~/.ssh/**`.
- Absolute paths in permission rules are written `//abs/path`; a single leading `/` is
  relative to the project in the CLI's rule syntax.
- The paths these runs see (CLI binary, brain file, food-log dir, notify core) come only
  from the environment or a hand-edited `settings.json`, never from a browser patch.

| Run | Allowed | Denied | Can write |
|---|---|---|---|
| Coach (`server/coach.js`) | `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch` (+ `Write(<brain dir>/**)` only if a brain file is configured) | `Bash`, `Edit`, `NotebookEdit`, `Task` (+ `Write` when there is no brain file) | only files beside the configured brain file |
| Workout planner (`server/planner.js`) | `Read`, `Grep`, `Glob` | everything else | nothing |
| Week planner (`server/weekplanner.js`) | `Read`, `Grep`, `Glob` | `Bash`, `Edit`, `Write`, `NotebookEdit`, `Task`, `WebSearch`, `WebFetch` | nothing |
| Check-in coach (`server/chat.js`, dormant) | no tools (`--tools ""`); context assembled server-side on stdin | — | nothing |

Extra readable directories are passed with `--add-dir` (brain dir, nutrition digest dir, a
non-default data dir). Read the header of `askCoach` before changing any list. **No run may
ever write `data/state.json` or the plan file**, and none has a shell.

Rules that apply to all of them:

- **Nothing is written until the user taps.** `/api/plan/workout`, `/api/plan/revise` and
  `/api/plan/week` return a proposal and store it nowhere. The coach's suggested sessions
  render as cards whose buttons go through the same `pickMain`/`addExtra`/`dropEntry`
  paths as the day list; which buttons exist is decided live on every render
  (`placeable()`/`offers()`), and a card the day cannot take shows the reason where its
  buttons would be. There is no such thing as an AI write to the log.
- **The user's message is stored before the model is asked.** A turn can take minutes and
  fail; the reply may be lost, never the question.
- **Revisions return the whole object** with a REQUIRED `changed` field (optional fields
  get omitted by models).
- **Server-side context, not browser-posted context.** WHOOP/Strava digests are built
  from the caches on disk (`chat.whoopDigest`, `chat.stravaDigest`, `weekContext`). Absent
  data produces no section at all — a model told nothing about recovery must not conclude
  the user is recovered.
- **Pre-digest instead of letting a model read the log whole.** The week planner timed out
  reading `state.json` at medium effort; `weekContext` now supplies the last three weeks
  per category and the prompt says to Grep. Planners run at low effort
  (`BUSHIDO_PLANNER_EFFORT`, `BUSHIDO_WEEK_EFFORT`) with timeouts set from measurement.
- **Prompts are gender-neutral and personal-detail-free.** The name and notes come from
  Settings via `server/prompting.js` (`who()`, `speaker()`, `notesSection()`), falling back
  to "the athlete". `server/prompts.test.js` enforces it. Do not write a person's facts
  into a prompt.
- **The endurance kinds leave `category`/`activity` null** so the planner picks the sport
  from what the week still owes; the planner prompt explains how. The builder never
  guesses on the user's behalf ("counts toward nothing" until a chip is tapped).

**The coach note and the check-in coach.** `data/coach.json` is a dated note: advice for
another day does nothing, nudges are clamped to `recommender.coachCap` and read in
`scoreSession` after the hard blocks return. The check-in coach (`/api/chat`,
`examples/coach/CHECKIN.md`) was written around a retired programme structure and is
**switched off**: the route refuses, the app does not fetch `/api/coach`, and
`BUSHIDO_COACH=1` forces it on. Rewrite `CHECKIN.md` for quotas and standing achievements
before removing either guard. A `changed` entry on a note renders as a "coach changed"
chip and the smoke suite pins it; nothing writes one today, but the path stays honest.

**Nothing schedules an AI run, and nothing but a person edits the plan.** There was once a
nightly timer and a "run the coach now" button that could edit the plan behind a
validate-test-revert gate. Both were removed deliberately. Do not reintroduce scheduled or
unattended plan edits.

---

## 8. Integrations

All optional; all off on a fresh install. None may block a request the app needs to load
or a log being saved.

### 8.1 The Totem bridge

Totem is the author's separate personal assistant app; its HTTP bridge is what holds the
WHOOP and Strava OAuth grants and exposes goals and a habits API. Any service exposing the
same endpoints would work. Configure with Settings → Integrations or
`BUSHIDO_TOTEM_URL`, `BRIDGE_SECRET` / `BUSHIDO_TOTEM_ENV`, `BUSHIDO_TOTEM_HABIT`. The
secret never reaches the browser.

**Bushido holds no WHOOP or Strava credentials, and must not.** WHOOP rotates its refresh
token on every refresh and invalidates the old pair, so exactly one process may hold a
grant; a second copy silently kills one of them. Read through the bridge.

### 8.2 WHOOP (`server/whoop.js`, `app/src/lib/whoop.jsx`, `app/src/whoop.jsx`)

- Bridge endpoint `GET /api/whoop/training`. Bushido: `GET /api/whoop` serves the cache
  and refreshes in the background; `POST /api/whoop/pull` is the only synchronous path.
- **The cache is disposable; the snapshot is the user's.** `data/whoop.json` is a
  refetchable mirror: delete freely, never hand-edit, never depend on a particular item
  being in it. What persists is `entry.data.out.whoop` (+ `out.whoopMore`), copied in on
  attach and self-contained, so a session's data survives outages, cache deletion and a
  revoked grant. This is also the honest reading of WHOOP's terms on permanent copies.
- **Matching is suggested, never applied.** `rankForSession()` marks at most one
  candidate `likely`, only on real evidence: time overlap with a timed session, the only
  workout of the session's declared sport (`sched.whoopSport`), or the only workout that
  day. Never on duration similarity. `sportMatches()` is three-valued (match / mismatch /
  undeclared); a mismatch can never be `likely`. Already-attached workouts stay visible.
  Do not join workouts to sessions by time and report it as fact.
- **One workout may be split across two sessions** (`out.whoop.part = { start, end,
  minutes }`, minutes = overlap). Read `attachedMinutes(snap)`, never `snap.minutes`.
  **Only minutes split** — strain, HR, calories and zones remain the whole workout's; do
  not pro-rate them.
- **Attaching fills the card's blanks** (`attachTo`/`detachFrom`, identical in both
  services): activity from sport, time, distance, elevation in the card's units, recorded
  as `filled: { key: value }` so detaching returns exactly those blanks. Fill works off the
  declared fields, then `pruneAttached`. Filled values are labelled on screen from the
  `filled` map, never inferred. Climbing sports map to nothing on the free-form card.
- **Scope errors travel verbatim** ("authorized without read:workout" names the fix); do
  not flatten them to "failed".
- **Recovery is the weakest term in the engine**: clamped to `recommender.whoop.cap`,
  applied after the hard blocks, against the user's own fortnight median (`baselineFor`),
  null with fewer than four prior days or when WHOOP reports `calibrating`. Null must
  compute identically to the app before WHOOP existed (`recommend.test.js` pins it).
- WHOOP has no journal, behaviour or survey endpoint; the journal is native by necessity.

### 8.3 Strava (`server/strava.js`, `app/src/lib/strava.jsx`, `app/src/strava.jsx`)

Same arrangement and the same cache-vs-snapshot rule (`data/strava.json` vs
`out.strava`/`out.stravaMore`).

- Bridge `GET /api/strava/training?days=N` → `{ fetchedAt, days, athlete, gear,
  activities }`, already shaped: both unit systems, a `family`, and the athlete's local
  `date`. `GET /api/strava/activity?id=` fetches full detail at attach time; on failure
  the summary is attached.
- **Moving time is the headline** (`attachedMinutes` falls back to elapsed). In
  `lib/minutes.js` Strava sits below an attached WHOOP workout and above the workout-mode
  clock.
- **A ride is one session**: no split; attaching one activity to two entries is flagged
  as a mistake.
- **One activity, two instruments.** `mergeScore` pairs WHOOP and Strava on time overlap
  with sport agreement as a sanity check (tolerating WHOOP's generic `activity`). A
  merged tap lands one entry with both snapshots; **Strava fills first** (GPS-measured
  distance and moving time). `pairUp` merges only while both are unlogged; `mergeTargets`
  ("Same as…") attaches a late arrival onto an existing session, because sync order is
  not ours to control. A merged row spans the union of both windows.
- The free-form card's activity choice also declares sport at log time (`familyMatches`).

### 8.4 Linked goals

The bridge owns goals; Bushido is a second window, not a second author. A goal is linked
by an ordinary URL link pointing at this app, matched on HOST (exactly, not as a
substring) so a path change does not unlink everything. The host is build-time env only:
`VITE_BUSHIDO_HOST`, plus `VITE_BUSHIDO_LEGACY_HOSTS` for older hostnames, in `app/.env`.
With `VITE_BUSHIDO_HOST` unset, the page's own `location.host` stands in (`bushidoHost()`);
legacy hosts are env-only. `lib/handoff.js` likewise moves pages from the hostnames in
`VITE_BUSHIDO_HANDOFF_FROM` to `VITE_BUSHIDO_HOST`, and does nothing when they are unset.
No hostname belongs in shipped code. `GET /api/goals` proxies and caches to
`data/goals.json`.

- **Nothing in `lib/goals.js` recomputes progress.** Use `goal.progress.percent`; the
  bridge already resolves sources and sub-goal rollups.
- **The field is `subGoals`, not `steps`.** Take field names from a live payload, not
  from what they ought to be called.
- Two-way sync was considered and declined; keep it read-only.

### 8.5 Habit sync

Fire-and-forget push to the bridge's habits API (default habit id `move-every-day`).
**Synced per DAY, not per entry**: `habitBodyForDay()` rebuilds the whole day from merged
state (count = done non-rest sessions, note = all of them). Per-entry sync made the last
write erase the others' notes. Rest days log `count: 0`. Drop free text before dropping
sessions to fit the bridge's 500-char note cap. A bridge that is down must never fail a
save; state is in `GET /api/health` → `totem.lastSync`. Tests: `server/totem.test.js`.

### 8.6 Notifications

Bushido has its own push identity (`data/vapid.json`) so training notifications are its
own. It does **not** own the push machinery: the queue, RFC 8291 encryption, VAPID
signing, the day planner and feedback weights come from an external notify core loaded by
path (`BUSHIDO_NOTIFY_CORE` / Settings), deliberately not copied — a fix to one copy
would leave the other broken silently. Without a core there are no notifications and no
timer.

- A logged workout notifies **exactly once, when it becomes done**
  (`completedDailyEntries` compares against the previous state), never on re-sync or
  edit, and names a linked goal only if that goal still has something left on it.
- Scheduled facts (readiness, unlogged workouts, goal pace) are planned once a day,
  drained on a 30s tick, and revalidated just before sending.
- **A notifier that cannot start must never stop a workout being saved.**
  Tests: `server/notify-facts.test.js`.

### 8.7 Read-only local files for the AI

- **Brain file** (`BUSHIDO_BRAIN_FILE`): an optional Markdown athlete profile the coach
  and planners may read; the coach may write only beside it. Absent is survivable.
- **Nutrition digest dir** (`BUSHIDO_KRAKATOA_DIR`): a pre-computed `digest.json` from a
  separate food-log app, read-only. **Do not build food logging into Bushido**; it was
  deliberately split out to keep this app uncrowded.

---

## 9. Server API (summary)

See `docs/operations.md` for the full table. Shape to keep: `GET/PUT /api/state`,
`POST /api/entry` (upsert), `GET /api/export`, `POST /api/import`, `GET /api/content`,
`POST /api/plan/import|example|reset`, `GET/PUT /api/settings`,
`POST /api/settings/ai/test`, `GET /api/auth/me`, `POST /api/auth/password`, the coach,
planner, WHOOP, Strava, goals and push routes, and `GET /api/health` (liveness; with a
session, resolved paths and integration state).

---

## 10. Why it is this way: design history worth not undoing

The app grew from a single dated climbing block into a multi-sport log, and several
large changes removed features on purpose. Each subsection is the reasoning to respect
before "improving" something back.

### 10.1 From one dated block to quotas and every sport

The original programme was eleven dated weeks with a weekday template. It was replaced,
not migrated, by standing **achievements**, weekly **quotas**, a `category` on every
session, a `hardFingers` question on every finger-loading card, and the 91-activity
catalog. Removed: `weeks[]`, `phases[]`, `weekTemplate`, hotspot days and branches, trip
mode, the standalone evidence index, `sched.weeks` gates (left in, they would block
sessions forever), and the template's scoring weights.

- **Venue is a filter, not a branch.** It is a hard block from what the user states;
  absent a statement, nothing is assumed. Two venues exist: `climbing-gym` and `gym`
  (weights); support blocks are `any`.
- **Misses expire.** Debt that carries makes a bad week make the next one look worse.
- **The catalog is content**, and gates may ask it (`when: { shape: [...] }`), so no field
  lists 91 keys.
- **A pairing the plan declares (`sched.stacksWith`) outranks one the scorer likes**, and
  a hard session rides along with another only where declared.
- **What the user states outranks what the calendar guesses**: check-in fields with
  `informs` (venue, time window, fingers now) feed the engine as hard blocks, and a
  blocked session renders "Not today" with its reason.

### 10.2 The app stopped recommending

A recommender the user ignores is not one that needs tuning, so Today stopped having an
opinion and the effort went into writing a workout down and following it. Removed from
Today: the tappable quota board, companion sessions, the "why today" card, the ranked
swap list and dialog, the rest-day suggestion, per-session dismissals, the morning coach
card. `DaySessions` renders the day and routes taps; it does not rank, offer, dismiss or
explain.

**`lib/recommend.js` stays** (the finger rules, `checkin.jsx`, `metrics.js`, its tests).
**Do not wire it back into Today.** `TodayTab(empty day offers nothing)` asserts the
absences.

What went on: the **+** button (Plan a workout, Plan the week, Log a workout, Pick a
session, Log a rest day). "Log a workout" and "Pick a session" are one `PickerScreen` over
two catalogs. Removing the swap list briefly removed the only route to every climbing
card while every test passed — the origin of the reachability rule in §2.

### 10.3 Endurance as a catalog, and the week planner

- The `endurance` planner group is by **intent** (Zone 2, Long & easy, Recovery, Tempo,
  Threshold, VO2, Hills, Brick, Race rehearsal), sport-agnostic; Zone 2 leads it on
  purpose and the smoke suite pins the order. Swim, Bike and Run catalogs are collapsed
  groups, each with a catch-all first.
- **Plan the week** applies every workout-planner rule to a week: read-only tools,
  stateless (thread and draft up, whole week back with `changed`), nothing written until
  "Set the week", then an ordinary `quota-<monday>` entry via `buildQuotaEntry(monday,
  counts, extra)` carrying the thread and reasoning. Opens on next week on a weekend
  (`defaultMonday`). Does not run on open. Starts from what was done, not what was set.

### 10.4 The cull: fewer ways to do the same thing

Removed, each pinned absent: `FullScreenSession` (a third way to read a session),
`AdjunctPills` (unused add-ons), the sheet's "MAIN/ADDED SESSION" strap, the sheet's own
"log another" link (**the day-list button is the door — keep it**), the footer "remove"
link (now a header bin with a confirmation), the name box in the form (now behind the
pencil), boilerplate protocols on the two container cards (now a plain notes box), lift
rest intervals, and the runner for lift-only sessions.

Added: everything folds; reorder per section; `out.notes` back as a plain notes box (same
key, so old notes read back); several measurements per session (`out.whoop` keeps the
first so every older reader stays right; extras in `*More`); a Warm-up button on unlogged
workouts; `priorIds` for history; quota-bar rows open the entry (`onOpenEntry`, `openAs:
'sheet'`).

**The log form and the planner's editor are the same component** (`exercises.jsx`).
`liftlog.jsx` adapts the positional stored shape (index as set id) rather than migrating
history; a blank is `''` there and `null` on a prescription via one `blank` prop.
`BlockQuota` stays in `planner.jsx`. `.exlog-*` styles stay for the climbing set log,
which is a genuinely different form. `SessionLog(other training, a lift)` and
`Sheet(a planned session)` pin the same one-open-card shape from opposite sides; if they
disagree, someone has grown a second copy.

**The edit panel** (`SessionDetails` in `DetailsSheet`, behind the pencil, shared by both
sheets) holds name, gear, "just miles" and time spent — set-once fields. The form keeps
the set log, declared fields, RPE, WHOOP/Strava and notes.

### 10.5 The iOS 26 safe area

On an installed iOS 26 web app with `black-translucent`, the layout viewport is short by
the top safe-area inset, so `position: fixed; inset: 0` stops early and the strip below is
outside the WebView (unpaintable, untappable). No CSS reaches it. Sheets therefore keep
their header clear of the status-bar glass (scrim `padding-top` from the inset, headers
offset past it, 44px close buttons) and spend as little as possible at the top. Headless
Chrome has no safe area, so screenshots will not show it; the Screen card in the profile
settings (`screeninfo.jsx`) measures it on the device. If a header goes missing on a
phone, suspect the inset before the stacking order.

### 10.6 Rest days have their own door

**Log a rest day** is on Today's empty day card (when viewing today) and in the + menu,
both opening `RestPrompt` in `App.jsx`. It asks why (chips from the rest card's own
`why` output, plus notes; both optional), has a date field for a forgotten rest day, and
edits an existing rest entry rather than adding a second. `restStats` in `lib/stats.js`
shows the why on the row. Pinned by `FabMenu(five doors, rest included)` and
`RestPrompt(asks why before logging)`.

### 10.7 Food is a separate app

Nutrition logging lives in a separate app. The only wire is the optional read-only
digest directory (§8.7). Do not add food logging here.

---

## 11. Before you finish

- `npm test` at the repo root passes.
- If you touched `app/src`, you ran `npm run build`.
- If you touched shared content in `test/fixtures/plan.json`, you ran
  `node app/starter.build.mjs` and the generated files are in the diff.
- If you removed or moved a control, there is a smoke case asserting the absence at the
  old place and the presence at the new one.
- If you added a route into the menu or the planner, there is a reachability assertion.
- If you added a setting, it has an env override, a source shown on the Settings page,
  and an entry in `.env.example`; and it is off (or harmless) by default.
- If you touched an AI run, its tool flags still deny shell and writes to the log and the
  plan, and `server/prompts.test.js` still passes.
- No personal details, hostnames, home paths or secrets went into tracked files.
  Deployment-specific notes belong in the untracked `AGENTS.local.md`.
