# AGENTS.md — Bushido

Working notes for any person or AI agent changing this repository.

If AGENTS.local.md exists, read it too: it holds the owner's deployment-specific notes.

Bushido is a self-hosted, single-owner workout log: a phone-first React PWA (`app/`) and
an iPhone app (`mobile/`) served by a zero-dependency Node server (`server/`), backed by
one JSON file. Three tabs (Today, Log, Progress) and a + button (Log a workout, Log a
rest day, Plan a workout, Interval timer). The
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
3. **Stored data is never deleted or rewritten to suit the code.** Old entries of kinds
   the app no longer has (check-ins, journal days, quotas, achievements) stay in
   `state.json`, unread; readers filter by `kind`, never by "what exists" (§4, §10.8).
4. **Nothing the AI produces is written until the user taps.** The workout planner
   returns a proposal; the app's own write paths place it.
5. **AI runs are constrained by `--allowedTools` / `--disallowedTools`, not by prompt
   text.** No AI run can write `data/state.json` or the plan file.
6. **Resolve an entry's session with `optFor`, never a raw `menu.find`.**
7. **`isDone()` is the only thing that means "I did this."** A session is done once its
   day arrives unless marked undone (§4); never read the raw `data.done` flag.
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
| `mobile/` | The native iPhone app (Expo). The web's phone layout rebuilt in React Native, with `app/src/lib/` copied in at the same paths. Its own install and rules: read `mobile/AGENTS.md` before changing it, and port a web change there when it touches a screen the app has. |
| `content/starter.json` | What a fresh install runs on: catalogs and the rest card, no programme. **Generated.** |
| `examples/plan.json` | A small, invented example plan (Settings → "Use the example plan"). **Generated.** |
| `test/fixtures/plan.json` | A large synthetic climbing-and-triathlon programme used by the test suites (smoke render, every app suite, `starter.test.mjs`) and by `starter.build.mjs` / `muscles.build.mjs`. The canonical fixture, and the source both generated files are built from. |
| `data/` | Runtime state. Gitignored. Never commit, delete or rewrite it (§4). |
| `deploy/bushido.service` | The systemd user unit. |
| `scripts/start.js` | `npm start`: builds the app if there is no build, then runs the server. |
| `Dockerfile`, `docker-compose.yml` | Container path; data in a volume at `/data`, no Claude CLI in the image. |
| `.github/workflows/ci.yml` | CI: app tests, server tests, build. A private repo runs it on a self-hosted runner labelled `box`; a public copy on GitHub's hosted runner. |

### Server

| File | What |
|---|---|
| `server/server.js` | Routes, static serving of `dist/`, the state store and merge, habit sync, notification wiring. |
| `server/auth.js` | Single-owner sign-in (§3). Also reads the native app's session sent as a bearer. |
| `server/users.js` | The people on an install, Cloudflare Access token checks, acting as someone (§3). |
| `server/config.js` | Settings, env precedence, first-start migration, which plan file is in use (§3). |
| `server/pages.js` | The server-rendered `/setup`, `/login` and `/settings` pages. Plain HTML on purpose: they must work before there is an account, before the app is built, and when a stale service worker is serving an old shell. |
| `server/agentflags.js` | The permission flags the planner is spawned with (`plannerFlags`): refused directories, the secrets deny list, and for anyone but the owner the denials that keep a run inside their own space (§7). Tested by `agentflags.test.js`. |
| `server/prompting.js` | Shared prompt pieces: the athlete's name and notes (the owner's from Settings, anyone else's from their `about.json`), gender-neutral fallbacks. |
| `server/planner.js` | Plan a workout (`/api/plan/workout`, `/api/plan/revise`): the only AI run. |
| `server/drafts.js` | "Write it for me" drafts: the run belongs to a draft file in the person's `drafts/`, written by the server when the run ends (`/api/plan/drafts`, §7). |
| `server/whoop.js`, `server/strava.js` | Pure matching, snapshot and card-filling logic for each service. |
| `server/notify.js`, `notify-facts.js`, `notify-categories.js` | Push notifications on top of an external notify core (§8). |

### App: the files you will most often need

