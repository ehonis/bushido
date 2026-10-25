# Operations

How Bushido runs, where its files are, and what to do when something needs fixing.
The [README](../README.md) has the quick start; [`deploy/README.md`](../deploy/README.md)
has the systemd install; [`features.md`](features.md) describes the app itself.

## Layout

```
bushido/
  server/server.js      zero-dependency Node API + static server
  server/config.js      Settings: data/settings.json, env overrides, first-run migration
  server/auth.js        single-owner sign-in, sessions, bearer tokens
  content/starter.json  what a fresh install runs on: the catalogs, no programme
  examples/plan.json    a small invented example plan ("Use the example plan" in Settings)
  test/fixtures/        the full programme the test suites render and check against
  app/                  React source (Vite)
  dist/                 built app, served by the API
  data/state.json       your log — the only file that matters, back this up
  data/backups/         automatic state snapshot before every write (last 60 kept);
                        data/backups/plans/ holds replaced plans and is never pruned
  data/settings.json    what you set on the Settings page (0600)
  data/auth.json        the owner account and the session key (0600)
  data/plan.json        your own plan: preferred over everything but env (backed up before
                        Settings replaces or removes it)
  data/drafts/          "Write it for me" drafts, one file each (up to 8, a week at most)
  data/whoop.json       WHOOP cache: workouts + daily recovery (disposable)
  data/strava.json      Strava cache: recent rides/runs/walks + gear (disposable)
  data/strava-oauth.json        the owner's Strava grant (0600; Bushido is its only holder)
  data/strava-activities.json   the owner's full activity mirror, which Totem's goals read
```

An install older than 2026-10-25 may also have `data/coach.json`, `data/coach/` and
`data/goals.json`, left by the AI coach and linked goals (since removed). Nothing reads
them and nothing deletes them; move them out by hand if you want them gone.

`BUSHIDO_DATA_DIR` moves everything under `data/`; the Docker image puts it at `/data`.

## Service (systemd)

```
systemctl --user status bushido
systemctl --user restart bushido
journalctl --user -u bushido -f
```

Runs as a `--user` unit with lingering enabled, so it survives reboot and logout.
`ExecStart` points at `~/.local/bin/apps-node`, a stable symlink to the nvm-managed node —
**after an nvm upgrade, repoint that symlink** rather than editing the unit:

```
ln -sfn "$(readlink -f "$(which node)")" ~/.local/bin/apps-node
systemctl --user restart bushido
```

See [`deploy/README.md`](../deploy/README.md) for installing the unit.

## Rebuilding the app

```
cd app && npm run build              # writes ../dist, no service restart needed
npm run dev                                 # hot reload on :5173, proxies /api to :8099
npm test                                    # every app suite + render smoke + server suites
```

Editing the content file (`data/plan.json`, or whichever one Settings says is in
use) needs no rebuild at all — the app fetches it at runtime.
Run `npm test` after you edit it anyway: the suites check it set by set and catch a bad
property access here rather than on your phone in a basement.

## Frontend build settings

The built app reads two optional values from `app/.env` at **build** time (template:
`app/.env.example`); change one and run `npm run build` again.

| variable | what it does | unset |
|---|---|---|
| `VITE_BUSHIDO_HOST` | the hostname this app is served at; handed-over pages land here | nothing moves |
| `VITE_BUSHIDO_HANDOFF_FROM` | comma-separated retired hostnames; once a page there has synced its offline outbox it moves to `VITE_BUSHIDO_HOST` | nothing moves |

## Sign-in

One owner account. On the first start with no account, the server prints a one-time
link (`/setup?token=…`) and only that link can create it. The password is hashed with
scrypt and kept in `data/auth.json` with the key that signs session cookies; both are
`0600`. Sessions last 30 days, are httpOnly and `SameSite=Lax`, and are `Secure` when the
request arrived over https (directly or with `X-Forwarded-Proto: https`). Changing the
password or signing out signs every device out. Five wrong passwords from one address in
a minute lock that address out for a minute, and 30 from anywhere lock all sign-ins for a
minute. The address is the socket peer, or the forwarded header when
`BUSHIDO_TRUST_PROXY=1` or the peer is loopback.

