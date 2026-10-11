// Text in the system face, which is what the web asks for (ui-sans-serif,
// system-ui, -apple-system): San Francisco on an iPhone. Defaults match the web
// body (15px/1.55, --ink); `dim` is --ink-dim and `faint` is --ink-faint.
import React from 'react'
import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native'
import { colors } from '../theme'

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
  /** The small uppercase label the CSS uses for tags and section heads. */
  caps?: boolean
  mono?: boolean
}

export function T({ size = 15, weight, color, dim, faint, align, lineHeight, tabular, caps, mono, style, ...rest }: TProps) {
  const flat = StyleSheet.flatten(style) || {}
  const fontSize = (flat.fontSize as number | undefined) ?? size
  return (
    <RNText
      {...rest}
      style={[
        {
          fontSize: size,
          lineHeight: lineHeight ?? Math.round(fontSize * 1.45),
          color: color || (faint ? colors.inkFaint : dim ? colors.inkDim : colors.ink),
          textAlign: align,
          fontWeight: weight ? (String(weight) as TextStyle['fontWeight']) : undefined,
        },
        tabular && { fontVariant: ['tabular-nums'] },
        caps && { textTransform: 'uppercase', letterSpacing: fontSize * 0.07 },
        mono && { fontFamily: 'Menlo' },
        style,
      ]}
    />
  )
}
