/*
 * Just enough markdown for what the coach actually writes (app/src/lib/markdown.jsx).
 *
 * The same hand-rolled parser as the web, emitting native elements: blocks are
 * Views, inline runs are nested <T>s (which inherit size and colour from the
 * paragraph, the way a <strong> inherits from its <p>; so inline runs are plain
 * RN Text, not <T>, which would reset the size). There is no HTML and no
 * markup string anywhere, so there is nothing to inject into: a model that
 * emitted a `<script>` tag gets the literal text `<script>`.
 *
 * DELIBERATELY A SUBSET. Headings, bold, italic, inline code, fenced code,
 * bullets, numbered lists, blockquotes, links and paragraphs. No tables, no
 * images, no footnotes, no nested lists. If the coach starts emitting something
 * that matters and is missing, add it here and on the web.
 */
import React from 'react'
import { Linking, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '../theme'
import { T } from '../ui/Text'

/* --------------------------------------------------------------- inline */

const openLink = (url: string) => { Linking.openURL(url).catch(() => {}) }

/*
 * One pass, longest-delimiter-first, so `**bold**` is never mistaken for two
 * italics. Links are matched before emphasis so a URL containing an underscore
 * cannot be chopped in half by it.
 */
const INLINE: { re: RegExp; render: (m: RegExpExecArray, k: string) => React.ReactNode }[] = [
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/, render: (m, k) =>
      <Text key={k} style={s.link} accessibilityRole="link" onPress={() => openLink(m[2])}>{m[1]}</Text> },
  { re: /`([^`]+)`/, render: (m, k) => <Text key={k} style={s.code}>{m[1]}</Text> },
  { re: /\*\*([^*]+)\*\*/, render: (m, k) => <Text key={k} style={s.strong}>{m[1]}</Text> },
  { re: /__([^_]+)__/, render: (m, k) => <Text key={k} style={s.strong}>{m[1]}</Text> },
  /*
   * Emphasis has to HUG its content — the opener followed by a non-space, the
   * closer preceded by one. Without that, "3 * 4 = 12 and a lone * asterisk"
   * italicises everything between the two stray asterisks. Real markdown has
   * the same rule for the same reason.
   */
  { re: /(?<![\w*])\*(?!\s)([^*\n]*[^*\s])\*(?![\w*])/, render: (m, k) => <Text key={k} style={s.em}>{m[1]}</Text> },
  { re: /(?<![\w_])_(?!\s)([^_\n]*[^_\s])_(?![\w_])/, render: (m, k) => <Text key={k} style={s.em}>{m[1]}</Text> },
]

/**
 * Inline markdown to an array of strings and <T> runs. Wrap the result in a <T>:
 * a bare string cannot sit in a View.
 */
function inline(text: any, keyBase = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let rest = String(text ?? '')
  let n = 0
  while (rest) {
    // Whichever delimiter comes first wins, so emphasis inside a link's label
    // cannot pull the link apart.
    let best: { m: RegExpExecArray; rule: typeof INLINE[number] } | null = null
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

const isBullet = (l: string) => /^\s*[-*+]\s+/.test(l)
const isNumber = (l: string) => /^\s*\d+[.)]\s+/.test(l)
const stripBullet = (l: string) => l.replace(/^\s*[-*+]\s+/, '')
const stripNumber = (l: string) => l.replace(/^\s*\d+[.)]\s+/, '')

/**
 * Markdown to native elements. `text` in, elements out.
 *
 * Line-based rather than a real parser, because the input is one model's prose
 * and the cost of being wrong is that some markup shows as text.
 *
 * `size` and `color` are what the surrounding CSS gives .md (a coach bubble is
 * 14px, --ink); `className` is accepted for the web's props and ignored.
 */
export function Markdown({ text, size = 14, color = colors.ink, style }: {
  text: any
  className?: string
  size?: number
  color?: string
  style?: StyleProp<ViewStyle>
}) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const out: { kind: string; el: React.ReactNode }[] = []
  const lh = Math.round(size * 1.55)
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code. Everything inside is literal, including things that look like
    // markup — which is the whole point of a fence.
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      out.push({ kind: 'pre', el: (
        <ScrollView key={key++} horizontal style={s.pre} contentContainerStyle={{ padding: 10 }}>
          <T mono size={size * 0.88} color={color} lineHeight={lh}>{body.join('\n')}</T>
        </ScrollView>
      ) })
      continue
    }

    if (!line.trim()) { i++; continue }

    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) {
      // Headings inside a chat bubble are a size step, not a document outline —
      // an h1 in a reply should not be bigger than the page's own title.
      out.push({ kind: 'h', el: (
        <T key={key++} size={14} weight={700} color={colors.ink} lineHeight={lh} accessibilityRole="header">
          {inline(h[2], `h${key}`)}
        </T>
      ) })
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', el: (
        <View key={key++} style={s.quote}>
          <T size={size} dim lineHeight={lh}>{inline(body.join(' '), `q${key}`)}</T>
        </View>
      ) })
      continue
    }

    if (isBullet(line) || isNumber(line)) {
      const numbered = isNumber(line)
      const test = numbered ? isNumber : isBullet
      const strip = numbered ? stripNumber : stripBullet
      const items: string[] = []
      while (i < lines.length && test(lines[i])) items.push(strip(lines[i++]))
      const k = key++
      out.push({ kind: 'list', el: (
        <View key={k}>
          {items.map((t, j) => (
            <View key={j} style={[s.li, j === 0 && { marginTop: 0 }]}>
              <T size={size} faint lineHeight={lh} tabular style={s.marker}>{numbered ? `${j + 1}.` : '•'}</T>
              <T size={size} color={color} lineHeight={lh} style={{ flex: 1 }}>{inline(t, `${numbered ? 'n' : 'b'}${k}-${j}`)}</T>
            </View>
          ))}
        </View>
      ) })
      continue
    }

    // A paragraph runs to the next blank line or block start. Single newlines
    // inside it become spaces, as markdown says — the coach wraps its prose and
    // those wraps are not line breaks the user asked for.
    const para: string[] = []
    while (i < lines.length && lines[i].trim() &&
           !isBullet(lines[i]) && !isNumber(lines[i]) &&
           !/^(#{1,4})\s/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
      para.push(lines[i++])
    }
    out.push({ kind: 'p', el: <T key={key++} size={size} color={color} lineHeight={lh}>{inline(para.join(' '), `p${key}`)}</T> })
  }

  // .md's rhythm, with CSS margin collapsing: every block keeps 10px below it,
  // a heading takes 14px above and 6px below, and the larger of two touching
  // margins wins. The first and last child lose their outer margins.
  const below = (k: string) => (k === 'h' ? 6 : 10)
  const above = (k: string) => (k === 'h' ? 14 : 0)
  return (
    <View style={style}>
      {out.map((b, j) => (
        <View key={j} style={j ? { marginTop: Math.max(below(out[j - 1].kind), above(b.kind)) } : null}>{b.el}</View>
      ))}
    </View>
  )
}

/** The same renderer's inline half, for a single line. Wrap it in a <T>. */
export const inlineMarkdown = inline

const s = StyleSheet.create({
  strong: { color: colors.ink, fontWeight: '700' },
  em: { color: colors.ink, fontStyle: 'italic' },
  code: { fontFamily: 'Menlo', fontSize: 12.5, backgroundColor: colors.panel2 },
  link: { color: colors.accent, textDecorationLine: 'underline' },
  pre: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8, flexGrow: 0,
  },
  quote: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.line },
  li: { flexDirection: 'row', gap: 6, marginTop: 3, paddingLeft: 4 },
  marker: { minWidth: 14 },
})
