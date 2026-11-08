/* Smoke cases: Plan a workout: kinds, ask, drafts, review, build, kept.
 * Run by app/smoke/index.jsx (`npm run smoke`); moved out of app/smoke.jsx in #73,
 * unchanged and in their old relative order. A case is [name, element | null, assert?].
 */
import { renderToString } from 'react-dom/server'
import {
  PlanFlow, KeptStep, PlanTalk, BuildStep, groupedKinds, DraftList, Working, KindStep,
  AskStep,
} from '../src/planner.jsx'
import { draftStep, draftPres, draftLine } from '../src/lib/drafts.js'
import { _setMe } from '../src/lib/whoami.js'
import { hasIcon } from '../src/lib/icons.jsx'
import { plannerContext, aiOffered, noteAiRefusal, resetAiRefusal } from '../src/lib/plannerapi.js'
import { activityFieldOf } from '../src/picker.jsx'
import { blankPrescription, appendLift } from '../src/lib/prescription.js'
import { PlanProvider } from '../src/lib/planctx.jsx'
import { liftFieldOf } from '../src/lib/lifts.js'
import {
  plan, entries, noop, TODAY, back, text, LIFT_FIELD, SQUAT, PRESCRIPTION,
} from './fixtures.jsx'

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
  ['KindStep(pick what)', <KindStep plan={plan} custom="" setCustom={noop} setPicked={noop} onBuild={noop} picked={[]} />,
    (html) => {
      const t = text(html)
      // The kinds are CONTENT — adding "Shoulders" must be an edit to plan.json
      // and not a rebuild, so the screen has to be rendering that list.
      // `&` comes back as `&amp;` out of the serialiser — "Core & hips" is one
      // of the kinds, so the comparison has to read through the escaping.
      const plain = t.replace(/&amp;/g, '&')
      for (const k of plan.plannerKinds.kinds) {
        if (!plain.includes(k.label)) throw new Error(`${k.label} is not on the picker`)
      }
      // The dividers, and the reason for them: "Power" and "Endurance" are
      // climbing categories in this app and ordinary words everywhere else, so
      // ungrouped they were a coin flip. Hence a heading per group.
      for (const g of plan.plannerKinds.groups) {
        if (!plain.includes(g.name)) throw new Error(`the "${g.name}" divider is missing`)
      }
      if (!/Something else/.test(t)) throw new Error('no way to ask for something not on the list')
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
  ['KindStep(more than one kind at a time, numbered in the order picked)',
    <KindStep plan={plan} custom="" setCustom={noop} setPicked={noop} onBuild={noop}
      picked={[plan.plannerKinds.kinds[2], plan.plannerKinds.kinds[0]]} />,
    (html) => {
      // Every row is a toggle, and the fork is what commits — a row that navigates
      // on tap cannot be the second of three.
      if (!/aria-pressed="false"/.test(html) || !/aria-pressed="true"/.test(html)) throw new Error('the kind rows are not toggles')
      // The check carries the order: the planner writes the blocks in it.
      const marks = [...html.matchAll(/class="kindrow-check"[^>]*>(\d*)</g)].map(m => m[1]).filter(Boolean)
      if (marks.join() !== '2,1') throw new Error(`the picks are numbered ${marks.join()}, not in the order tapped`)
      if (!/Build it myself/.test(text(html))) throw new Error('no way to commit a selection')
    }],
  /*
   * TWO ROUTES (docs/DESIGN.md, Plan a workout). The build route's kinds are rows
   * with a check under section heads, no prose; its footer appears once a kind is
   * picked, and it never offers the model (that is the first screen's, #59).
   */
  ['KindStep(nothing picked: no footer, no paragraph, rows not cards)', <KindStep plan={plan} custom="" setCustom={noop}
    setPicked={noop} onBuild={noop} picked={[]} />,
    (html) => {
      const t = text(html)
      if (/Build it myself|Write it for me/.test(t)) throw new Error('the footer shows before anything is picked')
      if (/as many as you like|sends nothing anywhere|Pick what you are doing/i.test(t)) throw new Error('the paragraphs are back')
      if (/kindcard|kindgrid|kindgroup-head/.test(html)) throw new Error('the kinds are cards in a grid again')
      if (!/class="list-row kindrow/.test(html)) throw new Error('the kinds are not list rows')
      if (!/class="section-head"><h3>Lifting<\/h3>/.test(html)) throw new Error('the groups are not section heads')
      // A group's blurb is content, and is no longer printed.
      const blurb = plan.plannerKinds.groups.find(g => g.blurb)?.blurb
      if (blurb && t.includes(blurb.slice(0, 30))) throw new Error('a group blurb paragraph is on screen')
    }],
  ['KindStep(picked: Build it myself is the one primary, and the model is not offered here)',
    <KindStep plan={plan} custom="" setCustom={noop} setPicked={noop} onBuild={noop}
      picked={[plan.plannerKinds.kinds[0]]} />,
    (html) => {
      const btns = [...html.matchAll(/<button class="(btn big[^"]*)"[^>]*>.*?<\/button>/g)].map(m => [m[1], text(m[0])])
      if (btns.length !== 1 || btns[0][0].trim() !== 'btn big' || !/Build it myself/.test(btns[0][1])) {
        throw new Error(`the footer is ${JSON.stringify(btns)}, not one "Build it myself" primary`)
      }
      if (/Write it for me|Sparkles/.test(html)) throw new Error('the build route offers the model')
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
      if (!/Add a swim set, interval or hold/.test(t)) throw new Error('no way to add work that is not a lift')
      if (/Add a piece|its own workout:/.test(t)) throw new Error('the planner\u2019s jargon is back ("a piece", "its own workout:")')
      if (!/A separate .*workout|Part of the workout beside it/.test(t)) throw new Error('a block does not say whether it is its own workout')
      if (!/Put it on today/.test(t)) throw new Error('no way to keep it')
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
      for (const door of ['Start it now', 'Plan another workout', 'Back to today']) {
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
      if (/Start it now/.test(t)) throw new Error('offering to start something it cannot open')
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
  ['KindStep(folded catalogs are still in the page)', <KindStep plan={plan} custom="" setCustom={noop} setPicked={noop} onBuild={noop} picked={[]} />,
    (html) => {
      if (!/<details class="kindgroup folded"/.test(html)) throw new Error('nothing folds')
      const t = text(html).replace(/&amp;/g, '&')
      // Folded is not gone: every ride variant is rendered, one tap away.
      for (const k of plan.plannerKinds.kinds.filter(k => k.group === 'bike')) {
        if (!t.includes(k.label)) throw new Error(`${k.label} is not in the page`)
      }
      if (!/<summary class="section-head"><h3>[^<]+<\/h3><span class="sub">\d+<\/span>/.test(html)) {
        throw new Error('a folded group is not a section head saying how many are in it')
      }
      // The endurance group's paragraph ("These let the model pick swim, bike or run…") is
      // content and stays in the file, but the screen no longer prints it (D7).
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
  ['PlanFlow(no AI: building it yourself is the only button, primary, and nothing mentions a model)', null, () => {
    const one = [plan.plannerKinds.kinds[0]]
    _setMe({ id: 'sam', owner: false, features: { ai: false, goals: false, whoop: false, strava: false, notifications: false } })
    try {
      // Without the model, the kinds are the first screen.
      const html = renderToString(<KindStep plan={plan} custom="" setCustom={noop} setPicked={noop}
        onBuild={noop} picked={one} />)
      const t = text(html)
      if (!/Build it myself/.test(t)) throw new Error('no way to build a workout without the AI')
      if (/Write it for me|Write me \d/.test(t)) throw new Error('the model is offered to someone it is not set up for')
      if (/model|Sparkles/i.test(t.replace(/<[^>]*>/g, ' '))) throw new Error('the screen mentions a model')
      const btns = html.match(/<button class="btn big[^"]*"/g) || []
      if (btns.length !== 1 || /secondary|ghost/.test(btns[0])) throw new Error(`the only button is ${btns.join(' / ')}, not one primary`)
      const flowHtml = renderToString(<PlanFlow plan={plan} entries={[]} iso={TODAY} onKeep={noop} onClose={noop} />)
      const flow = text(flowHtml)
      if (/Write it for me|Drafts|What do you want to do/.test(flow)) throw new Error('the flow offers the model or its drafts')
      if (!/class="list-row kindrow/.test(flowHtml)) throw new Error('without the model, the first screen is not the kinds')
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
]
