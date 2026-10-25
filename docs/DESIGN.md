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

*Implemented by #31 (2026-10-25).*

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
  the general ways to log), and their history still reads. Nothing climbing-specific is shown
  above ordinary workout logging. The two hard-finger rules were never enforced on placing a
  session: only the removed check-in's offer cards (and the recommender behind them) refused a
  hard day, so they went with them. `lib/fingers.js` keeps `isHardEntry` for history only
  (AGENTS.md §6.1); do not re-add the blocks believing they once guarded placement.

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

Defined by #29. Screen PRs consume it; they do not add tokens or restyle a base component in
their own CSS. A value a screen needs and the system lacks is added here and in both token
files in the same PR.

**Direction.** A quiet, dark training log you can read at arm's length with chalk on your
hands. The Carbon palette stays (near-black with a trace of green, one lime accent): the owner
picked it from three rendered options and it is not the problem. The problem is that the app
was built one screen at a time, so it had twenty-seven font sizes, twenty-four radii, fifty-seven
uppercase labels, three kinds of icon button, two global `.chip` rules fighting each other, and
a card title smaller than the text under it. The system is mostly subtraction: fewer sizes,
one radius rule, one way to title a group, one primary action per screen in the accent.

Where it lives: `app/src/styles.css` (`:root`, then the base components straight after the
header and tab rules) and `mobile/src/theme.ts` + `mobile/src/ui/kit.tsx`, `Sheet.tsx`,
`Text.tsx`. Names match: `--ink-dim` is `colors.inkDim`, `--fs-title` is `font.title`, `--sp-4`
is `space[4]`, `--r-card` is `radius.card`, `--elev-2` is `elevation[2]`.

### Tokens

**Colour.** Surfaces go up in steps; a thing sits one step above what it is on.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0b0c0b` | the page |
| `--panel` | `#131513` | cards, sheets, the + menu |
| `--panel-2` | `#1a1d1a` | controls and rows inside a card: inputs, chips |
| `--panel-3` | `#232723` | pressed or selected control, icon wells |
| `--line` / `--line-strong` | `#272b27` / `#363c35` | card edges / control edges, ghost buttons, dashed empties |
| `--ink` / `--ink-dim` / `--ink-faint` | `#e9ece7` / `#99a295` / `#808a7c` | text: primary / secondary / tertiary. `--ink-faint` was `#61695e` (3.2:1 on a card); it now clears 4.5:1 on `--bg`, `--panel` and `--panel-2`. It is **never text on `--panel-3` or `--accent-soft`** (4.2:1 and 3.5:1 there): text on those is `--ink` or `--ink-dim` (4.8:1 or better). Icons may use it anywhere (3:1 is the bar for graphics). |
| `--accent` | `#b8f23d` | the one primary action on a screen, the selected tab's icon, focus rings |
| `--on-accent` | `#0f1409` | text and icons on the accent (was two values, one a warm leftover) |
| `--accent-soft` / `--accent-line` | `color-mix(in oklab)` of the accent, 14% over `--panel-2` / 55% over `--line` (`#2d3623` / `#72923e`, the values `theme.ts` carries) | selected chip fill / its border, icon wells, the acting banner |
| `--good` `--warn` `--bad` `--flame` | unchanged | state only; `--flame` is the streak and nothing else |
| `--scrim` | black 62% | behind every sheet and menu |
| `--series-*`, `--load-*`, `--viz-*` | unchanged | charts only. `npm --prefix app run palette` still gates them. People's colours (`--person-*`) stay mapped onto these. |

Rule: the accent fills at most one thing per screen (the primary button or the +). Everything
else that is "on" uses `--accent-soft` with a border, never colour alone.

