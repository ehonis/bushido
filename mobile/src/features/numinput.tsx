/**
 * A number box that lets them type a decimal (app/src/numinput.jsx).
 *
 * See `lib/numtext.js` for why this exists. The box owns its TEXT; the parent
 * owns the NUMBER. A keystroke updates the text and, when it reads as a number,
 * the parent too. A change that did not come from this box — a thumb button, a
 * set carried forward, a different set on screen — replaces the text, because
 * then the number really has moved. One that did leaves the text alone, because
 * "12." and 12 are the same number and different text, and clobbering the text
 * with the number is the bug.
 *
 * `blank` is what an emptied box hands out — `null` everywhere except the lift
 * log, whose rows have always used '' for "not typed yet".
 *
 * Native: the decimal pad (or number pad) instead of inputMode; the web's
 * `className` is dropped, `style` styles the box, and `aria-label` passes
 * straight through (React Native reads it as the accessibility label).
 */
import React, { useEffect, useRef, useState } from 'react'
import type { TextInputProps } from 'react-native'
import { Input } from '../ui/kit'
import { acceptNumberText, numOrNull } from '../lib/numtext.js'

export function NumInput({ value, onChange, decimal = true, blank = null, className, ...rest }: Omit<TextInputProps, 'value' | 'onChange'> & {
  value: any
  onChange: (v: any) => void
  decimal?: boolean
  blank?: any
  className?: string
  'aria-label'?: string
}) {
  const shown = value === '' || value === null || value === undefined ? '' : String(value)
  const [text, setText] = useState(shown)
  const last = useRef(numOrNull(value))

  useEffect(() => {
    const v = numOrNull(value)
    if (v !== last.current) { last.current = v; setText(shown) }
  }, [value, shown])

  const change = (raw: string) => {
    const r = (acceptNumberText as any)(raw, { decimal })
    if (!r) return
    setText(r.text)
    if (!r.emit) return
    last.current = r.value
    onChange(r.value === null ? blank : r.value)
  }

  return (
    <Input
      keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
      inputMode={decimal ? 'decimal' : 'numeric'}
      returnKeyType="done"
      value={text}
      onChangeText={change}
      onBlur={() => setText(shown)}
      {...rest}
    />
  )
}
