# Features

What each part of Bushido does and why it is built the way it is. Written while the app
was in daily use by one person, so it often says "you" and means him; the reasoning
holds for anyone.

## Achievements, quotas, and your day

**Achievements** are the standing things you are training for. Each owns a set of
**quota categories**. Two come with the app; add, edit or delete your own on the
**Achievements** tab, which also shows what this week asks of each. (They are not Totem's *goals*, which are a week or a quarter with metrics
that expire — those show up on Today under their own card.)

| 5.12a | Half iron | Neither |
|---|---|---|
| Power · Power-endurance · Endurance · Fingers · Fun | Run · Bike · Swim | Lift · Support · Anything else |

A **quota** is a count of *workouts* for the current Monday-to-Sunday week — not days. A
day you ride and lift fills two. Nothing is ever assigned to a weekday: you write the
quotas on the **Week** tab, the app pre-fills next week from this one, and whatever is
left on Sunday **expires** rather than following you around as debt.

The Today tab leads with **the bars**: one per category, done over asked-for. **Press one and
it opens onto the sessions behind the number** — what you actually did to fill it, by day,
with the planned ones dotted like the bar; pressing one of those jumps the day nav to it. A
bar with nothing behind it does not open, because an empty panel is a worse answer than no
panel. A workout you have put on a day and not finished carries on from where the solid fill
stops as a **dotted segment** — planned, not done — so "1 of 2, and the second is already written down" reads
differently from "1 of 2, and I have not thought about it". It never counts as progress:
the totals, what is owed and the green tick all ignore it. They are a reading and nothing
else — there is nothing to tap and nothing being suggested. Under them
is **your day**: the sessions actually on it, and nothing you did not put there.

Everything gets onto the day through the **+ button**, bottom right next to the coach. It
offers three things, and the last two are **the same screen over two different catalogs**:

| | |
|---|---|
| **Plan a workout** | An agent writes the sets. See below. |
| **Log a workout** | All 91 activities, your six pinned sports first, grouped as the catalog groups them, with the quota each one fills in the right-hand column. Pick it and the card opens already the right shape — a ride asking for distance and elevation, a swim for yards. |
| **Pick a session** | The plan's own cards: max hangs, the board, the 4×4s, ARC laps, the load-cell tests. Grouped by quota category, protocol, cues and timer included. |

Neither list ranks anything. They are doors in the order the content file declares them,
with a search box — the swap list they replaced is not coming back. Until 2026-09-17 Today also carried a quota board of eleven tappable lanes, a list
of also-recommended blocks, a card explaining why today was what it was, a ranked swap list
and a rest-day suggestion. All of it is gone, because the user does not follow recommended
workouts and a screen that opens with an argument every morning is a screen you stop
reading. `lib/recommend.js` is still there and still tested — the coach can reason with it,
and it is where the two unbypassable finger rules live — but nothing on Today reads it.

## Plan a workout

