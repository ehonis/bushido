// Text in the system face, which is what the web asks for (ui-sans-serif,
// system-ui, -apple-system): San Francisco on an iPhone. Defaults match the web
// body (16/24, --ink); `dim` is --ink-dim and `faint` is --ink-faint. A size
// from `font` takes its role's line height from `leading` (12/16, 14/20,
// 16/24, 18/24, 24/30, 32/38); anything else is 1.25 of its size (the clocks).
import React from 'react'
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native'
import { colors, font, leading } from '../theme'

export interface TProps extends TextProps {
  size?: number
  weight?: 400 | 500 | 600 | 700
  color?: string
  dim?: boolean
  faint?: boolean
  align?: TextStyle['textAlign']
  lineHeight?: number
  /** font-variant-numeric: tabular-nums, for clocks and counters. */
  tabular?: boolean
  mono?: boolean
}

const LEADING: Record<number, number> = {
  [font.caption]: leading.caption, [font.label]: leading.label, [font.body]: leading.body,
  [font.title]: leading.title, [font.screen]: leading.screen, [font.stat]: leading.stat,
}
/** The line height a size takes: its role's, else 1.25 of it. */
export function leadingFor(size: number) { return LEADING[size] ?? Math.round(size * 1.25) }

export function T({ size = font.body, weight, color, dim, faint, align, lineHeight, tabular, mono, style, ...rest }: TProps) {
  const flat = StyleSheet.flatten(style) || {}
  const fontSize = (flat.fontSize as number | undefined) ?? size
  return (
    <RNText
      {...rest}
      style={[
        {
          fontSize: size,
          lineHeight: lineHeight ?? leadingFor(fontSize),
          color: color || (faint ? colors.inkFaint : dim ? colors.inkDim : colors.ink),
          textAlign: align,
          fontWeight: weight ? (String(weight) as TextStyle['fontWeight']) : undefined,
        },
        tabular && { fontVariant: ['tabular-nums'] },
        mono && { fontFamily: 'Menlo' },
        style,
      ]}
    />
  )
}
