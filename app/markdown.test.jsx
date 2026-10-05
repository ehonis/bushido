/* The coach's markdown renderer:
 *   node app/markdown.test.js
 *
 * Hand-rolled, because the app has three runtime dependencies and pulling in a
 * markdown library to bold some words is a bad trade. Hand-rolled markdown is
 * also the classic way to ship an injection bug and a dozen emphasis bugs, so
 * this file is the price of not taking the dependency.
 *
 * Rendered to STATIC MARKUP here rather than inspected as elements, because what
 * matters is what reaches the screen — and rendering to a string is also the only
 * way to prove the escaping claim honestly.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './src/lib/markdown.jsx'

let failed = 0
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`) }
  catch (err) { failed++; console.error(`  FAIL  ${name}\n        ${err.message}`) }
}
const md = (text) => renderToStaticMarkup(<Markdown text={text} />)
const eq = (got, want, what = '') => {
  if (got !== want) throw new Error(`${what || 'value'}:\n        got  ${got}\n        want ${want}`)
}
const has = (text, needle) => {
  const out = md(text)
  if (!out.includes(needle)) throw new Error(`${JSON.stringify(needle)} not in ${out}`)
}
const hasnt = (text, needle) => {
  const out = md(text)
  if (out.includes(needle)) throw new Error(`${JSON.stringify(needle)} should not be in ${out}`)
}

/* ============================================================ the basics === */

check('bold, which is what started this', () => {
  // The screenshot that prompted it: `**Your stated split...**` on screen with
  // the asterisks showing.
  has('**Your stated split** is not what is happening', '<strong>Your stated split</strong>')
})

check('headings become a size step, not a document outline', () => {
  // An h1 in a chat bubble should not be bigger than the page title.
  has('## Two things', '<h4>Two things</h4>')
  has('# One', '<h3>One</h3>')
})

check('bullets and numbers', () => {
  has('- one\n- two', '<ul><li>one</li><li>two</li></ul>')
  has('1. first\n2. second', '<ol><li>first</li><li>second</li></ol>')
})

check('inline code, fenced code, quotes and links', () => {
  has('Read `state.json`', '<code>state.json</code>')
  has('```\nraw **not bold**\n```', '<pre><code>raw **not bold**</code></pre>')
  has('> a quote', '<blockquote>a quote</blockquote>')
  has('[the plan](https://example.com/x)',
    '<a href="https://example.com/x" target="_blank" rel="noreferrer">the plan</a>')
})

check('a wrapped line is one paragraph, not two', () => {
  // The coach wraps its prose for width; those wraps are not line breaks the user asked
  // for, and rendering them as breaks makes every reply look like poetry.
  eq(md('a line the model\nwrapped for width'),
    '<div class="md"><p>a line the model wrapped for width</p></div>')
})

/* ====================================================== the emphasis traps === */

check('THE BUG: a stray asterisk does not italicise the rest of the sentence', () => {
  // The first version turned "a lone * asterisk and 3 * 4 = 12" into
  // "a lone <em> asterisk and 3 </em> 4 = 12". Emphasis has to HUG its content.
  hasnt('a lone * asterisk and 3 * 4 = 12', '<em>')
  hasnt('use * for multiply and * for footnotes', '<em>')
})

check('...but real emphasis still works', () => {
  has('a *real* italic', '<em>real</em>')
  has('and _this_ one', '<em>this</em>')
  has('**bold** next to *italic*', '<strong>bold</strong>')
})

check('snake_case survives', () => {
  // The commonest false positive there is, in an app whose coach talks about
  // `max_heart_rate` and `period_start`.
  hasnt('snake_case_name and weight_kilogram', '<em>')
})

check('bold is not two italics', () => {
  eq(md('**x**'), '<div class="md"><p><strong>x</strong></p></div>')
})

check('a URL with an underscore is not chopped in half', () => {
  has('[x](https://example.com/a_b_c)', 'href="https://example.com/a_b_c"')
})

/* ============================================================== escaping === */

check('THE SAFETY CLAIM: there is no HTML to inject into', () => {
  // The renderer emits React elements, never an HTML string, so a model that
  // emitted a script tag gets it rendered as literal text. This asserts the
  // property rather than trusting the design note.
  const out = md('a <script>alert(1)</script> tag and an <img src=x onerror=y>')
  // The property is that no ELEMENT is created, not that the characters are
  // absent: "onerror=" sitting in escaped text is inert, and asserting it were
  // missing would be testing something that is not the claim.
  if (/<script|<img/i.test(out)) throw new Error('a tag survived as markup')
  if (!out.includes('&lt;script&gt;')) throw new Error('it should show as text')
  if (!out.includes('&lt;img src=x onerror=y&gt;')) throw new Error('the whole tag should be inert text')
})

check('an empty or missing reply renders nothing rather than crashing', () => {
  eq(md(''), '<div class="md"></div>')
  eq(md(undefined), '<div class="md"></div>')
  eq(md(null), '<div class="md"></div>')
})

check('a real coach reply, end to end', () => {
  const real = [
    'Pulled the actual log (state.json) rather than going off vibes.',
    '',
    '**Your stated split is not what is happening.** Over the last two weeks:',
    '',
    '- Week of Sep 1-7: one hard finger day (board, Sep 6)',
    '- Week of Sep 8-14: **zero** hard finger days',
    '',
    'It is not a recovery problem — WHOOP the last four days: 73, 92, 83, 59.',
  ].join('\n')
  const out = md(real)
  if (!out.includes('<ul>')) throw new Error('the list did not render')
  if (!out.includes('<strong>zero</strong>')) throw new Error('inline bold in a list item did not render')
  if (out.includes('**')) throw new Error('raw asterisks reached the screen')
})

console.log(failed ? `\n${failed} markdown test(s) failed` : '\nall markdown tests pass')
process.exit(failed ? 1 : 0)