**Type.** System sans (San Francisco on the phone), seven sizes, three weights (400, 500, 600;
700 only in a person's name pill). Nothing is uppercase or letter-spaced.

| Token | px | Use |
|---|---|---|
| `--fs-micro` | 11 | dock labels with more than four tabs, chart ticks. Never something you must read to decide. |
| `--fs-caption` | 12 | dock labels (three tabs), timestamps beside a row |
| `--fs-small` | 13 | secondary text (`.sub`), field labels, chip and segment labels |
| `--fs-body` | 15 | body, list-row titles, section heads, buttons |
| `--fs-input` | 16 | every input (iOS zooms below 16) |
| `--fs-title` | 17 | card titles, sheet titles, the app name |
| `--fs-heading` | 22 | a screen's own title, where it has one |
| `--fs-display` | 32 | the one hero number on a screen (a chart's headline, a set's weight) |

`--lh-tight` 1.25 for titles, `--lh-body` 1.5 for text. Numbers that line up or change
(clocks, counts, weights) use `font-variant-numeric: tabular-nums` (`tabular` on `T`). The
runner and interval-timer clocks are the only sizes above 32; they keep their own and say so.

**Space.** A 4px grid: `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 20,
`--sp-6` 24, `--sp-8` 32; `--gutter` 16 is the screen's side margin. Inside a card 16; between
cards 12; between a section head and its content 8; between sections 24.

**Radius**, one rule: controls 10 (`--r-control`: buttons, inputs, segmented, icon wells),
containers 12 (`--r-card`: cards, rows, menus), sheets 20 (`--r-sheet`: top corners of a sheet,
popovers, the + menu), pill (`--r-pill`: chips, the dock, the +, icon buttons, avatars).
`--radius` is now an alias of `--r-card` for older rules.

**Elevation.** Cards are flat: `--panel` and a line, no shadow. `--elev-2` is for what floats
over the page (the dock and the +), `--elev-3` for sheets, popovers and menus. Nothing else casts
a shadow.

**Motion.** `--ease-out`, `--dur-fast` 120ms, `--dur` 220ms. Motion explains a change: a sheet
rises 24px as it arrives, a pressed button settles 1px, a tab's pill fades. Nothing loops except
a live clock. `prefers-reduced-motion` turns all of it off (web); native uses the platform's.

### Components

Each is a base class in `styles.css` and a component in `mobile/src/ui/`. Bold names are new.

| Pattern | Web | iPhone | Rules |
|---|---|---|---|
| Card | `.card`, `.card h2`, `.sub` | `Card`, `H2`, `Sub` | Groups related things. Title 17/600, then one `.sub` line at most. Do not put a card in a card; inside a card, group with a section head or a list. |
| **Section head** | `.section-head > h3 (+ .sub)` | `SectionHeader` | Sentence case, 15/600, an optional count or one action on the right. Replaces every small-caps label (`text-transform: uppercase`, `T caps`). |
| **List row** | `.list > .list-row` (`-main`, `-title`, `-meta`, `-chev`) | `Row` | One thing you can open: icon, name, the one fact that matters, chevron. 52px. Rows in a list share one card and hairline dividers; a row is not its own card. |
| Button | `button.btn` + `.secondary`, `.ghost`, `.quiet`, `.bad` | `Btn kind=` `primary`/`secondary`/`ghost`/`quiet`/`bad` | 44px, one line, a verb. One `primary` per screen or sheet. `ghost` backs out (Cancel, Keep it). `bad` only in a confirm. |
| Icon button | `.iconbtn` (= `.modal-btn`); bordered: `.qbtn` | `IconBtn`; `IconBtn bordered` | 44px round, quiet until pressed, an `aria-label`/`label` always. Close is last in a header. The bordered form is a rounded square for a control that must read as one on its own (the ± beside a number). Never the only way to a feature (D7): an action you need to find has a word. |
| Chip | `.chip`, `.chip.on`, `.chip.ghost`; `.out-chip` | `Chip`, `Chip out` | Filters 36px in a row with an 8px gap; an answer to a question 44px. Selected = accent-soft fill + accent-line border. |
| Segmented | `.seg`; full tap height: `.seg.tap` | `Segmented`; `Segmented tap` | Two to four views of the same thing. Selected is a raised `--panel-3` segment. More than four is a list. `tap` makes each segment 44px, for one pressed on its own (the sleep range, #44). |
| Input / field | `input`, `label.field` | `Input`, `Field`, `NoteField` | Label above (13px, `--ink-dim`), helper or error under, never a placeholder as a label. A guessed number is a placeholder (`AGENTS.md` §6.4) and must look like one: placeholder colour is `--ink-faint`, a value is `--ink`. |
| Stepper | `.stepper` (exercises.jsx) | `features/exercises` | A number you nudge: 44px − and +, the value between them. Today it is a 9.5px label under the number; wave 2 brings it onto the tokens. |
| Empty state | `.empty` | `Empty` | Says what goes here in plain words and holds the one button that puts it there. Dashed `--line-strong` edge. |
| Sheet | `.modal` (`-head`, `-ico`, `-title`, `-sub`, `-body`, `-foot`) | `Modal` (iOS page sheet) | Header: optional icon well, title 17 over one line of context, up to three icon buttons, close last. Footer: the one primary, full width, at most one ghost beside it. |
| Full screen | `.fs` (`-head`, `-tabs`) | `FullScreen` | For doing (a session in progress). Back on the left. Section tabs look like the segmented control. |
| Popover | `.pop` | `Popover` | For reference (profile). Anchored on desktop, a bottom sheet under 640px. |
| Confirm | `.confirm` inside a sheet (`Modal onDelete`) | the same in `Modal` | A screen, not a system dialog: the warning icon, the question as the title ("Remove this session?"), one sentence of consequence, **Keep it** (ghost) and the verb (`bad`). It replaces the sheet's body, so there is one thing to answer. |
| Day switcher | Today's `.daynav`; a date input elsewhere today | `DayStepper` | ‹ day › with the day in words ("Today", "Sat 24 Oct"); never a raw browser date input. One component for Today, a rest day and gear dates. |
| Toast | `toast.jsx` + `.toast` (batch A builds it) | `ToastHost` + `lib/toast.ts` | Transient result of an action only (removed, with Undo; a failed save, with Retry). Full width under the header, one solid fill per kind, white text. Errors about a form stay inline under the field. The web port keeps the mobile API (`pushError`, `pushToast`) so a screen calls the same thing on both. |
| Shell | `.hdr`, `.tabs`, `.fabs`, `.fabmenu`, `.acting` | `shell/Screen`, `shell/TabBar`, `features/app` | See below. |

### The shell (done in #29)

- **Header**: the mark, "Bushido" at 17, the streak, the avatar as a 44px target around a 32px
  face (the name and chevron come back only where there is room). Nothing else up here.
- **Dock**: a glass capsule. With three or four tabs (Today, Log, Progress after D6) the + sits
  beside it in the same row at the same height (`.app[data-dock="compact"]`, `compactDock()`), so
  the foot of the screen is one row of things to press and no button floats over content. With
  no + on screen (no plan loaded yet) the capsule takes the row (`data-dock="alone"`). With more
  than four tabs (`"wide"`, the app until #31 lands) the capsule takes the width and the + floats
  above it as before; labels ellipsize instead of clipping. The selected tab is a lit pill with
  its icon in the accent, so it does not rely on colour alone.
- **Sheets, full screens, popovers**: the frame above. Header icon buttons are borderless.
- **Acting banner**: the accent-soft surface with the accent edge: still loud on purpose.

### The + menu, final shape

After #31 (Plan the week gone) and #36 (the interval timer's door), the + menu is, in order:

1. **Log a workout** · "Something you already did" (the accent icon well; the only one)
2. Up to three **recent activities**, one tap each (batch B, see "Logging in two taps")
3. **Log a rest day** · "A day off on purpose"
4. **Plan a workout** · "Build it yourself, or have it written for you"
5. **Interval timer** · "Work, rest and rounds"
6. Cancel (a real button)

The rule for every door: the title is a verb phrase of at most four words; the line under it is
one line, at most about 40 characters, no sentence, no full stop, no dash. Logging doors come
before planning doors, and tools last. #36's door currently carries two sentences ("Work, rest,
rounds. Starts in one tap; change anything first if you like."); whichever of #29/#36 lands second
cuts it to the line above. #29 already orders the doors this way and shortens the lines;
#31 removed Plan the week (doors 1, 3 and 4 are live; 2 and 5 are still to come). #42 added door 2
(`quicklog.jsx`, under Log a workout) and the same rows as Log a workout's Recent group.

### Logging in two taps (D7)

The common case is "I did a run, write it down". Today that is + → Log a workout → find Run →
the form → close: four or five taps. The target is two:

- **+ → Run.** The + menu lists up to three recent activities under Log a workout ("Run",
  "Road ride", "Lift": the activities of your last distinct logged workouts, newest first; on a
  fresh install, the catalog's first pinned sports). One tap places that workout on the day Today
  is showing and opens its sheet.
- **Today's empty day** offers the same rows, so the same two taps work from the screen itself
  (tap Run; the + is not needed).
- **What "logged" means once the form is open:** the entry exists from the tap. With D2 (#34) an
  entry for today or earlier is done by default, so it already counts. Every field saves as it is
  typed (the store writes on change, as now); there is no Save to press, and closing the sheet
  keeps what is there. Numbers left blank stay blank (placeholders are not values, `AGENTS.md`
  §6.4). Removing it is the sheet's bin, with an Undo toast.
- A climbing card still goes through Log a workout → Climbing, because its hard-finger question
  is the point (`AGENTS.md` §6.1).

Batch B builds the rows as one component (`app/src/quicklog.jsx` → `mobile/src/features/quicklog.tsx`,
new) and wires it into the + menu; batch A places the same component in Today's empty day.

### Audit: every screen after D6, #31 and #36

Screenshots at 390px from a throwaway server seeded with four weeks of runs, rides, lifts,
climbs and a rest day, compared against #31's branch for what it already changes; the iPhone
screens read from `mobile/src/features`. Judged by D7: one primary action, plain words, two taps
for the common case. Removed screens (check-in, journal, achievements, goals, quotas, Week, Plan
the week, coach) are not audited (#31 removed them), and nothing #31 already does is listed as work.

Problems that are on every screen, so every batch fixes them in its own files:

1. **Small capitals as section titles** (57 `text-transform: uppercase` rules on the web, 62
   `T caps` in 19 mobile files): "TODAY", "CATEGORY", "MAIN". Use `.section-head` /
   `SectionHeader`, sentence case.
2. **A box per row.** Log, the day list and Log a workout put each row in its own bordered card,
   so a list of eight things is eight cards. Use one card with `.list-row`s.
3. **Explanatory paragraphs above the control** ("Pick what you are doing, as many as you like.
   A gym trip that is…"). If a control needs a paragraph, change the control. One `.sub` line at most.
4. **Off-scale values.** 27 font sizes and 24 radii in `styles.css`, 28 sizes in the mobile
   features. Move every one onto the tokens.
5. **The category shown twice** ("Run  RUN", "Run …… Run"): a row says its name once; the
   category appears only when it differs from the name.
6. **Jargon in the UI** (D7): "MAIN"/"extra" (the day's slot), a bare "RPE" (say "How hard"),
   "RPE × minutes" and "load" (say "Effort × time"), "counts anyway", "any sport".

| Screen | What is wrong | What is good and stays | Direction |
|---|---|---|---|
| **Today** (batch A) | The day row carries a "MAIN" pill, a check and a chevron (three marks for one fact); its subtitle runs to two lines of dots ("45 min · 3.1 mi · 9:21 /mi · RPE 4"). "Log another workout" is a dashed full-width button that looks like an empty slot. The day switcher is a whole card for two arrows. The empty day is a paragraph ("Plan one and it arrives with the sets already written; log one…") over three buttons, with Plan as the primary. | The day list as the heart of the screen; planned vs done; logging onto a past day. | The day as the screen's title with ‹ › beside it (the day switcher), not in a card. One card of `.list-row`s: name, one meta line (time · distance), done shown by the leading icon, no MAIN. When the day has workouts the + is the action and "Log another" goes. WHOOP readiness/sleep (if connected), unlogged workouts and "Sam's day" sit below, compact. |
| **Today, first run** (batch A) | A fresh install on the starter content shows the same paragraph-and-three-buttons empty day, with no hint of what is quick. | Nothing is pre-filled: a fresh log is empty. | An `.empty`: "Nothing logged today", then the quick-log rows (the starter's pinned sports) as one-tap rows, then **Log a workout** as the primary for anything else, and "Rest day" as a quiet button. No paragraph. |
| **Session sheet** (batch A) | The header's line contradicts the form ("45 min" over a typed 29) and uses jargon ("any sport · counts anyway"). "Session logged" is a green fold title that hides the form behind a tap. "Change" is an underlined link inside a box. The footer's only button is #34's done toggle, "Done · Mark undone" as a ghost (or "Mark done" as the primary): a state and an action in one label, and since D2 the state is the default, so the one big button at the foot of a logged session is the rare undo. Guessed values (speed, elevation) look the same as typed ones. | The edit panel behind the pencil (§10.4); delete behind the confirm screen; placeholders for guessed numbers (§6.4); the per-set log. | Header: name, then date · time as typed. The form is open; fields save as typed. The footer's primary is **Close** (the only thing left to do); **Mark undone** is a quiet button beside it, shown for today or earlier, and an undone entry shows **Mark done** instead (D2: an explicit undo always wins). A future-dated entry shows neither. Activity is a `.list-row` that opens the picker. Guessed numbers styled as placeholders. |
| **Rest day** (batch A) | Close to right. The date is a raw browser date input; "In your own words" is a second label for a notes box. | Asking why before logging; chips from the rest card; one primary in the footer. The model sheet for the others. | Date as the day switcher; "Notes" as the label. |
| **Log a workout** (batch B) | #31 already puts the activities before Climbing. Left: a paragraph under the search; each row is its own card and repeats its category on the right; "Your usual" then the whole catalog is a long scroll. | Search across the catalog; folders keeping climbing reachable; logging onto the day Today shows. | Search, then **Recent** (the quick-log rows), then the catalog grouped under section heads, then Climbing. One card of rows per group, no category echo, no paragraph. |
| **Plan a workout** (batch B) | Opens on a paragraph. Kinds are a grid of cards under small-caps group labels; the endurance group has its own paragraph. "Build it myself" and "Write it for me" are both pinned large in the footer before anything is picked. The editor's steppers carry a 9.5px label. #33's drafts (`.plandraft*`) have their own styles. | One door, two routes (§6.6); kinds as a list; the shared editor; nothing written until Keep; drafts surviving the page (D3). | Drafts in progress first, as list rows. Then the kinds as rows with a check, grouped under section heads, no prose. The footer appears once a kind is picked: **Write it for me** primary and **Build it myself** secondary when AI is on. **When AI is off** (the server answers `ai-not-configured`: a fresh install with no CLI, anyone it is not configured for) **Build it myself is the only button and is primary**, and nothing mentions the model. Steppers on the tokens. |
| **Runner** (batch B; read from code) | Small-caps set labels, its own clock sizes and button styles, a second segmented style. | The absolute-instant rest clock (§6.5); one writer; add-a-set copies the last. | Big current set, one primary (**Done set**), the set list as rows, the side switcher as `Segmented`. Its clock sizes stay its own, documented. |
| **Workout mode** (batch B; read from code) | The climbing cards' clock face, styled apart from the runner and from #36's new timer. | The clock rules. | The same face as #36's interval timer where they overlap; it reads `timer.css` rather than copying it. |
| **Log** (batch C) | Date headers in capitals with "1 workout" on the right of every day. Each workout is a card with a chevron that expands in place (a second way to read a session beside the sheet). Untitled free-form workouts are named "Log a workout" (the button's name). Filter chips scroll off the right with counts that read as part of the label. | Newest first; filters by category; opening the sheet by id. | One card per day, workouts as rows; header "Fri 23 Oct", no count. A row opens the sheet (no in-place expansion). An untitled workout is named by its activity. Filters: "All" plus the categories you actually log, as chips that fit. |
| **Progress** (batch C) | #31 removed the achievement filter and the hard-finger tile, and moved the Climbing group last. Left: a filter card leads (Category, Just one thing, Since) before any number; tiles are a 2-up grid with a lone third; "Volume" explains sRPE in a sentence. | Charts declare when they apply (§6.8); the noise band; the table toggle. | Lead with workouts and time this period, two numbers in one card. Period as `Segmented` (4 wk · 8 wk · 6 mo · All) under the title; category chips only when more than one is logged; "Just one thing" behind a row. Charts titled in plain words ("Time per week", "Effort per week"). |
| **Profile** (batch D) | Six sections in a sideways strip that cuts off ("Alerts" half hidden). The avatar button has no accessible name on a phone (only a `title`). Testing and Why are climbing-only and sit beside You and Gear. Every field has a helper line; values and placeholders look alike. | Popover on desktop, sheet on the phone; the sync dot on the avatar; gear's two origins (§6.9). | A list of sections (You, Gear, Notifications, Connections, Climbing, Settings), each opening its page; Testing and Why under the one "Climbing" row (D6). `aria-label` on the avatar. Helper text only where a field is not obvious. |
| **WHOOP, Strava, unlogged workouts** (batch D) | Each has its own card, chart and button style; the unlogged card's row actions are several small buttons. | Suggested, never applied, matching (§8.2); snapshots on the entry. | Rows with one action ("Log it") and the rest behind the row; charts on the viz tokens via `lib/viz`. |
| **Settings, sign-in, setup, Connect** (batch D) | Server-rendered with their own inline CSS, not on the tokens. | Working before the app is built (§3). | Copy the token values into the pages' inline style block (no shared file: the pages must work without `dist/`). Connect uses the kit. |
| **Shared workouts and people** (batch E) | "With …" chips, "For: You / Sam", the side switcher and "Sam's day" each have their own small styles. | Always knowing whose side you are on (what the owner asked for, item 2); each person's colour with their name. | The switcher is `Segmented` with the person's colour on the selected segment; "With …" is a section head with person chips; "Sam's day" is a list row. |
| **Interval timer** (#36, not wave 2) | New, built alongside this PR. | Its one-screen default. | Uses these tokens and components (`timer.css` reads the variables); its clock face is the one place above `--fs-display`. |

### Wave 2: who owns which file

Every file below has exactly one owner. Shell-resident pieces are named explicitly; the rest of
a shell file stays with the shell owner (#29), and a batch that needs a change there asks for it
in its PR description rather than making it.

**Before wave 2 starts, one pure-move PR (#29's follow-up, no visual or behaviour change). Done (#39); what it did is noted under each item:**

- Split `styles.css`: it keeps the tokens, the base components and the shell (header, dock,
  `.fabs`, `.fabmenu`, `.acting`, `.modal`/`.fs`/`.pop`, `.confirm`). Everything else moves,
  rule for rule and in the same order, into `app/src/css/<area>.css`, imported from `main.jsx`
  after `styles.css` (the way #36 imports `timer.css`): `today.css` (A), `logging.css` (B,
  including #33's `.plandraft*`), `feed.css` (C), `profile.css` (D), `people.css` (E). The
  palette check keeps reading the first `:root` in `styles.css`.
  - Done, with three refinements. Area files load between `styles.css` and `timer.css` (where
    their rules used to sit). The desktop `@media (min-width: 1024px)` block is split by area,
    so each area's overrides load after the rules they override. `.card.note`, `.filters` and
    `.blurb-head h2` stay in `styles.css`, because shell rules later in it override them.
  - The rules for the screens #38 removed (coach, check-in, week planner, quota bars, journal,
    achievements, goals) were deleted rather than moved: 269 rules that nothing renders. A few
    live rules sat in those sections (the planner's `.thinking`/`.coachdots` and their
    `@keyframes coachpulse`, `.md`, `.qbtn`, the notification rows, `.sub.warn`) and moved to
    their area. Older Today layouts nothing renders any more (the recommender's cards, the swap
    dialog, history, trip) were kept, rule for rule, in `today.css` for batch A to delete.
  - Checked by comparing main's build with the split: every rule but the deleted ones is
    unchanged, and every element's computed style is identical on 23 screens at 390, 720 and
    1280px.
  - **Every new rule goes in its area's file**; `styles.css` takes only tokens, base components
    and shell.
- Move `TestingTab` and `WhyTab` out of `tabs.jsx` into `app/src/testing.jsx` (and
  `features/tabs.tsx` into `features/testing.tsx`), so the climbing pages belong to D and Today to A.
- Move `DayStepper` from `features/app.tsx` to `mobile/src/ui/DayStepper.tsx`: it is the day
  switcher pattern, used by Today, the rest day and gear.
- Split `app/smoke.jsx` into delimited sections, `// ===== batch A: Today and the session sheet
  =====` and so on, one per batch plus `// ===== shell =====` and the timer's (#36). Each batch
  adds and edits cases only inside its own section; a case that has to change in someone else's
  section is called out in the PR. Done: every existing case is in its owner's section, unchanged
  and in its old relative order (the smoke run lists the same cases, rendering the same sizes).

| Batch | Screens | Web (each file one owner) | iPhone twin | Waits for |
|---|---|---|---|---|
| **A. Today and the session sheet** | Today (incl. first run and the empty day), the day switcher, session sheet and details, rest day, how-to, the web toast | `tabs.jsx` (after the move: Today and SessionSheet only), `sessionlog.jsx`, `session.jsx`, `setlog.jsx`, `liftlog.jsx`, `howto.jsx`, `lib/figures.jsx`, **new** `toast.jsx` + `lib/toast.js`, `css/today.css`; in `App.jsx` only the `RestPrompt` function | `features/tabs.tsx`, `sessionlog.tsx`, `session.tsx`, `setlog.tsx`, `liftlog.tsx`, `howto.tsx`, `lib/figures.tsx`, `features/screens/TodayScreen.tsx`; in `features/app.tsx` only `RestPrompt` | #31, #34; places B's quick-log component (stub until it lands) |
| **B. Logging and planning** | Log a workout, quick log, the + menu doors, Plan a workout and drafts, the editor, runner, workout mode | `picker.jsx`, `activitypicker.jsx`, **new** `quicklog.jsx`, `planner.jsx`, `exercises.jsx`, `numinput.jsx`, `runner.jsx`, `workout.jsx`, `lib/markdown.jsx`, `lib/bodymap.jsx`, `css/logging.css`; in `App.jsx` only the `FabMenu` function and its call site | `features/picker.tsx`, `activitypicker.tsx`, **new** `quicklog.tsx`, `planner.tsx`, `exercises.tsx`, `numinput.tsx`, `runner.tsx`, `workout.tsx`, `lib/markdown.tsx`, `lib/bodymap.tsx`; in `features/app.tsx` only `FabMenu` | #31, #36 (+ menu), #26 (exercises) |
| **C. Log and Progress** | Log feed, Progress, charts, blurbs | `log.jsx`, `progress.jsx`, `blurb.jsx`, `lib/viz.jsx`, `css/feed.css` | `features/log.tsx`, `progress.tsx`, `blurb.tsx`, `lib/viz.tsx`, `features/screens/LogScreen.tsx`, `ProgressScreen.tsx` | #31 |
| **D. Profile and connections** | Profile and its sections, Testing and Why, gear, notifications, WHOOP, Strava, unlogged workouts, Settings/sign-in pages, Connect | `profile.jsx`, **moved** `testing.jsx`, `gear.jsx`, `gearpicker.jsx`, `notifications.jsx`, `screeninfo.jsx`, `whoop.jsx`, `strava.jsx`, `unlogged.jsx`, `lib/whoop.jsx`, `lib/strava.jsx`, `server/pages.js`, `css/profile.css` | `features/profile.tsx`, **moved** `testing.tsx`, `gear.tsx`, `gearpicker.tsx`, `notifications.tsx`, `whoop.tsx`, `strava.tsx`, `unlogged.tsx`, `app/connect.tsx` | #31 |
| **E. People** | "With …", "For: …", the side switcher, someone's day | `sharedwith.jsx`, `trainer.jsx` (incl. `PeopleDays`, which Today places), `css/people.css` | `features/sharedwith.tsx`, `trainer.tsx` | #26, #34 |

**Not in a batch:** the shell, owned by #29: the top of `styles.css`, `modal.jsx`, `main.jsx`,
`lib/icons.jsx`, `lib/planctx.jsx`, `lib/prefs.jsx`, the rest of `App.jsx`; `mobile/src/theme.ts`,
`mobile/src/ui/*` (including the moved `DayStepper`), `mobile/src/shell/*`, the rest of
`features/app.tsx`, `features/screens/PlanGate.tsx`, `mobile/src/app/_layout.tsx` and `(tabs)/*`,
`lib/icons.tsx`. The interval timer (`timer.jsx`, `timer.css`, `lib/timer.js`, `features/timer.tsx`)
is #36's. A batch that needs a token or a component variant adds it to both token files in its
own PR and says so; it does not restyle a base class locally.

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
