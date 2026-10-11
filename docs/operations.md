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
  data/coach/           the AI coach's conversations, one file each
  data/whoop.json       WHOOP cache: workouts + daily recovery (disposable)
  data/strava.json      Strava cache: recent rides/runs/walks + gear (disposable)
```

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
npm test                                    # recommender + quotas + workout + coach + lifts + render smoke
```

Editing the content file (`data/plan.json`, or whichever one Settings says is in
use) needs no rebuild at all — the app fetches it at runtime.
Run `npm test` after you edit it anyway: the suites check it set by set and catch a bad
property access here rather than on your phone in a basement.

## Frontend build settings

The built app reads three optional values from `app/.env` at **build** time (template:
`app/.env.example`); change one and run `npm run build` again.

| variable | what it does | unset |
|---|---|---|
| `VITE_BUSHIDO_HOST` | the hostname this app is served at; Totem goals linking to it show on Today, and handed-over pages land here | goals match the host the page is open at |
| `VITE_BUSHIDO_LEGACY_HOSTS` | comma-separated older hostnames that stored goal links may still use | old links are not matched |
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
core, the athlete profile file and the food-log directory) are read-only on the page: set
them in the environment or in `data/settings.json`.

If you lose the password: stop the server, delete `data/auth.json`, start it, and use
the new setup link. The training log is untouched.

## More than one person

An install can hold several people's logs. The owner (whoever set it up) keeps the data
dir exactly as it was: `data/state.json`, `data/plan.json`, `data/coach/`, `data/backups/`.
Everyone else has the same files under `data/users/<id>/`. `data/users.json` (`0600`) lists
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

For anyone but the owner: Settings are refused; the AI coach and planners are off (the
Coach tab and "Write it for me" are not shown); WHOOP, Strava, linked goals, habit sync and
notifications are off, because they hold the owner's accounts; the plan is their own
`data/users/<id>/plan.json` if one was imported while acting as them, else the starter.
Removing someone in Settings stops them getting in and leaves their folder on disk.

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
| `GET /api/settings` · `PUT /api/settings` | the settings, secrets masked; a partial update |
| `POST /api/settings/ai/test` | one tiny request through the configured CLI |
| `GET /api/content` | the content file in use (see Settings → Training plan) |
| `POST /api/plan/import` · `/api/plan/example` · `/api/plan/reset` | import a plan, copy the example, back to the starter |
| `GET /api/coach` | today's coach note — 404 until there is one, which is normal |
| `GET /api/coach/threads` · `GET`/`DELETE /api/coach/thread/<id>` | the AI coach's conversations |
| `POST /api/coach/chat` | `{ message, threadId?, context? }` → one coach turn; one model run |
| `POST /api/plan/workout` | `{ kinds, minutes, goal }` → a workout with the sets written in; one model run, stored nowhere |
| `POST /api/plan/revise` | `{ plan, message, thread }` → the same workout, changed; stored nowhere |
| `POST /api/plan/week` | `{ monday, counts, message, thread }` → the week's quotas, proposed; stored nowhere |
| `GET /api/whoop` · `POST /api/whoop/pull` | the WHOOP cache, and a refetch through the bridge (`configured: false` without one) |
| `GET /api/strava` · `POST /api/strava/pull` | the Strava cache (activities, gear, athlete), and a refetch |
| `GET /api/strava/activity?id=` | one activity in full (laps, splits, calories) — fetched when you attach it |
| `GET /api/goals` · `POST /api/goals/pull` | Totem goals linked to this app |
| `/api/push/*` | push subscriptions, when a notify core is configured |
| `GET /api/state` | `{ version, updatedAt, state }` |
| `PUT /api/state` | `{ state }` — merged with disk, returns merged doc |
| `POST /api/entry` | `{ entry }` — upsert one entry |
| `GET /api/export` | download the whole log as JSON |
| `POST /api/import` | replace the log from an export |

Every route that reads or writes a log, a plan or coach files does so for the person the
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
`BUSHIDO_TOTEM_URL`). Totem is a separate personal-assistant app; its bridge holds the
WHOOP and Strava grants and a habits API. Logging a daily session pushes it there so the
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

## The coach note

`data/coach.json` is one document per day: a headline, what the coach read in your week,
capped nudges, and flags. The app shows it as its own card on Today.

It is written on the way out of a check-in and nowhere else — there is no scheduled run
any more, and nothing writes it in the background. Talk to the coach and there is a note;
don't and the app behaves exactly as it did before the coach existed. Advice is dated, so
a note written for Monday can never quietly steer Tuesday.

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