**Signing out** (Settings, or the profile menu) is a page load of `/?signout=1`, handled
by the app before it loads anything (`app/src/lib/signout.js`). It freezes cache writes in
every open tab, pushes everything this device holds, and asks before deleting anything the
server does not have yet. It removes this device's push subscription (on the server by
endpoint, then in the browser; best effort, never blocking). Then it calls `POST /api/auth/logout`, which revokes every session
and sends `Clear-Site-Data: "cache"`. Only once the server confirms does it clear this
app's local storage and every cache but the app shell, and tell the other tabs, which go to
the sign-in page. If the server cannot be reached, nothing is cleared and you stay signed
in. Proxy mode has no sign-out.

Every request that changes something is refused if the browser says it came from
another site (`Sec-Fetch-Site`, or an `Origin` that is not this host, or `Origin: null`),
and JSON API routes refuse other content types with `415`. There are no CORS headers.

Scripts and other services can skip the cookie: `Authorization: Bearer <token>` with
`BUSHIDO_API_TOKEN`. That is the only bearer token: the Totem bridge secret is for Bushido
calling Totem and does not sign anything in.

`BUSHIDO_AUTH=proxy` (or `"auth": { "mode": "proxy" }` in `data/settings.json`, which
the first-start migration writes for an install that predates sign-in) turns sign-in off
entirely, for an install that sits behind
something which already authenticates every request (Cloudflare Access, an auth proxy).
In that mode anyone who can reach the port can read and overwrite the log, so do not
also expose the port directly. The environment variable wins over the file, so
`BUSHIDO_AUTH=password` forces sign-in back on. The Settings page shows the mode and
where it came from but cannot change it. In proxy mode the settings can be changed only by a request
from a loopback peer (the tunnel or proxy on this machine), not by a direct connection to
the port, and the server logs a warning at start-up if it is listening on anything but
loopback. A data directory that already has an owner account is never migrated to proxy.

Settings that name files or programs (the CLI path, the bridge `.env` file, the notify
core and the athlete profile file) are read-only on the page: set
them in the environment or in `data/settings.json`.

If you lose the password: stop the server, delete `data/auth.json`, start it, and use
the new setup link. The training log is untouched.

## More than one person

An install can hold several people's logs. The owner (whoever set it up) keeps the data
dir exactly as it was: `data/state.json`, `data/plan.json`, `data/backups/`.
Everyone else has the same files under `data/users/<id>/`, plus `about.json` (their About
you: a name and notes for their own AI runs). `data/users.json` (`0600`) lists
the people and the emails they sign in with; edit it in Settings → People.

People are told apart by **Cloudflare Access**, in proxy mode. Set the team and the
application's AUD tag (`BUSHIDO_ACCESS_TEAM`, `BUSHIDO_ACCESS_AUD`, or `access.team` /
`access.aud` in `data/settings.json`; they are read-only on the Settings page, like the
auth mode). Access then signs every request with a JWT in `Cf-Access-Jwt-Assertion`; the
server verifies it against the team's public keys and looks the email up:

| The request carries | It is |
|---|---|
| a valid token for a listed email | that person |
| a valid token for an email nobody has | refused, `403` |
| a token that does not verify | refused, `403` |
| no token (the box itself, the tailnet) | the owner, as plain proxy mode always was |

Add each person's email to the Access application's policy as well, or Cloudflare will
not let them reach the server at all. With built-in sign-in there is one account, the owner.

**The owner can act as anyone** (profile → Settings → People → *Log for …*). That sets a
12-hour `bushido_as` cookie, honoured only for the owner, and the app reloads into that
person's log with a banner saying whose it is. Each person's log is cached on a device
under its own key, and every API call from the app says whose log it holds
(`X-Bushido-User`); if the server is answering for someone else it refuses with `409` and
`X-Bushido-Auth: switched`, and the app reloads. One person's cached log can never be
merged into another's.