**+ → Plan a workout.** Pick what — **as many as you like**. A gym trip that is legs, then
core, then ten minutes on the bike is *one* session with three blocks, in the order you
tapped them, against one time budget for the whole trip. The kinds are grouped under
**Lifting**, **Support**, **Swim, bike, run** and **Climbing**, because "Power" and
"Endurance" are climbing categories in this app and ordinary words everywhere else, and
ungrouped they were a coin flip. The discipline follows you onto the next screen ("Climbing ·
Power endurance"). The whole list is `plannerKinds` in `plan.json`, groups included, so it
grows without a rebuild. Then say how long you have and what you want out of it, and an agent goes and reads your log, your athlete profile in
Totem's brain (when one is configured) and last night's WHOOP recovery before writing a session with every set,
load and rest in it.

- **It is read-only.** `Read`, `Grep`, `Glob` and nothing else — no shell, no writes, not
  even to the brain file the coach may append to.
- **Nothing is stored until you keep it.** A session you do not want costs a model run and
  leaves no trace. Tapping *put it on today* is what writes an entry.
- **Everything is editable, before and after.** The review screen is the same editor the
  session sheet shows afterwards: steppers on every rep, load and rest, exercises
  removable, more addable out of the 207-movement catalog.
- **It leaves blanks on purpose.** With no history for a movement it writes no load rather
  than inventing one, and says so. A dash in the box means *you tell me*.
- **The plan and the log stay separate.** `data.plan` is what was asked for; `out` is what
  happened. The runner pre-fills one from the other, so you can still see afterwards where
  you went off it.
- **A multi-part trip lands as separate workouts.** Legs then a run home becomes *two*
  entries, not one: each with its own log, its own quota and — the reason it matters — its
  own slot for a WHOOP or Strava measurement to attach to. A pooled entry has one
  `out.whoop`, so a lift and a ride would fight over it. A block's `counts toward` is what
  decides the seams; a warm-up carries none and joins the workout beside it. The review
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
  the quota you chose. The conversation lives on the entry, so a session written at eight in
  the morning can be argued with at six in the evening.

Then **start the workout** — see the runner below.

### What blocks, and what only advises

Exactly two rules block, and they are the two that can injure you:

- **No hard finger day the day after another** (48 hours, `hardMinGapDays`)
- **No more than three hard finger days a week** (`hardCap`)

Everything else is advisory, with the reason on the card and a tap straight through it:
per-discipline spacing (a hard ride discourages another hard ride, not a board session),
and a whole-body ceiling read off the trailing week's RPE × minutes against your own
logged history.

### Hard finger days are what you SAY they were

Every card that can load the fingers asks, pre-filled from what the session was planned
as. **Your answer is what the budget counts.** A board session you took easy costs
nothing and frees tomorrow; a social night you projected through costs a full exposure.
Before this the plan's declaration was final, which made an easy board night as expensive
as a hard one with no way to say otherwise.

The budget is counted on what you **logged**, never on what you were offered — so a board
that offers hard finger work in three lanes still costs one exposure, because you only do
one of them.

### Two gyms

`Climbing gym` and `Gym` are separate answers in the check-in, because they are separate
places: the board, the wall and the laps live at one, and the other is a weights room where
what the app offers is a lift and the support blocks. Until 2026-09-14 `gym` meant the
climbing gym, since it was the only one.

Say where you are in the check-in and lanes that need somewhere else are struck through
with the reason rather than vanishing, because a card that disappears reads as a bug —
and they stay tappable, since you can say "home" at five and make the gym at eight.

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

A treadmill run asks its incline and never its elevation; an outdoor run is the reverse.
The old card gated incline on `activity: ["run","walk"]` and got both backwards.

**Climbing is deliberately absent from the catalog.** It is logged on the climbing cards,
which are what ask the hard-finger question — a second path in is a way for a hard finger
day to land where the injury budget cannot see it.

## Workouts your watch already knows about

WHOOP and Strava record what you did; Today offers anything with no log entry as a
one-tap card, pre-filled with the time and distance. Waving one off is recorded, so it
does not come back.

This fixed a real hole: three of the six sports in `data/whoop.json` — `dance`,
`mountain-biking`, and WHOOP's own generic `activity` — previously mapped to **nothing**,
so attaching one of those filled in no activity at all and the card stayed a single blank
question. The sport mapping is now read off the catalog rather than a hardcoded list.

**The same ride on both services becomes one row.** WHOOP and Strava both record your
rides, so the card pairs them on time overlap and offers one card, badged with both, that
logs as a single entry carrying both snapshots — Strava answers distance, elevation and
moving time (it has GPS), WHOOP contributes heart rate and strain. It says what it's
claiming (`90 min in common — logged as one`) and **Not the same** splits them for good if
it ever gets it wrong. Without this, one afternoon would fill two bike quotas and count
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
The Totem bridge fills sleep from WHOOP each morning and hands the nights over as
`sleep[]` in the same `/api/whoop/training` pull as recovery (`sleepFor` and
`sleepNights` in `server/whoop.js`). Nights are filed under the morning woken into, the
same calendar as recovery. The coach reads them too (`whoopDigest`). A morning with no
scored night shows no card.

## You, and your gear

The header is your Strava name and picture (the sync state survives as the dot on it).
Tapping it opens a panel anchored under it — a bottom sheet on a phone — which absorbed three tabs — **Gear**, **Testing** and **Why**
— because none of them is touched mid-session and all three were taking room in a bottom bar
used one-handed. The tab bar is now **Today · Week · Log · Progress**.

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

Every workout, newest first, grouped by day and filterable by quota category — with its
numbers, what it was done on, and which services recorded it. The charts moved to their own
**Progress** tab; they were never history.

The old climbing-only quick-log (edge mm, added lb, hang seconds) is gone rather than moved:
bodyweight is on the profile and writes the same series the charts already use, and a max
hang is logged by the session that *is* that test.

## Progress

Ask a question first: filter by **achievement**, **category**, **one sport or session**, or **one
lift exercise**, over 4 weeks / 8 weeks / 6 months / all time. The charts follow — filtering
to the half iron drops every finger chart, filtering to bench press brings up its top set and
volume.

This replaced about twenty hardcoded charts that were all on screen at once and nineteen of
which were about climbing. Each chart now declares when it means anything, so the page draws
what answers the question you asked. The very specific climbing numbers — critical force,
4×4 rest, straddle reach — are declared by the sessions themselves in `plan.json` and appear
under **This session** when that session is in scope.

The filter only offers what you've actually logged, with counts, because a dropdown of eleven
categories when you've done five mostly returns empty charts.

## The journal

What the coach check-in became. 42 behaviours modelled on WHOOP's — sleep, intake, state,
recovery — **all off until you turn them on**, because a journal with forty questions is a
journal you answer once. You can add your own: toggle, 1–10 slider, number or note, and a
custom metric correlates exactly like a catalogued one.

**Patterns** compares each tracked behaviour against the **next morning's** recovery, because
what you did Tuesday shows up in Wednesday's score. Below four days either side it says "not
yet" rather than showing a number that will move twenty points next week.

This is native rather than synced because it had to be: WHOOP's API has no journal, behaviour
or survey endpoint, and is read-only for user data. Which is the better outcome — Bushido has
your recovery *and* knows what you trained, so it can answer things WHOOP structurally can't.

Where you are, how long you've got and how the fingers read survive as the top row: the
recommender genuinely needs those, and they still write the same entry they always did.

## Goals from Totem

Optional, and only with a Totem bridge configured. Goals live in **Totem** — it has the
schema, the MCP tools and the weekly review. Bushido shows the ones you link to it,
read-only, with their progress. The host it matches is `VITE_BUSHIDO_HOST` at build time, or
the host the page is open at when that is unset (see `docs/operations.md`):

```
goals__link_goal(<id>, kind: 'url', url: 'https://<your Bushido host>', label: 'Bushido')
```

That's an ordinary `goal_links` row, so marking a goal for Bushido needs no schema change and no
new column. The numbers shown are Totem's own — including anything a Strava connector is
feeding and any sub-goal rollup — because a number with two opinions will disagree with
itself.

## The AI coach

Its own tab, plus a floating bubble on every other tab — **same threads, two views**, so a
quick question is findable later. Threads are files under `data/coach/`, not log entries.

It's an agent with tools: it can read your training log, the app's own content, the web,
and — when configured in Settings — an athlete profile file and a food-log digest, and it
goes and looks before it answers. With a profile file set it can append a dated memory
beside it; without one it has no write access at all. It runs the Claude Code CLI headless
(Settings → AI), and what you write under *About you* in Settings goes with every turn.

What it cannot do is enforced by flags rather than by asking nicely: **no shell, no editing
code or content, and it can never write to `data/state.json`** — the one file here with no
upstream copy. It *offers* sessions as cards; they land on your day only when you tap one,
through the same path your own taps use, and the two finger rules are enforced before any
suggestion is read.

## The old check-in

> **The check-in coach is switched off.** `examples/coach/CHECKIN.md` and `server/chat.js` are written
> around the eleven-week climbing block — its phases, its week focus, the trip it counted
> down to — and all of that was deleted on 2026-09-14. Left running it would keep
> confidently referencing a block that no longer exists, and fluent wrong advice is harder
> to ignore than none. The `/api/chat` route has since been removed (the AI coach above
> replaced it) and the hard fields still save. Bringing it back means rewriting the prompt
> and restoring the route.
>
> Everything below describes how it worked and how it should work again once CHECKIN.md
> is rewritten for standing achievements and a quota week.

The first card on the Today tab. Two halves:

- **Hard fields** — bodyweight, how you feel out of ten, how you slept, how the fingers
  are, how long you've got, where you are. They save as you touch them; bodyweight goes
  into the same series it always has, so the chart is unbroken.
- **A message box.** Tell the coach the thing the fields can't hold — *"can't get to the
  gym tonight, going Sunday instead"* — and it answers, having read your last three weeks
  of sessions, your own notes on them, your athlete profile, and what WHOOP has on you:
  a fortnight of recovery, HRV and resting HR against your own baselines, your recent
  workouts, and the heart rate on the sessions you attached one to — and what Strava has: four
  weeks of riding/running totals, the recent activities, each bike's mileage, and the ride on any
  session you attached one to. On the *Other training* card, attaching a ride fills in its
  distance, time, speed and elevation for you.

The reply can lean on today's recommendation with a capped, dated, explained nudge, and
it can offer sessions — cards with buttons, under the reply, that don't move your day
until you press one. It **cannot** edit the plan, and it cannot break the two rules that
can injure you — no hard finger day the day after another, and the weekly cap — because
nudges are read after those blocks have already returned.

A turn is one headless Claude run and takes about twenty seconds; the card counts while
it waits. What you typed is saved *before* the coach is asked, so with the box unreachable
you lose the reply and never the note. Nothing schedules anything: telling it on Thursday
that the gym moved to Sunday works because every check-in is in the context of the next
one, so Sunday's coach is reading Thursday's message.

The WHOOP digest is built server-side from `data/whoop.json`, never posted by the browser
— the coach's view of your physiology isn't something a phone gets to write.

Configure with `BUSHIDO_CHAT_MODEL` (default `claude-sonnet-5`), `BUSHIDO_CHAT_EFFORT`
(default `low`) and `BUSHIDO_CHAT_TIMEOUT_MS`.

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

## Workout mode — the climbing timer

The older full-screen timer, still what the **climbing cards** use: a rep clock, a row of
pips that fills as the reps go by, and the how-to on screen between sets. A session with a
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
`templateDebt` only ever half-papered over it. Quotas say how many of each kind the week
wants and leave the days alone.

## Colours

**Carbon** — near-black neutral with a lime accent, picked from three rendered options on
2026-09-15. The neutrals carry a trace of green so the surfaces and the accent read as one
family rather than a colour laid on a grey app.

The chart palette is gated. `npm run palette` (also in `npm test`) checks contrast against
the panel, separation between the categorical series under all three dichromacies, and that
the load ramp actually climbs. Don't change a viz hex without it — it caught the *previous*
palette failing its own colour-blindness check, which had been shipping since those colours
were chosen.