| Thing | Path | Notes |
|---|---|---|
| Render smoke suite | `app/smoke.jsx` | `npm run smoke` in `app/`. Mounts every tab and session viewer against real content. |
| Store, merge, `isDone`, `markDone`, `doneWhenPlaced`, `isTraining`, entry ids | `app/src/lib/store.js` | The server's word-for-word copy of `isDone` is in `server/notify-facts.js` (§4). |
| Session lookup | `app/src/lib/menu.js` | `optFor(menu, optId)`; renamed cards declare old ids as `aka`. |
| Categories | `app/src/lib/category.js` | `categoryOf`, `disciplineOf`: what an entry files under, for the Log filter and Progress. |
| Dates and weeks | `app/src/lib/dates.js` | `localIso`, `fromIso`; `mondayOf`, `weekDays`, `shiftWeek` (Progress's weeks, Sam's week). |
| Hard finger days | `app/src/lib/fingers.js` | `isHardEntry`, `fingerLoad`, `hardDates`: what is left of the recommender; read by the Progress Climbing charts (§6.1). |
| Test results | `app/src/lib/tests.js`, `app/src/lib/force.js` | A test session writes its result; the Testing panel (profile) and the CF ceiling read it. |
| Activity catalog | `app/src/lib/activities.js`, `app/src/activitypicker.jsx` | 91 sports, their form shape, category, WHOOP/Strava names. Content-driven. |
| Lifts | `app/src/lib/lifts.js`, `app/src/liftlog.jsx` | Catalog search, logged-lift shape, arithmetic. `liftlog.jsx` is only an adapter. |
| One exercise card | `app/src/exercises.jsx` | `ExerciseCard`, `ExerciseSection`, `ExercisePicker`, `Stepper`, `STEP`. **Shared by the lift log and the planner's editor.** |
| Which fields a card asks | `app/src/lib/outputs.js` | `when` gates, `pruneHidden`, derived placeholders. |
| Minutes | `app/src/lib/minutes.js` | Precedence of time sources; `minutesSourceOf()` is the single statement of it. |
| Naming | `app/src/lib/naming.js` | `nameFor`, `titleFor`, `out.title`, quick-name chips. |
| Grades | `app/src/lib/grades.js` | The only grade scales in the app. |
| Prescriptions | `app/src/lib/prescription.js` | The model under planning and the runner. Pure; `now` is an argument. |
| Runner | `app/src/runner.jsx` | Set-by-set screen for a planned session. One writer. |
| Workout mode | `app/src/workout.jsx`, `app/src/lib/workout.js` | The climbing cards' rep clock and set log. |
| Interval timer | `app/src/timer.jsx`, `app/src/timer.css`, `app/src/lib/timer.js` | The general timer: from any workout's sheet and the + menu. Pure model, `now` as an argument; presets are `kind: 'timer'` entries (§6.5). |
| Planner UI | `app/src/planner.jsx`, `app/src/lib/plannerapi.js`, `app/src/lib/drafts.js` | + → Plan a workout; `BuildStep` (by hand) and `AskStep`/`ReviewStep` (by model); `DraftList` reopens a draft at its step. `plannerContext` sends the last week's logged workouts. `lib/markdown.jsx` renders its reasoning. |
| Pickers | `app/src/picker.jsx`, `app/src/lib/folders.js` | `PickerScreen`, `ActivityChooser` (Log a workout: the sports catalog, then the plan's cards under Climbing, in folders by `sched.discipline`). Declaration order, no ranking. |
| Quick log | `app/src/quicklog.jsx`, `app/src/lib/quicklog.js` | `<QuickLog plan entries upsertEntry date onPlaced />`: up to three recent activities (then the catalog's pins), one tap each; under Log a workout in the + menu, Recent in Log a workout, and Today's empty day. Places through `placeEntries`, so the id and done-by-default are Log a workout's own. |
| Unlogged workouts | `app/src/lib/unlogged.js`, `app/src/unlogged.jsx` | What WHOOP/Strava saw that the log lacks; `pairUp`, `mergeTargets`, `outWith()`. |
| Session sheet / edit panel | `app/src/sessionlog.jsx` | `SessionLog`, `SessionDetails`, `DetailsSheet`, `NameField`. |
| Day switcher | `app/src/tabs.jsx` (`DaySwitcher`, `dayWords`) | ‹ day › in words; Today's title and the rest day's date (§10.9). The phone's is `mobile/src/ui/DayStepper.tsx`. |
| Toasts | `app/src/toast.jsx`, `app/src/lib/toast.js` | Mobile's API (`pushToast`, `pushError`) on the web: a removal's Undo, a failed save's Retry. |
| Log feed | `app/src/log.jsx` | Newest first; the open sheet is keyed by ID. |
| Progress | `app/src/lib/scope.js`, `app/src/lib/metrics.js`, `app/src/progress.jsx` | Charts declare when they apply. |
| Gear | `app/src/lib/gear.js`, `app/src/gear.jsx`, `app/src/gearpicker.jsx` | Two origins (§6.9). |
| Profile | `app/src/lib/profile.js`, `app/src/profile.jsx` | A `Popover`, not a `FullScreen`. Opens on a list of sections (`homePages`), each a page with a back button; Testing and Why (`testing.jsx`) are under Climbing. |
| Number inputs | `app/src/numinput.jsx`, `app/src/lib/numtext.js` | Text inputs that own their text (§6.4). |
| Body diagram | `app/src/lib/bodymap.jsx`, `app/muscles.build.mjs` | `react-body-highlighter` + `free-exercise-db`; nothing hand-drawn. |
| How-to figures | `app/src/howto.jsx`, `app/src/lib/figures.jsx` | Registry of SVG figures named by content. |
| Palette | `app/src/styles.css` `:root`, `app/validate_palette.js` | `npm run palette`; a real gate (§6.10). |
| Styles | `app/src/styles.css` (tokens, base components, shell), `app/src/css/<area>.css` (each screen area's rules, one owner each), `app/src/timer.css` | A new rule goes in its area's file. See `docs/DESIGN.md`, "Visual system". |
| Notifications client | `app/src/lib/push.js`, `app/src/notifications.jsx` | |
| Device screen probe | `app/src/screeninfo.jsx` | Measures the iOS safe-area bug on the device (§10.5). |
| Whose log this is | `app/src/lib/whoami.js` | Decided before the store mounts; per-person cache key; `X-Bushido-User` on every API call (§3). |
| Shared workouts | `app/src/lib/shared.js`, `app/src/sharedwith.jsx` | "With …" on the sheet; someone's copy through the people endpoints (§3). |
| The owner as trainer | `app/src/lib/trainer.js`, `app/src/trainer.jsx` | "For: You / Sam" in Plan a workout, the workout side switcher, "Sam's day", About you (§3). `placeEntries` is the one place day ids are minted for a batch, for anyone's log. |

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
  (`test:fingers`, `test:streak`, `test:gear`, `test:progress`, `test:workout`,
  `test:tests` (test-result sessions), `test:lifts`, `test:presc`, `test:naming`,
  `test:md`, `test:starter`, `test:signout`, `test:whoami`, `test:shared`,
  `test:trainer`) and the smoke suite. Run a
  single suite while iterating; run the whole thing before you finish.
- **The generated content must not drift.** `app/starter.test.mjs` fails if
  `content/starter.json` or `examples/plan.json` no longer match what
  `app/starter.build.mjs` produces from `test/fixtures/plan.json`. Edit the fixture's
  shared parts (catalogs, categories, quick names, planner kinds), re-run the build
  script, and commit all three. The build script also scrubs design-history quotes that
  name a real person, and leaves out the content of removed features (`recommender`,
  `checkin`, `journal`, `achievements`): the fixture still carries them, as an old plan
  file does, and the app must ignore them.
- **Prompts are tested for neutrality.** `server/prompts.test.js` builds the planner's
  prompts as a fresh install would and fails on a gendered pronoun, a personal name or
  quota language.
- `server/http.test.js` boots real servers on temporary data directories and drives
  setup, sign-in and the defaults end to end, including the `legacy data:` steps that boot
  on a data dir full of removed features' entries and files. `server/config.test.js` and
  `server/auth.test.js` cover precedence, migration and sessions.

### What the smoke suite is for, and how to extend it

The smoke suite (`app/smoke.jsx`) server-renders every tab, sheet and flow against real
content. It is the main defence for this codebase, and it has had to learn three lessons:

- **A missing door is invisible to a render test.** "The picker renders" passes when a
  card is unreachable. Reachability cases diff the content against what a screen lists
  (`ActivityChooser(every startable card is in a folder)`, the planner kinds, figures named vs
  figures registered). **Any new route into the menu needs that kind of assertion.**
- **A removal still renders.** The only way to catch a re-addition is to assert the
  absence (`TodayTab(empty day offers nothing)`, `TodayTab(legacy entries are ignored)`,
  `FabMenu(four doors…)`, `tabsFor(three tabs…)`, `SessionSheet(no add-ons, no strap)`,
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
- **The native app** (`mobile/`) signs in with `POST /api/auth/session` (username and
  password, JSON, throttled like `/login`) and gets the signed session value back instead of a
  cookie; it sends it as `Authorization: Bearer`, which `auth.check` verifies exactly as the
  cookie. Revoking sessions and changing the password sign it out too.
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
| About you | Name and free-text notes given to the workout planner. |
| Training plan | Download; import a file; use the example; back to the starter. Replacing `data/plan.json` copies the old one to `data/backups/plans/` (never rotated) first. The log is never touched. |
| Integrations | Totem bridge URL, secret or `.env` file to read `BRIDGE_SECRET` from, habit id, and the habit sync toggle. |
| Strava | The Strava API app's client ID, secret and optional redirect URI. Everyone connects their own account in the app. |
| WHOOP | The WHOOP app's client ID, secret and optional redirect URI. The owner connects in the app. |
| Other local services | Notify core directory, athlete-profile (brain) file the planner may read, timezone. |

Secrets (`ai.apiKey`, `totem.secret`, `strava.clientSecret`, `whoop.clientSecret`) are
never sent to the browser; they are masked, and a masked value posted back is ignored. Each
section keeps only the keys `blank()` names, so a removed setting is dropped on the next save
(this is how `totem.goals` and `links.krakatoaDir` leave an older `settings.json`).

### More than one person (`server/users.js`, `app/src/lib/whoami.js`)

- **The owner's files never move.** The owner's space is the data dir itself; anyone
  else's is `data/users/<id>/` with the same file names. `spaceFor()` in `server.js` is
  the only place a log, backup or plan path is built; do not reintroduce a
  module-level `STATE_FILE`.
- **Identity is a verified Cloudflare Access JWT, never a bare header.** Present but
  invalid, or valid for an unknown email, is a `403`, never a fallback to the owner.
  Absent is the owner, which is exactly plain proxy mode's existing trust.
- **One device never mixes two logs.** Whose log is open is decided before the store
  mounts; a switch is a full reload; each person has their own cache key (the owner keeps
  `bushido:cache-v1`); every API call carries `X-Bushido-User` and the server refuses a
  mismatch with `409 switched`. All four are load-bearing.
- **Integrations are the owner's; the AI is everyone's.** `featuresFor(space)` turns WHOOP,
  habit sync and notifications off for anyone else (they are the owner's grants),
  which must render exactly like an install that never set them up.
- **Strava is everyone's own, and Bushido holds it, the owner's included.** Once Settings
  has a Strava API app (`config.strava()`), each person connects their OWN account
  (`/api/strava/connect`, `/strava/callback`; refused while acting as someone), and the
  grant and cache live in their space (`strava-oauth.json`, `strava.json`). The client is
  `server/strava-api/`. The owner's client also keeps the full activity mirror
  (`strava-activities.json`) and is the only place Totem gets Strava from:
  `POST /api/strava/owner` runs one of `STRAVA_OWNER_METHODS` on it for Totem's goals, agent
  tools and CLI. Never give Totem a grant of its own again; one holder per account.
- **The owner's WHOOP is held here too** (since 2026-10-14; it was the Totem bridge's). Owner
  only: Settings has the WHOOP app (`config.whoop()`), the owner connects in the app
  (`/api/whoop/connect`, `/whoop/callback`), and the grant is `whoop-oauth.json` in the data
  dir. The client is `server/whoop-api/client.mjs`. Totem's sleep habit and Krakatoa's calorie
  burn read it through `POST /api/whoop/owner` (`WHOOP_OWNER_METHODS`: `status`, `training`,
  `sleepNights`). Habit sync and
  the "logged" push run only for the owner's writes. `ai` is on for everyone once a CLI is
  configured AND runs (`aiUsable` in server.js: an executable file whose `--version` did not
  fail), and every run is built from ONE person's space (`aiRun(space)` in server.js;
  §7 says what a non-owner's run can read). Without one it is off for everyone, the owner
  included (#55): Plan a workout is Build it myself alone, and Settings → AI is where the
  owner learns why. A refusal (`ai-not-configured`) is remembered for the rest of the page's
  life (`aiOffered` in `lib/plannerapi.js`), so reopening the planner does not offer the model
  again.
- **About you is per person.** The owner's is in Settings, as always. Anyone else's is
  `about.json` in their space (`aboutFor`/`writeAbout`), edited by them (`/api/about`,
  profile → You) or by the owner (`/api/people/:id/about`, "About Sam" in Sam's day), and
  falls back to the name in People. Prompts take the name and notes of the person the run
  is for, never the owner's.
- **Only the owner is an admin**: Settings, People and acting-as are refused to anyone
  else. The `bushido_as` cookie is honoured only when the real requester is the owner.
- **Shared workouts** (`lib/shared.js`, `sharedwith.jsx`, `server/sharedsync.js`,
  `peopleRoute` in `server.js`): the owner adds someone to one workout from the sheet
  ("With …") without acting as them. Their copy is an ordinary entry in THEIR log (same
  derivable id unless they logged something of their own there, then an `extraEntryId`
  extra), `done: false` (done from its day on by §4, never their own tick, which is what
  `hasOwnMarks` reads), carrying the workout's shared facts (`SHARED_OUT_KEYS`) and the
  owner's EXERCISES, never the owner's numbers: reps, weights, effort, feel, notes, gear and
  WHOOP/Strava show only as placeholders on their side. The owner's entry names them in
  `data.sharedWith: [{ id, entryId, sync }]`; the copy carries `data.sharedFrom: { id, name }`,
  stamped by the server.
  - **Sync** ("Sync exercises with Sam", one switch per person, `sync: true` on the link,
    on when someone is added). While on, the workout's STRUCTURE is one thing seen from two
    logs: exercises and blocks added, removed, renamed or reordered, and set counts, on
    EITHER side reach the other. Numbers never cross: reps, weights, times, the run
    (`data.run`), `out`, `done`/`undone`/`doneAt` (§4) and WHOOP/Strava stay in the log
    they were written in; the sync only ever writes `plan`, `out.lifts`, the run's set keys
    and `syncBase` on the receiving entry. A set
    or exercise that arrives is blank (an interval keeps its own last set's shape); the
    implement is each person's own. A removal never takes an exercise (or a set) the other
    side has logged on. Off, each side stays as it is, and **Copy my exercises to …**
    (`copyExercises`, add-only) is the way to bring the owner's over; it is hidden while
    sync is on. A link without the flag (shared before sync existed) is off; turning sync
    on aligns the two by name once and adds what their side lacks.
  - **The merge runs on the server**, because only it sees every write (the owner's
    devices, the other person's own phone, and the owner writing their side through
    `/api/people/:id/entry`) and only it can write both logs (`commitSynced` in
    `server.js`). Identity is a `uid` on every block and plan item, minted by the server
    the first time it sees one and never changed; plan ids (`b0i1`) are positional and are
    never matched on. A model revision is asked for each uid back (the planner's reply
    schema allows it, the revise prompt says to copy it) and `normalizePrescription` keeps
    it, so a renamed exercise stays the same one. An item that still arrives without a uid
    takes the uid of the same-named item it replaced.
  - **The rule** (`intentOf`, stated at the top of `server/sharedsync.js`). Each synced
    entry carries `data.syncBase` (`{ of: <entry id>, rev, plan | lifts }`, its structure as
    the server last wrote it, a new `rev` on every change), and a device sends back the base
    it was given. A **matching or older base of this entry** is structural intent, applied
    as a three-way change: (that base → what it sent) onto what is stored, so whatever
    reached the entry since stays, and only that change is carried. **No base, a foreign
    one or a future one** (another entry's, not a base, a rev this entry never had, a
    different structure under the same rev, or a stored entry not stamped yet) is numbers
    only: its numbers, run, notes and done land on the stored structure; it never removes,
    reorders or adds structure, and nothing it does is carried. A list of exercises that
    merely arrived is not a decision to delete what it lacks. **Logged data is never removed
    by anyone else's write**: a carry keeps what the receiving side has logged on, and a
    write keeps an exercise its own device logged on even when the merge lacks it (on that
    side, uncarried), whatever base it sent. So a stale device, a pre-sync copy and an old
    app can neither resurrect an unlogged exercise nor delete a logged one. The cost: a
    write with no base (in practice only a copy pulled before sync existed) silently drops
    the structural edits it made to exercises it has not logged on. Last-write-wins still
    holds per entry for everything else.
  - A write the sync makes is stamped one millisecond past the RECEIVING entry's own
    `updatedAt`, never the sender's time or the server's clock: a later or skewed sender
    stamp would beat the receiver's own write saved earlier but arriving later (offline
    sets) and LWW would drop their numbers, while the structure survives that write
    through its base. The first version (`server/mirror.js`, removed in #15) followed the
    owner one way and matched exercises by NAME, and was dropped because the owner had no
    say over when their side changed; the switch and uids are what answer that. Do not
    move the merge into a client.
  - **Their side** of the sheet: the You / Sam bar (each person's initial and name in their
    colour) is pinned to the top while the sheet scrolls (`position: sticky` on the web,
    the sheet header on the phone), and the sheet reopens on the side last viewed on this
    device (`bushido:shared-side`, per entry id; also set from a running workout). Every
    exercise's "last time" and the session history come from THEIR log
    (`/api/people/:id/state`), labelled with their name. Their copy is re-read every few
    seconds while open, so the other phone's changes appear. Their side of a planned
    session shows their plan in the same editor, and "Start the workout" opens the sides
    runner on their side.
  - The owner's sheet reads and writes the copy through `/api/people/:id/entry`, never
    through the owner's store or cache, so logs still never mix on a device. The server
    refuses non-owners, acting-as, the owner's own log, and any live entry without
    `sharedFrom` (`not-shared`); a sync never writes into an entry they logged themselves.
    Those writes fire no habit sync and no push. Taking someone off tombstones their copy
    only if they have marked nothing (`hasOwnMarks`; copied lifts with nothing marked on
    them are not marks), otherwise it asks. WHOOP/Strava stay off on their side.
  - Pinned by `server/sharedsync.test.js`, the `shared workouts:` and `sync:` steps in
    `server/http.test.js`, `app/shared.test.js`, and the `SessionSheet(… "With …" …)`,
    person bar, sync switch and `TheirSide` smoke cases.
- **The owner as trainer** (`lib/trainer.js`, `trainer.jsx`, the same `peopleRoute`):
  without acting as anyone, the owner plans for someone else, sees their week and runs a
  workout from their side. All of it is owner-only, needs someone else on the install and
  is hidden while acting (`planPeople(me)`, the same rule as `sharePeople`).
  - **Planning for someone** is a "For: You / Sam" choice at the top of Plan a workout (both
    routes). The model runs with `for: <id>` on the request (`aiSpaceFor`), so its log,
    plan and About you are theirs; the client context (`plannerContext`) is built from their
    log too, and WHOOP readiness is left out. Nothing is written until the tap (§0.4). Keeping it writes into
    THEIR log through `/api/people/:id/entry`: their day is read first and `placeEntries`
    mints the ids their own + would have, one entry per part (`plannedEntriesFor`), each
    `done: false` (done from its day on, §4) with `data.plannedBy: { id, name }` stamped by the server. The server
    accepts only `daily-…` entries carrying `sharedFrom` or `plannedBy`, and refuses any
    live entry without one of them. (Planning someone's WEEK went with the quotas; a
    `quota-<monday>` entry is refused with a 400.)
    They see a quiet "planned by <owner>" (`plannedLine`) on the row, the sheet and the
    feed, and the entry is theirs to edit, log or delete. They cannot plan for anyone.
  - **Sides of a workout.** A shared entry opens the runner or workout mode through
    `SidesWorkout`: a You / <name> switcher under the header, the name in a pill and a rule
    in that person's colour (`[data-tone]`: the accent for the owner, the series colours for
    everyone else, so the palette check has nothing new), and a haptic on switch (native).
    Every side stays mounted with its own runner over that person's own entry and its own
    writer (the owner's `saveRun`/`saveOutputs`; anyone else's `usePersonCopy`), so each
    has its own sets, weights, rest clock and done state, and the runner still has ONE
    writer per entry (§6.2). Only the side on screen makes a sound. Finishing a side hands
    over to the next one not done. `applyOut`/`applyRun`/`applyDone` are the owner's write
    paths as pure functions, so both sides write the same shape. A workout nobody shares,
    and everyone but the owner, get the single screen they always had.
  - **"Sam's day"** (`PeopleDays` under the day list on Today, `PersonDay`) is a read-only
    week of their log from `/api/people/:id/state`; a session opens in `PersonEntrySheet`
    (their form without WHOOP/Strava, done, and Start, which runs it from their side). It
    never touches the owner's store or cache. Act-as stays exactly as it was.
  - Pinned by the `trainer:`/`ai for everyone:` steps in `server/http.test.js`,
    `server/agentflags.test.js`, `server/prompts.test.js`, `app/trainer.test.js`, and the
    `PlanFlow("For: …")`, `SidesWorkout(…)`, `TodayTab("Sam's
    day" …)` and "planned by" smoke cases, including every absence (one person, acting,
    not the owner).
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
is found (`CLAUDE_BIN`, `~/.local/bin/claude`, then `PATH`); no bridge, so habit sync is
off; no WHOOP or Strava app, so both are hidden; no notify core and therefore **no
timers at all**; no brain file; starter content. AI routes answer
`503` with `code: "ai-not-configured"` and the planner offers only Build it myself; nothing else is
affected.

An **existing install** (`state.json` present, no `settings.json`, no `auth.json`) is
migrated once, and the migration does exactly two things: it writes `auth.mode: "proxy"`
(the old version had no login, so an upgrade must not lock the owner out; a data dir with
an owner account is never switched to proxy), and it copies a legacy tracked
`content/plan.json` into `data/plan.json` if that file is absent. A `git pull` deletes
that file first, so in practice the owner restores it with
`git show 'HEAD@{1}:content/plan.json' > data/plan.json` (deploy/README.md); the server
warns at start-up when a migrated install is running on the starter. Every other setting
(bridge, notify core, brain file, timezone, About you) starts off or
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
  for a new workout on a day that already has one). Two offline devices doing the same act compute the same
  id, so the merge has something to agree about.
- **Done once its day arrives, unless marked undone** (since 2026-10-25, docs/DESIGN.md D2).
  An entry created for today or an earlier day is written `done: true` (`doneWhenPlaced`);
  one for a later day is written `done: false` and `isDone()` reads it as done from its
  day on. That is a READ rule: nothing wakes at midnight and nothing is rewritten. The
  sheet's **Mark undone** writes `done: false` plus `undone: true` (`markDone`, the only
  writer of `undone`), which no date ever flips back; **Mark done** writes `done: true` and
  drops the marker. `done: true` beats everything; an absent `done` means true (older
  entries predate the flag). A `done: false` with no marker on a day that has arrived is
  done, and that includes every entry stored before the rule: a session once planned and
  never ticked now counts. Use `isDone()` — never entry existence, never the raw flag —
  for streaks, load, hard-day counts, charts, habit sync and notifications. It has three
  copies, kept word for word by `app/done.test.js`: `lib/store.js`, `server/notify-facts.js`
  (the server's; it takes the configured timezone's today) and `mobile/src/lib/store.js`.
  - **Transitions are about writes, not dates.** The "logged" push fires once, when a
    write first makes an entry `announceable` (`completedDailyEntries`): marked done AND
    its run ended, a done tap (`doneAt`, stamped by `markDone`), something logged in `out`,
    or an earlier day's date. So picking a session for today counts for the habit at once
    but is announced when the first set or effort is logged; a workout logged after the
    fact is announced as it lands; a planned session's day arriving is never announced.
    The habit record for a day leaves out sessions still to come and picks them up on the
    next write after their day arrives, because every sync re-sends every day's record whole.
  - **An old client's untick is kept as one.** Before this rule, unticking wrote a bare
    `done: false`, which now reads as done. New code never does that, so the server's merge
    (`keepUntick` in `server.js`) adds `undone: true` when a bare `done: false` replaces an
    entry stored as done, and keeps a marker the stored copy already has. An entry already
    stored as `done: false` without one (a plan, a legacy entry) is never touched.
  - **"Done" no longer means "finished running".** Today's session is done before it
    starts, so "Start" asks `canStart()` (run not ended; on an earlier day, only once
    undone) and the sides runner hands over by what was finished on screen.
- **Nothing rewrites history to suit a component.** Old shapes are read as they are
  (positional lift sets, `out.notes` on old entries, `out.intensity`/`out.effort`, the
  retired `hard-home` card id). New code adapts to stored data, not the reverse.
- **Entries of removed kinds stay and are ignored.** A log may hold `checkin-<date>`,
  `journal-<date>`, `journal-custom`, `quota-<monday>` and `achievement-<id>` entries.
  Every reader selects the kinds it reads (`daily`, `bodyweight`, `gear`, `test`,
  `skip-workout`, `timer`…) rather than dropping the ones it does not, so these are never a
  workout, a streak day or a chart point, and nothing filters out a live kind such as an
  undated `timer` preset; the merge,
  export and backups carry them untouched. Never write a migration that drops them.
- Non-log state lives beside the log: `data/drafts/` (AI workout drafts, not entries;
  at most eight per person, a week old at most), `data/whoop.json`, `data/strava.json` (caches),
  `data/vapid.json` (push identity — **deleting it silently breaks every subscription**),
  `data/push-subscriptions.json` (a secret: endpoint + keys is enough to push to a
  device). An older install may also have `data/coach/`, `data/coach.json` and
  `data/goals.json` from removed features: nothing reads or deletes them.

---

## 5. Content: the plan file is the content API

No training content is hardcoded in the app. Sessions, catalogs, categories
(`quotaCategories`, a name kept from the quotas because plan files carry it), planner kinds,
quick names and gear kinds all come from the content file, so the programme can change with
no rebuild. An older plan file may also carry `recommender`, `checkin`, `journal` and
`achievements`: the app ignores them, and the test fixture keeps them to prove it.

- **Sessions** are objects in `dailyMenu` with `role` (`session` / `adjunct` / `rest`), a
  `protocol`, `outputs` (log fields) and `logSpec` (per-set logging). Output types:
  `slider`, `toggle`, `choice`, `grade`, number; `optional: true` stops a field blocking
  "logged". An output with `chart` becomes a progress chart. `levelFrom`, `nameFrom` and
  `minutesFrom` let a session rewrite its own entry from what was logged.
- **Every menu session needs a `sched` block** (category, venue, finger load,
  `repeatable`, sport declarations); the suite fails otherwise. `sched.discipline`
  (`bouldering` / `rock-climbing`) says which folder of Log a workout the card sits in;
  a card without one lands in "From the plan" (`lib/folders.js`). Where the folders sit
  (after the sports catalog) is decided in `picker.jsx`, not by content, because the
  owner's plan file is not in the repository.
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

- **The two finger rules are no longer enforced by anything, and say so.** No hard finger
  day the day after another (`hardMinGapDays`) and no more than `hardCap` a week used to
  block the recommender's and the coach's offers. Those offers are gone (2026-10-25), and
  placing a session (`placeEntries`, `pickMain`, `addExtra`) never consulted the rules, so
  `lib/recommend.js` shrank to `lib/fingers.js`. The workout planner's prompt still tells
  the model not to write a fourth hard finger day or one the day after another. If a
  surface that OFFERS sessions ever comes back, it must read the rules from
  `lib/fingers.js` (`hardDates`) before offering, not after.
- **`isHardEntry()` decides what an old climbing week reads as.** It was the most
  load-bearing predicate in the app while the rules blocked, and it is now what the
  Progress Climbing charts count (`fingers.test.js`). Order: a session that cannot load the
  fingers never counts; then what the user logged (`out.hardFingers`, pre-filled from
  `sched.fingerLoad`); then the plan's declaration. Changing it rewrites history.
- **Climbing is not in the activity catalog and must not be added.** Climbing sessions are
  `dailyMenu` cards that ask the hard-finger question; a second way to log climbing is a
  way for a hard finger day to land where nothing asks the question. Hence
  `choiceForSport` returns null for climbing sports, `laneCandidates` never falls back to
  the workout card for a climbing category, and the unlogged-workout card offers a WHOOP or
  Strava climb only as a `climbing: true` row whose "Log it" opens the climbing folders
  (`onClimb`), never the workout card, "just miles" or "warm-up". The folders in Log a
  workout are doors to the climbing cards, not catalog activities.
- **Hard finger days count what was LOGGED, never what was planned or offered.**
  `hardDates` reads only done entries.
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
- **A day is a list of sessions.** Day-level accounting (load calendar, hard finger days)
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

### 6.3 "Just miles" and categories

- **"Just miles" / warm-up are not training.** `data.training: false` (`isTraining`)
  counts for gear mileage, streak, habit and Progress miles, and is excluded from training
  load (sRPE, the load calendar) and from the planner's "logged in the last week" context.
  Absent means training. Marking one also names it (`out.titleFrom: 'casual'` →
  "Commute", `'warmup'` → "Warm-up"), and unticking removes only the app's name.
- **One category per entry.** `categoryOf(entry, menu)` (`lib/category.js`): `out.category`
  beats the card's `category`, which beats the catalog activity's (`categoryFrom:
  "activity"`). A planned trip with a lift and a ride is two entries, not one entry in two
  categories (§6.6).

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
  target the user asked for; the target stays on `data.plan`. An unanswered slider is
  drawn as a placeholder too (`.slider.unset`, `RangeSlider unset`): an empty track and a
  hollow thumb on the default, until it is moved or tapped.
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
- **The interval timer is a clock, not a log** (`lib/timer.js`, `timer.jsx`, D8 in
  `docs/DESIGN.md`). A config compiles to a flat list of segments; a run is instants
  (`at`, `pausedAt`, …) and `settle(program, run, now)` steps over every segment that
  ran out, each starting where the last ENDED, so backgrounding and a reload (the run is
  kept on the device under `bushido:timer-run`) land on the right second. A segment with
  `seconds: null` counts up and waits for a tap. It writes nothing to a workout.
- **The climbing cards' timers are presets of it.** `sessionTimer()` walks workout mode's
  own `startOf`/`advancePhase`/`afterSet` and drops only the review (where a set is
  logged), so the same card runs the same sequence from either door;
  `workout.test.js` pins that for every timed card. Workout mode keeps the set log.
- **Timer presets are entries**: one undated `kind: 'timer'` entry per preset (like gear),
  plus `timer-last`, the one-tap default, rewritten only when Start runs something
  different. Per person, synced, merged per preset, deleted by tombstone.
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
- **"Write it for me" is a draft on the server** (`server/drafts.js`, `lib/drafts.js`),
  in the requester's space, never an entry. The run belongs to the draft, so leaving the
  page loses nothing; the first screen lists drafts and reopens one at its step
  (`draftStep`); keeping one places it as always and then discards it. A draft whose run
  is not in this process (a restart) reads as failed with a retry, never "working".
- **A draft is kept once.** "Put it on today" claims it first (`POST …/keep`; a second
  device is refused and sent back to the list), and the placed plan carries
  `data.plan.draftId`. A draft whose id is on an entry is on a day: the app does not offer
  it and the server deletes it, which is what retires a draft kept offline.
- **Kinds are a list**; the seam is the BLOCK, not the author. `splitPrescription()` cuts
  at block categories (consecutive same-category blocks merge; uncategorised blocks join
  a neighbour) and `placeAll()` writes one entry per part, so each part gets its own WHOOP
  and Strava slot. The block control says it in plain words: *its own workout: Run* or
  *part of the workout beside it*.
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
- **Groups render in registry order, and Climbing is last.** The page leads with workouts
  and time for the period; hard finger days are a Climbing chart. Pinned in
  `progress.test.js` (`climbing charts come after the general ones`).
- Charts are titled in plain words ("Effort per week", not "training load"); the effort
  chart is still sRPE (RPE × minutes), which is why minutes are measured when possible.

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

There is one: the workout planner (`server/planner.js`, *Plan a workout → Write it for
me*, `/api/plan/workout` and `/api/plan/revise`, and the drafts under `/api/plan/drafts`
that run them). It spawns one headless Claude Code CLI
run (`claude --print`, JSON schema for the reply) with the configured binary, model and
environment (`config.ai()`; `spawnEnv()` adds a stored API key). Without a CLI those routes
answer 503 with `code: "ai-not-configured"` and nothing else changes. The AI coach, the
dormant check-in coach and the week planner were removed on 2026-10-25 (§10.8).

**The boundary is flags, not prompt text.** A prompt is a request; a flag is a rule. All
of them are built in `server/agentflags.js` (`plannerFlags`):

- Allowed: `Read`, `Grep`, `Glob`. Denied: `Bash`, `Edit`, `Write`, `NotebookEdit`,
  `Task`, `WebSearch`, `WebFetch`, plus explicit `Edit` denials on `state.json`,
  `plan.json`, `auth.json`, `settings.json`, the data dir and the repo. **No run may ever
  write anything**, and none has a shell.
- A brain directory that is the filesystem root, `$HOME` or an ancestor of it is refused
  outright (no `--add-dir`). A safe one is passed with `--add-dir`, read-only, as is a
  non-default data dir.
- Every run denies `Read` of `auth.json`, `settings.json`, `vapid.json`,
  `push-subscriptions.json` in the data dir, any `.env`, `~/.claude/**` and `~/.ssh/**`.
- Absolute paths in permission rules are written `//abs/path`; a single leading `/` is
  relative to the project in the CLI's rule syntax.
- The paths a run sees (CLI binary, brain file, notify core) come only from the
  environment or a hand-edited `settings.json`, never from a browser patch.
- `ISOLATION` keeps the owner's own Claude Code settings, MCP servers, hooks and
  CLAUDE.md out of the run. An un-isolated run once overwrote the training log.

**A run for anyone but the owner** (their own, the owner acting as them, or the owner
planning `for` them) is built by `aiRun(space)` from their space alone, and the flags make
that a rule rather than a request (`person` and `ownerSources` in `agentflags.js`):

| | Their run |
|---|---|
| Can read | their own space (`data/users/<id>/`: log, plan, drafts, About you), passed as the only `--add-dir`; the repo (the starter content, README, docs) from the cwd |
| Is denied by rule | everything else directly in the data dir (enumerated when the run is spawned, plus the owner's file names whether or not they exist yet: `state.json`, `plan.json`, `whoop.json`, `strava.json`, `users.json`, `about.json`, `backups/`, `drafts/`, and an older install's `coach.json`, `coach/`, `goals.json`), every other person's folder, the owner's brain file and its directory, the owner's own plan file when it is not the starter, and the usual secrets |
| Never gets | the brain file, WHOOP/Strava cache paths, the owner's About you |
| Prompt | their name and notes; `logDir` is their space, so every path in it is theirs; no brain, WHOOP or Strava section at all (`measurements: false`), exactly as on an install that never configured them |

Deny beats allow, and a deny on the data dir as a whole would also cover their own space
inside it, which is why the owner's names are enumerated. Claude Code applies `Read` rules
to Grep and Glob as well. `server/http.test.js` (the `ai for everyone:` steps, with a fake
CLI that records its argv and prompt) and `agentflags.test.js` pin both the denials and
that their own space is never denied; `prompts.test.js` pins the absent sections.
`agentflags.live.test.js` (opt-in, `BUSHIDO_LIVE_CLI=1`) runs the real CLI in a hostile
configuration and checks every write is refused.

Rules the planner keeps:

- **Nothing is written until the user taps.** `/api/plan/workout` and `/api/plan/revise`
  return a proposal and store it nowhere. `/api/plan/drafts` stores the proposal on a draft
  beside the log (the SERVER writes it from the run's stdout; the run still has no Write),
  and the log only on the tap; keeping it goes through the app's own `placeAll`. There is
  no such thing as an AI write to the log.
- **Revisions return the whole object** with a REQUIRED `changed` field (optional fields
  get omitted by models).
- **Pre-digest instead of letting a model read the log whole.** `plannerContext`
  (`lib/plannerapi.js`) sends today's WHOOP readiness (owner only) and the last 7 days of
  done training workouts, so the model does not spend its budget parsing `state.json`.
  Absent data produces no section at all — a model told nothing about recovery must not
  conclude the user is recovered. Runs are at low effort (`BUSHIDO_PLANNER_EFFORT`) with a
  timeout set from measurement.
- **Prompts are gender-neutral and personal-detail-free.** The name and notes come from
  Settings via `server/prompting.js` (`who()`, `speaker()`, `notesSection()`), falling back
  to "the athlete". `server/prompts.test.js` enforces it, and that no quota language is
  left in the prompt. Do not write a person's facts into a prompt.
- **The endurance kinds leave `category`/`activity` null** so the planner picks the sport
  it has seen least in the last week's log; the planner prompt explains how. The builder
  never guesses on the user's behalf ("part of the workout beside it" until a chip is
  tapped).

**Nothing schedules an AI run, and nothing but a person edits the plan.** There was once a
nightly timer and a "run the coach now" button that could edit the plan behind a
validate-test-revert gate. Both were removed deliberately. Do not reintroduce scheduled or
unattended plan edits.

---

## 8. Integrations

All optional; all off on a fresh install. None may block a request the app needs to load
or a log being saved.

### 8.1 The Totem bridge

Totem is the author's separate personal assistant app; its HTTP bridge exposes a habits
API. Any service exposing the same endpoints would work. Configure with Settings →
Integrations or `BUSHIDO_TOTEM_URL`, `BRIDGE_SECRET` / `BUSHIDO_TOTEM_ENV`,
`BUSHIDO_TOTEM_HABIT`. The secret never reaches the browser.

**Bushido is the one holder of the owner's WHOOP and Strava grants.** WHOOP rotates its
refresh token on every refresh and invalidates the old pair, and Strava's may rotate too,
so exactly one process may hold a grant; a second copy silently kills one of them. Totem
and Krakatoa read through Bushido (`/api/whoop/owner`, `/api/strava/owner`, with
`BUSHIDO_API_TOKEN`) and must never be given credentials of their own. Within Bushido, one
WHOOP refresh runs at a time (`accessToken` in `server/whoop-api/client.mjs`; the http test
"share one refresh" checks it).

### 8.2 WHOOP (`server/whoop.js`, `app/src/lib/whoop.jsx`, `app/src/whoop.jsx`)

- Bushido's own client (`server/whoop-api/client.mjs`, `training()`). `GET /api/whoop`
  serves the cache and refreshes in the background; `POST /api/whoop/pull` is the only
  synchronous path. `POST /api/whoop/owner` serves Totem and Krakatoa.
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
- **Recovery is read against the user's own fortnight median** (`baselineFor`), and is
  null with fewer than four prior days or when WHOOP reports `calibrating`. Null renders
  nothing, exactly as the app before WHOOP existed. (It used to be a capped term in the
  recommender; that went on 2026-10-25.)
- **Sleep and recovery rows accumulate in the cache** (`mergeDaily`): each pull is laid
  over what was cached, newest copy winning, kept for a year, so the Today tab's sleep
  graph (30d / 90d / 1y, ported from Totem's Habits tab) can look back further than the
  client's 60-day maximum per pull. A cache with no `backfilledAt` gets one 60-day pull. It is still
  a refetchable mirror; deleting it loses only graph history.

### 8.3 Strava (`server/strava.js`, `app/src/lib/strava.jsx`, `app/src/strava.jsx`)

Same arrangement and the same cache-vs-snapshot rule (`data/strava.json` vs
`out.strava`/`out.stravaMore`).

- The person's client (`server/strava-api/`, `training({ days })`) → `{ fetchedAt, days,
  athlete, gear, activities }`, already shaped: both unit systems, a `family`, and the
  athlete's local `date`. `GET /api/strava/activity?id=` fetches full detail at attach
  time; on failure the summary is attached.
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

### 8.4 Hostnames

No hostname belongs in shipped code. `lib/handoff.js` moves pages from the hostnames in
`VITE_BUSHIDO_HANDOFF_FROM` to `VITE_BUSHIDO_HOST` (build-time env, `app/.env`), and does
nothing when they are unset. (Linked goals from the bridge, which also matched on
`VITE_BUSHIDO_HOST`, were removed on 2026-10-25.)

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

- A logged workout notifies **exactly once, when a write marks it done**
  (`completedDailyEntries` compares against the previous state), never on re-sync, an
  edit, or a planned session's day arriving (§4), and says what was logged ("Logged. RPE
  6."), nothing more.
- Scheduled facts (readiness, unlogged workouts, the body warning) are planned once a day,
  drained on a 30s tick, and revalidated just before sending.
- **A notifier that cannot start must never stop a workout being saved.**
  Tests: `server/notify-facts.test.js`.

### 8.7 The brain file

`BUSHIDO_BRAIN_FILE`: an optional Markdown athlete profile the workout planner may read.
Read-only; nothing writes beside it any more. Absent is survivable.

---

## 9. Server API (summary)

See `docs/operations.md` for the full table. Shape to keep: `GET/PUT /api/state`,
`POST /api/entry` (upsert), `GET /api/export`, `POST /api/import`, `GET /api/content`,
`POST /api/plan/import|example|reset`, `GET/PUT /api/settings`,
`POST /api/settings/ai/test`, `GET /api/auth/me`, `POST /api/auth/password`, `GET /api/people`,
`GET/POST /api/people/:id/entry` (shared workouts and what the owner planned for someone),
`GET /api/people/:id/state|content` and `GET/PUT /api/people/:id/about` (owner only, §3),
`GET/PUT /api/about` (anyone but the owner), `for` on the planner and draft routes, the
planner, `/api/plan/drafts`, WHOOP, Strava and push routes, and `GET /api/health` (liveness; with a session,
resolved paths, `ai: { model, claude, brain }` and integration state). `/api/chat`,
`/api/coach*`, `/api/goals*` and `/api/plan/week` are gone and answer 404.

---

## 10. Why it is this way: design history worth not undoing

The app grew from a single dated climbing block into a multi-sport log, and several
large changes removed features on purpose. Each subsection is the reasoning to respect
before "improving" something back.

### 10.1 From one dated block to every sport

The original programme was eleven dated weeks with a weekday template. It was replaced,
not migrated, by a `category` on every session, a `hardFingers` question on every
finger-loading card, and the 91-activity catalog (and, until 2026-10-25, weekly quotas
and achievements; §10.8). Removed: `weeks[]`, `phases[]`, `weekTemplate`, hotspot days and
branches, trip mode, the standalone evidence index, `sched.weeks` gates (left in, they
would block sessions forever), and the template's scoring weights.

- **The catalog is content**, and gates may ask it (`when: { shape: [...] }`), so no field
  lists 91 keys.
- **Old shapes stay readable.** Entries logged against those weeks, the retired cards and
  the template still render (`optFor`, `aka`, `priorIds`); nothing migrated them.

### 10.2 The app stopped recommending

A recommender the user ignores is not one that needs tuning, so Today stopped having an
opinion (2026-09-17) and the effort went into writing a workout down and following it.
Removed from Today: the tappable quota board, companion sessions, the "why today" card,
the ranked swap list and dialog, the rest-day suggestion, per-session dismissals, the
morning coach card. `DaySessions` renders the day and routes taps; it does not rank,
offer, dismiss or explain. On 2026-10-25 the recommender itself went (§10.8); only
`lib/fingers.js` is left. `TodayTab(empty day offers nothing)` asserts the absences.

What went on: the **+** button. Removing the swap list briefly removed the only route to
every climbing card while every test passed — the origin of the reachability rule in §2.
"Pick a session" came back as that route, and went again on 2026-10-14: two doors for
"write down what I did" meant knowing which list a thing lived in, and it only ever placed
on today. The plan's cards are now folders (Bouldering, Rock climbing, by
`sched.discipline`) inside Log a workout, under Climbing after the sports catalog, and Log
a workout lands on **the day Today is showing**, never a future one, so a past climb can be
logged on its own day. `FabMenu(four doors…)` and `TodayTab(empty day offers nothing)` pin
the absence of the old door.

### 10.3 Endurance as a catalog

- The `endurance` planner group is by **intent** (Zone 2, Long & easy, Recovery, Tempo,
  Threshold, VO2, Hills, Brick, Race rehearsal), sport-agnostic; Zone 2 leads it on
  purpose and the smoke suite pins the order. Swim, Bike and Run catalogs are collapsed
  groups, each with a catch-all first. A sport-agnostic kind lets the planner pick the
  sport from the last week's log (§7).

### 10.4 The cull: fewer ways to do the same thing

Removed, each pinned absent: `FullScreenSession` (a third way to read a session),
`AdjunctPills` (unused add-ons), the sheet's "MAIN/ADDED SESSION" strap, the sheet's own
"log another" link (the + is the door; the day list's own dashed "Log another" button went
too in #41, §10.9), the footer "remove"
link (now a header bin with a confirmation), the name box in the form (now behind the
pencil), boilerplate protocols on the two container cards (now a plain notes box), lift
rest intervals, and the runner for lift-only sessions.

Added: everything folds (except the log form, which is open since #41); reorder per section; `out.notes` back as a plain notes box (same
key, so old notes read back); several measurements per session (`out.whoop` keeps the
first so every older reader stays right; extras in `*More`); a Warm-up button on unlogged
workouts; `priorIds` for history.

**The log form and the planner's editor are the same component** (`exercises.jsx`).
`liftlog.jsx` adapts the positional stored shape (index as set id) rather than migrating
history; a blank is `''` there and `null` on a prescription via one `blank` prop.
`BlockQuota` (the per-block "its own workout" control) stays in `planner.jsx`. `.exlog-*` styles stay for the climbing set log,
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

**Rest day** is a quiet button on Today's empty day (any day up to today), and **Log a
rest day** is in the + menu, both opening `RestPrompt` in `App.jsx`. It asks why (chips
from the rest card's own `why` output, plus "Notes"; both optional), has the day switcher
for a forgotten rest day, and
edits an existing rest entry rather than adding a second. `restStats` in `lib/stats.js`
shows the why on the row. Pinned by `FabMenu(four doors…)` and
`RestPrompt(asks why before logging)`.

### 10.7 Food is a separate app

Nutrition logging lives in a separate app, which reads the owner's WHOOP through
`/api/whoop/owner`. Bushido has no wire to it any more (the coach's read-only nutrition
digest went with the coach). Do not add food logging here.

### 10.8 The 2026-10-25 cut (issue #31)

Bushido became a plain workout log. Measured from the live log, the month before was
free-form workouts, rest days, planned and shared workouts with WHOOP/Strava attached, and
nothing else. Removed from the web app, the iPhone app and the server, with their routes,
prompts, notifications and tests:

- the daily **check-in** and the dormant check-in coach (`/api/chat`, `CHECKIN.md`);
- the **journal**;
- **achievements** (their tab, the Progress filter, the starter's seeds);
- **linked goals** (`/api/goals`, the goals cache, goal-pace notifications, the goals
  toggle, `VITE_BUSHIDO_LEGACY_HOSTS`);
- **quotas**, the Week tab, the quota bars and **Plan the week** (`/api/plan/week`, and
  planning someone else's week);
- the **AI coach** (its tab and bubble, threads, the coach note and its nudges, the brain
  Write grant, the nutrition digest);
- the **recommender**, except `lib/fingers.js` (§6.1).

What that means for the code that stays:

- **Stored data is never deleted.** Old `checkin-`, `journal-`, `journal-custom`,
  `quota-` and `achievement-` entries stay in `state.json` and are carried through merge,
  export and backups untouched; `coach.json`, `coach/` and `goals.json` stay in the data
  dir. Readers ignore them by `kind`. Settings keys only those features used are dropped
  from `settings.json` on the next save, as any removed setting always was.
- **Climbing follows, it does not lead.** In Log a workout the sports catalog comes first
  and the Climbing folders after it; on Progress the headline is general and the Climbing
  group is last. Both are ordered in code, because the owner's plan file is outside the
  repo and cannot be reordered from here.
- **Navigation is Today, Log, Progress** for everyone (`tabsFor`), and the + offers Log a
  workout, Log a rest day, Plan a workout and the interval timer, in that order.
- Pinned: `TodayTab(legacy entries are ignored)`, `LogTab(legacy entries are not workouts)`,
  `ProgressView(legacy entries are not workouts)`, `FabMenu(four doors…)`,
  `tabsFor(three tabs…)`, `plannerContext(…not quotas)`, the `legacy data:` steps in
  `server/http.test.js` (a data dir full of the removed features' data boots, reads back
  byte for byte through every write and export, and the removed routes answer 404),
  `progress.test.js` (climbing last, no achievement filter) and `starter.test.mjs` (no
  removed content in the starter).

---

### 10.9 Today and the session sheet, redone (#41, 2026-10-25)

The owner called the old screens atrocious. Same functions; what changed, each pinned in
the batch A section of `app/smoke.jsx`:

- **The day is Today's title** (`DaySwitcher` with `title`): "Today" / "Yesterday" / a
  date, ‹ › beside it, a quiet "Today" to come back. Not a card for two arrows.
- **One card of rows.** Name, one meta line (time · distance as typed or measured, never
  the card's estimate; what was lifted; a rest day's why), and done said once, by the
  leading icon. Pinned absent: the MAIN/ADDED pill, the second tick, the "planned" chip,
  "RPE" on the row, and the dashed "Log another workout" (the + does that).
- **The empty day** is "Nothing logged today", batch B's quick-log rows (a stub until #42
  lands), **Log a workout** as the primary, **Rest day** quiet. No paragraph; Plan a
  workout is the + menu's.
- **The sheet**: the header is the name over "Today · 29 min" (the day and the time as
  typed); the log form is always open (the "How did it go?" / "Session logged" fold is
  gone); the activity is a row that opens the picker; the card's example numbers are no
  longer placeholders (a placeholder is a guess the app made, §6.4); the footer's primary
  is **Close** (or Start, when there is something to run) with **Mark undone** / **Mark
  done** quiet beside it, and neither on a later day; the interval timer is a row at the
  foot of the body.
- **Removing** a workout closes the sheet and shows a toast with **Undo**, which writes
  the entry (and its test result) back. A failed write to someone else's copy shows one
  with **Retry**.

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
