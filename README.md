# Bushido

Bushido is a self-hosted health and training log for someone training several sports at
once. Instead of a calendar of planned days, each week has **quotas**, a count of workouts
per category from Monday to Sunday ("3 bike, 2 run, 1 lift"). You fill them in whatever
order the week allows, and anything left on Sunday expires instead of carrying over as
debt. It logs 91 kinds of activity, each with a form that fits it, and keeps a lift log
backed by a 207-movement exercise catalog. It can read WHOOP recovery and Strava
activities. An optional AI coach and workout planner run on the Claude Code CLI. It is a
phone-first installable web app, served by a Node server with no npm dependencies and
backed by a single JSON file.

It started as one person's tool, built for training toward a 5.12a climbing redpoint and
a half Ironman at the same time. Neither goal fits a fixed weekly schedule, and a missed
Thursday shouldn't cost the session, only move it.

> **A personal project.** Bushido was built for one user and is used daily by one user.
> It is single-owner by design (one account per install), and the full climbing and
> triathlon programme it was built around lives on as the test fixture. The AI prompts carry no personal details: they use the name and notes you
> enter in Settings. WHOOP and Strava are
> read through a separate bridge service that is not part of this repository (see
> [Integrations](#integrations)). It is published as a working example rather than a
> supported product.

## Features

- **Weekly quotas.** Set them on the Week tab, which pre-fills from last week. The Today
  tab shows one bar per category, done against asked-for, and pressing a bar lists the
  sessions behind it. Workouts you have planned but not yet done show as a dotted segment
  and never count as progress.
- **Achievements.** The standing goals you are training for. Each one owns a set of
  quota categories. You create, edit and date them in the app.
- **Log any workout.** A searchable catalog of 91 activities with pinned quick-picks. The
  form follows the activity: distance, pace and elevation or incline for a run or ride,
  yards and per-100 pace for a swim, the exercise chooser for a lift, time and effort for
  everything else.
- **Lifts.** Sets, reps and load per movement. Every movement shows a front-and-back body
  diagram of the muscles it works, and what you lifted last time shows while you pick the
  weight.
- **Plan a workout.** Pick one or more kinds (legs, then core, then a short ride), a time
  budget and a goal. An agent reads your log and recovery and writes every set, load and
  rest. You can edit everything, revise it by chatting ("make it shorter"), or skip the
  AI and build it yourself. Nothing is stored until you keep it.
- **Plan the week.** The same idea for quotas: the agent compares what you set against
  what you did over recent weeks and proposes the week's counts.
- **Workout runner.** One set per screen, pre-filled numbers, and rest that starts
  itself. Deadlines are stored as absolute times, so closing the app mid-rest or picking
  up on another device lands on the right second.
- **AI coach.** Threaded conversations with read-only tools over your log, the content
  file and the web. It can offer sessions as cards, but nothing goes on your day until
  you tap one.
- **WHOOP and Strava.** Unlogged workouts are offered as one-tap cards with time and
  distance filled in. The same ride recorded by both services becomes one entry. Recovery,
  HRV and resting heart rate are read against your own two-week baseline, last night's
  sleep (time asleep against what was needed, stages, bedtime and wake) sits beside them
  with a two-week strip, and Strava bikes and shoes arrive with their odometers.
- **Gear.** Bikes and shoes come from Strava. Ropes, shoes, plates and boards you add
  yourself, and their use is counted from your log in miles, hours or reps.
- **Journal.** 42 optional behaviours (sleep, intake, state), plus your own, compared
  against the next morning's recovery.
- **Progress.** Charts filtered by achievement, category, sport or lift, over 4 weeks to
  all time, showing only what you have actually logged.
- **Offline-first sync.** Every device keeps a local cache and an outbox. Writes merge
  last-write-wins per entry, deletes are tombstones, and every write snapshots the
  previous state to `data/backups/`.
- **Two safety rules enforced in code.** For finger-intensive climbing: no hard finger
  day the day after another, and no more than three a week. The rest of the scheduling
  advice only advises.

## How it is built

```
phone / laptop (installable PWA)
  React 19 + Vite, localStorage cache and outbox
        │  HTTP, session cookie
        ▼
server/server.js  ── Node 22, no npm dependencies ─────────────────────────┐
  sign-in, Settings, JSON API, serves the built app                       │
        │                │                  │                             │
        ▼                ▼                  ▼                             ▼
  data/state.json   content/*.json   claude CLI (headless)        Totem bridge (optional)
  + 60 backups      catalog, quotas  coach and planners,          WHOOP, Strava, goals,
                    sessions         structured output,           habit sync
                                     tool allow/deny lists
```

- **Frontend** (`app/`): React 19 and Vite 7, `lucide-react` icons, `react-body-highlighter`
  for the muscle diagrams (with data matched from the public-domain `free-exercise-db`).
  Mobile-first: bottom tab bar, 16px inputs, safe-area insets, and a service worker that
  caches the app shell but never the training log.
- **Server** (`server/`): plain Node `http`, `fs` and `crypto`. One JSON document, written
  atomically behind a write lock. Model runs are spawned as `claude --print` with a JSON
  schema for the reply and explicit tool allow/deny lists.
- **Content** (`content/`, `examples/`): the activity and lift catalogs, quota categories,
  session cards and recommender weights are JSON, fetched at runtime, so changing them
  needs no rebuild.
- **Tests**: dependency-free Node scripts with `assert`, a server-side render of every
  tab against real content, an end-to-end test that boots the server and drives setup,
  sign-in and the defaults, and a palette check for contrast and colour-blind separation
  of the chart colours.

## Quick start

Requirements: **Node.js 22 or newer** and npm. Optional: the
[Claude Code CLI](https://docs.claude.com/en/docs/claude-code/overview) for the AI
features.

```bash
git clone https://github.com/ehonis/bushido.git
cd bushido
npm install      # installs the app's dependencies
npm start        # builds the app on first run, then serves it on port 8099
```

1. The server prints a one-time setup link:

   ```
   [bushido] No owner account yet. Open this one-time link to create it:
   [bushido]   http://localhost:8099/setup?token=…
   ```

   Open it, pick a username and a password (8 or more characters). You are signed in
   and taken to **Settings**.
2. **AI (optional).** Install the Claude Code CLI and sign in to it once in a terminal
   as the same user that runs Bushido, or paste an Anthropic API key in Settings → AI.
   Press **Test**. Without AI the app works and the AI features say they need setting up.
3. **About you (optional).** Write what the coach and planners should know: goals,
   injuries, equipment.
4. Open the app. Add an achievement on the **Achievements** tab, set the week on the
   **Week** tab, and log a workout with the **+** button.

A fresh install starts on `content/starter.json`, which has the catalogs and no
programme. To see a filled-in plan, use Settings → Training plan → **Use the example
plan**: a small invented one, with two achievements, four session cards and a benchmark
test. `test/fixtures/plan.json` is the full programme the test suites run against, and
it is also a valid plan to import.

Change the port with `BUSHIDO_PORT`, the data directory with `BUSHIDO_DATA_DIR`. Every
setting is listed in [`.env.example`](.env.example).

### Docker

```bash
docker compose up -d
docker compose logs bushido | grep setup     # the one-time setup link
```

Data lives in the `bushido-data` volume at `/data`. The image does not include the
Claude Code CLI, so the AI features stay off unless you add it.

### On a phone

Open the app's address and use **Add to Home Screen**. Offline support needs https,
because service workers only register in a secure context. Put Bushido behind a reverse
proxy with TLS, or run `tailscale serve`. If that proxy already authenticates every
request (Cloudflare Access, for example), set `BUSHIDO_AUTH=proxy` to turn off the
built-in sign-in.

### Running it as a service

[`deploy/`](deploy/) has a systemd user unit and its install steps.

## Integrations

| | how | default |
|---|---|---|
| AI coach, workout and week planners | Claude Code CLI, spawned headless | on if a CLI is found |
| WHOOP, Strava, linked goals, habit sync | through a **Totem bridge**, a separate HTTP service that holds the OAuth grants | off |
| Push notifications | a notification core loaded by path | off |
| Athlete profile, food-log digest | files the AI may read | off |

Bushido stores no WHOOP or Strava credentials and has no direct OAuth connection to
either. Both are read from a bridge that exposes `/api/whoop/training` and
`/api/strava/training`. Totem, the author's personal-assistant app, is that bridge, and it
is not in this repository. Without a bridge the WHOOP and Strava panels stay hidden.

## Development

```bash
npm start                # the server on :8099 (run it alongside the dev server)
npm run dev              # Vite on :5173 with hot reload; proxies /api and sign-in to :8099
npm test                 # app suites, the render smoke test, then the server suites
```

Editing the content file needs no rebuild. Run `npm test` after editing it anyway,
because the suites check every session against the code.

## Documentation

- [`docs/features.md`](docs/features.md): each part of the app and why it works the way it does
- [`docs/operations.md`](docs/operations.md): files, sign-in, the full API, sync, backups, phone setup
- [`deploy/README.md`](deploy/README.md): the systemd unit, upgrading an older install, the coach's permissions
- [`AGENTS.md`](AGENTS.md): working notes for people and AI agents changing the code

The app was renamed three times as its scope grew: rung, then Endurcrux (2026-09-14),
then Pulse (2026-09-15), then Bushido (2026-10-02).

## License

[MIT](LICENSE) © 2026 Ethan Honis
