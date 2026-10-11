# AGENTS.md — Bushido for iPhone

The native client for the Bushido server. It recreates the web app's **phone** layout
(`../app/src`, served by `../server/server.js`) one to one, and uses native mechanics where a
phone has them: sheets are iOS page sheets, "…" menus and pickers are system action sheets, list
rows swipe, and logging a set, finishing a session and every phase change of the workout timer
give haptic feedback.

## Expo has changed — do not trust memory

This is Expo SDK 57 (React Native 0.86, expo-router). Before touching an Expo API, read the
versioned docs: append `.md` to any docs.expo.dev URL, starting from https://docs.expo.dev/llms.txt.
Use `npx expo install <pkg>` for dependencies so versions match the SDK.

## How it fits together

- **`src/lib/` is the web's `app/src/lib/`, at the same relative paths, mostly byte for byte.**
  The pure modules (`store.js`, `quota.js`, `prescription.js`, `recommend.js`, `lifts.js`, …) are
  copied as JavaScript, not rewritten: `tsconfig.json` has `allowJs`. When the web changes one,
  copy it again and re-apply the few native edits, which are all marked in the file:
  - `store.js`: AppState (`lib/foreground.ts`) instead of `visibilitychange`; no hostname handoff.
  - `whoop.jsx`, `strava.jsx`: the same foreground swap.
  - `signout.js`: `confirmFn` may return a promise.
  - Gone on purpose: `push.js` and `handoff.js` (web push and hostname moves have no native meaning).
  - Rewritten for React Native because they render: `icons.tsx` (lucide-react-native, same names),
    `viz.tsx`, `figures.tsx`, `bodymap.tsx`, `markdown.tsx`, `cues.ts` (haptics for the web's beeps).
  - `lib/minutes.js`, `unlogged.js`, `whoop.jsx` and `strava.jsx` import `../../../server/whoop.js`
    and `strava.js` exactly as the web does; `metro.config.js` watches `../server` for that, and the
    repo-root `.easignore` uploads those two files with the app.
- **`fetch('/api/…')` works unchanged.** `src/lib/boot.ts` installs a fetch wrapper
  (`installFetch` in `connection.ts`) that sends any path starting with `/` to the saved server
  with the credential, the Cloudflare Access token and `X-Bushido-User`, and handles the gate's
  answers (401 `login` → back to Connect, 409 `switched` → reload) the way `main.jsx` does.
  Absolute URLs pass through untouched.
- **Auth lives in one place: `src/lib/connection.ts`** (plus the form in `src/app/connect.tsx`).
  Three kinds, matching `server/auth.js`: `session` (username + password exchanged once via
  `POST /api/auth/session` for the signed session value, sent as a bearer), `token`
  (`BUSHIDO_API_TOKEN`), `proxy` (`BUSHIDO_AUTH=proxy`, nothing sent). Credentials and the Access
  token live in the keychain (expo-secure-store), never in localStorage. When sign-in changes on
  the server (more than one person), change these two files.
- `localStorage` is real: `boot.ts` installs expo-sqlite's synchronous localStorage before anything
  loads, so the store's cache and outbox persist exactly as on the web, under the same keys.
- `src/shell/AppData.tsx` is `App.jsx`'s state: the store, the plan, which + overlay is open, the
  write paths (`placeAll`, `placeToday`, `keepPlan`, `takeRest`) and the providers. Screens read it
  with `useApp()` and pass the same props the web components take.
- `src/shell/` is the frame: `Screen` (the header with the mark, streak and profile button, and a
  body that clears the dock), `TabBar` (the floating glass capsule and the + row), `Overlays`
  (what the + opens), `reload.ts`, `accessReauth.ts`, `ScreenError`.
- `src/app/` holds routes only: `(tabs)/` is one file per web tab; `connect.tsx` is sign-in.
- **`src/features/<name>.tsx` is `app/src/<name>.jsx`**, one file per web file, with the same
  export names and the same props. `features/app.tsx` is the components in `App.jsx`;
  `features/screens/` wraps each tab in its frame.
- `src/theme.ts` is the web's `:root` (`--ink-dim` → `colors.inkDim`), plus `mix()` for the CSS's
  `color-mix` tints and `cssColor()` for `var(--x)` strings that arrive in content.
- `src/ui/` holds the building blocks: `T` (text), `kit.tsx` (Btn, IconBtn, Card, H2, Sub, Chip,
  Segmented, Input, Field, NoteField, Toggle, Empty, Spinner, Row), `Sheet.tsx` (`Modal`,
  `FullScreen`, `Popover` with `modal.jsx`'s props), `Fold.tsx` (`<details>`), `menu.ts` (system
  action sheets, `confirm`, `prompt`), `haptics.ts`, `ToastHost`, `NotYet`.

## Porting rules

- **The web is the spec.** Same sections, copy, order, colours and states as the phone layout
  (`@media (max-width: 719px)` in `styles.css`). A difference must be deliberate and native (a page
  sheet, a system menu, a swipe, a haptic), not drift. Keep the web's comments that explain *why*,
  shortened if needed; they are the design history.
- **Logic is not forked.** If the web component computes something, port the computation as is or
  call the same `lib/` function. Never "simplify" a rule (`isDone`, `optFor`, the finger blocks).
- **Never hand-draw an icon.** `<Icon name="…">` from `src/lib/icons.tsx` takes the web's lucide
  names. Missing one: add a deep import there after confirming the file exists in
  `node_modules/lucide-react-native/dist/esm/icons/`. Tabler (`@tabler/icons-react-native`, deep
  per-icon imports) for anything lucide lacks. Bespoke art the web already ships (the exercise
  figures, the body map, the logo) is rendered from the web's own data, never redrawn.
- Browser-only things and their native forms: `<select>` → `showMenu` (system action sheet);
  `window.confirm` → `await confirm()`; `<input type="date">` → `DayStepper` (`features/app.tsx`);
  `<details>` → `Fold`; hover → nothing; `document`/`window.location` → never.
- Haptics (`ui/haptics.ts`): `tap` for toggles and selection, `impact` for a primary action,
  `success` when something is done (a set logged, a session completed), `warn` before a destructive
  confirm. The workout timer's cues are `lib/cues.ts`.
- Scrolling screens pad their foot by `FAB_CLEAR` (or `DOCK_CLEAR` with no + row) so nothing ends
  up under the floating bar.

## Running, building, shipping

```sh
cd mobile && npm install                           # its own install; app.local.json first (README)
npx tsc --noEmit                                   # typecheck
npx expo export --platform ios --output-dir /tmp/x # proves the JS bundles
npm run start:tailscale                            # Metro on the Tailscale IP, for the dev client
```

- **Dev client:** `npx eas-cli build -p ios --profile development`, install it on the phone, then
  `npm run start:tailscale`. Rebuild it whenever a native module is added or `app.json` plugins
  change. Expo Go is not supported.
- **TestFlight:** `npx eas-cli build -p ios --profile production --auto-submit`.
- **Over-the-air:** `npx eas-cli update --channel production -m "…"` ships JS-only changes.
  `runtimeVersion` uses the fingerprint policy, so an update only reaches binaries whose native
  code matches; if native code changed, build again.

## Gotchas

- iOS ATS allows plain http (`NSAllowsArbitraryLoads`) because the server is usually reached over
  Tailscale at `http://<100.x>:8099`.
- **The install's identity is not in the repo.** The bundle id and the EAS project id live in the
  gitignored `app.local.json`, which `app.config.js` merges into `app.json`. Never put an account,
  bundle id, project id, host, IP or email in a tracked file: this directory is published with the
  rest of Bushido.
- `eas.json` is part of the runtime fingerprint. Change it only alongside a new build.
- A JS module's default-parameter destructuring (`function f({ a, b } = {})`) makes TypeScript
  infer a narrower type than the function takes; cast at the call site (`(f as any)(…)`) rather
  than editing the ported file.
- Every screen sits under an error boundary (`src/shell/ScreenError.tsx`), so a data shape the app
  has not caught up with shows an error on that screen instead of closing the app.
