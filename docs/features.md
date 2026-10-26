# Features

What each part of Bushido does and why it is built the way it is. Written while the app
was in daily use by one person, so "you" often means its owner; the reasoning holds for
anyone.

## Your day, and the + button

Three tabs: **Today**, **Log** and **Progress**. Today is **your day**: the day is the
title, with ‹ › to move between days, and under it one list of the workouts actually on
it, each with one line of what it was (time · distance, as typed or measured, never the
card's guess) and its leading icon saying whether it is done. Nothing you did not put there.

An empty day says "Nothing logged today" and offers your **three most recent activities**
as one-tap rows (a fresh install offers the catalog's pinned sports), then **Log a
workout** for anything else and a quiet **Rest day**. Tapping Run puts a run on the day you
are looking at, done, and opens it: logging the common case is two taps. Tapping a workout
opens its sheet, headed by its name, the day and the time: the form is open, everything
saves as you type, and **Close** is the button at the foot. Removing one shows an **Undo**
for a few seconds.

Everything gets onto the day through the **+ button**, bottom right:

| | |
|---|---|
| **Log a workout** | The same three recent activities sit right under it in the menu, one tap each. Behind it: a search box, **Recent** (that same list), then all 91 activities under section heads (Running, Cycling, …); pick one and the card opens already the right shape. Last, the plan's own climbing cards as folders under **Climbing**: **Bouldering** (the board, 4×4s, limit bouldering) and **Rock climbing** (max hangs, ARC laps, the load-cell tests), each with protocol, cues and timer included. One search box reaches both. It lands on the day you are looking at on Today, so a workout you forgot can be logged on its own day. |
| **Log a rest day** | A day off on purpose, with why (sick, travelling, planned recovery) and a note. |
| **Plan a workout** | Build it yourself, or (when AI is set up) have it written for you. See below. |
| **Interval timer** | Work, rest and rounds, for any workout or none; also on every workout's sheet. |

Nothing in it ranks anything. They are doors in the order the content file declares them,
with a search box. Until 2026-09-17 Today also carried a quota board, also-recommended
blocks, a "why today" card, a ranked swap list and a rest-day suggestion; on 2026-10-25 the
quota bars and the journal that had stayed went too (see *What was removed on 2026-10-25*
below). A screen that opens with an argument every morning is a screen you stop reading.

### Done by default

A workout is done once its day has arrived. Logging one, planning one for today, a rest day,
a ride the watch recorded: all of it is done the moment it lands, with nothing to tick. A
workout planned for a later day shows as planned until that day, then counts as done
without anything being written. If you skipped it, open it and tap **Mark undone**; it then
stays undone however many days pass, and **Mark done** puts it back. The streak, the load,
the habit in Totem and every chart read the same rule. The "nice session" notification waits
until there is something to say: the first set or effort you log, the workout finishing in
the runner, or a **Mark done** tap. A workout logged for an earlier day is announced as it
lands, and a planned day arriving at midnight never is.

## Plan a workout

**+ → Plan a workout.** Pick what, **as many as you like**, as rows with a check that
shows the order you tapped them. A gym trip that is legs, then core, then ten minutes on the
bike is *one* session with three blocks against one time budget for the whole trip. The
kinds are grouped under section heads (**Lifting**, **Support**, **Endurance** by intent, the
Swim, Bike and Run catalogs folded, and **Climbing**), because "Power" and "Endurance" are
climbing categories in this app and ordinary words everywhere else. The whole list is
`plannerKinds` in `plan.json`, groups included, so it grows without a rebuild. The owner
can also plan **for** someone else on the install (*For: You / Sam*); it lands in their log.

Once something is picked, two buttons appear:

- **Build it myself** opens the same editor with the blocks you picked and nothing in them.
- **Write it for me** (only when the server has a working Claude Code CLI) asks how long you
  have and what you want out of it, then an agent reads your log, your athlete profile (when
  a brain file is configured), what you logged in the last week and last night's WHOOP
  recovery before writing a session with every set, load and rest in it. A kind that names no
  sport ("Zone 2", "Tempo") picks the one you have done least lately. The run is a **draft**
  on the server, so leaving the page, locking the phone or switching devices loses nothing:
  the planner lists drafts being written and drafts ready to keep, and a draft is kept once.

With no AI set up (a fresh install, or a CLI that will not run), Build it myself is the only
button and nothing on the screen or in the + menu mentions a model. The server says
`ai-not-configured` for everyone, the owner included; Settings → AI says why.

- **The agent is read-only.** `Read`, `Grep`, `Glob` and nothing else: no shell, no writes,
  not even to the brain file.
- **Nothing is in the log until you keep it.** A draft you do not want costs a model run and
  is discarded. Tapping *put it on today* is what writes an entry.
- **Everything is editable, before and after.** The review screen is the same editor the
  session sheet shows afterwards: steppers on every rep, load and rest, exercises
  removable, more addable out of the 207-movement catalog.
- **It leaves blanks on purpose.** With no history for a movement it writes no load rather
  than inventing one, and says so. A dash in the box means *you tell me*.
- **The plan and the log stay separate.** `data.plan` is what was asked for; `out` is what
  happened. The runner pre-fills one from the other, so you can still see afterwards where
  you went off it.
- **A multi-part trip lands as separate workouts.** Legs then a run home becomes *two*
  entries, not one: each with its own log and — the reason it matters — its own slot for a
  WHOOP or Strava measurement to attach to. A pooled entry has one `out.whoop`, so a lift
  and a ride would fight over it. Whether a block is *a separate workout* (and which category)
  is what decides the seams; a warm-up is *part of the workout beside it*. The review
  screen says what it will land as before you keep it.
- **Every lifting movement shows what it works.** A front and back body beside the name,
  primary muscles bright and secondary dim, everywhere the name appears: the plan, the
  review, the session card, the runner and the lift log. Drawn by
  [`react-body-highlighter`](https://github.com/giavinh79/react-body-highlighter) (MIT) from
  muscle data matched out of [`free-exercise-db`](https://github.com/yuhonas/free-exercise-db)
  (public domain) by `app/muscles.build.mjs` — 162 of the 207 movements matched by name, the
  rest fall back to their catalog group, and about two dozen are corrected by hand in the
  script.
- **It shows what you lifted last time, while you are choosing the weight.** The runner has
  always had it; the planning screen is where the number is actually decided.
- **You can keep talking to it.** *Why this session — and what to change* sits at the top of
  the review and of the session's own card afterwards: its reasoning, then quick prompts
  (*make it shorter*, *go easier on me*, *more volume*, *swap an exercise*) and a box for
  anything else. A revision returns the whole session rewritten and says in a sentence what
  it changed and what the trade-off was — and it keeps the numbers you edited by hand, and
  the categories you chose. The conversation lives on the entry, so a session written at eight in
  the morning can be argued with at six in the evening.

Then **start the workout** — see the runner below.

## Shared workouts, and other people

An install can hold more than one person (Settings → People, behind Cloudflare Access).
Each has their own log; one device never shows two.

- **With …** on a workout's sheet adds someone to it. Their copy lands in their log, done
  from its day like anything else, with your exercises and none of your numbers.
- **Sync exercises with Sam** (on when someone is added) keeps the workout's structure the
  same on both sides: an exercise or set added, removed or reordered on either side reaches
  the other. Numbers never cross: reps, weights, effort, notes, gear and WHOOP/Strava stay in
  the log they were written in. Off, each side stays as it is.
- The sheet's **You / Sam** bar stays at the top while you scroll and remembers which side
  you were on. Their side shows what *they* did last time, from their log.
- **Sam's day**, under your day on Today, is a read-only week of their log; a workout opens
  from their side, and Start runs it there.

### Hard finger days are what you SAY they were

Every climbing card that can load the fingers asks, pre-filled from what the session was
planned as, and **your answer is what is recorded**: a board session you took easy was
not a hard finger day; a social night you projected through was. The Progress page's
Climbing group counts hard finger days per week from those answers (`lib/fingers.js`).

Until 2026-10-25 two rules were built on that count — no hard finger day the day after
another, and no more than three a week — and the recommender and the coach checked them
before offering anything. Both of those offered sessions; nothing does now, and placing a
session never consulted the rules, so nothing enforces them today. The planner's prompt
still tells it not to write a fourth hard finger day or one the day after another.

## Every sport gets a card

The single *Other training* catch-all is gone. In its place is a searchable catalog of
**91 activities** — the lift-chooser pattern, and content in `plan.json`, so adding one is
an edit with no rebuild. Your six sports are pinned as one-tap quick-picks; everything
else is two keystrokes away.

The form follows what you pick, via one of four **shapes**:

| shape | asks for | e.g. |
|---|---|---|
| `distance` | miles, time, pace, and elevation *or* incline | run, mountain bike, hike |
| `pool` | yards, laps, per-100 pace | swim |
| `lift` | the exercise chooser | lift, functional fitness |
| `time` | how long, how hard | dance, yoga, pickleball |

A lift's weight box says what the number means ("lb per hand", "lb on the bar"). Where an
implement can mean more than one thing, that label is a button: one tap switches a
dumbbell or kettlebell between per hand and one dumbbell, and a bar between on the bar and
per side. The choice is remembered per exercise, so the next Bulgarian split squat starts
the way the last one was logged.

A treadmill run asks its incline and never its elevation; an outdoor run is the reverse.
The old card gated incline on `activity: ["run","walk"]` and got both backwards.

**Climbing is deliberately absent from the catalog.** It is logged on the climbing cards,
which are what ask the hard-finger question — a second path in is a way for a hard finger
day to land where nothing asks it. The Bouldering and Rock climbing folders
are those cards, not catalog entries, and a climb WHOOP or Strava recorded shows on the
unlogged card with a "Log it" that asks which climbing session it was.

## Workouts your watch already knows about

WHOOP and Strava record what you did; Today offers anything with no log entry as a row
with one button, **Log it**, which logs it pre-filled with the time and distance. Tap the
row for the rest: **Just miles**, **Warm-up**, *Same as…*, *Not the same* and **Dismiss**.
Dismissing is recorded, so it does not come back (until you bring it back).

This fixed a real hole: three of the six sports in `data/whoop.json` — `dance`,
`mountain-biking`, and WHOOP's own generic `activity` — previously mapped to **nothing**,
so attaching one of those filled in no activity at all and the card stayed a single blank
question. The sport mapping is now read off the catalog rather than a hardcoded list.

**The same ride on both services becomes one row.** WHOOP and Strava both record your
rides, so the card pairs them on time overlap and offers one card, badged with both, that
logs as a single entry carrying both snapshots — Strava answers distance, elevation and
moving time (it has GPS), WHOOP contributes heart rate and strain. It says what it's
claiming (`90 min in common — logged as one`) and **Not the same** splits them for good if
it ever gets it wrong. Without this, one afternoon would count as two rides and count
twice on the load chart.

**…and when they don't arrive together, *Same as…* merges the late one in.** That pairing
only works while *both* are still unlogged, and sync order is not something this app
controls — Strava landed first on 2026-09-17, the ride got logged off it, and WHOOP's copy
of the same hour turned up with nothing left to pair with. *Same as…* lists the sessions
already on the day and attaches the measurement to whichever one you say it is. It fills
blanks only, so nothing you have typed gets overwritten, and a session that already carries
a snapshot from that source is not offered — attaching a second one would silently replace
the first. It is not filtered by activity: you are the one asserting the two are the same
thing, and an app that hides the ride you mean because the catalog disagrees is arguing
with you about your own day.

Climbing workouts are never offered here, for the reason above.

## Last night's sleep

Today's side column has a **Last night** card under *How you arrived*: time asleep
against what WHOOP says you needed, the sleep score, efficiency and debt, bedtime and
wake, the stage split, and a two-week strip of hours asleep. Nothing is logged by hand.
The nights come from WHOOP as `sleep[]` in the same pull as recovery (`sleepFor` and
`sleepNights` in `server/whoop.js`). Nights are filed under the morning woken into, the
same calendar as recovery. A morning with no scored night shows no card.

## You, and your gear

The header is your Strava name and picture (the sync state survives as the dot on it).
Tapping it opens a panel anchored under it (a bottom sheet on a phone) that lists its
sections: **You** (body numbers), **Gear**, **Notifications**, **Connections** (Strava, and
WHOOP for the owner; only when the server has an app for one), **Climbing** (your grades,
then **Testing** and **Why** when the plan has tests or evidence) and **Settings** (whose
log, sync, explanations, the server's Settings page, sign out). Each opens its page with a
back button. The tab bar is **Today · Log · Progress**.

**Gear** is what you own and what it has done, not what to buy. Bikes and shoes arrive from
Strava with their real odometers and stay read-only; ropes, harnesses, climbing shoes, plates
and the Port-A-Board you add yourself, and the app counts their use from your log. What each
is measured in belongs to the kind: **miles** for bikes and shoes, **hours** for climbing
gear, **reps** for weights.

An item can be your **default** for its kind, so a logged ride picks up your primary bike
with no taps — Strava's model — and the workout card asks "on what" only when the discipline
actually uses gear. A dance class is never asked which bike it was on.

One number is deliberately not a single number: a synced bike shows Strava's odometer, and
anything logged here that Strava can't have seen (a trainer ride, a hand-logged one) is shown
*beside* it rather than added in. Adding them would double-count every ride that was on
Strava.

## The log

Every workout, newest first: one card per day ("Fri 23 Oct"), each workout a row with its
time and distance. Tap a row to open it. Filter by **All** or by any category you have
logged. The charts moved to their own **Progress** tab; they were never history.

The old climbing-only quick-log (edge mm, added lb, hang seconds) is gone rather than moved:
bodyweight has its own quick log here, for any date, and writes the same series the
charts already use; a max hang is logged by the session that *is* that test.

## Progress

It opens on the answer: how many workouts and how much time, over 4 weeks / 8 weeks /
6 months / all time. Under that, narrow it by **category**, **just one thing** (a sport or
a session) or **one lift**, and the charts follow — filtering to running drops every
climbing chart, filtering to bench press brings up its top set. Charts are titled in plain
words (**Time per week**, **Effort per week**), and the **Climbing** group comes after
Training, Distance, Strength and Effort: a workout log first.

This replaced about twenty hardcoded charts that were all on screen at once and nineteen of
which were about climbing. Each chart now declares when it means anything, so the page draws
what answers the question you asked. The very specific climbing numbers — critical force,
4×4 rest, straddle reach — are declared by the sessions themselves in `plan.json` and appear
under **This session** when that session is in scope.

The filter only offers what you've actually logged, with counts, because a dropdown of eleven
categories when you've done five mostly returns empty charts.

## The runner — a planned workout, set by set

A session with a plan on it opens the **runner**: one set filling the screen, the target
above it, two thumb-sized steppers, and one big button. Built for a phone and nothing else.

- **The clock survives the app being closed.** The rest deadline is an absolute instant
  stored on the entry, so shutting Bushido mid-set, answering a text and coming back lands on
  the right second — and so does picking it up on the laptop, because the entry syncs.
  Nothing counts down; everything subtracts.
- **A workout in progress says so on your day, and tapping it goes back into the runner**
  rather than into the reading sheet.
- **Numbers arrive filled in** — from the prescription on an untouched set, and from what
  you actually did on the last set of the same movement once you have moved off it. A
  session done as written is one tap per set.
- **Rest starts itself** off the set you just finished, with ±15/30s and skip. It rings,
  buzzes and — if the phone is in your pocket and notifications are on — posts one.
- **Marking is the only required action.** No start, no count-in, no confirm, no save
  button: every mark writes the entry as it happens.
- Skipping is recorded as *skipped*, never as a zero. Finishing writes the lift rows into
  `out.lifts`, where the ordinary lift editor and the volume charts read them.

## The interval timer

A timer app inside the log: **Interval timer** on any workout's sheet, and in the **+**
menu on its own. The setup screen opens on the last timer you ran (or a sensible preset
the first time) with **Start** as the biggest thing on it; work, rest and rounds are
steppers right under it, and **More** has sets, rest between sets, get ready, cool-down,
named intervals and repeat. Presets you save are yours and follow you between devices.

The run screen is one huge number in the colour of what you are doing (work, rest, get
ready, cool-down), the round and set, and what comes next. Tap anywhere to pause; back,
skip and ±10s are along the bottom. It beeps on the web and buzzes on the iPhone, keeps
the screen awake, and picks up at the right second after the phone was locked or the page
reloaded. A climbing card that declares a timer offers it as a preset; logging its sets is
still workout mode's job.

## Workout mode — the climbing timer

What the **climbing cards** use: the interval timer's face (the phase in its colour, the
clock, "Max hangs · Set 1 of 3") with a set log behind it, and the how-to on screen between
sets. A session with a
prescription gets the runner instead. You mark the **set**, not the rep.

- Numbers arrive pre-filled from the prescription, so a session you did as written is
  zero typing — confirm and move on. Anything that didn't match, you edit at the end of
  the set.
- Rests come from the plan. Where the plan doesn't state one, the clock counts **up**
  with no target instead of counting down to an invented number.
- Every set is saved as you mark it, so leaving halfway loses nothing. The rail at the
  bottom jumps back to any set to fix it.
- It records real elapsed time, which is what makes the weekly training-load chart mean
  something — that chart is RPE × minutes, and before this it was using the duration the
  card *planned* for.

Two browser APIs it leans on need the **HTTPS address** to work:

| | over `http://<tailnet-ip>:8099` | over the `ts.net` name |
|---|---|---|
| Beeps between phases | yes | yes |
| Screen stays awake mid-set | **no — the phone sleeps** | yes |

The wake lock is the one that matters. Use the HTTPS name below if you're running
intervals off it.

## What was removed on 2026-10-25

Bushido became a plain workout log (issue #31). Measured from the live log, the month before
was free-form workouts, rest days, planned and shared workouts, with WHOOP and Strava
attached; nothing else was being used. Removed from the app, the server and the iPhone app:

| gone | was |
|---|---|
| the check-in, `/api/chat`, `CHECKIN.md` | the daily card of hard fields and a message to a (long dormant) coach |
| the journal | behaviours compared against the next morning's recovery |
| achievements | standing goals, each owning categories; their tab and the Progress filter |
| linked goals, `/api/goals` | Totem's goals shown read-only, and the goal-pace notifications |
| quotas, the Week tab, *Plan the week* | counts of workouts per category per week, their bars on Today, and the agent that proposed them |
| the AI coach | threaded conversations, the coach note and its nudges |
| the recommender | `lib/recommend.js`, except `lib/fingers.js`, which the Climbing charts read |

**Nothing stored was deleted.** Old check-in, journal, quota and achievement entries stay
in the log and are simply not read; `coach.json`, `coach/` and `goals.json` stay in the data
directory. The settings that only those features used (the goals toggle, the nutrition
digest) are dropped from `settings.json` the next time Settings is saved.

## What was removed on 2026-09-14

Alongside the pivot, five things came out of `plan.json` and the app rather than being
migrated — the dates were stale and it was already being used as a generic tracker:

| gone | was |
|---|---|
| `weeks[]`, `phases[]` | eleven dated weeks and four phases of a block ending in October |
| `weekTemplate` | one session per weekday per branch — "Thursday is the board day" |
| `trip{}`, `routes[]`, `trip.jsx` | trip mode and its route shortlist |
| `evidence[]` | the standalone evidence index — **every session still carries its own** |
| `sched.weeks` | "weeks 7–10 only" gates, which would have blocked those sessions forever |

The week template's failure was structural rather than cosmetic: Thursday *was* the board
day, so a Thursday you couldn't make cost the board session instead of moving it, and
`templateDebt` only ever half-papered over it. Weekly quotas replaced it, and went
themselves on 2026-10-25.

## Colours

**Carbon** — near-black neutral with a lime accent, picked from three rendered options on
2026-09-15. The neutrals carry a trace of green so the surfaces and the accent read as one
family rather than a colour laid on a grey app.

The chart palette is gated. `npm run palette` (also in `npm test`) checks contrast against
the panel, separation between the categorical series under all three dichromacies, and that
the load ramp actually climbs. Don't change a viz hex without it — it caught the *previous*
palette failing its own colour-blindness check, which had been shipping since those colours
were chosen.