For anyone but the owner: Settings are refused; WHOOP, habit sync and notifications
are off, because they hold the owner's accounts. Strava is everyone's own:
each person, the owner included, connects their account in profile → Settings → *Connect
Strava*, which needs a Strava API app in Settings → *Strava*. A new Strava app accepts only
its creator until it is raised to ten athletes at strava.com/settings/api, and its
Authorization Callback Domain must cover the host people open Bushido on. A person's grant is
`strava-oauth.json` and their cache `strava.json`, in their space (the data dir for the owner,
`data/users/<id>/` for anyone else); the plan is their own
`data/users/<id>/plan.json` if one was imported while acting as them, else the starter.
Removing someone in Settings stops them getting in and leaves their folder on disk.

**Everyone gets the workout planner** once a Claude CLI is configured (Plan a workout →
*Write it for me*). Each run is built from that person's own space only: their log, plan and
About you (profile → You → *About you*; the owner's stays in Settings). Their runs get
`--add-dir` for `data/users/<id>/` alone, and are denied by rule from reading anything else
in the data dir (the owner's `state.json`, caches, backups, `users.json`, and an older
install's coach files and goals cache) and every other person's folder. The owner's brain
file and its notebook and the WHOOP/Strava files are not given to them and are denied by
path; their prompts have no section for any of them, exactly like an install that never
configured them. Without a CLI nothing changes for them: no "Write it for me".

**The owner as trainer.** Without acting as anyone, the owner can:

- plan a workout FOR someone (the "For: You / Sam" choice at the top of Plan a workout,
  shown only to the owner, only with more than one person, never while acting). The model
  run uses that person's log, plan and About you. Keeping it writes into their log: a
  planned session lands as an ordinary entry, `done: false` (done from its day on), with the same derivable id
  their own + would have given it and `data.plannedBy: { id, name }` stamped by the server.
  They see "planned by <owner>" on Today, the sheet and the feed, and
  can edit, log or delete it like anything else.
- open "Sam's day" from Today: their week, read-only, each session openable to log it, mark
  it done or start it from their side. Their About you can be edited there too.
- run a shared workout from every side: the runner and workout mode get a You / <name>
  switcher with the name and colour in the header. Each side is that person's own entry with
  its own sets, weights, rest clock, done state and writer; the owner's goes through the
  owner's store, theirs through `/api/people/<id>/entry`. Only the side on screen makes a sound.
- a shared workout's exercises: "Sync exercises with <name>" is on when someone is added.
  While it is on, adding, removing, renaming or reordering exercises, or changing how many
  sets one has, on either side shows up on the other; the server does the merge, so it works
  from the other person's own phone too. Numbers never cross: their reps, weights and marks
  are their own, and anything that arrives is blank. With it off, each side stays as it is
  and "Copy my exercises to …" under their side brings over anything the owner added since.
  Their side shows their own last time for every exercise, and the You / <name> bar stays at
  the top of the sheet. Their side of a planned session shows their plan and can start the
  shared runner on their side.

## API

Every route below needs a session cookie, a bearer token, or `BUSHIDO_AUTH=proxy`.
Signed out, `/api/*` answers `401` with `X-Bushido-Auth: login` and pages redirect to
`/login` (or `/setup` before there is an owner). Built assets are public.

| | |
|---|---|
| `GET /setup?token=` · `POST /setup` | first-run owner account, from the link the server prints |
| `GET /login` · `POST /login` · `POST /logout` | sign in and out |
| `POST /api/auth/session` | `{ username, password }` → `{ session, user }`: sign-in for the native app, which sends `session` as `Authorization: Bearer` |
| `GET /settings` | the Settings page |
| `GET /api/health` | liveness; with a session, also entry count, resolved paths and integration state |
| `GET /api/auth/me` · `POST /api/auth/password` | who is signed in, whose log this is and what it offers; change the password |
| `POST /api/act-as` | `{ id }` — the owner acts as someone (`null`: back to themselves) |
| `GET`/`POST`/`PUT /api/settings/users` · `DELETE /api/settings/users/<id>` | the people on this install (owner only) |
| `GET /api/people` · `GET /api/people/<id>/entry?id=…` or `?date=…` · `POST /api/people/<id>/entry` | the owner reads and writes someone else's copy of a shared workout, or a session the owner planned for them (`daily-…`). Owner only, not while acting as someone, never the owner's own log, and only entries carrying `data.sharedFrom` or `data.plannedBy` (both stamped by the server); anything they logged or set themselves is `409 not-shared` |
| `GET /api/people/<id>/state` · `GET /api/people/<id>/content` | their log and the plan their app runs on, read-only (owner only, not while acting) |
| `GET`/`PUT /api/people/<id>/about` | their About you, `{ name, notes }` (owner only, not while acting) |
| `GET`/`PUT /api/about` | your own About you, for anyone but the owner (whose is in Settings; `PUT` from the owner is `409 settings`) |
| `GET /api/settings` · `PUT /api/settings` | the settings, secrets masked; a partial update |
| `POST /api/settings/ai/test` | one tiny request through the configured CLI |
| `GET /api/content` | the content file in use (see Settings → Training plan) |
| `POST /api/plan/import` · `/api/plan/example` · `/api/plan/reset` | import a plan, copy the example, back to the starter |
| `POST /api/plan/workout` | `{ kinds, minutes, goal, for? }` → a workout with the sets written in; one model run, stored nowhere |
| `POST /api/plan/revise` | `{ plan, message, thread, for? }` → the same workout, changed; stored nowhere |
| `GET`/`POST /api/plan/drafts` | this person's AI workout drafts; `{ picked, minutes, goal, context, for? }` starts one, answering at once with it still working |
| `GET`/`PUT`/`DELETE /api/plan/drafts/<id>` | one draft; `PUT { pres }` saves edits; `DELETE` discards (and stops its run) |
| `POST /api/plan/drafts/<id>/revise` · `…/retry` | `{ message, pres? }` revises on the draft; retry re-runs a failed turn |
| `POST /api/plan/drafts/<id>/keep` | claim it before placing (`409`/`404` with `code: "kept"` when another device kept it); `{ release: true }` hands it back. A draft whose id is on an entry (`data.plan.draftId`) is deleted |
| `GET /api/whoop` · `POST /api/whoop/pull` | the WHOOP cache, and a refetch (`configured: false` until the owner connects WHOOP) |
| `POST /api/whoop/connect` · `GET /whoop/callback` · `POST /api/whoop/disconnect` | connect or drop the owner's WHOOP (owner only; `409` while acting as someone) |
| `POST /api/whoop/owner` | `{ method, args }` on the owner's WHOOP client (`status`, `training`, `sleepNights`): how Totem and Krakatoa read WHOOP (owner only) |
| `GET /api/strava` · `POST /api/strava/pull` | the Strava cache (activities, gear, athlete), and a refetch |
| `GET /api/strava/activity?id=` | one activity in full (laps, splits, calories) — fetched when you attach it |
| `POST /api/strava/connect` · `GET /strava/callback` · `POST /api/strava/disconnect` | connect or drop your own Strava (`409` while acting as someone) |
| `POST /api/strava/owner` | `{ method, args }` on the owner's Strava client: how Totem reads Strava (owner only) |
| `/api/push/*` | push subscriptions, when a notify core is configured |
| `GET /api/state` | `{ version, updatedAt, state }` |
| `PUT /api/state` | `{ state }` — merged with disk, returns merged doc |
| `POST /api/entry` | `{ entry }` — upsert one entry |
| `GET /api/export` | download the whole log as JSON |
| `POST /api/import` | replace the log from an export |

`for` (a person's id) on the planner and draft routes is the owner planning for someone else: the
run uses their space. Owner only (`403`), not while acting as someone else (`409 acting`),
never the owner's own id.

`GET /api/health` with a session reports, besides the entry count and resolved paths,
`ai: { model, claude, brain }` (the planner's model, whether a CLI was found, whether the
brain file exists), `totem`, `notify`, `whoop` and `strava`.

Every route that reads or writes a log or a plan does so for the person the
request is for (see *More than one person*). AI routes answer `503` with
`code: "ai-not-configured"` when no CLI is found, or for someone the AI is not set up for.

## How sync works

Writes are **last-write-wins per entry id**, using each entry's own `updatedAt`. The client
runs the identical merge locally, so the two never disagree.

In practice: log a set on your phone in the basement with no signal, log another on the
laptop, and both survive. The client caches to `localStorage` and retries when the box comes
back. Deletes are tombstones, so a delete on one device isn't resurrected by a stale write
from the other.

The only way to lose data is editing *the same entry* on both devices while offline — then
the later edit wins.

## Backups

Every write snapshots the previous state to `data/backups/` first. To roll back:

```
cp data/backups/state-<stamp>-v<n>.json data/state.json
systemctl --user restart bushido
```

## Phone / home screen

The app is built mobile-first: the tab bar sits at the **bottom** on phones (thumb
reach, one-handed, chalky fingers), inputs are 16px so iOS doesn't zoom the viewport
every time you type a number, and safe-area insets are respected so nothing hides under
the home indicator. Charts respond to taps, not just hover.

**Add to Home Screen** works today over `http://<tailnet-ip>:8099/` on iOS — you get a
standalone app with its own icon, no browser chrome.

**For offline support you need HTTPS.** Service workers only register in a secure
context, so over the plain-http tailnet IP the app skips it silently. To enable it,
serve the app over the tailnet's HTTPS name (one-time, needs sudo):

```
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8099
```

Then use **https://<machine>.<tailnet>.ts.net:8443/** instead. That gets you the
offline app shell, instant loads, and an installable app on Android too. This is additive:
other `tailscale serve` mappings on the machine are left alone.
To undo: `sudo tailscale serve --https=8443 off`.

The service worker never serves `/api/state` from cache. A stale training log that looks
live is worse than an honest failure, and the client already has its own offline cache
and outbox for that case.

## Totem habit sync

Optional, and off unless a Totem bridge is configured (Settings → Integrations, or
`BUSHIDO_TOTEM_URL`). Totem is a separate personal-assistant app; its bridge has a habits
API, and it reads the owner's Strava and WHOOP from Bushido. Logging a daily session pushes it there so the
streak shows up too:

```
POST http://127.0.0.1:8787/api/habits/log
{ id: "move-every-day", date, count, note }
```

**No Totem code was changed** — it already had a habits API and the habit itself
(`move-every-day`, renamed from `hangboard-climbing` on 2026-08-07 when its scope widened
to any real workout). Bushido is just a writer into it.

- The bridge secret comes from Settings, `BRIDGE_SECRET`, or the bridge's own `.env`
  file (`BUSHIDO_TOTEM_ENV`). It never reaches the browser.
- Fire-and-forget: if Totem is down, your training log still saves. Sync state is visible
  at `GET /api/health` under `totem.lastSync`.
- **Every session marks it except rest.** The habit is "Move Every Day" — climbing, hangboard,
  a lift, a run, a bike ride all count, including the free-form *Other training* card. Rest days
  log `count: 0`, not 1: counting a deliberate rest day as movement would put false data in a
  series kept since July. Change a day to rest and it zeroes out there too.
- Override with `BUSHIDO_TOTEM_URL`, `BUSHIDO_TOTEM_HABIT`, `BUSHIDO_TOTEM_ENV`, or untick *Mark the daily habit* in Settings.

## The removed coach

The AI coach, its daily coach note (`data/coach.json`) and the dormant check-in coach were
removed on 2026-10-25. Their files are left where they are and nothing reads them.

There used to be a 04:40 systemd timer (`coach/run.sh`) that ran a headless Opus session
and could edit the plan file behind a validate-test-revert gate. It's gone, along
with the button that started it by hand: the plan is now edited by hand and reviewed in a
diff. If you're upgrading a box that had it installed:

```
# boxes installed before the 2026-10-02 rename have it as rung-coach.*
systemctl --user disable --now rung-coach.timer rung-coach.service
systemctl --user disable --now bushido-coach.timer bushido-coach.service
rm -f ~/.config/systemd/user/{rung,bushido}-coach.{service,timer}
```
