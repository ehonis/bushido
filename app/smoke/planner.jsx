/* Smoke cases: Plan a workout: kinds, ask, drafts, review, build, kept.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import {
  PlanFlow, KeptStep, PlanTalk, BuildStep, groupedKinds, DraftList, Working, KindChips,
  AskStep, MinuteChips, PlanDay, WORKING_LINE, FileAs,
} from '../src/planner.jsx'
import { blankFor, fileChoices } from '../src/lib/planflow.js'
import { addedId } from '../src/editor.jsx'
import { isoShift } from '../src/lib/dates.js'
import { draftStep, draftPres, draftLine } from '../src/lib/drafts.js'
import { _setMe } from '../src/lib/whoami.js'
import { hasIcon } from '../src/lib/icons.jsx'
import { plannerContext, aiOffered, noteAiRefusal, resetAiRefusal } from '../src/lib/plannerapi.js'
import { activityFieldOf } from '../src/picker.jsx'
import { blankPrescription, appendLift, appendPiece } from '../src/lib/prescription.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import {
  plan, entries, noop, TODAY, back, text, LIFT_FIELD, SQUAT, PRESCRIPTION,
} from './fixtures.jsx'

/* The builder as Plan a workout opens it with nothing picked (#78), in its provider. */
const builder = (pres = blankFor([]), picked = [], extra = {}) => (
  <PlanProvider plan={plan}>
    <BuildStep pres={pres} setPres={noop} liftField={LIFT_FIELD} entries={[]} categories={plan.quotaCategories}
      onKeep={noop} plan={plan} picked={picked} setPicked={noop} {...extra} />
  </PlanProvider>
)
const noAi = { id: 'sam', owner: false, features: { ai: false, goals: false, whoop: false, strava: false, notifications: false } }

