/*
 * Just enough markdown for what the coach actually writes.
 *
 * It was rendering raw: `**Your stated split isn't what's happening**` appeared
 * on screen with the asterisks, along with `- ` bullets and `##` headings.
 *
 * NO DEPENDENCY, AND NO HTML. The app has three runtime dependencies — react,
 * react-dom, lucide — and pulling in a markdown library and its tree to bold some
 * words is a bad trade for a self-hosted app that has to load on a phone in a
 * basement. So this is hand-rolled, which is usually how you get an injection
 * bug: the standard mistake is producing an HTML string and handing it to
 * `dangerouslySetInnerHTML`.
 *
 * This produces REACT ELEMENTS instead. There is no HTML string anywhere in this
 * file, so there is nothing to inject into — a model that emitted a `<script>` tag
 * would have it rendered as the literal text `<script>`, which is both safe and
 * correct.
 *
 * DELIBERATELY A SUBSET. Headings, bold, italic, inline code, fenced code,
 * bullets, numbered lists, blockquotes, links and paragraphs. No tables, no
 * images, no footnotes, no nested lists. If the coach starts emitting something
 * that matters and is missing, add it here — but the failure mode is that the
 * markup shows as text, which is exactly where this started and is survivable.
 */

import { Fragment } from 'react'

/* --------------------------------------------------------------- inline */

/*
 * One pass, longest-delimiter-first, so `**bold**` is never mistaken for two
 * italics. Links are matched before emphasis so a URL containing an underscore
 * cannot be chopped in half by it.
 */
const INLINE = [
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/, render: (m, k) =>
      <a key={k} href={m[2]} target="_blank" rel="noreferrer">{m[1]}</a> },
  { re: /`([^`]+)`/, render: (m, k) => <code key={k}>{m[1]}</code> },
  { re: /\*\*([^*]+)\*\*/, render: (m, k) => <strong key={k}>{m[1]}</strong> },
  { re: /__([^_]+)__/, render: (m, k) => <strong key={k}>{m[1]}</strong> },
  /*
   * Emphasis has to HUG its content — the opener followed by a non-space, the
   * closer preceded by one. Without that, "3 * 4 = 12 and a lone * asterisk"
   * italicises everything between the two stray asterisks, which is what the
   * first version of this did. Real markdown has the same rule for the same
   * reason: prose is full of loose asterisks and underscores.
   */
  { re: /(?<![\w*])\*(?!\s)([^*\n]*[^*\s])\*(?![\w*])/, render: (m, k) => <em key={k}>{m[1]}</em> },
  { re: /(?<![\w_])_(?!\s)([^_\n]*[^_\s])_(?![\w_])/, render: (m, k) => <em key={k}>{m[1]}</em> },
]

function inline(text, keyBase = 'i') {
  const out = []
  let rest = String(text ?? '')
  let n = 0
  while (rest) {
    // Whichever delimiter comes first wins, so emphasis inside a link's label
    // cannot pull the link apart.
    let best = null
    for (const rule of INLINE) {
      const m = rule.re.exec(rest)
      if (m && (!best || m.index < best.m.index)) best = { m, rule }
    }
    if (!best) { out.push(rest); break }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index))
    out.push(best.rule.render(best.m, `${keyBase}-${n++}`))
    rest = rest.slice(best.m.index + best.m[0].length)
  }
  return out
}

/* ---------------------------------------------------------------- blocks */

const isBullet = (l) => /^\s*[-*+]\s+/.test(l)
const isNumber = (l) => /^\s*\d+[.)]\s+/.test(l)
const stripBullet = (l) => l.replace(/^\s*[-*+]\s+/, '')
const stripNumber = (l) => l.replace(/^\s*\d+[.)]\s+/, '')

/**
 * Markdown to React. `text` in, elements out.
 *
 * Line-based rather than a real parser, because the input is one model's prose
 * and the cost of being wrong is that some markup shows as text.
 */
export function Markdown({ text, className = 'md' }) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const out = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code. Everything inside is literal, including things that look like
    // markup — which is the whole point of a fence.
    if (/^\s*```/.test(line)) {
      const body = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      out.push(<pre key={key++}><code>{body.join('\n')}</code></pre>)
      continue
    }

    if (!line.trim()) { i++; continue }

    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      // Headings inside a chat bubble are a size step, not a document outline —
      // an h1 in a reply should not be bigger than the page's own title.
      const Tag = `h${Math.min(6, h[1].length + 2)}`
      out.push(<Tag key={key++}>{inline(h[2], `h${key}`)}</Tag>)
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(<blockquote key={key++}>{inline(body.join(' '), `q${key}`)}</blockquote>)
      continue
    }

    if (isBullet(line)) {
      const items = []
      while (i < lines.length && isBullet(lines[i])) items.push(stripBullet(lines[i++]))
      out.push(<ul key={key++}>{items.map((t, j) => <li key={j}>{inline(t, `b${key}-${j}`)}</li>)}</ul>)
      continue
    }

    if (isNumber(line)) {
      const items = []
      while (i < lines.length && isNumber(lines[i])) items.push(stripNumber(lines[i++]))
      out.push(<ol key={key++}>{items.map((t, j) => <li key={j}>{inline(t, `n${key}-${j}`)}</li>)}</ol>)
      continue
    }

    // A paragraph runs to the next blank line or block start. Single newlines
    // inside it become spaces, as markdown says — the coach wraps its prose and
    // those wraps are not line breaks the user asked for.
    const para = []
    while (i < lines.length && lines[i].trim() &&
           !isBullet(lines[i]) && !isNumber(lines[i]) &&
           !/^(#{1,4})\s/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
      para.push(lines[i++])
    }
    out.push(<p key={key++}>{inline(para.join(' '), `p${key}`)}</p>)
  }

  return <div className={className}>{out.map((el, j) => <Fragment key={j}>{el}</Fragment>)}</div>
}

/** The same renderer's inline half, for a single line. */
export const inlineMarkdown = inline
