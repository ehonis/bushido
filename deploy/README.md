# Deploy

Runs as a systemd `--user` service so it survives reboot and logout
(`loginctl enable-linger` must be on).

The unit expects the checkout at `~/bushido`. Settings that belong in the environment
(see [`.env.example`](../.env.example)) go in `~/bushido/.env`, which the unit loads if it
exists.

```bash
cd ~/bushido && npm install && npm run build     # app dependencies + the built app
cp deploy/bushido.service ~/.config/systemd/user/
ln -sfn "$(readlink -f "$(which node)")" ~/.local/bin/apps-node   # stable node path
systemctl --user daemon-reload
systemctl --user enable --now bushido
journalctl --user -u bushido | grep setup        # the one-time link to create the owner
```

This unit is the only one the app needs. Nothing else in this repo installs a timer.

Upgrading a box that still runs the app as `rung.service` (the name before the
2026-10-02 rename): both units bind port 8099, so the old one has to be stopped
and disabled *before* the new one starts, or Bushido fails to listen and the
old checkout keeps serving. The old unit also pointed at `~/.local/bin/rung-node`,
which the `apps-node` symlink above replaces.

```bash
systemctl --user disable --now rung.service
rm -f ~/.config/systemd/user/rung.service ~/.local/bin/rung-node
cp deploy/bushido.service ~/.config/systemd/user/
ln -sfn "$(readlink -f "$(which node)")" ~/.local/bin/apps-node
systemctl --user daemon-reload
systemctl --user enable --now bushido
cd app && npm ci && npm run build
```

`ExecStart` points at `~/.local/bin/apps-node` rather than `node` because node
is nvm-managed and nvm is not on systemd's PATH. After an nvm upgrade, repoint
that symlink instead of editing the unit.

Sign-in is on by default: one owner account, created from the setup link above. An
install that sits behind something that already authenticates every request (Cloudflare
Access, an auth proxy) can turn it off with `BUSHIDO_AUTH=proxy` in `~/bushido/.env` —
in that mode anyone who can reach port 8099 can read and overwrite the log, so the port
itself must not be reachable from anywhere you do not trust. See
[`docs/operations.md`](../docs/operations.md#sign-in).

### Upgrading an install that predates sign-in and Settings

**1. Keep your plan.** The plan used to be the tracked `content/plan.json`, which this
version deletes. The app now reads your own plan from `data/plan.json` (untracked) before
anything else. Copy it there before pulling:

```bash
cd ~/bushido && test -e data/plan.json || cp content/plan.json data/plan.json
```

If you already pulled, the file is gone from the checkout but still in git. Restore it
from the commit you were on before the pull:

```bash
cd ~/bushido && test -e data/plan.json || git show 'HEAD@{1}:content/plan.json' > data/plan.json
```

(`HEAD@{1}` is where the branch pointed before the pull; `git reflog` shows it if you
have moved since.) The server warns at start-up when an upgraded install is running on
the starter for lack of a plan.

**2. Pull and restart.** On its first start the new code finds the existing
`data/state.json`, no `data/settings.json` and no `data/auth.json`, and writes a settings
file that differs from a fresh install in exactly two ways:

- `"auth": { "mode": "proxy" }`: the old version had no login, so an upgraded install
  keeps working with no account and no env change. To turn sign-in on later, set
  `BUSHIDO_AUTH=password` (the environment beats the file) or remove `auth.mode` from
  `data/settings.json`, restart, and use the setup link the server prints.
- If `content/plan.json` is somehow still in the checkout and `data/plan.json` is not, it
  is copied across. After a `git pull` it never is, which is why step 1 exists.

It logs what it did. Nothing in the training log changes.

**3. Turn back on what you used.** Everything else starts off, exactly as on a fresh
install: the Totem bridge (and with it WHOOP, Strava, goals and the habit sync), the
notification core, the athlete profile file, the food-log digest, the timezone and
*About you*. Set the ones you had in Settings, or write them into `data/settings.json`
before the first start; a `settings.json` that already exists is never migrated or
overwritten.

**4. Set the frontend's build-time hosts, then rebuild.** The app no longer ships any
hostname. If goals in Totem link to this app, or the app used to live at another
hostname, put them in `app/.env` (template: `app/.env.example`) and rebuild with
`cd app && npm run build`:

```bash
VITE_BUSHIDO_HOST=bushido.example.com              # the hostname the app is served at
VITE_BUSHIDO_LEGACY_HOSTS=old-name.example.com     # older hostnames goal links may still use
VITE_BUSHIDO_HANDOFF_FROM=old-name.example.com     # retired hostnames that hand pages over to VITE_BUSHIDO_HOST
```

All three are optional. Without `VITE_BUSHIDO_HOST`, goals are matched against the host the
page is opened at; without the other two, old links are not matched and nothing is handed
over. They are read at build time, so a change needs a rebuild, not a restart.

## The coach

The AI features — the coach (`POST /api/coach/chat`), the workout planner
(`/api/plan/workout`, `/api/plan/revise`) and the week planner (`/api/plan/week`) — each
run one headless `claude` from inside `bushido.service`. They need the Claude Code CLI,
signed in as the user the service runs as, or an API key (Settings → AI, or
`ANTHROPIC_API_KEY`). The CLI is found at `CLAUDE_BIN`, then `~/.local/bin/claude`, then
on `PATH`; without one, those routes answer "set up AI in Settings" and nothing else is
affected.

What each run may do is set by flags in the spawn, not by the prompt:

| run | tools | can write |
|---|---|---|
| coach | `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`; `Bash`, `Edit`, `NotebookEdit`, `Task` denied | only files beside the brain file, and only when one is configured |
| workout and week planners | `Read`, `Grep`, `Glob`; everything else denied | nothing |

None of them can write `data/state.json` or the plan file. Sessions the coach suggests are
offers the app draws as cards; nothing lands on the day until you tap one.

| variable | default | |
|---|---|---|
| `BUSHIDO_COACH_MODEL`, `BUSHIDO_PLANNER_MODEL` | Settings → AI → Model, else `claude-sonnet-5` | |
| `BUSHIDO_COACH_EFFORT` | `medium` | |
| `BUSHIDO_PLANNER_EFFORT`, `BUSHIDO_WEEK_EFFORT` | `low` | measured: a quarter of the latency of the CLI default for a reply no worse |
| `BUSHIDO_COACH_TIMEOUT_MS` | `180000` | the run is killed at this point and the card says so |
| `BUSHIDO_BRAIN_FILE` | off (Settings → Other local services) | an athlete profile in Markdown. Absent is survivable — the AI is simply told less |

Each turn is a real model call billed to whichever account the CLI is signed in with.
Nothing else in the app costs anything; `GET /api/health` shows the last coach turn.

There used to be a second coach: a 04:40 systemd timer running `coach/run.sh`, a
headless Opus session that could edit the plan behind a validate-test-revert gate, plus a
button in the app that started the same script. Both are gone. If a box still has the
unit installed — as `rung-coach.*` on anything set up before the 2026-10-02 rename, or
`bushido-coach.*` if it was installed under the new name — remove it under whichever name
it has:

```bash
systemctl --user disable --now rung-coach.timer rung-coach.service
systemctl --user disable --now bushido-coach.timer bushido-coach.service
rm -f ~/.config/systemd/user/{rung,bushido}-coach.{service,timer}
systemctl --user daemon-reload
```
