# Two people, one workout: shared workouts and the owner as trainer

Moved out of AGENTS.md §3 in #98, word for word, because every agent reads that file
and only the ones changing sharing need all of this. **Read it before changing**
`lib/shared.js`, `lib/trainer.js`, `lib/copyqueue.js`, `server/sharedsync.js`,
`peopleRoute` in `server/server.js`, `sharedwith.jsx`, `trainer.jsx`, or their phone
twins. The summary and the invariants that must never break are still in AGENTS.md §3
("More than one person"); this is the detail behind them. A § number here is a section
of AGENTS.md.

- **Shared workouts** (`lib/shared.js`, `sharedwith.jsx`, `server/sharedsync.js`,
  `peopleRoute` in `server.js`): the owner adds someone to one workout from the sheet
  (the sharing chip under the title, #80) without acting as them. Their copy is an ordinary entry in THEIR log (same
  derivable id unless they logged something of their own there, then an `extraEntryId`
  extra), `done: false` (done by §4 once they do something on it or its day has passed,
  never their own tick, which is what `hasOwnMarks` reads, along with any set they typed
  into), carrying the workout's shared facts (`SHARED_OUT_KEYS`: what kind of workout it
  is, `activity` and `category`, since #74, then its name, time and distance) and the
  owner's EXERCISES, never the owner's numbers: reps, weights, effort, feel, notes, gear and
  WHOOP/Strava show only as placeholders on their side. The owner's entry names them in
  `data.sharedWith: [{ id, entryId, sync }]`; the copy carries `data.sharedFrom: { id, name, sync }`,
  stamped by the server. `sync` (#80) is the server's word on whether the copy is in step,
  because the link that says so is on the owner's entry, which the other person cannot read:
  set from the owner's log on every write to a copy (whatever the device sent, `name`
  included: it is pinned to the owner in users.json as the people route stamps it), on a carry
  into it, and on the copy whose link the owner switches, adds or takes off
  (`flagged`, `flagChanges`, `flagCopy` in `server/sharedsync.js`; `flagWritten` in
  `server.js`). A copy written before #80 has no flag and reads as in step if the sync ever
  stamped it (`inStep` in `lib/shared.js`). Their own sheet says it under "with Alex":
  "Exercises stay in step with Alex's" (`inStepLine`).
  - **Sync** ("Keep exercises in step", one switch per person in the sharing panel,
    `sync: true` on the link, on when someone is added). While on, the workout's STRUCTURE is one thing seen from two
    logs: exercises and blocks added, removed, renamed or reordered, and set counts, on
    EITHER side reach the other. Numbers never cross: reps, weights, times, the run
    (`data.run`), `out`, `done`/`undone`/`doneAt` (§4) and WHOOP/Strava stay in the log
    they were written in; the sync only ever writes `plan`, `out.lifts`, the run's set keys
    and `syncBase` on the receiving entry, and with a carry that changes something, the
    workout's kind (`out.activity`/`out.category`) on a side that names neither
    (`withKind`; a copy from before they were shared facts). A set
    or exercise that arrives is blank (an interval keeps its own last set's shape); the
    implement is each person's own. A removal never takes an exercise (or a set) the other
    side has logged on (next bullet). **Whether a hold is counted in seconds or reps is each person's
    own** (#63): an exercise arrives counted the way the sender has it, and after that the
    "sec ⇆" / "reps ⇆" switch on either side changes that side only, like the implement. A
    writer that sends no `measure` key (an app from before holds) keeps the stored one.
    Off, each side stays as it is, and **Copy my exercises to …** in the sharing panel
    (`copyExercises`, add-only; it opens their side and copies through that side's one
    queue) is the way to bring the owner's over; it is hidden while sync is on. A link without the flag (shared before sync existed) is off; turning sync
    on aligns the two by name once and adds what their side lacks.
  - **Numbers typed on the sheet are the log too.** Sets are mostly filled in straight on the
    sheet, never through the runner, so for a change arriving from the OTHER side "logged on"
    also means a lift's set someone typed a number into: the editor marks it `typed: true`
    (`patchSet` in `lib/prescription.js`) and the carry keeps it and its exercise (`typedOn`,
    `loggedOf(…, typed)` in `server/sharedsync.js`). A target the plan arrived with is not
    typed: keeping a plan from the planner clears the mark (`dropEmptyBlocks`), and a share
    never copies it (`theirSet` in `lib/shared.js`), so an untouched set still follows a
    removal. Only a change marks a set: a patch to the number it already had does not, and
    a set ADDED as a copy of the last (`addSet`, `addSetLike`, a share's extra sets, the
    sync's interval sets) carries its numbers but not the mark (#74). A model revision on the entry keeps the mark on every set it left as it was
    (`keepTyped`, through `reviseWeightModes`). Two carve-outs: inside a circuit (one there or one the exercise moved into) an
    exercise has one set, its timing, whatever was typed; and a device's OWN write keeps the
    narrower rule (marked in its run), so an exercise the same person removed on another
    device stays removed. Kept sets leave one side above the other, so when both sides ADDED,
    `wantSets` takes the larger, not the sum; any other mix is the difference, so a removal
    is never undone by an add on the other side. Numbers typed before the mark existed
    carry none, so **on a shared copy (`sharedFrom`) a weight counts as logged, mark or
    not** (#80, `ownWeight`): a share nulls the owner's weights and anything that arrives
    over the sync is blank, so nothing but its own person ever puts a weight there.
    (Without it the owner's removal took Sam's 50 lb Hip thrust, and Undo brought the sets
    back empty.) Reps and a hold's seconds alone are not enough: the share copies those as
    targets. And on EITHER side, **what the app reads as lifted on the receiving entry is
    logged** (#80, `liftedOf` in `server/sharedsync.js`, held equal to `liftsDone` in
    lib/lifts.js by `sharedsync.test.js`): on a done workout dated before today every set
    with a number (done as written), on its own day the typed sets, or the logged row that
    stands for the item. The owner's sets on a done day carry no mark, and Sam's phone
    removing Hip adduction took the owner's 85, 85, 100. A plan for today nobody touched,
    or for a later day, reads as nothing lifted and still follows every removal. In a
    circuit (here, or the one it moves into over there) it keeps the exercise, one set.
    `hasOwnMarks` counts a weight on a copy too.
  - **The merge runs on the server**, because only it sees every write (the owner's
    devices, the other person's own phone, and the owner writing their side through
    `/api/people/:id/entry`) and only it can write both logs (`commitSynced` in
    `server.js`). Identity is a `uid` on every block and plan item, minted by the server
    the first time it sees one and never changed; plan ids (`b0i1`) are positional and are
    never matched on. A model revision is asked for each uid back (the planner's reply
    schema allows it, the revise prompt says to copy it) and `normalizePrescription` keeps
    it, so a renamed exercise stays the same one. An item that still arrives without a uid
    takes the uid of the same-named item it replaced, in its own block only, never one in
    another block (#105: a plan can have Back squat in its main block and in a circuit, or
    three rounds with the same names). An entry shared before uids existed (no uid, no
    `syncBase`) is stamped by its own items on its first write, the stored entry before the
    write is laid onto it, with uids derived from where each row is, so both sides get the
    same ones whichever is written first. That write is numbers only (the rule below): its
    numbers land on the exercise they were written on, and it adds nothing the stored entry
    lacks but an exercise its own device logged on, like any numbers-only write.
  - **The rule** (`intentOf`, stated at the top of `server/sharedsync.js`). Each synced
    entry carries `data.syncBase` (`{ of: <entry id>, rev, plan | lifts }`, its structure as
    the server last wrote it, a new `rev` on every change), and a device sends back the base
    it was given. A **matching or older base of this entry** is structural intent, applied
    as a three-way change: (that base → what it sent) onto what is stored, so whatever
    reached the entry since stays, and only that change is carried. **No base, a foreign
    one or a future one** (another entry's, not a base, a rev this entry never had, a
    different structure under the same rev, or a stored entry not stamped yet) is numbers
    only: its numbers, run, notes and done land on the stored structure; it never removes,
    reorders or adds structure, and nothing it does is carried. A list of exercises that
    merely arrived is not a decision to delete what it lacks. **Logged data is never removed
    by anyone else's write**: a carry keeps what the receiving side has logged on, and a
    write keeps an exercise its own device logged on even when the merge lacks it (on that
    side, uncarried), whatever base it sent. So a stale device, a pre-sync copy and an old
    app can neither resurrect an unlogged exercise nor delete a logged one. The cost: a
    write with no base (in practice only a copy pulled before sync existed) silently drops
    the structural edits it made to exercises it has not logged on. Last-write-wins still
    holds per entry for everything else.
  - **Every synced write gets a receipt** (`acks` on `PUT /api/state` and `POST /api/entry`,
    `ack` on `POST /api/people/:id/entry`; `ackFor` in `server/sharedsync.js`): the base for
    exactly what that write sent. A device that kept editing while the write was out keeps its
    newer copy, and takes the receipt as that copy's base (`withAck`/`adoptAcks` in
    `lib/store.js`, both stores); without it the next write carried the earlier change a
    second time (one set added became two, one taken off came back). A reply lost on the way
    is no receipt, and the next write then reads the change again as before. The owner's
    sheet writes someone's copy one request at a time (`lib/copyqueue.js`, in
    `usePersonCopy`): edits made while one is out go as one write of the copy as it stands
    then, a write still waiting takes each receipt even after the sheet switched sides, a
    copy reopened while its edit is unanswered shows that edit, and one reopened while a save
    landed shows the save, never an older read (`newest`, `openedCopy`), and an answer never
    replaces edits made since it was sent. That covers the sheet's edits; a
    circuit done together writes through its own path (§3, the together rule). An older app
    that ignores receipts behaves as before.
  - A write the sync makes is stamped one millisecond past the RECEIVING entry's own
    `updatedAt`, never the sender's time or the server's clock: a later or skewed sender
    stamp would beat the receiver's own write saved earlier but arriving later (offline
    sets) and LWW would drop their numbers, while the structure survives that write
    through its base. The first version (`server/mirror.js`, removed in #15) followed the
    owner one way and matched exercises by NAME, and was dropped because the owner had no
    say over when their side changed; the switch and uids are what answer that. Do not
    move the merge into a client.
  - **The sheet** (#80): under the title, the done chip and then ONE sharing chip ("with Sam
    · in sync ›", "Add someone"), which opens the sharing panel (per person: the sync
    switch, Copy my exercises while sync is off, Take Sam off; then Add Jo). Nothing about
    who is on it sits between the title and the workout. The header's title, time and
    counts follow the side on screen, never the owner's over Sam's exercises.
  - **Their side** of the sheet: the You / Sam bar (each person's initial and name in their
    colour, and a tick on each side that is done) is pinned to the top while the sheet
    scrolls (`position: sticky` on the web, the sheet header on the phone), and the sheet
    reopens on the side last viewed on this device (`bushido:shared-side`, per entry id;
    also set from a running workout). Every
    exercise's "last time" and the session history come from THEIR log
    (`/api/people/:id/state`), labelled with their name. Their copy is re-read every few
    seconds while open, so the other phone's changes appear. Their side of a planned
    session shows their plan in the same editor, and "Start workout" opens the sides
    runner on their side.
  - The owner's sheet reads and writes the copy through `/api/people/:id/entry`, never
    through the owner's store or cache, so logs still never mix on a device. The server
    refuses non-owners, acting-as, the owner's own log, and any live entry without
    `sharedFrom` (`not-shared`); a sync never writes into an entry they logged themselves.
    Those writes fire no habit sync and no push. **Taking someone off never deletes what
    they logged** (#96): a copy they have marked (`hasOwnMarks`; copied lifts with nothing
    marked on them are not marks) stays in their log as their own workout, unlinked (the
    server flags it not in step); one they never touched is tombstoned. No question either
    way: a toast says which, with Undo (`removePerson`, `takeOffWords`, `undoTakeOff`). It
    used to tombstone a logged copy after a bare browser confirm, with no Undo. A kept copy
    is then theirs: the server stamps it `sharedFrom.off` when the link goes (`flagCopy`,
    `withOff`; cleared when a link is back) and refuses the owner's writes to it through the
    people route (409 `not-linked`). A copy never linked yet is not refused, because adding
    someone writes the copy first and links it second. WHOOP/Strava stay off on their side.
  - **A copy shows its person nothing the planner wrote for the owner** (#96): the plan's
    `why`, `notes`, `thread`, `ask` and `changed`, and the note on each exercise and set
    ("3x10 at 95 was RPE 6 last time"), are the owner's (the owner's recovery and weights,
    in the owner's words). A share leaves them out (`theirPlan`), and the sheet and the
    runner read a plan through `planShown(entry)`, which hides them on any entry with
    `sharedFrom`, so copies shared before the share stripped them are covered without
    rewriting them. A block's note stays: it is the workout's prose and shared structure.
    **Display only**: every write from those screens (the editor on either side, the
    runner's added set) goes through `withStoredWords`, which puts each hidden word back
    byte for byte, so an edit lands on the stored plan and erases nothing (review 2: the
    first version saved the filtered plan and lost the notes for good). What the person
    asks the model on their own copy is theirs:
    the sheet stamps it `ownWords` (`ownWordsOn`) and such a plan is shown whole.
    An older copy's form also reads the activity its plan files it under (`formOut` in
    lib/category.js, the form's twin of `filedOut`), so it no longer asks "What kind of
    workout was this?" with nothing picked. A removal on the other person's own copy says
    the synced line about the owner (`syncedSides`), because it reaches the owner's log too.
  - Pinned by `server/sharedsync.test.js`, the `shared workouts:` and `sync:` steps in
    `server/http.test.js`, `app/shared.test.js`, and the `SessionSheet(… sharing chip …)`,
    `SharePanel(…)`, person bar, `PersonSwitch(…)` and `TheirSide` smoke cases.
- **The owner as trainer** (`lib/trainer.js`, `trainer.jsx`, the same `peopleRoute`):
  without acting as anyone, the owner plans for someone else, sees their week and runs a
  workout from their side. All of it is owner-only, needs someone else on the install and
  is hidden while acting (`planPeople(me)`, the same rule as `sharePeople`).
  - **Planning for someone** is a "For: You / Sam" choice at the top of Plan a workout (both
    routes). Since #59 it is several at once (`who = { me, others }`, `toggleFor`; You on
    by default, never nobody); the four cases are below. For ONE other person the model runs with `for: <id>` on the request (`aiSpaceFor`), so its log,
    plan and About you are theirs; the client context (`plannerContext`) is built from their
    log too, and WHOOP readiness is left out. Nothing is written until the tap (§0.4). Keeping it writes into
    THEIR log through `/api/people/:id/entry`: their day is read first and `placeEntries`
    mints the ids their own + would have, one entry per part (`plannedEntriesFor`), each
    `done: false` (done on its day once touched, then from the next day on, §4) with `data.plannedBy: { id, name }` stamped by the server. The server
    accepts only `daily-…` entries carrying `sharedFrom` or `plannedBy`, and refuses any
    live entry without one of them. (Planning someone's WEEK went with the quotas; a
    `quota-<monday>` entry is refused with a 400.)
    They see a quiet "planned by <owner>" (`plannedLine`) on the row, the sheet and the
    feed, and the entry is theirs to edit, log or delete. They cannot plan for anyone.
  - **Several people at once** (#59; `forOf`, `forWords`, `shareKept` in lib/trainer.js,
    `aiTargetFor` in server.js). `for` is then a LIST of ids (the owner's own among them
    when the owner is doing it too), and the run is the OWNER's: the owner's space and
    flags, no `--add-dir` for anyone else, each person's name and About you put in the
    prompt by the server, and each one's last week built by the app from their own log
    (`groupContext`) and sent as context. The prompt asks for one structure and no loads,
    and the server strips any `weight` the model wrote anyway (`noLoads`, planner.js).
    **You and others**: keeping it places it in the owner's log as always, then shares
    each entry with each of them, sync on, through `addPerson` (exactly the sharing chip on the
    sheet; no second sharing path). **Others only**: `keepPlanFor` once per person,
    independent copies. The last screen is worded from who it actually landed for; a
    person it missed is named, with "Try again for <name>" (others only, `keepForEach`)
    or the sharing chip on the sheet (you and others). The retry is safe to repeat: each part is
    stamped `data.keepKey` (`<draft id or key>:<part>`) and `keepPlanFor` skips a part their
    day already has, so a keep that failed part-way, or whose answer was lost, is never
    written twice. It lives on that last screen only: the server retires the draft once its
    id is in any one log (`isKept`), which is what stops a second device keeping it again.
    A plan for several people carries no loads by either route: the model's are stripped
    on the server (`noLoads`), a hand-built one's on the way in (`withoutLoads`).
    A draft stores `people: [{ id, name, owner? }]`; a draft with a single `for` (every
    draft before #59) still reopens and runs as it did (`whoOfDraft`).
  - **Sides of a workout.** A shared entry opens the runner or workout mode through
    `SidesWorkout`: a You / <name> switcher under the header, the name in a pill and a rule
    in that person's colour (`[data-tone]`: the accent for the owner, the series colours for
    everyone else, so the palette check has nothing new), and a haptic on switch (native).
    Every side stays mounted with its own runner over that person's own entry and its own
    writer (the owner's `saveRun`/`saveOutputs`; anyone else's `usePersonCopy`), so each
    has its own sets, weights, rest clock and done state, and the runner still has ONE
    writer per entry (§6.2). Only the side on screen makes a sound. Finishing a side hands
    over to the next one not done. `applyOut`/`applyRun`/`applyDone` are the owner's write
    paths as pure functions, so both sides write the same shape. A workout nobody shares,
    and everyone but the owner, get the single screen they always had.
  - **A circuit can be done together** (#68): on a shared workout whose link has sync on, a
    circuit waits on its start screen with **Together with Sam** (on by default, remembered
    per device under `bushido:circuit-together`). On, one clock runs on the side it was
    started from, and at its end its result is offered to every other side
    (`shareCircuit` → `togetherWrite`; the owner's through `onOwnerRun`, anyone else's
    through `/api/people/:id/entry`). Off, each side starts its own clock (§6.5). **THE
    TOGETHER RULE** (stated in full above `togetherWrite` in `lib/trainer.js`; written after
    two review rounds in which each fix opened a new way to lose data):
    1. **It fills, it never overwrites.** Seconds, reps and weight land only in blanks,
       per exercise and per set (`endCircuit` `fill`, `fillOut`). A side whose circuit is
       already ended or whose own clock is running is not written at all, and is reported
       as "Sam already logged it" / "Sam is running it": not a miss, no Retry. Totals are
       read off what is there (`run.circuitTimes`, set per block), never added to. The
       shared-sync rule again: logged data is never removed by anyone else's write.
       A blank is filled in the shape the CLOCK ran it (#96): the result names how each
       exercise was timed (`togetherItems`, `by`), and one counted in reps on the side that
       ran it is a count where this side's own timing is blank (`endCircuit` `counted`),
       never a hold of the seconds spent on its reps. A side that says reps or seconds
       keeps its own shape.
    2. **It decides from fresh data.** Someone else's side is re-read from the server right
       before it is written and rule 1 applied to THAT, never to a copy on screen that may
       hold a write that never landed. This run's key (the clock's `startedAt`,
       `run.circuitKeys`) with its result already there is done: success, nothing sent; the
       key without the result is written. Retry is the same path, so a lost reply or a
       second owner device ending the same run sends nothing.
    3. **It is offered only where it can help** (`togetherSides`): sides ended or running
       their own clock are left out, judged on what the SERVER last said (`usePersonCopy`'s
       `server`, which the switcher's "done" reads too); nobody left, no switch. "Running"
       means a LIVE clock: paused, or moved within `STALE_CLOCK_MS` (10 minutes); one that
       ran out, or sat on a count-up, longer ago than that does not block anyone. Who was
       offered it is kept on the run (`run.circuit.with`, the result's `with`), and only
       they are written at its end.
    4. **A miss survives Close**: kept on the device (`bushido:together-pending`, by run and
       person) and tried again, re-read then fill, when the workout or its sheet next opens
       (`retryPending`, `TogetherPending` on the sheet with Try again). A miss is kept only
       while the owner's LIVE entry still carries that run (`circuitKeys` holds its key)
       and the person is still in `sharedWith`, and for at most `PENDING_DAYS` (7);
       otherwise it is dropped from the device, so a workout deleted and planned again
       under the same derivable id never gets another run's numbers.
    5. **Honest words** (`togetherSaid`): "Logged for you", then "and Sam", "Sam already
       logged it", "Sam is running it" or "Not on Sam's log yet" with Try again; never
       "for you and Sam" over a miss.
    One write per side at most, so the owner's push fires once and nobody else's at all.
  - **"Sam's day"** (`PeopleDays` under the day list on Today, `PersonDay`) is a read-only
    week of their log from `/api/people/:id/state`; Today's row lists each session with its
    done state. A session opens in `PersonEntrySheet` (their form without WHOOP/Strava, and
    the owner's sheet parts, #80: the done chip with Undo, and Start, which runs it from
    their side, as the one footer action). It
    never touches the owner's store or cache. Act-as stays exactly as it was.
  - Pinned by the `trainer:`/`ai for everyone:` steps in `server/http.test.js`,
    `server/agentflags.test.js`, `server/prompts.test.js`, `app/trainer.test.js`, and the
    `PlanFlow("For: …")`, `SidesWorkout(…)`, `TodayTab("Sam's
    day" …)` and "planned by" smoke cases, including every absence (one person, acting,
    not the owner).