export default [
  /* ============================================ plan a workout, and run it
   *
   * The whole route the + button opens, rendered at every step. These are the
   * screens with the least test surface anywhere else in the app: the model is
   * covered as arithmetic in `prescription.test.js`, but nothing there would
   * catch a runner that renders a set with no number on it.
   */
  /*
   * Since #59 the kinds are the hand-built route's first step ("Build it myself"),
   * and the model's first screen is one box (AskStep, below), with the same kinds
   * as optional chips. Both must list every kind.
   */
  ['BuildStep(start from: every kind, under its group, in the page)', builder(),
    (html) => {
      const t = text(html)
      // The kinds are CONTENT — adding "Shoulders" must be an edit to plan.json
      // and not a rebuild, so the screen has to be rendering that list.
      const plain = t.replace(/&amp;/g, '&')
      for (const k of plan.plannerKinds.kinds) {
        if (!plain.includes(k.label)) throw new Error(`${k.label} is not on the builder's Start from`)
      }
      // "Power" and "Endurance" are climbing categories here and ordinary words
      // everywhere else, so ungrouped they were a coin flip. Hence a heading per group.
      for (const g of plan.plannerKinds.groups) {
        if (!plain.includes(g.name)) throw new Error(`the "${g.name}" group is missing`)
      }
      if (!/<details class="askkinds plan-from"><summary class="section-head"><h3>Start from<\/h3><span class="sub">Optional<\/span>/.test(html)) {
        throw new Error('the kinds are not an optional, folded "Start from"')
      }
    }],
  // The discipline travels onto the ask screen too — "Power endurance" alone is
  // the same ambiguity one step later, on the screen the user presses go from.
  ['PlanFlow(the discipline follows the kind)', null, () => {
    const pe = plan.plannerKinds.kinds.find(k => k.key === 'pe')
    const group = plan.plannerKinds.groups.find(g => g.key === pe.group)
    if (!group) throw new Error('the power-endurance kind names no group')
    if (group.name !== 'Climbing') throw new Error(`power endurance is grouped under ${group.name}`)
  }],
  // Same reachability rule as the session picker: a kind in plan.json that no
  // group claims must still land on screen, not vanish into a gap.
  ['PlanFlow(every kind is in a group)', null, () => {
    const listed = groupedKinds(plan).flatMap(g => g.items.map(k => k.key))
    const missing = plan.plannerKinds.kinds.filter(k => !listed.includes(k.key)).map(k => k.key)
    if (missing.length) throw new Error(`ungrouped and unreachable: ${missing.join(', ')}`)
    if (listed.length !== new Set(listed).size) throw new Error('a kind is listed in two groups')

    // And an orphan really does fall through rather than disappear.
    const orphaned = groupedKinds({ plannerKinds: {
      groups: plan.plannerKinds.groups,
      kinds: [{ key: 'weird', label: 'Weird', group: 'no-such-group' }],
    } })
    if (!orphaned.flatMap(g => g.items).some(k => k.key === 'weird')) {
      throw new Error('a kind with an unknown group vanished')
    }
  }],
  /* Keeping a workout and starting it are two decisions: after keeping one, the
   * user chooses between going back to the main menu, planning another workout,
   * or starting it. The screen that asks is `KeptStep`. */
  /* Multi-select, and the conversation that follows a plan: several workouts can
   * be selected to plan a full day at the gym, and a created plan can be followed
   * up on with the AI rather than being a dead end. */
  ['BuildStep(start from several kinds: one block each, in the order tapped)', null, () => {
    const [a, b] = [plan.plannerKinds.kinds[2], plan.plannerKinds.kinds[0]]
    const html = renderToString(builder(blankFor([a, b]), [a, b]))
    if (!/<details class="askkinds plan-from" open="">/.test(html)) throw new Error('a picked kind is folded away')
    // The blocks are written in the order the kinds were tapped: which came first is a fact about the session.
    const blocks = [...html.matchAll(/class="presc-blocktoggle"[^>]*>(?:(?!<\/h3>).)*?<h3>([^<]+)<\/h3>/g)].map(m => m[1].replace(/&amp;/g, '&'))
    if (blocks.join() !== `${a.label},${b.label}`) throw new Error(`the blocks are ${blocks.join()}, not ${a.label},${b.label}`)
  }],
  /*
   * TWO ROUTES, and Build it myself starts empty (#78). No kind is needed: the
   * builder opens on one block with the catalogues' two doors, the keep button
   * off until something is in it, and nothing written for the model (a kind's
   * `hint`, the model, a "why") on the hand-built route.
   */
  ['BuildStep(empty: one block, no kind needed, no model, no kind hints)', builder(),
    (html) => {
      const t = text(html).replace(/&amp;/g, '&')
      if (!/Add an exercise here/.test(t)) throw new Error('an empty builder has no way into the exercise catalogue')
      if (!/Add a swim set, interval or hold/.test(t)) throw new Error('an empty builder has no way to add a piece')
      if (!/<button class="btn big" disabled=""/.test(html)) throw new Error('an empty workout can be kept')
      const btns = [...html.matchAll(/<button class="(btn big[^"]*)"/g)].map(m => m[1].trim())
      if (btns.length !== 1 || btns[0] !== 'btn big') throw new Error(`the footer is ${btns.join(' / ')}, not one primary`)
      if (/Write it for me|Sparkles|Why this session/.test(html)) throw new Error('the hand-built route offers the model')
      for (const k of plan.plannerKinds.kinds.filter(k => k.hint)) {
        if (t.includes(k.hint)) throw new Error(`a hint written for the model is on the builder: "${k.hint}"`)
      }
      if (/class="list-row kindrow/.test(html)) throw new Error('the kinds are a required list again')
    }],
  // Something in it: the blocks are the user's, and Start from goes.
  ['BuildStep(once something is in it, Start from is gone)',
    builder(appendLift(blankFor([]), LIFT_FIELD, SQUAT.key, { blockId: 'b0' })),
    (html) => {
      if (/plan-from|Start from/.test(html)) throw new Error('Start from still offers to replace a workout with work in it')
      if (/<button class="btn big" disabled=""/.test(html)) throw new Error('a workout with a squat in it cannot be kept')
    }],
  /*
   * A piece's time is minutes (#78): a fifteen-minute run is "15 min", never
   * "1 × 900 s", and its box counts minutes. A hand-built piece starts at ten.
   */
  ['BuildStep(a timed piece is in minutes)', null, () => {
    const fifteen = appendPiece(blankFor([]), 'Easy run', { by: 'time' })
    const it = fifteen.blocks[0].items[0]
    if (it.sets[0].seconds !== 600) throw new Error(`a new timed piece starts at ${it.sets[0].seconds} s`)
    const pres = { ...fifteen, blocks: [{ ...fifteen.blocks[0], items: [{ ...it, sets: [{ ...it.sets[0], seconds: 900 }] }] }] }
    const html = renderToString(builder(pres))
    const t = text(html)
    if (/900 s|900<|value="900"/.test(html)) throw new Error('a fifteen-minute piece shows 900 seconds')
    if (!/1 × 15 min/.test(t)) throw new Error('the piece line does not say "1 × 15 min"')
    if (!/value="15"/.test(html)) throw new Error('the box is not in minutes')
    if (!/aria-label="more min"/.test(html)) throw new Error('the stepper does not step minutes')
  }],
  /*
   * THE BLANK CANVAS (#59). "Write it for me" opens on one box and one button: a
   * sentence is a brief on its own, and no kind is required. The kinds are still
   * there, folded, as optional chips, every one of them (the reachability rule).
   */
  ['PlanFlow(AI on: the first screen is one text box and one button, and no kind is required)',
    <PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onStart={noop} onClose={noop} />,
    (html) => {
      const t = text(html)
      if (!/<label class="askcanvas-label" for="plan-ask">What do you want to do\?<\/label><textarea id="plan-ask"/.test(html)) {
        throw new Error('the first screen is not the "What do you want to do?" box')
      }
      if ((html.match(/<textarea/g) || []).length !== 1) throw new Error('more than one text box on the first screen')
      const primaries = html.match(/<button class="btn big[^"]*"[^>]*>/g) || []
      if (primaries.length !== 1 || !/Write it for me/.test(t)) throw new Error(`the primary buttons: ${primaries.join(' / ')}`)
      if (/class="list-row kindrow/.test(html)) throw new Error('the kinds are still a required list on the first screen')
      if (!/Build it myself/.test(t)) throw new Error('no way to the hand-built route')
      if (/How long, and what for/.test(t)) throw new Error('the second "ask" screen is back')
      // The box asks for a session, not the content's goal prompt ("…has stalled").
      const goalPh = plan.plannerKinds?.goalPlaceholder
      if (goalPh && /squat has stalled/.test(html)) throw new Error('the box carries the old goal placeholder')
      if (!/placeholder="Legs, then twenty minutes easy on the bike"/.test(html)) throw new Error('the box does not show what a description looks like')
    }],
  ['AskStep(a sentence alone is enough; with nothing at all the button waits)', null, () => {
    const ask = (goal, picked = []) => renderToString(<AskStep goal={goal} setGoal={noop} minutes={45} setMinutes={noop}
      plan={plan} picked={picked} setPicked={noop} onGo={noop} onBuild={noop} />)
    const go = (html) => html.match(/<button class="btn big"[^>]*>/)[0]
    if (/disabled/.test(go(ask('legs, then an easy spin')))) throw new Error('a sentence with no kind cannot be sent')
    if (!/disabled/.test(go(ask('  ')))) throw new Error('an empty ask can be sent')
    if (/disabled/.test(go(ask('', [plan.plannerKinds.kinds[0]])))) throw new Error('a kind alone cannot be sent')
  }],
  ['AskStep(every kind is an optional chip, folded, and open once one is picked)', null, () => {
    const html = renderToString(<AskStep goal="" setGoal={noop} minutes={45} setMinutes={noop} plan={plan} picked={[]}
      setPicked={noop} onGo={noop} />)
    if (!/<details class="askkinds"><summary class="section-head"><h3>Add a kind<\/h3><span class="sub">Optional<\/span>/.test(html)) {
      throw new Error('the kinds are not a folded, optional section')
    }
    const t = text(html).replace(/&amp;/g, '&')
    for (const k of plan.plannerKinds.kinds) if (!t.includes(k.label)) throw new Error(`${k.label} is not a chip`)
    const picked = renderToString(<AskStep goal="" setGoal={noop} minutes={45} setMinutes={noop} plan={plan}
      picked={[plan.plannerKinds.kinds[0], { key: 'custom:hike', label: 'A hike' }]} setPicked={noop} onGo={noop} />)
    if (!/<details class="askkinds" open="">/.test(picked)) throw new Error('a picked kind is hidden in a closed fold')
    if (!/2 picked/.test(picked) || !/A hike/.test(picked)) throw new Error('an older draft\'s own kind is not shown')
  }],
  /*
   * The hand-built route, opened empty.
   *
   * The thing this has to pin is that it is the SAME editor: one block per kind
   * the user picked, each carrying its own quota, and a way in to both catalogues —
   * the two hundred lifts and the pieces that are not lifts. A builder that
   * could only add lifts would dead-end every swim, ride and 4x4 session, which
   * is most of the kinds on the screen before it.
   */
  ['BuildStep(his own, block by block)',
    <PlanProvider plan={plan}>
      <BuildStep
        pres={blankPrescription({
          title: 'Legs + Ride',
          blocks: [
            { name: 'Legs', category: 'lift', activity: 'lift' },
            { name: 'Ride', category: 'bike', activity: 'bike' },
          ],
        })}
        setPres={noop} liftField={LIFT_FIELD} entries={[]}
        categories={plan.quotaCategories} onKeep={noop} />
    </PlanProvider>,
    (html) => {
      const t = text(html)
      for (const name of ['Legs', 'Ride']) {
        if (!t.includes(name)) throw new Error(`the ${name} block is not on the screen`)
      }
      if (!/Add an exercise here/.test(t)) throw new Error('no way into the exercise catalogue')
      // Worded from each block's category (#80): a lift block's piece is a hold, a ride's an interval.
      if (!/Add a hold or timed exercise/.test(t) || !/Add an interval/.test(t)) throw new Error('no way to add work that is not a lift, in the block\'s words')
      if (/Add a swim set/.test(t)) throw new Error('a lift and a ride offer a swim set')
      if (/Add a piece|its own workout:/.test(t)) throw new Error('the planner\u2019s jargon is back ("a piece", "its own workout:")')
      if (!/A separate .*workout|Part of the workout beside it/.test(t)) throw new Error('a block does not say whether it is its own workout')
      if (!/Add to Today/.test(t)) throw new Error('no way to keep it')
      // Nothing in it yet is not a workout, and the button says so by being off.
      if (!/<button class="btn big" disabled=""/.test(html)) {
        throw new Error('an empty session can be kept')
      }
      // No model wrote this, so nothing on the screen may claim one did.
      if (/Why this session/.test(t)) throw new Error('a hand-built session offers reasoning nobody wrote')
    }],
  /* And with something in it, the same card the log form and the review step
     render — one open, steppers, the body map, and the keep button live. */
  ['BuildStep(one exercise in, and it is the same card)',
    <PlanProvider plan={plan}>
      <BuildStep
        pres={appendLift(
          blankPrescription({ title: 'Legs', blocks: [{ name: 'Legs', category: 'lift' }] }),
          LIFT_FIELD, SQUAT.key, { blockId: 'b0' })}
        setPres={noop} liftField={LIFT_FIELD} entries={[]}
        categories={plan.quotaCategories} onKeep={noop} />
    </PlanProvider>,
    (html) => {
      const t = text(html)
      if (!t.includes(SQUAT.name)) throw new Error('the exercise he added is not there')
      if (!/stepper/.test(html)) throw new Error('the numbers are not steppers')
      if (/<select/.test(html)) throw new Error('a native select is back on the plan side')
      if (/<button class="btn big" disabled=""/.test(html)) {
        throw new Error('a session with an exercise in it cannot be kept')
      }
    }],
  /*
   * COLLAPSED BY DEFAULT: the AI reasoning at the top of a planned session is a
   * collapsible section that starts collapsed. It used to open
   * with the reasoning showing, on the argument that a section you have to open
   * first shows you nothing; what that missed is that it sat between the user and
   * the first set of the session they were standing there to do.
   *
   * What the fold must NOT do is hide that there is something to read, which is
   * why the header keeps the turn count. A revision the user cannot see is the problem
   * the old coach's silent plan edits had.
   */
  ['PlanTalk(folded, and says so)',
    <PlanTalk pres={PRESCRIPTION} onChange={noop} />,
    (html) => {
      const t = text(html)
      if (!/Why this session/.test(t)) throw new Error('nothing says there is reasoning to read')
      if (!/aria-expanded="false"/.test(html)) throw new Error('it is not collapsed')
      if (t.includes(PRESCRIPTION.why.slice(0, 40))) throw new Error('the paragraph is still on screen')
      if (/Make it shorter/.test(t)) throw new Error('the prompt row is still on screen')
    }],
  ['PlanTalk(a revised plan carries its count on the fold)',
    <PlanTalk onChange={noop} pres={{ ...PRESCRIPTION, thread: [
      { role: 'you', text: 'Make it shorter', at: 'z' },
      { role: 'coach', text: 'Dropped the third squat set and the calf work — 32 minutes now.', at: 'z' },
    ] }} />,
    (html) => {
      if (!/class="plantalk-n"/.test(html)) throw new Error('nothing marks that it has been revised')
      if (!/aria-expanded="false"/.test(html)) throw new Error('a revised plan should still open folded')
    }],
  /*
   * AI WORKOUT DRAFTS (#28). "Write it for me" is a draft the server keeps, and
   * the run is the draft's, not the screen's. What SSR can pin: the list says
   * what each draft is doing and offers a retry only where there is something to
   * retry; the wait no longer says leaving cancels it; a revision being written
   * when the page was left is still shown as being written; and each draft
   * reopens at the step it is on.
   */
  ['DraftList(being written, ready and failed, each says which)',
    <DraftList now={Date.parse('2026-10-25T12:01:00Z')} onOpen={noop} onRetry={noop} onDiscard={noop} drafts={[
      { id: 'da', status: 'working', ask: { label: 'Legs', minutes: 45 }, run: { kind: 'write', startedAt: '2026-10-25T12:00:20Z' }, createdAt: '3' },
      { id: 'db', status: 'ready', ask: { label: 'Swim', minutes: 30 }, pres: { title: '2,000 yd threshold', minutes: 30 }, updatedAt: '2026-10-25T11:00:00Z', createdAt: '2', for: { id: 'sam', name: 'Sam' } },
      { id: 'dc', status: 'failed', error: 'the planner took too long', ask: { label: 'Core', minutes: 20 }, pres: null, createdAt: '1' },
    ]} />,
    (html) => {
      const t = text(html)
      // Drafts first, as list rows in one card (docs/DESIGN.md, Plan a workout).
      if (!/class="section-head"><h3>Drafts<\/h3>/.test(html)) throw new Error('drafts have no section head')
      if ((html.match(/class="list-row plandraft /g) || []).length !== 3) throw new Error('the drafts are not list rows')
      for (const want of ['Not on your day yet', 'Legs', 'Being written… 40s', '2,000 yd threshold',
        'For Sam · Ready · 30 min · 1 h ago', 'Core', 'Did not finish: the planner took too long']) {
        if (!t.includes(want)) throw new Error(`no "${want}"`)
      }
      if ((t.match(/Try again/g) || []).length !== 1) throw new Error('a retry is offered on a draft that did not fail, or not on the one that did')
      if ((html.match(/aria-label="Discard /g) || []).length !== 3) throw new Error('not every draft can be thrown away')
    }],
  ['DraftList(no drafts, no list)', <DraftList drafts={[]} onOpen={noop} onRetry={noop} onDiscard={noop} />,
    (html) => { if (html) throw new Error('an empty list rendered something') }],
  ['PlanFlow(no draft list until there is a draft)', <PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />,
    (html) => { if (/plandrafts|Not on your day yet/.test(html)) throw new Error('a draft list with nothing in it') }],
  ['Working(leaving the wait cancels nothing, and it says so)',
    <Working label="Legs" minutes={45} since={null} onDiscard={noop} />,
    (html) => {
      const t = text(html)
      if (/cancels it/.test(t)) throw new Error('the wait still says leaving cancels the run')
      if (!/You can leave/.test(t)) throw new Error('the wait does not say the draft carries on')
      if (!/Stop and throw it away/.test(t)) throw new Error('no way to stop a draft from the wait')
    }],
  ['PlanTalk(a draft\'s revision still being written is open and says so)',
    <PlanTalk pres={{ ...PRESCRIPTION, thread: [{ role: 'you', text: 'Make it shorter', at: 'z' }] }} onChange={noop}
      draft={{ busy: true, error: null, onAsk: noop }} />,
    (html) => {
      const t = text(html)
      if (!/aria-expanded="true"/.test(html)) throw new Error('a revision in progress is folded away')
      if (!/Rewriting it…/.test(t)) throw new Error('it does not say it is rewriting')
      if (!t.includes('Make it shorter')) throw new Error('the message is not on the thread')
    }],
  ['PlanTalk(a draft\'s failed revision shows its error)',
    <PlanTalk pres={PRESCRIPTION} onChange={noop} draft={{ busy: false, error: 'box busy', failedMessage: 'More volume', onAsk: noop }} />,
    (html) => {
      if (!/box busy — your session is unchanged/.test(text(html))) throw new Error('the failure is not shown')
    }],
  ['drafts(each reopens at the step it is on)', null, () => {
    const pres = { title: 'Legs', minutes: 40, blocks: PRESCRIPTION.blocks, thread: [{ role: 'you', text: 'x' }], ask: { kinds: ['Legs'] } }
    const table = [
      [{ status: 'working', run: { kind: 'write' }, pres: null }, 'working'],
      [{ status: 'working', run: { kind: 'revise' }, pres }, 'review'],
      [{ status: 'ready', pres }, 'review'],
      [{ status: 'failed', run: { kind: 'write' }, pres: null }, 'failed'],
      [{ status: 'failed', run: { kind: 'revise' }, pres }, 'review'],
      [null, 'kind'],
    ]
    for (const [d, want] of table) {
      if (draftStep(d) !== want) throw new Error(`${JSON.stringify(d?.status)}/${d?.run?.kind} reopened at ${draftStep(d)}, not ${want}`)
    }
    const shown = draftPres({ pres }, liftFieldOf(plan))
    if (!shown || shown.thread.length !== 1 || shown.ask?.kinds?.[0] !== 'Legs') throw new Error('the thread or the ask was lost on the way to the editor')
    if (!/Rewriting it/.test(draftLine({ status: 'working', run: { kind: 'revise', startedAt: new Date().toISOString() } }))) {
      throw new Error('a revision in progress reads as a new draft')
    }
  }],
  ['KeptStep(three doors, and nothing started)',
    <KeptStep pres={PRESCRIPTION} onStart={noop} onAnother={noop} onDone={noop} />,
    (html) => {
      const t = text(html)
      for (const door of ['Start workout', 'Plan another workout', 'Back to today']) {
        if (!t.includes(door)) throw new Error(`no "${door}" door`)
      }
      if (!t.includes(PRESCRIPTION.title)) throw new Error('it does not say what landed')
      // The promise this screen makes. If the flow ever auto-starts again, this
      // sentence becomes a lie and the test is the only thing that would say so.
      if (!/Nothing has started/.test(t)) throw new Error('it does not say the clock is not running')
    }],
  ['KeptStep(kept, but nothing to start)',
    <KeptStep pres={PRESCRIPTION} onStart={null} onAnother={noop} onDone={noop} />,
    (html) => {
      const t = text(html)
      // A write that did not come back with an id still has to leave two doors
      // rather than a dead end.
      if (/Start workout/.test(t)) throw new Error('offering to start something it cannot open')
      if (!/Back to today/.test(t)) throw new Error('no way out')
    }],
  /* ============================================================= endurance
   *
   * Instead of one bike/swim/run section, endurance is a set of workout kinds —
   * speed, power, endurance and so on — that the app selects workouts from, with
   * zone-two and low-intensity volume as the default emphasis.
   */
  ['PlanFlow(the endurance kinds let the planner pick the sport)', null, () => {
    const kinds = plan.plannerKinds.kinds
    const endurance = kinds.filter(k => k.group === 'endurance')
    if (endurance.length < 6) throw new Error(`only ${endurance.length} endurance kinds — he asked for a lot`)
    if (!endurance.some(k => /zone 2/i.test(k.label))) throw new Error('zone 2 is not a kind, and it is the bread and butter')
    if (!/zone 2/i.test(endurance[0].label)) throw new Error('zone 2 does not lead the endurance group')
    for (const k of endurance) {
      // Naming no sport is what tells the planner to choose one from the week.
      if (k.category || k.activity) throw new Error(`${k.key} names a sport; the endurance group is for kinds that let the planner pick`)
      if (!/swim|bike|run|sport/i.test(k.prompt)) throw new Error(`${k.key}'s prompt does not tell the planner to pick a sport`)
    }
    // The three sport catalogs: each has a catch-all, and every kind in it is
    // that sport's category.
    for (const g of ['swim', 'bike', 'run']) {
      const items = kinds.filter(k => k.group === g)
      if (items.length < 5) throw new Error(`only ${items.length} ${g} kinds`)
      if (!items.some(k => k.key === g)) throw new Error(`no catch-all "${g}" kind`)
      for (const k of items) if (k.category !== g) throw new Error(`${k.key} in the ${g} group fills ${k.category}`)
    }
    // Every sport and category a kind names is real. A typo here is a form of the
    // wrong shape and a category nothing files under.
    const acts = new Set(activityFieldOf(plan).activities.map(a => a.key))
    const cats = new Set(plan.quotaCategories.map(c => c.key))
    for (const k of kinds) {
      if (k.activity && !acts.has(k.activity)) throw new Error(`${k.key}: activity "${k.activity}" is not in the catalog`)
      if (k.category && !cats.has(k.category)) throw new Error(`${k.key}: category "${k.category}" is not a category`)
    }
    // The bread and butter is not folded away; the catalogs are.
    const groups = plan.plannerKinds.groups
    if (groups.find(g => g.key === 'endurance')?.collapsed) throw new Error('the endurance group is folded')
    for (const g of ['swim', 'bike', 'run']) {
      if (!groups.find(x => x.key === g)?.collapsed) throw new Error(`the ${g} catalog is not folded, and thirty cards bury the climbing section`)
    }
  }],
  ['PlanFlow(every icon the content names is registered)', null, () => {
    // An unknown name renders as a dot, which looks like a bug the user caused.
    for (const k of plan.plannerKinds.kinds) if (!hasIcon(k.icon)) throw new Error(`${k.key}: icon "${k.icon}" is not registered`)
    for (const g of plan.plannerKinds.groups) if (!hasIcon(g.icon)) throw new Error(`group ${g.key}: icon "${g.icon}" is not registered`)
    for (const c of plan.quotaCategories) if (!hasIcon(c.icon)) throw new Error(`category ${c.key}: icon "${c.icon}" is not registered`)
  }],
  ['KindChips(folded, every kind still in the page)', <KindChips plan={plan} picked={[]} setPicked={noop} title="Start from" />,
    (html) => {
      if (!/<details class="askkinds"><summary/.test(html)) throw new Error('the kinds do not fold')
      const t = text(html).replace(/&amp;/g, '&')
      // Folded is not gone: every ride variant is rendered, one tap away.
      for (const k of plan.plannerKinds.kinds.filter(k => k.group === 'bike')) {
        if (!t.includes(k.label)) throw new Error(`${k.label} is not in the page`)
      }
      // The endurance group's paragraph is content and stays in the file, never on screen (D7).
      if (/pick swim, bike or run/i.test(t)) throw new Error('the endurance paragraph is back on the screen')
    }],
  /* The planner picks a sport from what was LOGGED lately, not from a quota (issue #31). */
  ['plannerContext(hands over the last week\'s workouts, not quotas)', null, () => {
    const s = plannerContext({
      iso: '2026-09-19', plan,
      entries: [
        { id: 'q', kind: 'quota', date: '2026-09-14', updatedAt: 'z', data: { counts: { bike: 3, pe: 2 } } },
        { id: 'r1', kind: 'daily', date: '2026-09-15', updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Mountain bike', level: 2, done: true, out: { activity: 'mtb' } } },
        { id: 'r2', kind: 'daily', date: '2026-09-16', updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Run', level: 2, done: false, undone: true, out: { activity: 'run' } } },
        { id: 'r3', kind: 'daily', date: '2026-09-01', updatedAt: 'z',
          data: { optId: 'log-workout', name: 'Swim', level: 2, done: true, out: { activity: 'swim' } } },
      ],
    })
    if (!/2026-09-15: Mountain bike/.test(s)) throw new Error(`the recent ride is missing: ${s}`)
    if (/2026-09-16|2026-09-01/.test(s)) throw new Error(`an unfinished or old workout leaked in: ${s}`)
    if (/quota|owe|0\/2/i.test(s)) throw new Error(`quota language reached the planner: ${s}`)
    if (!/Nothing logged/.test(plannerContext({ iso: '2026-09-19', plan, entries: [] }))) {
      throw new Error('an empty week does not say so')
    }
  }],
  ['PlanFlow(no AI: the first screen is the builder, and nothing mentions a model)', null, () => {
    _setMe(noAi)
    try {
      const html = renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />)
      const t = text(html)
      if (/Write it for me|Drafts|What do you want to do/.test(t)) throw new Error('the flow offers the model or its drafts')
      if (/model|Sparkles/i.test(t.replace(/<[^>]*>/g, ' '))) throw new Error('the screen mentions a model')
      if (!/Add an exercise here/.test(t)) throw new Error('without the model, the first screen is not the builder')
      if (/class="list-row kindrow/.test(html)) throw new Error('without the model, a kind must still be picked first')
      const btns = html.match(/<button class="btn big[^"]*"/g) || []
      if (btns.length !== 1 || /secondary|quiet/.test(btns[0])) throw new Error(`the only button is ${btns.join(' / ')}, not one primary`)
    } finally { _setMe({}) }
    const owner = text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
    if (!/Write it for me/.test(owner)) throw new Error('the owner lost "Write it for me"')
  }],
  /*
   * A refusal lasts the session (#55). Once a run comes back `ai-not-configured`,
   * closing Plan a workout and opening it again must not offer the model a second
   * time, whatever the cached features said; the next page load asks the server.
   */
  ['PlanFlow(after ai-not-configured, reopening offers Build it myself alone)', null, () => {
    const one = [plan.plannerKinds.kinds[0]]
    void one
    const kind = () => text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
    try {
      if (!aiOffered({ ai: true }) || !/Write it for me/.test(kind())) throw new Error('the model is not offered before any refusal')
      if (noteAiRefusal({ code: 'not-shared' })) throw new Error('another error counted as a refusal')
      if (!noteAiRefusal(Object.assign(new Error('x'), { code: 'ai-not-configured' }))) throw new Error('the refusal was not noted')
      if (aiOffered({ ai: true })) throw new Error('a refused session still offers the model')
      if (/Write it for me/.test(kind())) throw new Error('reopening Plan a workout offers the model again')
      const flow = text(renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />))
      if (/Write it for me|Drafts/.test(flow)) throw new Error('the reopened flow offers the model or its drafts')
    } finally { resetAiRefusal() }
  }],
  /*
   * WHICH DAY (#78). The flow opens on the day Today is showing, and the keep
   * button says it; a past day is not offered (that is Log a workout's), and the
   * stepper goes no earlier than today.
   */
  ['PlanFlow(plans the day Today is showing, and says it on the button)', null, () => {
    _setMe(noAi)
    try {
      const tomorrow = isoShift(TODAY, 1)
      const html = renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} date={tomorrow} onKeep={noop} onClose={noop} />)
      const t = text(html)
      if (!/Add to Tomorrow/.test(t)) throw new Error('planning from tomorrow does not offer "Add to Tomorrow"')
      if (!/<section class="planday" aria-label="Which day">/.test(html)) throw new Error('no day in the flow')
      if (/disabled="" aria-label="The day before"/.test(html)) throw new Error('tomorrow cannot step back to today')
      const past = renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} date={isoShift(TODAY, -2)} onKeep={noop} onClose={noop} />)
      if (!/Add to Today/.test(text(past))) throw new Error('a past day Today was showing is not planned for today')
      if (!/disabled="" aria-label="The day before"/.test(past)) throw new Error('the day can go before today')
    } finally { _setMe({}) }
    const ask = renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} date={isoShift(TODAY, 3)} onKeep={noop} onClose={noop} />)
    if (!/class="planday"/.test(ask)) throw new Error('the ask has no day')
  }],
  ['PlanDay(today and later, in words)', <PlanDay value={isoShift(TODAY, 1)} today={TODAY} onChange={noop} />,
    (html) => {
      if (!/<span>Tomorrow<\/span>/.test(html)) throw new Error('the day is not in words')
      if (!/aria-label="The day before"/.test(html) || !/aria-label="The day after"/.test(html)) throw new Error('no ‹ ›')
    }],
  /* How long is set one way (#78): chips, and Other; no second ± stepper. */
  ['AskStep(minutes are chips, with Other, and no second stepper)',
    <AskStep goal="" setGoal={noop} minutes={45} setMinutes={noop} plan={plan} picked={[]} setPicked={noop} onGo={noop} />,
    (html) => {
      if (/minstep|five minutes (less|more)/.test(html)) throw new Error('the minutes are set two ways again')
      if (!/aria-pressed="true">45<!-- --> min/.test(html)) throw new Error('the chosen time is not a picked chip')
      if (!/>Other<\/button>/.test(html)) throw new Error('no way to a time that is not a chip')
    }],
  ['MinuteChips(a time that is not a chip shows as its own, picked)',
    <MinuteChips minutes={50} setMinutes={noop} chips={[30, 45, 60]} />,
    (html) => {
      if (!/class="out-chip on" aria-pressed="true">50<!-- --> min/.test(html)) throw new Error('fifty minutes from a draft is not shown')
      if ((html.match(/out-chip on/g) || []).length !== 1) throw new Error('more than one time is picked')
    }],
  /* The wait says what it is doing and only that: no stages on a timer (#78). */
  ['Working(no canned stages)', <Working label="Legs" minutes={45} />,
    (html) => {
      if (/recovery|athlete profile|what you lifted last time/i.test(html)) throw new Error('a canned stage is back')
      if (!text(html).includes(WORKING_LINE)) throw new Error('the wait does not say what it is doing')
    }],
  /* Back from the builder keeps the work (G-visual-ia F6): the ask says so. */
  ['AskStep(a workout set aside is one tap back)',
    <AskStep goal="" setGoal={noop} minutes={45} setMinutes={noop} plan={plan} picked={[]} setPicked={noop} onGo={noop}
      onBuild={noop} building />,
    (html) => {
      if (!/Back to your workout/.test(text(html))) throw new Error('the ask does not offer the workout set aside')
    }],
  /* An exercise added to the second of two blocks called "Main" opens there, not in the first (C F17). */
  ['addedId(the block an exercise was added to, by place, not by name)', null, () => {
    const two = blankPrescription({ title: 'Legs', blocks: [{ name: 'Main', category: 'lift' }, { name: 'Main', category: 'lift' }] })
    const next = appendLift(two, LIFT_FIELD, SQUAT.key, { blockId: 'b1' })
    const id = addedId(two, next, 'b1')
    if (!id || !next.blocks[1].items.some(i => i.id === id)) throw new Error(`the new exercise was looked for in the wrong block (${id})`)
  }],
  /* A minutes box keeps its unit and reads m:ss (#78): 100 s is "1:40", not "1.67", and 30 s is "0:30", not "30 sec". */
  ['BuildStep(a minutes box reads m:ss and never flips to seconds)', null, () => {
    const base = appendPiece(blankFor([]), 'Strides', { by: 'time' })
    const it = base.blocks[0].items[0]
    const at = (secs) => renderToString(builder({ ...base, blocks: [{ ...base.blocks[0], items: [{ ...it, sets: [{ ...it.sets[0], seconds: secs }] }] }] }))
    const a = at(100)
    if (!/value="1:40"/.test(a) || /1\.67/.test(a)) throw new Error('100 seconds is not "1:40"')
    const b = at(30)
    if (!/value="0:30"/.test(b) || !/aria-label="more min"/.test(b) || /aria-label="more sec"/.test(b)) throw new Error('30 seconds flipped to a seconds box')
  }],
  /* "What is it?" (#78): the catalog's pinned sports, one tap, and the rest behind Other…. */
  ['FileAs(the pinned sports, and Other…)', <FileAs choices={fileChoices(plan)} value={null} onChange={noop} />,
    (html) => {
      const t = text(html)
      if (!/<h3>What is it\?<\/h3>/.test(html)) throw new Error('the row does not ask what it is')
      for (const name of ['Run', 'Bike', 'Swim', 'Lift']) if (!t.includes(`> ${name}<`) && !t.includes(name)) throw new Error(`${name} is not offered`)
      if (!/Other…/.test(t)) throw new Error('no way to the rest of the catalog')
      if (/<select/.test(html)) throw new Error('a native select on the plan side')
    }],
  ['FileAs(a pick from Other… shows as its own chip, picked)', <FileAs choices={fileChoices(plan)} value="rowing" onChange={noop} />,
    (html) => {
      const on = html.match(/class="out-chip on"[^>]*>(?:(?!<\/button>).)*/g) || []
      if (on.length !== 1 || !/Row/i.test(on[0])) throw new Error(`the pick is not shown: ${on.join(' / ')}`)
    }],
]
