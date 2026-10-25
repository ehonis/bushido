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

## Deploying every merge (optional)

`.github/workflows/deploy.yml` deploys `main` after CI passes on it. It runs on a
[self-hosted GitHub Actions runner](https://docs.github.com/actions/hosting-your-own-runners)
on the machine that serves the app, so nothing has to reach that machine from outside.
Each deploy:

1. stops if the live checkout has uncommitted changes to tracked files or is not on `main`;
2. fast-forwards it to `origin/main` (nothing new, nothing done), runs `npm ci` only if a
   `package.json` or lockfile changed, and builds;
3. restarts the service (`launchctl kickstart -k` on macOS,
   `systemctl --user restart` on Linux), then waits up to a minute for the health URL;
4. if the build, the restart or the health check fails, resets to the commit it started
   from, builds that and restarts again.

When the iPhone app changed (`mobile/`, `app/src/lib/`, `server/whoop.js` or `server/strava.js`), a second job ships it. It publishes an over-the-air
update to the `production` channel; installed builds take it only when their native code
matches (the runtime version is a fingerprint). When no App Store build has that
fingerprint yet, it also starts one with `--auto-submit`, so it lands in TestFlight.

It does nothing until the repository is told where the install is:

```bash
# On the serving machine, as the user the service runs as: a runner for this repository
# with the label the workflow asks for (Settings → Actions → Runners → New self-hosted
# runner gives the download and the token).
./config.sh --url https://github.com/<you>/<repo> --token <token> --labels bushido-deploy --no-default-labels
./svc.sh install && ./svc.sh start
# Give it the PATH npm needs, in .env beside config.sh, e.g.:
#   PATH=/opt/homebrew/opt/node/bin:/opt/homebrew/bin:/usr/bin:/bin

# Repository variables (Settings → Secrets and variables → Actions):
gh variable set DEPLOY_DIR -b /path/to/the/live/checkout
gh variable set DEPLOY_SERVICE -b bushido            # the launchd label or systemd unit
gh variable set DEPLOY_HEALTH_URL -b http://127.0.0.1:8099/api/health   # the default

# Optional, for the iPhone app:
gh variable set EAS_PROJECT_ID -b <project id>       # what mobile/app.local.json holds
gh variable set IOS_BUNDLE_ID -b <bundle id>
gh secret set EXPO_TOKEN                             # an Expo access token
```

Run one by hand from the Actions tab (Deploy → Run workflow) or with
`gh workflow run deploy.yml`. Only people who can push to the repository can trigger it, so
use it on a private repository you control: a self-hosted runner runs whatever a workflow
on that repository asks of it.

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
install: the Totem bridge (the habit sync), the Strava and WHOOP apps, the
notification core, the athlete profile file, the timezone and *About you*. Set the ones you had in Settings, or write them into `data/settings.json`
before the first start; a `settings.json` that already exists is never migrated or
overwritten.

**4. Set the frontend's build-time hosts, then rebuild.** The app no longer ships any
hostname. If the app used to live at another hostname, put both in `app/.env` (template:
`app/.env.example`) and rebuild with `cd app && npm run build`:

```bash
VITE_BUSHIDO_HOST=bushido.example.com              # the hostname the app is served at
VITE_BUSHIDO_HANDOFF_FROM=old-name.example.com     # retired hostnames that hand pages over to VITE_BUSHIDO_HOST
```

Both are optional; without them nothing is handed over. They are read at build time, so a
change needs a rebuild, not a restart.

## The workout planner

The one AI feature, *Plan a workout → Write it for me* (`/api/plan/workout`,
`/api/plan/revise`), runs one headless `claude` from inside `bushido.service`. It needs the
Claude Code CLI, signed in as the user the service runs as, or an API key (Settings → AI, or
`ANTHROPIC_API_KEY`). The CLI is found at `CLAUDE_BIN`, then `~/.local/bin/claude`, then on
`PATH`; without one, those routes answer "set up AI in Settings" and nothing else is
affected. *Build it myself* needs no AI at all.

What the run may do is set by flags in the spawn, not by the prompt: `Read`, `Grep`,
`Glob`, and everything else denied. It cannot write anything, including `data/state.json`
and the plan file; what it returns is a proposal that lands on the day only when you keep it.

| variable | default | |
|---|---|---|
| `BUSHIDO_PLANNER_MODEL` | Settings → AI → Model, else `claude-sonnet-5` | |
| `BUSHIDO_PLANNER_EFFORT` | `low` | measured: a quarter of the latency of the CLI default for a reply no worse |
| `BUSHIDO_PLANNER_TIMEOUT_MS` | `150000` | the run is killed at this point and the screen says so |
| `BUSHIDO_BRAIN_FILE` | off (Settings → Other local services) | an athlete profile in Markdown the planner may read. Absent is survivable — it is simply told less |

Each run is a real model call billed to whichever account the CLI is signed in with.
Nothing else in the app costs anything.

The AI coach (`/api/coach/chat`), the dormant check-in coach (`/api/chat`) and the week
planner (`/api/plan/week`) were removed on 2026-10-25. The files they left in the data
directory (`coach.json`, `coach/`, `goals.json`) are not read and not deleted.

There used to be a scheduled coach too: a 04:40 systemd timer running `coach/run.sh`, a
headless Opus session that could edit the plan behind a validate-test-revert gate. It is
gone. If a box still has the unit installed — as `rung-coach.*` on anything set up before
the 2026-10-02 rename, or `bushido-coach.*` if it was installed under the new name —
remove it under whichever name it has:

```bash
systemctl --user disable --now rung-coach.timer rung-coach.service
systemctl --user disable --now bushido-coach.timer bushido-coach.service
rm -f ~/.config/systemd/user/{rung,bushido}-coach.{service,timer}
systemctl --user daemon-reload
```
