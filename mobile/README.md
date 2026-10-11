# Bushido for iPhone

The native app for [Bushido](../README.md), a self-hosted health and training log. It is the web
app's phone layout rebuilt in React Native (Expo SDK 57): the same tabs and screens, with iOS page
sheets, system menus, swipe actions, and haptics on every set you log and every phase of the
workout timer. It talks to your own Bushido server; it has no backend of its own.

## Run

Copy `app.local.example.json` to `app.local.json` and fill in your own bundle id and EAS project id
(`npx eas-cli init` creates a project). It is gitignored; `app.config.js` reads it.

```bash
cd mobile
npm install
npm run start:tailscale   # Metro on this machine's Tailscale IP
```

Open it in a Bushido development build (Expo Go cannot load its native modules). On first launch,
enter:

- **Server**: the machine running Bushido, e.g. `100.64.0.10` (port 8099 is assumed) or
  `https://bushido.example.com`. A server behind Cloudflare Access gets Access's sign-in first.
- Then whatever the server asks for: your **username and password** (the account from `/setup`),
  or `BUSHIDO_API_TOKEN` from the server's environment. With `BUSHIDO_AUTH=proxy` there is nothing
  to enter.

The credential is stored in the iOS keychain. Signing in needs a server new enough to have
`POST /api/auth/session`; an older one still accepts an API token.

Linked goals are matched on the host they link to. The app uses the server's address; if your goals
link to a different hostname (the one the web app is published at), put it in `mobile/.env`:

```bash
EXPO_PUBLIC_BUSHIDO_HOST=bushido.example.com
EXPO_PUBLIC_BUSHIDO_LEGACY_HOSTS=old.example.com
```

## Build

```bash
npx eas-cli build -p ios --profile development              # dev client
npx eas-cli build -p ios --profile production --auto-submit # TestFlight
npx eas-cli update --channel production -m "message"        # JS-only update to installed builds
```

See `AGENTS.md` for how the code is laid out and the rules for changing it.
