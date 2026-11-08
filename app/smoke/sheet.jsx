/* Smoke cases: the session sheet: header, body, footer, the log form, details, how-to.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import { SessionSheet } from '../src/sheet.jsx'
import { WorkoutRunner } from '../src/runner.jsx'
import { climbingFolders } from '../src/lib/folders.js'
import { normalizePrescription, emptyRun, setCircuit } from '../src/lib/prescription.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { SessionLog, NameField, SessionDetails } from '../src/sessionlog.jsx'
import { ExerciseCard, implementPick } from '../src/exercises.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import { SectionBody } from '../src/session.jsx'
import { HowSheet, MovesList, HowRow } from '../src/howto.jsx'
import { FIGURES, hasFigure } from '../src/lib/figures.jsx'
import { resolveCeiling } from '../src/lib/force.js'
import { hasWorkout } from '../src/lib/workout.js'
import { TimerHost, openTimer, closeTimer, timerRequestFor } from '../src/timer.jsx'
import { BUILT_INS } from '../src/lib/timer.js'
import {
  plan, example, entries, noop, otherCard, priorLifts, TODAY, back, rich, noteHistory,
  cfEntries, text, augOnly, uniWork, LIFT_FIELD, SQUAT, PRESCRIPTION, PLANNED_CARD,
  PLANNED_ENTRY, HELD_PLAN,
} from './fixtures.jsx'

export default [
  /*
   * ABSENCES, which are the only thing a render test can say about a removal.
   *
   * The add-on pills and the "MAIN SESSION" strap came off the sheet as unused
   * clutter that got in the way. Putting either back is a
   * change that still renders, so asserting they are gone is the only way to
   * catch it — same argument as `TodayTab(empty day offers nothing)`.
   */
  ['SessionSheet(no add-ons, no strap)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'hard-home')
    const t = text(renderToString(
      <SessionSheet opt={opt} entry={null} tone="rec" entries={[]}
        onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />))
    if (/Add-ons for this session/.test(t)) throw new Error('the add-on pills are back')
    if (/Main session|Added session/.test(t)) throw new Error('the tone strap is back')
    if (!t.includes(opt.name)) throw new Error('the sheet is not about the session it was handed')
  }],
  /*
   * The pencil and the bin, beside the X: delete sits at the top near the close
   * button, behind a confirmation screen, with an edit pencil next to it. The
   * thing they replaced was two text links at the very bottom of the form, which
   * is a long scroll to do something irreversible.
   *
   * The pencil grew from "rename" to the whole of `SessionDetails`: everything
   * below the WHOOP and Strava blocks, except the notes and "how hard was it",
   * moved into the edit modal.
   */
  ['SessionSheet(edit and remove live in the header)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Ride', minutes: 45, out: { activity: 'bike' } } }
    const html = renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rec" entries={rich} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />)
    if (!/aria-label="Edit this workout"/.test(html)) throw new Error('no pencil beside the X')
    if (!/aria-label="Remove from today"/.test(html)) throw new Error('no remove button beside the X')
    // And the old footer link is gone, so there is exactly one way to do it.
    if (/Remove from today<\/button>/.test(html.replace(/aria-label="Remove from today"[^>]*>/, '')) &&
        /linkbtn extra-rm/.test(html)) {
      throw new Error('the footer remove link survived')
    }
  }],
  // Every menu entry has to survive being read in all three viewers: the picker
  // dialog, the day-list sheet, and the fullscreen page. These are where a bad
  // property access in hand-written plan.json content actually shows up.
  ...plan.dailyMenu
    .filter(m => m.role !== 'adjunct' && m.role !== 'rest')
    .flatMap(m => {
      const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: m.id, level: m.level, name: m.name, minutes: m.minutes, out: {} } }
      return [
        [`Sheet(${m.id})`,
          <SessionSheet opt={m} entry={entry} tone="rec" entries={rich} isFuture={false}
            onLog={noop} onSave={noop} onClose={noop} />],
      ]
    }),
  /*
   * "Log another workout today" came OFF the sheet on 2026-09-21. The day list's
   * own button (pinned separately, below) and the + button are
   * both one tap from here, and a third route at the foot of a form was part of
   * what made this screen read as a maze.
   *
   * Pinned as an absence, and pinned NEXT TO the day-list route deliberately: the
   * mistake to avoid is not "this button came back", it is removing a door and
   * leaving no door, which is exactly what happened to the climbing cards when
   * the swap list went.
   */
  ['Sheet(no second route to a second session)',
    <SessionSheet opt={otherCard} tone="extra" entries={rich} isFuture={false}
      entry={{ id: `daily-${TODAY}-log-workout`, kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Lift', minutes: 52,
          done: true, out: { activity: 'lift', duration: 52, rpe: 5 } } }}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />,
    html => {
      if (/Log another workout today/.test(text(html))) {
        throw new Error('the sheet\u2019s "and another one" link is back')
      }
    }],
  /*
   * A rename is the HEADER's name too, not just a line inside the form.
   *
   * `titleFor` puts their words over the planner's title over the card's, and this
   * case is the wiring rather than the ordering (which `naming.test.js` pins):
   * every one of these headers used to read `pres?.title || nameFor(...)`, so a
   * renamed planned session would have kept announcing itself as "Legs".
   */
  ['Sheet(renamed, and the header says so)',
    <SessionSheet opt={otherCard} tone="extra" entries={rich} isFuture={false}
      entry={{ id: 'nm3', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'log-workout', level: 2, name: 'Bike', minutes: 22,
          done: true, plan: { title: 'Zone 2 ride' },
          out: { activity: 'bike', duration: 22, title: 'Commute' } } }}
      onLog={noop} onSave={noop} onSetDone={noop} onClose={noop} />,
    html => {
      const t = text(html)
      if (!/Commute/.test(t)) throw new Error('the header ignored the rename')
      if (/>Zone 2 ride</.test(t)) throw new Error('the plan\'s title outranked his own words')
    }],
  // An unlogged main and an add-on both reach the sheet by different paths.
  ['Sheet(unlogged)', <SessionSheet opt={plan.dailyMenu[0]} entry={null} tone="rec" entries={rich}
    isFuture={false} onLog={noop} onSave={noop} onClose={noop} />],
  ['Sheet(adjunct, no log)', <SessionSheet opt={plan.dailyMenu.find(m => m.role === 'adjunct')} entry={null}
    tone="adj" entries={rich} isFuture={false} onLog={null} onSave={noop} onClose={noop} />],
  ['Sheet(extra, removable)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'x', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'extra', optId: 'fun-boulder', level: 3, name: 'Bouldering with friends', minutes: 90,
        out: { intensity: 3, rpe: 6 } } }}
    tone="extra" entries={rich} isFuture={false} onLog={noop} onSave={noop} onRemove={noop}
    onClose={noop} />],
  /* Workout mode is offered per SESSION, and the sessions that lost it must lose
   * only the timer — the set log, the done button and the notes are the whole
   * point of opening the sheet and are untouched. */
  ['Sheet(a session with no timer to run)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'lead-laps')}
      entry={{ id: 'll2', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'extra', optId: 'lead-laps', level: 3, minutes: 30, done: false, out: {} } }}
      tone="extra" entries={rich} isFuture={false} onLog={noop} onSave={noop}
      onStartWorkout={noop} onSetDone={noop} onClose={noop} />,
    html => {
      // Nobody stands at a wall driving a timer through doubled laps.
      if (/Start workout/.test(text(html))) throw new Error('doubled lead laps must not offer a timer')
      if (!/Doubles/.test(text(html))) throw new Error('but it still logs set by set')
    }],
  ['Sheet(a session that does run a clock)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'max-hangs')}
      entry={{ id: 'mh', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { slot: 'main', optId: 'max-hangs', level: 4, minutes: 25, done: false, out: {} } }}
      tone="rec" entries={rich} isFuture={false} onLog={noop} onSave={noop}
      onStartWorkout={noop} onSetDone={noop} onClose={noop} />,
    html => {
      if (!/Start workout/.test(text(html))) throw new Error('a 7-second hang needs the countdown')
    }],
  // Per-session notes, and the repeat lookup that surfaces the previous one.
  ['SessionLog(notes + history)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'cur', kind: 'daily', date: '2026-10-01', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    entries={noteHistory} onSave={noop} bare />],
  /* Time spent is on EVERY session, and the estimate is a placeholder rather than
   * a pre-filled value — a pre-filled 150 is a number you confirm without
   * reading, and confirming the plan is what the field exists to stop. */
  ['SessionDetails(time spent, nothing said)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts', kind: 'daily', date: '2026-10-06', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      const est = plan.dailyMenu.find(m => m.id === 'four-by-four').minutes
      if (!/aria-label="Time spent, in minutes"/.test(html)) throw new Error('no time-spent field')
      if (!new RegExp(`placeholder="${est}"`).test(html)) throw new Error('the estimate is not the placeholder')
      if (new RegExp(`aria-label="Time spent, in minutes"[^>]*value="${est}"`).test(html)) {
        throw new Error('the estimate was pre-filled into the field')
      }
    }],
  ['SessionDetails(time spent, typed over everything)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts2', kind: 'daily', date: '2026-10-07', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80,
        out: { minutesSpent: 65, elapsedMin: 71, whoop: { minutes: 96 } } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      if (!/value="65"/.test(html)) throw new Error('the typed number is not in the field')
      // What the user typed has settled it, so nothing is being offered instead.
      const t = text(html)
      if (/use \d+ from/.test(t)) throw new Error('a typed number should not be second-guessed')
      // No jargon under it ("RPE", "training load"): the typed number needs no sentence (#41).
      if (/RPE|training-load/.test(t)) throw new Error('jargon under the time box')
    }],
  /* Attaching a WHOOP workout SETS the length — the whole point of the ordering.
   * Nothing to confirm, and the number in use is on screen rather than implied. */
  ['SessionDetails(time spent, from WHOOP)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'ts4', kind: 'daily', date: '2026-10-09', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80,
        out: { elapsedMin: 71, whoop: { minutes: 96, sport: 'rock-climbing' } } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      const t = text(html)
      if (!/Using the 96 min WHOOP recorded/.test(t)) throw new Error('the number in use is not stated')
      if (!/placeholder="96"/.test(html)) throw new Error("the field should show WHOOP's number")
      // Never pre-FILLED — a value the user did not give must not look like one the user did.
      if (/aria-label="Time spent, in minutes"[^>]*value="96"/.test(html)) {
        throw new Error('pre-filled a number he never typed')
      }
      // The losing measurement is the one thing the user cannot see, so it is a tap.
      if (!/use 71 from the timer instead/.test(t)) throw new Error("workout mode's clock is not offered")
    }],
  // Log a workout already asks for its own duration, so it must not grow a second box.
  ['SessionDetails(asks its own duration)', <SessionDetails session={plan.dailyMenu.find(m => m.id === 'log-workout')}
    entry={{ id: 'ts3', kind: 'daily', date: '2026-10-08', updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, minutes: 38, out: { activity: 'run', duration: 38 } } }}
    entries={noteHistory} onSave={noop} />,
    html => {
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('two boxes for one fact: it already asks for its duration')
      }
    }],
  /* ------------------------------------------------ the free-form card's form
   *
   * *Log a workout* is one card covering a run, a bike ride and a lift, so what
   * it ASKS follows what was picked — originally it asked a lifting day
   * for its distance and incline, and had nowhere at all to put six exercises.
   * These cases pin the three states, because a gate that stops matching renders
   * as a field silently missing rather than as an error.
   */
  ['SessionLog(other training, nothing picked yet)', <SessionLog session={otherCard}
    entry={{ id: 'ot0', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: {} } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/What did you do\?/.test(t)) throw new Error('the one question that is always a question')
      // Everything else is noise until it knows what the workout was.
      if (/Distance/.test(t)) throw new Error('an empty card is asking for a distance')
      if (/Incline/.test(t)) throw new Error('an empty card is asking for an incline')
      if (/search \d+ of them/.test(t)) throw new Error('an empty card is offering the lift catalog')
      if (/How hard was it/.test(t)) throw new Error('an empty card is asking how hard nothing was')
    }],
  ['SessionLog(other training, a run)', <SessionLog session={otherCard}
    entry={{ id: 'ot1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 3, out: { activity: 'run', duration: 38, distance: 3.1 } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (!/Distance/.test(t)) throw new Error('a run has no distance field')
      if (!/Elevation/.test(t)) throw new Error('an outdoor run records no elevation')
      // Incline is a treadmill setting. The old card gated it on `activity:
      // ["run", "walk"]`, so a road run was asked its incline and a treadmill was
      // asked its elevation gain — exactly backwards, for both.
      if (/Incline/.test(t)) throw new Error('a road run is being asked for its incline')
      if (/What did you lift/.test(t)) throw new Error('a run is being asked for its exercises')
      // Average speed is distance over time — arithmetic the user must never be asked
      // to do. Offered as a PLACEHOLDER, never as a value the user did not give.
      if (!/placeholder="4\.9"/.test(html)) throw new Error('the pace was not worked out for him')
      if (/aria-label[^>]*speed[^>]*value="4\.9"/i.test(html)) throw new Error('a computed number was pre-filled')
      if (!/Worked out from your distance and time/.test(t)) throw new Error('the derived number is unlabelled')
      // The card's example numbers ("450 ft") are not shown: in a number box they
      // read as guesses the app had made, and it had made none (#41).
      if (/placeholder="450"|placeholder="45"|placeholder="14\.2"/.test(html)) throw new Error('a content example is posing as a guess')
      // The activity is a row that opens the picker, not a "Change" link in a box.
      if (!/class="list-row actrow"/.test(html)) throw new Error('the activity is not a row')
      if (/actpick-change/.test(html)) throw new Error('the underlined "Change" link is back')
      // The form is open: no fold title over it.
      if (/Session logged|How did it go/.test(t)) throw new Error('the form is folded behind a title again')
    }],
  /*
   * RENAMING ONE WORKOUT.
   *
   * A single workout can be renamed, with quick-entry names as taps so typing is
   * only needed for a genuinely specific name. Three things are pinned here and
   * each has a way of failing silently. The box must be EMPTY with the session's
   * current name as its placeholder — a pre-filled "Bike" is a string the user
   * confirms without reading,
   * and clearing the box is how the default comes back. Every name the content
   * declares for the discipline has to be IN THE PAGE, folded or not, or a chip
   * is unreachable and no rendering test would notice. And a name the user gave has
   * to read back in the box rather than as a placeholder they might type over.
   *
   * Rendered as `NameField` directly, because that is where it
   * lives now: the box left the log form for a layer of its own behind the
   * pencil in the sheet's header, and a render suite cannot press a pencil. That
   * the pencil EXISTS is pinned separately, in SessionSheet.
   */
  ['NameField(an empty box, and every chip in the page)',
    <PlanProvider plan={plan}>
      <NameField session={otherCard} out={{ activity: 'bike', duration: 22 }} onChange={noop} />
    </PlanProvider>,
    html => {
      const t = text(html)
      if (!/class="out-name-box"[^>]*placeholder="Bike"/.test(html)) {
        throw new Error('the name it already has should be the box\'s placeholder')
      }
      if (/class="out-name-box"[^>]*value="Bike"/.test(html)) {
        throw new Error('a name he did not type must never be pre-filled')
      }
      for (const n of [...plan.quickNames.byDiscipline.bike, ...plan.quickNames.any]) {
        if (!t.includes(n)) throw new Error(`no chip for "${n}" — an unreachable quick name`)
      }
      if (!/Commute/.test(t)) throw new Error('the commute chip is the whole point')
      if (/Long run/.test(t)) throw new Error('a ride is being offered running names')
    }],
  ['NameField(his own name reads back)',
    <PlanProvider plan={plan}>
      <NameField session={otherCard} out={{ activity: 'bike', title: 'Lunch ride with the club' }} onChange={noop} />
    </PlanProvider>,
    html => {
      if (!/class="out-name-box"[^>]*value="Lunch ride with the club"/.test(html)) {
        throw new Error('a name he typed belongs in the box, not in the placeholder')
      }
      // The way back to the default, in the card's own words.
      if (!/use “Bike”/.test(text(html))) throw new Error('no way back to what the card calls it')
    }],
  /*
   * WHAT THE LOG FORM NO LONGER HOLDS, which is the only thing a render test can
   * say about the split. Everything below the WHOOP and Strava blocks, except the
   * notes and "how hard was it", moved to the edit modal. So the name, the gear,
   * "just miles" and time spent are all in
   * `SessionDetails` behind the pencil — and what STAYED is asserted here too,
   * because moving one field too many is the easy mistake and it renders fine.
   */
  ['SessionLog(the details moved out, the notes and the effort stayed)',
    <PlanProvider plan={plan}><SessionLog session={otherCard}
      entry={{ id: 'nm3', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, out: { activity: 'bike', duration: 22 } } }}
      entries={[]} onSave={noop} bare /></PlanProvider>,
    html => {
      const t = text(html)
      if (/out-name-box/.test(html)) throw new Error('the name box is back in the log form')
      if (/class="gear/.test(html)) throw new Error('the gear picker is back in the log form')
      if (/Just miles — not a workout/.test(t)) throw new Error('the just-miles box is back in the log form')
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('time spent is back in the log form')
      }
      // And what is meant to STAY there.
      if (!/Notes<\/span>/.test(html)) throw new Error('no plain notes box')
      if (!/What to improve next time/.test(t)) throw new Error('the improve box went with it')
      // The notes and the effort question are the two things that stay.
      if (!/How hard was it\?/.test(t)) {
        throw new Error('"how hard was it" was supposed to stay on the form')
      }
    }],
  /* And every one of them IS in the panel behind the pencil. A field that left
   * one screen and arrived on no other is indistinguishable from a deletion. */
  ['SessionDetails(name, gear, just miles and time spent, all in one place)',
    <PlanProvider plan={plan}><SessionDetails session={otherCard}
      entry={{ id: 'nm4', kind: 'daily', date: TODAY, updatedAt: 'z',
        data: { optId: 'log-workout', level: 2, minutes: 22,
          out: { activity: 'bike', duration: 22 } } }}
      entries={[]} onSave={noop} training={undefined} onTraining={noop} /></PlanProvider>,
    html => {
      const t = text(html)
      if (!/out-name-box/.test(html)) throw new Error('no name box')
      if (!/Just miles, not a workout/.test(t)) throw new Error('no just-miles box')
      // This card asks for its own duration, so it must NOT also get the generic
      // box — two boxes for one fact is two answers. See asksItsOwnDuration.
      if (/aria-label="Time spent, in minutes"/.test(html)) {
        throw new Error('a card that asks its own duration grew a second box')
      }
    }],
  /* The lift form: the exercise search, and a logged session reading back with
   * its implement, its sets and what the user lifted last time. */
  ['SessionLog(other training, a lift)', <SessionLog session={otherCard}
    entry={{ id: 'ot2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', duration: 52, lifts: [
        { uid: 'bent-over-row-1', key: 'bent-over-row', name: 'Bent-over row', group: 'Back',
          implement: 'dumbbell', implementLabel: 'Dumbbell',
          sets: [{ reps: 10, weight: 30 }, { reps: 10, weight: 30 }, { reps: 8, weight: 30 }] },
        { uid: 'external-rotation-1', key: 'external-rotation', name: 'Shoulder external rotation',
          group: 'Shoulders', implement: 'cable', implementLabel: 'Cable',
          sets: [{ reps: 15, weight: 7.5 }] },
      ] } } }}
    entries={priorLifts} onSave={noop} bare />,
    html => {
      const t = text(html)
      if (/Distance/.test(t)) throw new Error('a lift day is being asked for its distance')
      if (/Elevation|Incline/.test(t)) throw new Error('a lift day is being asked about hills')
      if (!/Bent-over row/.test(t) || !/Shoulder external rotation/.test(t)) {
        throw new Error('the logged exercises did not render')
      }
      /*
       * THE SAME CARD THE PLANNER USES, because planning a workout and logging
       * one should look exactly the same. So: one card open (the
       * first), every other collapsed to its name and its summary line, implement
       * CHIPS rather than a native select, and steppers rather than a table of
       * bare inputs. `Sheet(a planned session)` pins the same shape from the other
       * side; if these two ever disagree, one of them has grown its own copy.
       */
      if ((html.match(/class="presc-sets"/g) || []).length !== 1) {
        throw new Error('exactly one exercise should open, as on the plan side')
      }
      if (/<select/.test(html)) throw new Error('the implement select survived the merge')
      if (!/class="stepper/.test(html)) throw new Error('the weight box is not a stepper')
      // What it was loaded with, and what the weight column therefore MEANS. The
      // cable's card is folded, so only the open one states its units.
      if (!/lb per hand/.test(t)) throw new Error('a dumbbell weight column must say per hand')
      if (!/class="implchip on"/.test(html)) throw new Error('the chosen implement is not marked')
      // Unequal sets read as themselves — the point of logging per set is that a
      // last set that dropped off shows up as one. On the HEADER now, so a folded
      // card still says what it was.
      if (!/10 @ 30 lb, 10 @ 30 lb, 8 @ 30 lb/.test(t)) throw new Error('the set summary is missing')
      if (!/1 × 15 @ 7\.5 lb/.test(t)) throw new Error('equal sets should collapse')
      // Spacing is at the mercy of how SSR splits the text nodes, so assert the
      // facts rather than the punctuation between them.
      if (!/last time/.test(t) || !/2026-09-02/.test(t) || !/1 × 5 @ 175 lb/.test(t)) {
        throw new Error("last time's numbers are not on screen")
      }
      if (!/4 sets/.test(t)) throw new Error('the session line is missing')
      // And the way in to the next exercise — behind the same dashed button the
      // plan side uses, rather than a search box always taking up the page.
      if (!/Add an exercise/.test(t)) throw new Error('no way to add an exercise')
    }],
  /* What the weight MEANS is switched on its own label (#58): a Bulgarian split
   * squat with ONE dumbbell. The label under the weight is the button, says
   * what it is now, and one tap is the other meaning. */
  ['SessionLog(a dumbbell lift: the weight label is the switch, in the mode it was logged in)', <SessionLog session={otherCard}
    entry={{ id: 'ot58', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'bulgarian-split-squat-1', key: 'bulgarian-split-squat', name: 'Bulgarian split squat', group: 'Quads',
          implement: 'dumbbell', implementLabel: 'Dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell',
          sets: [{ reps: 8, weight: 25 }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if ((html.match(/class="stepper-label stepper-swap"/g) || []).length !== 1) {
        throw new Error('a dumbbell lift has no switch on its weight label (one set, one switch)')
      }
      if (!/<button[^>]*class="stepper-label stepper-swap"/.test(html)) throw new Error('the switch is not a button')
      // The box says it in a word or two, so reps and weight keep one row on a phone;
      // the full wording is the summary's and "last time"'s (review of #60).
      const box = (html.match(/class="stepper-label stepper-swap"[^>]*>(.*?)<\/button>/) || [])[1] || ''
      if (box.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim() !== '1 DB') throw new Error(`the weight box says "${box.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim()}", not "1 DB"`)
      if (!/aria-label="Weight in lb · one dumbbell\. Switch to lb per hand"/.test(html)) {
        throw new Error('the switch does not say what a tap does')
      }
      // The header says the mode under the name, and keeps its summary short so a
      // long name is not squeezed on a phone (review of #60).
      if (!/<span class="presc-mode">one dumbbell<\/span>/.test(html)) throw new Error('the header does not say the meaning')
      if (!/<span class="presc-itemline">1 × 8 @ 25 lb<\/span>/.test(html)) throw new Error('the header summary is not the short one')
      if (/role="dialog"|<dialog/.test(html)) throw new Error('a dialog for a one-tap switch')
    }],
  ['SessionLog(a dumbbell lift in its default: the switch offers one dumbbell)', <SessionLog session={otherCard}
    entry={{ id: 'ot58b', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'bent-over-row-1', key: 'bent-over-row', name: 'Bent-over row', group: 'Back',
          implement: 'dumbbell', implementLabel: 'Dumbbell', sets: [{ reps: 10, weight: 30 }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const box = (html.match(/class="stepper-label stepper-swap"[^>]*>(.*?)<\/button>/) || [])[1] || ''
      if (box.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim() !== 'per hand') throw new Error(`the default's box says "${box.replace(/<[^>]+>/g, '').replace(/<!--.*?-->/g, '').trim()}"`)
      if (!/aria-label="Weight in lb per hand\. Switch to lb · one dumbbell"/.test(html)) {
        throw new Error('an old row with no mode is not in the default, or offers nothing')
      }
    }],
  /* And the absence: a machine has one meaning, so no switch is invented. */
  /* The chip already chosen does nothing (#58 follow-up): memory is applied when
   * an implement is PICKED, so tapping the chosen one again must not undo a
   * switch made since. */
  ['ExerciseCard(tapping the chosen implement again writes nothing)', null, () => {
    const field = liftFieldOf(plan)
    const dumbbell = field.implements.find(i => i.value === 'dumbbell')
    const barbell = field.implements.find(i => i.value === 'barbell')
    const log = [{ id: 'old', kind: 'daily', date: '2026-10-01', updatedAt: 'a', data: { out: { lifts: [
      { uid: 'bss-1', key: 'bulgarian-split-squat', implement: 'dumbbell', weightMode: 'one', weightLabel: 'lb · one dumbbell', sets: [{ reps: 8, weight: 25 }] }] } } }]
    // Memory says one dumbbell; this session the user switched back to per hand.
    const item = { kind: 'lift', exercise: 'bulgarian-split-squat', implement: 'dumbbell', weightLabel: 'lb per hand' }
    if (implementPick(field, item, dumbbell, log, 'today') !== null) throw new Error('the chosen chip re-applied memory over a switch made in this session')
    const toBar = implementPick(field, item, barbell, log, 'today')
    if (toBar?.implement !== 'barbell' || toBar.weightMode !== null || toBar.weightLabel !== 'lb on the bar') {
      throw new Error(`another implement did not write itself in its default: ${JSON.stringify(toBar)}`)
    }
    const fromBar = implementPick(field, { ...item, implement: 'barbell' }, dumbbell, log, 'today')
    if (fromBar?.weightMode !== 'one') throw new Error('picking the dumbbell lost the remembered mode')
  }],
  ['SessionLog(a machine lift: no switch, just its label)', <SessionLog session={otherCard}
    entry={{ id: 'ot58c', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: { activity: 'lift', lifts: [
        { uid: 'leg-extension-1', key: 'leg-extension', name: 'Leg extension', group: 'Quads',
          implement: 'machine', implementLabel: 'Machine', sets: [{ reps: 12, weight: 90 }] },
      ] } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      if (!/class="presc-sets"/.test(html)) throw new Error('the card is not open, so this proves nothing')
      if (/stepper-swap|ArrowLeftRight|Switch to/.test(html)) throw new Error('a machine lift grew a weight switch')
      if (!/<span class="stepper-label">lb<\/span>/.test(html)) throw new Error('the machine weight lost its plain label')
      if (/presc-mode/.test(html)) throw new Error('a machine lift says a weight mode')
    }],
  /* A number a service measured says so. Attaching is the whole point — time
   * should not need entering when WHOOP already measured it — and a value the
   * user did not type must never look like one they did. */
  ['SessionLog(other training, filled from WHOOP)', <SessionLog session={otherCard}
    entry={{ id: 'ot3', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { optId: 'log-workout', level: 2, out: {
        activity: 'run', duration: 38, distance: 5, elevation: 210,
        whoop: { id: 'w', sport: 'running', minutes: 38, attachedAt: 'z',
          filled: { activity: 'run', duration: 38, distance: 5, elevation: 210 } } } } }}
    entries={[]} onSave={noop} bare />,
    html => {
      const t = text(html)
      if ((t.match(/from WHOOP/g) || []).length < 3) throw new Error('the filled fields are not attributed')
      if (!/value="38"/.test(html)) throw new Error('the filled duration is not in the field')
    }],
  // A grade is entered from the ladder, per REP, and both of those are things a
  // rendered form can silently stop doing: a select whose value is off its own
  // option list goes blank, and a per-rep field is one `Array.isArray` away from
  // rendering nothing at all.
  ['SessionLog(a grade per lap)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'lead-laps')}
    entry={{ id: 'll', kind: 'daily', date: '2026-10-03', updatedAt: 'z',
      data: { optId: 'lead-laps', level: 3, minutes: 30,
        out: { sets: { doubles: [{ reps: 2, grades: [10.2, 10.2] }, { reps: 2, grades: [10.1, 10.2] }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      // One picker per lap across two sets, each one showing its own rung.
      const selected = [...html.matchAll(/<option value="([\d.]+)" selected=""/g)].map(m => m[1])
      if (selected.join() !== '10.2,10.2,10.1,10.2') {
        throw new Error(`the per-lap grades did not render as themselves: ${selected.join() || 'none'}`)
      }
      if (!text(html).includes('5.10−')) throw new Error('the ladder is not labelled')
      if (!/lap 1|rep 1/.test(text(html))) throw new Error('the laps are not numbered')
    }],
  // A session-level grade: same ladder, same control, one value.
  ['SessionLog(hardest route from the ladder)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    entry={{ id: 'fs', kind: 'daily', date: '2026-10-04', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, minutes: 120, out: { intensity: 3, hardestYds: 11.1, rpe: 6 } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/<option value="11.1" selected=""/.test(html)) throw new Error('the logged rung is not selected')
      if (/enter as/.test(text(html))) throw new Error('still asking him to encode a grade as a decimal')
    }],
  // An old hand-written value that is not on the ladder keeps its own option, so
  // opening the picker cannot silently relabel what the user climbed.
  ['SessionLog(off-ladder grade survives)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-sport')}
    entry={{ id: 'fs2', kind: 'daily', date: '2026-10-05', updatedAt: 'z',
      data: { optId: 'fun-sport', level: 2, minutes: 120, out: { hardestYds: 10.4 } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/<option value="10.4" selected="">10.4</.test(html)) {
        throw new Error('an off-ladder grade was dropped or relabelled')
      }
    }],
  // The fun days' per-climb option: OFF is the default and a button offers it —
  // ten selects nobody asked for is how a twenty-second form stops being filled in.
  ['SessionLog(fun day, option off)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'fb0', kind: 'daily', date: '2026-10-06', updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 2, minutes: 90, out: { sets: { problems: [{ reps: 10 }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      if (!/log each problem/.test(text(html))) throw new Error('the per-problem option is not offered')
      if (/climblog/.test(html)) throw new Error('per-climb detail rendered before he asked for it')
      // With the detail off the count is an ordinary typed number, not a stepper.
      if (/repstep/.test(html)) throw new Error('the stepper belongs to the detail, not the plain log')
      const reps = html.match(/<input[^>]*aria-label="set 1 reps"[^>]*>/)?.[0] || ''
      if (/readonly/i.test(reps)) throw new Error('the plain reps box must stay typeable')
    }],
  // ...and ON, each climb is a grade off its own ladder (V for boulders), a
  // style, a fell mark, and a felt-for-the-grade slider that speaks in words.
  ['SessionLog(fun day, per-problem detail)', <SessionLog session={plan.dailyMenu.find(m => m.id === 'fun-boulder')}
    entry={{ id: 'fb1', kind: 'daily', date: '2026-10-07', updatedAt: 'z',
      data: { optId: 'fun-boulder', level: 3, minutes: 90,
        out: { sets: { problems: [{ reps: 3, climbs: [
          { grade: 4, fell: true, felt: 1, style: 'roof' },
          { grade: 5, fell: false, felt: '', style: '' },
          { grade: '', fell: false, felt: '', style: '' },
        ] }] } } } }}
    entries={noteHistory} onSave={noop} bare />,
    html => {
      const t = text(html)
      const selected = [...html.matchAll(/<option value="([^"]*)" selected=""[^>]*>([^<]*)</g)].map(m => m[2])
      if (!selected.includes('V4') || !selected.includes('V5')) {
        throw new Error(`the per-problem V grades did not render as themselves: ${selected.join() || 'none'}`)
      }
      if (!selected.includes('roof')) throw new Error('the style did not render as picked')
      if (!/problem 1/.test(t)) throw new Error('the problems are not numbered in the plan’s own word')
      if (!/a touch stiff/.test(t)) throw new Error('felt must speak in words, not a bare number')
      if (!/fell on 1/.test(t)) throw new Error('the footer must count the falls')
      // Two graded problems, two felt sliders: "hard for the grade" is not a
      // question until a climb has a grade.
      const sliders = [...html.matchAll(/felt for the grade/g)].length
      if (sliders !== 2) throw new Error(`expected 2 felt sliders, saw ${sliders}`)
      if (!/for the grade: —/.test(t)) throw new Error('an untouched felt must read as unanswered, never "spot on"')
      // While the detail is on, the count is stepped and never typed — a typed
      // edit passes through states that truncate the list and delete climbs.
      const reps = html.match(/<input[^>]*aria-label="set 1 reps"[^>]*>/)?.[0] || ''
      if (!/readonly/i.test(reps)) throw new Error('a typeable count can still delete filled-in climbs')
      if (!/one more problem/.test(html)) throw new Error('no way to add a problem without retyping the count')
      if (!/one fewer problem/.test(html)) throw new Error('no way to remove one without retyping the count')
    }],
  ['SessionLog(a rest day)', <SessionLog session={plan.dailyMenu.find(m => m.role === 'rest')}
    entry={{ id: 'r', kind: 'daily', date: '2026-10-02', updatedAt: 'z',
      data: { optId: 'off', level: 1, minutes: 0, out: {} } }}
    entries={noteHistory} onSave={noop} bare />],
  ['Sheet(with prior note)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'four-by-four')}
    entry={{ id: 'cur', kind: 'daily', date: '2026-10-01', updatedAt: 'z',
      data: { optId: 'four-by-four', level: 4, minutes: 80, out: {} } }}
    tone="rec" entries={noteHistory} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // A suggestion opened from the day list: no entry behind it yet, so it offers
  // "add to today" and "not doing this today" rather than a log.
  ['Sheet(also recommended)',
    <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'lead-laps')} entry={null} tone="also"
      entries={rich} isFuture={false} recWhy="Not done yet this week."
      onLog={noop} onSave={noop} onDismiss={noop} onClose={noop} />],
  // The unilateral block resolves its dose from the ceiling — with a test...
  ['Sheet(unilateral, dose resolved)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'unilateral')}
    entry={{ id: 'u1', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'unilateral', level: 2, minutes: 12, out: {} } }}
    tone="rec" entries={cfEntries} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // ...and without one, where it must say so rather than invent a number.
  ['Sheet(unilateral, never tested)', <SessionSheet opt={plan.dailyMenu.find(m => m.id === 'unilateral')}
    entry={{ id: 'u2', kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'unilateral', level: 2, minutes: 12, out: {} } }}
    tone="rec" entries={[]} isFuture={false}
    onLog={noop} onSave={noop} onClose={noop} />],
  // The dose line itself. The sheet opens on the setup section, so this is the
  // only place the resolved kilograms actually render.
  ['SectionBody(dose from Aug 8)',
    <SectionBody section={uniWork} max={null} ceiling={resolveCeiling(augOnly)} />,
    html => {
      // CF 18.2 -> ceiling 12.2 -> target 10.2, the fixture's first result.
      if (!text(html).includes('10.2 kg on the gauge')) throw new Error('the resolved target is missing')
      if (!text(html).includes('12.2 kg')) throw new Error('the ceiling is missing')
    }],
  ['SectionBody(newest test wins)',
    <SectionBody section={uniWork} max={null} ceiling={resolveCeiling(cfEntries)} />,
    html => {
      // The September retest supersedes August: CF 20.4, CFmin 19.1 -> 14.4 -> 12.4.
      if (!text(html).includes('12.4 kg on the gauge')) throw new Error('did not use the newest test')
    }],
  ['SectionBody(never tested)',
    <SectionBody section={uniWork} max={null} ceiling={null} />,
    html => {
      if (!/run the 4-min all-out test/i.test(html)) throw new Error('no prompt to test')
      if (/\d+(\.\d+)? kg on the gauge/.test(text(html))) throw new Error('invented a number with no test')
    }],
  ['SectionBody(CFmin binds)',
    <SectionBody section={uniWork} max={null}
      ceiling={resolveCeiling([{ id: 'x', kind: 'test', date: '2026-08-08', updatedAt: 'z',
        data: { testId: 'critical-force', cfKg: 18.2, cfMinKg: 11.5, mvcKg: 48.6 } }])} />,
    html => {
      if (!text(html).includes('9.5 kg on the gauge')) throw new Error('CFmin did not bind (expected 11.5 - 2)')
      if (!/CFmin from/.test(text(html))) throw new Error('did not say which rule bound')
    }],
  /* The how-to layer. A figure name that plan.json can write but the app cannot
   * draw renders as an empty box, which on a phone in a basement is worse than
   * no picture at all — it reads as "this is broken" mid-set. */
  ['every figure the plan names exists', null, () => {
    const missing = []
    for (const m of plan.dailyMenu) {
      for (const ex of m.logSpec?.exercises || []) {
        if (ex.how && !hasFigure(ex.how.figure)) missing.push(`${m.id}/${ex.key} → ${ex.how.figure}`)
      }
    }
    if (missing.length) throw new Error(`no such figure: ${missing.join(', ')}`)
  }],
  ['no figure is drawn that nothing uses', null, () => {
    const used = new Set(plan.dailyMenu.flatMap(m => (m.logSpec?.exercises || []).map(e => e.how?.figure)))
    const spare = Object.keys(FIGURES).filter(k => !used.has(k))
    if (spare.length) throw new Error(`unused figures: ${spare.join(', ')}`)
  }],
  // Every figure has to survive being drawn, including the ones a rarely-picked
  // session owns. They are hand-written SVG; a stray undefined renders blank.
  ...Object.keys(FIGURES).map(name => [`Figure(${name})`,
    <HowRow exercise={{ name, how: { figure: name, gist: 'x' } }} open onToggle={noop} />,
    html => { if (!html.includes('<svg')) throw new Error('drew nothing') }]),
  // The moves list on every session that has one, and the mid-set sheet.
  ...plan.dailyMenu.filter(m => m.logSpec?.exercises?.length)
    .map(m => [`Moves(${m.id})`, <MovesList session={m} />]),
  ['HowSheet(eccentrics)', <HowSheet
    exercise={plan.dailyMenu.find(m => m.id === 'eccentrics').logSpec.exercises[0]}
    onClose={noop} />,
    html => {
      // The specific confusion this whole layer was built for: the free hand
      // lifts, the working hand only lowers. If that sentence stops reaching
      // the screen, the card is decoration.
      if (!/free hand/i.test(text(html))) throw new Error('lost the free-hand instruction')
    }],
  // An exercise with no how-to written yet must degrade, not crash.
  ['HowRow(no card)', <HowRow exercise={{ key: 'x', name: 'Something new' }} open onToggle={noop} />],
  ['HowSheet(nothing to show)',
    <div className="probe"><HowSheet exercise={{ name: 'x' }} onClose={noop} /></div>,
    html => { if (html.includes('how-sheet')) throw new Error('opened a sheet with nothing in it') }],
  /* The planned session, read from the day rather than run: the sheet shows the
   * prescription instead of the card's protocol, because the card has none. */
  ['Sheet(a planned session)',
    <SessionSheet opt={PLANNED_CARD} entry={PLANNED_ENTRY} tone="rec" entries={rich} isFuture={false}
      onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
      onClose={noop} />,
    (html) => {
      const t = text(html)
      if (!t.includes(PRESCRIPTION.title)) throw new Error('the sheet is not titled by the plan')
      // This one has a bike piece in it, so there is a clock to run.
      if (!/Start the workout/.test(t)) throw new Error('no way into the runner from the sheet')
      // The reasoning is one tap away rather than on screen — see PlanTalk above.
      if (!/Why this session/.test(t)) throw new Error('no way to reach the reasoning')
      // Every exercise open at once is four screens of steppers before the one the user
      // is about to do. Only the first opens.
      if ((html.match(/class="presc-sets"/g) || []).length > 1) {
        throw new Error('more than one exercise opened')
      }
    }],
  /*
   * A LIFT-ONLY session gets no runner: workout mode makes no sense for lifting,
   * which has no timed parts. Once rest came off a lift set there is nothing for a
   * clock to run, so the sheet is the whole screen — and it must not grow a start
   * button back, which is the only thing a render test can say about it.
   */
  ['Sheet(a lift-only session offers no clock)', null, () => {
    const pres = normalizePrescription({
      title: 'Push day', category: 'lift', minutes: 45, why: 'w',
      blocks: [{ name: 'Main', category: 'lift', items: [{
        kind: 'lift', name: 'squat', exercise: SQUAT.key, implement: 'barbell',
        sets: [{ reps: 8, weight: 135 }, { reps: 8, weight: 135 }],
      }] }],
    }, { liftField: LIFT_FIELD })
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: pres.title, minutes: 45, level: 2,
        done: false, plan: pres, out: {} } }
    const t = text(renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={rich} isFuture={false}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>))
    if (/Start the workout/.test(t)) throw new Error('a lift session is offering a clock again')
    if (!/Mark undone/.test(t)) throw new Error('with no runner, the sheet has to say it is done and offer to undo it')
    // And no rest box anywhere in the editor.
    if (/rest sec/.test(t)) throw new Error('lifting grew a rest interval back')
  }],
  /*
   * DONE BY DEFAULT (AGENTS.md §4), and THE FOOTER (#41). Every field saves as
   * typed, so the footer's primary is Close (or Start, where there is a workout
   * to run); beside it, quiet, "Mark undone" on a session done by default, "Mark
   * done" on one marked undone, and neither on a later day. Pinned absent: the old
   * toggles that put a state and an action in one label ("Done · Mark undone").
   */
  ['SessionSheet(Close is the primary; Mark undone quiet beside it; Mark done once undone; neither later)', null, () => {
    const sheet = (entry, isFuture = false, opt = PLANNED_CARD) => renderToString(
      <PlanProvider plan={plan}>
        <SessionSheet opt={opt} entry={entry} tone="rec" entries={rich} isFuture={isFuture}
          onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop}
          onClose={noop} />
      </PlanProvider>)
    const foot = (html) => (html.match(/<footer class="modal-foot">([\s\S]*?)<\/footer>/) || [])[1] || ''
    const today = foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false } }))
    if (!/class="btn quiet"[^>]*>Mark undone</.test(today)) throw new Error('a session planned for today has no quiet "Mark undone"')
    if (/Done · Mark undone|tap to undo|Mark as done/.test(text(today))) throw new Error('an old done toggle is back')
    // This one has a clock to run, so Start is the primary rather than Close.
    if (!/class="btn"[^>]*>.*Start the workout/.test(today)) throw new Error('a done-by-default session lost its Start')
    const undone = text(foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: false, undone: true } })))
    if (!/Mark done/.test(undone) || /Mark undone/.test(undone)) throw new Error('a session marked undone does not offer "Mark done"')
    const finished = foot(sheet({ ...PLANNED_ENTRY, data: { ...PLANNED_ENTRY.data, done: true, run: { startedAt: 1, endedAt: 2 } } }))
    if (/Start the workout/.test(finished)) throw new Error('a finished run offers Start again')
    if (!/<button type="button" class="btn">Close<\/button>/.test(finished)) throw new Error('Close is not the primary once nothing is left to start')
    const later = foot(sheet({ ...PLANNED_ENTRY, date: '2999-01-01', data: { ...PLANNED_ENTRY.data, done: false } }, true))
    if (/Mark (un)?done/.test(later)) throw new Error('a session on a later day offers a done control')
    if (!/>Close</.test(later)) throw new Error('a later day has no way to close its sheet')
    if (/Preview only/.test(text(later))) throw new Error('the explanatory preview line is back')
  }],
  /*
   * THE HEADER (#41): the name, then the day and the time as typed. It used to
   * say the card's "45 min · any sport · counts anyway" over a typed 29.
   */
  ['SessionSheet(header: day · time as typed, no tier, no estimate)', null, () => {
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'log-workout', level: 2, name: 'Run', minutes: 45, done: true,
        out: { activity: 'run', duration: 29, distance: 3.1 } } }
    const html = renderToString(<SessionSheet opt={otherCard} entry={entry} entries={rich} isFuture={false}
      onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />)
    const sub = text((html.match(/<div class="modal-sub">(.*?)<\/div>/) || [])[1] || '').replace(/<[^>]+>/g, '')
    if (sub !== 'Today · 29 min') throw new Error(`the header reads "${sub}"`)
    if (/any sport|counts anyway/.test(text(html))) throw new Error('the card\u2019s tier is back in the header')
    // The form is open, and the timer is a row at the foot rather than a big button.
    if (/Session logged|How did it go/.test(text(html))) throw new Error('the form is folded behind a title again')
    if (!/class="list sheet-tools"/.test(html) || !/Interval timer/.test(html)) throw new Error('the interval timer is not a row in the sheet')
    if (/wo-cta|done-btn/.test(html)) throw new Error('the old footer buttons are back')
  }],
  /* An unanswered slider is a placeholder (AGENTS.md §6.4): nothing lit, until moved or tapped. */
  ['SessionLog(an unanswered slider looks unanswered)', null, () => {
    const entry = (out) => ({ id: 'sl', kind: 'daily', date: TODAY, updatedAt: 'z', data: { optId: 'log-workout', out } })
    const blank = renderToString(<SessionLog session={otherCard} entry={entry({ activity: 'run' })} entries={[]} onSave={noop} bare />)
    if (!/class="slider unset"/.test(blank)) throw new Error('an unanswered slider is drawn lit, as if answered')
    if (!/class="out-value guess"/.test(blank)) throw new Error('its number is not a placeholder')
    const set = renderToString(<SessionLog session={otherCard} entry={entry({ activity: 'run', rpe: 4 })} entries={[]} onSave={noop} bare />)
    if (/slider unset|out-value guess/.test(set)) throw new Error('an answered slider still reads as unanswered')
  }],
  ['SessionSheet(an ordinary workout opens the interval timer)', null, () => {
    const opt = plan.dailyMenu.find(m => m.id === 'log-workout')
    if (hasWorkout(opt)) throw new Error('the test card is supposed to have no timer of its own')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      // Done, as today's entries are by default since #34: the timer must not hang off `!done`.
      data: { slot: 'main', optId: opt.id, level: 2, name: 'Run', minutes: 30, done: true, out: { activity: 'run' } } }
    const sheet = text(renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rec" entries={[]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} onStartWorkout={noop} />))
    if (!sheet.includes('Interval timer')) throw new Error('no timer on an ordinary workout\'s sheet')
    // What the button asks for, answered by the host the app mounts.
    const req = timerRequestFor(opt, entry)
    if (req.title !== 'Run') throw new Error(`the timer is titled ${req.title}`)
    if (req.presets.some(Boolean)) throw new Error('an ordinary card invented a plan timer')
    openTimer(req)
    try {
      const html = renderToString(<TimerHost entries={[]} upsertEntry={noop} deleteEntry={noop} />)
      const t = text(html)
      for (const w of ['Interval timer', 'Run', 'Start', 'Work', 'Rest', 'Rounds', BUILT_INS[0].name]) {
        if (!t.includes(w)) throw new Error(`the timer opened without "${w}"`)
      }
    } finally { closeTimer() }
    if (renderToString(<TimerHost entries={[]} upsertEntry={noop} deleteEntry={noop} />) !== '') {
      throw new Error('the host shows a timer nobody asked for')
    }
  }],
  ['SessionSheet(no interval timer on a rest day)', null, () => {
    const opt = plan.dailyMenu.find(m => m.role === 'rest')
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: opt.id, level: 1, name: 'Rest day', minutes: 0, done: true, out: {} } }
    const t = text(renderToString(
      <SessionSheet opt={opt} entry={entry} tone="rest" entries={[]} isFuture={false}
        onLog={noop} onSave={noop} onSetDone={noop} onRemove={noop} onClose={noop} />))
    if (t.includes('Interval timer')) throw new Error('a timer for resting')
  }],
  ['example: no climbing folders', null, () => {
    const keys = climbingFolders(example).map(f => f.key)
    if (keys.join() !== 'plan') throw new Error(`the example is foldered as ${keys.join(', ')}`)
  }],
  /*
   * Start on a circuit: a plan that is nothing but a circuit runs on the timer's
   * screen straight away (open, Start, it runs), with the exercise to do now as
   * big as the screen allows, where it is in the round, and what comes next.
   * A lift-only block switched to Circuit offers Start (a plain one does not,
   * `Sheet(a lift-only session offers no clock)`).
   */
  ['SessionSheet + WorkoutRunner(a circuit entry: Start, then the timer with the exercise on it)', null, () => {
    const pres = setCircuit(normalizePrescription({ title: 'Abs', blocks: [{ name: 'Core', category: 'lift', items: [
      { kind: 'lift', name: 'crunch', exercise: 'crunch', sets: [{ reps: 15 }, { reps: 15 }, { reps: 15 }] },
      { kind: 'lift', name: 'plank', exercise: 'plank', sets: [{ seconds: 45 }] },
    ] }] }, { liftField: LIFT_FIELD }), 'b0', true)
    const pres2 = { ...pres, blocks: [{ ...pres.blocks[0], items: pres.blocks[0].items.map(i => ({ ...i, sets: [{ ...i.sets[0], reps: null }] })) }] }
    const entry = { id: `daily-${TODAY}`, kind: 'daily', date: TODAY, updatedAt: 'z',
      data: { slot: 'main', optId: 'planned', name: 'Abs', done: true, plan: pres2, out: {} } }
    const sheet = text(renderToString(<PlanProvider plan={HELD_PLAN}>
      <SessionSheet opt={PLANNED_CARD} entry={entry} tone="rec" entries={[entry]} isFuture={false}
        onLog={noop} onSave={noop} onSavePlan={noop} onSetDone={noop} onStartWorkout={noop} onClose={noop} />
    </PlanProvider>))
    if (!/Start the workout/.test(sheet)) throw new Error('a lift block switched to Circuit is not runnable')
    // Started: no run on the entry yet, so it opens in the count-in, with the first exercise up next.
    const fresh = renderToString(<PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD} entry={entry}
      entries={[]} onRun={noop} onExit={noop} /></PlanProvider>)
    if (!/class="it it-run k-countin it-circuit"/.test(fresh)) throw new Error('Start on a circuit did not open the timer')
    if (!/Up next/.test(text(fresh)) || !/<strong class="it-exnext">Crunch/.test(fresh)) throw new Error('the count-in does not say what is coming')
    // Running: 5 s into the crunch, its name big, where it is, the plank next.
    const now = Date.now()
    const running = { ...entry, data: { ...entry.data, run: { ...emptyRun(now - 15000), circuit: { block: 'b0',
      timer: { startedAt: now - 15000, index: 1, lap: 1, at: now - 5000, extra: 0, pausedAt: null, pausedMs: 0, finishedAt: null } } } } }
    const html = renderToString(<PlanProvider plan={HELD_PLAN}><WorkoutRunner session={PLANNED_CARD} entry={running}
      entries={[]} onRun={noop} onExit={noop} /></PlanProvider>)
    const t = text(html)
    if (!/class="it it-run k-work it-circuit"/.test(html)) throw new Error('the work segment is not on screen')
    if (!/<span class="it-exname">Crunch<\/span>/.test(html)) throw new Error('the exercise to do now is not the big name')
    for (const w of ['Round 1 of 3', 'Exercise 1 of 2', 'Next:', 'Plank', 'Pause', 'Skip']) {
      if (!t.includes(w)) throw new Error(`no "${w}" on the circuit's run screen`)
    }
    if (!/aria-label="Stop the circuit"/.test(html)) throw new Error('the stop does not say it stops the circuit')
  }],
]
