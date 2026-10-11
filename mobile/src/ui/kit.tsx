// The web's small building blocks (styles.css: button.btn, .card, .chip,
// .out-chip, .seg, label.field, .notefield, .empty, .modal-btn) as native
// components. Screens compose these rather than restyling Pressables by hand,
// so a tap target feels the same everywhere. Every one is at least 44pt tall:
// the app is used one-handed, mid-session, with chalk on it.
import React from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native'
import { colors, mix, radius, TAP } from '../theme'
import { Icon } from '../lib/icons'
import { T } from './Text'
import { tap } from './haptics'

/** A Pressable that dims when held, the native stand-in for :hover/:active. */
export function Press({ style, haptic, onPress, ...rest }: PressableProps & { style?: StyleProp<ViewStyle>; haptic?: boolean }) {
  return (
    <Pressable
      {...rest}
      onPress={(e) => { if (haptic) tap(); onPress?.(e) }}
      style={({ pressed }) => [style, pressed && !rest.disabled ? { opacity: 0.6 } : null, rest.disabled ? { opacity: 0.4 } : null]}
    />
  )
}

export type BtnKind = 'primary' | 'ghost' | 'bad' | 'quiet'

/** button.btn (the accent), .btn.ghost, .btn.bad. */
export function Btn({ title, icon, kind = 'primary', small, onPress, disabled, loading, style, children, flex }: {
  title?: string
  icon?: string
  kind?: BtnKind
  small?: boolean
  onPress?: () => void
  disabled?: boolean
  loading?: boolean
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
  /** flex: 1, for a footer of buttons that share the row. */
  flex?: boolean
}) {
  const fg = kind === 'primary' ? colors.onAccent : kind === 'bad' ? colors.bg : kind === 'quiet' ? colors.inkFaint : colors.inkDim
  return (
    <Press
      haptic
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={[s.btn, small && s.btnSmall, kindStyle[kind], flex && { flex: 1 }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={fg} /> : null}
      {title ? <T size={small ? 13 : 15} weight={600} color={fg} numberOfLines={1}>{title}</T> : null}
      {children}
    </Press>
  )
}

const kindStyle: Record<BtnKind, ViewStyle> = {
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  ghost: { backgroundColor: 'transparent', borderColor: colors.line },
  bad: { backgroundColor: colors.vizCrit, borderColor: colors.vizCrit },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
}

/** .modal-btn: a 44pt square, bordered, icon only. */
export function IconBtn({ icon, onPress, size = 18, color = colors.inkDim, label, style, bordered = true, disabled }: {
  icon: string
  onPress?: () => void
  size?: number
  color?: string
  label: string
  style?: StyleProp<ViewStyle>
  bordered?: boolean
  disabled?: boolean
}) {
  return (
    <Press
      haptic
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={[s.iconBtn, bordered && { borderWidth: 1, borderColor: colors.line }, style]}
    >
      <Icon name={icon} size={size} color={color} />
    </Press>
  )
}

/** .card. `tone` tints the border the way .card.rec / .card.done / .tile.warn do. */
export function Card({ children, style, onPress, tone }: {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  tone?: string | null
}) {
  const border = tone ? { borderColor: mix(tone, 40, colors.line) } : null
  if (onPress) return <Press onPress={onPress} style={[s.card, border, style]}>{children}</Press>
  return <View style={[s.card, border, style]}>{children}</View>
}

/** .card h2 */
export function H2({ children, style }: { children: React.ReactNode; style?: any }) {
  return <T size={14} weight={600} style={[{ marginBottom: 4, letterSpacing: 0.15 }, style]}>{children}</T>
}

/** p.sub: the muted line under a heading. */
export function Sub({ children, style, size = 13 }: { children: React.ReactNode; style?: any; size?: number }) {
  return <T size={size} dim style={style}>{children}</T>
}

/** .chip (filters) and, with `out`, .out-chip (an answer to a question): 44pt, pill. */
export function Chip({ label, icon, on, onPress, style, out, small }: {
  label: string
  icon?: string
  on?: boolean
  onPress?: () => void
  style?: StyleProp<ViewStyle>
  out?: boolean
  small?: boolean
}) {
  const fg = on ? colors.ink : colors.inkDim
  return (
    <Press
      haptic={!!onPress}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[
        s.chip,
        out ? s.outChip : null,
        small && { minHeight: 36, paddingHorizontal: 11 },
        on && (out ? s.outChipOn : s.chipOn),
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={on ? colors.accent : colors.inkFaint} /> : null}
      <T size={13} color={fg}>{label}</T>
    </Press>
  )
}

/** .seg: a row of mutually exclusive options. Scrolls when it cannot fit. */
export function Segmented<V extends string>({ options, value, onChange, style, scroll }: {
  options: { value: V; label: string; icon?: string }[]
  value: V
  onChange: (v: V) => void
  style?: StyleProp<ViewStyle>
  scroll?: boolean
}) {
  const body = options.map((o) => {
    const on = o.value === value
    return (
      <Press
        key={o.value}
        haptic
        onPress={() => onChange(o.value)}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={[s.seg, !scroll && { flex: 1 }, on && { backgroundColor: colors.panel2 }]}
      >
        {o.icon ? <Icon name={o.icon} size={15} color={on ? colors.ink : colors.inkFaint} /> : null}
        <T size={13} weight={500} color={on ? colors.ink : colors.inkFaint} numberOfLines={1}>{o.label}</T>
      </Press>
    )
  })
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.segWrap, style]} contentContainerStyle={{ gap: 4 }}>
        {body}
      </ScrollView>
    )
  }
  return <View style={[s.segWrap, { flexDirection: 'row', gap: 4 }, style]}>{body}</View>
}

/** input / textarea: --panel-2, 16pt so nothing zooms, 44pt tall. */
export const Input = React.forwardRef<TextInput, TextInputProps & { boxStyle?: StyleProp<ViewStyle> }>(function Input({ style, boxStyle, multiline, ...rest }, ref) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.inkFaint}
      selectionColor={colors.accent}
      keyboardAppearance="dark"
      multiline={multiline}
      {...rest}
      style={[s.input, multiline && { minHeight: 76, textAlignVertical: 'top', paddingTop: 10 }, boxStyle as any, style]}
    />
  )
})

/** label.field: a small dim label over its control. */
export function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 5, flexGrow: 1, flexBasis: 110 }, style]}>
      <T size={12} dim>{label}</T>
      {children}
    </View>
  )
}

/** .notefield: a labelled notes box. */
export function NoteField({ label, value, onChangeText, placeholder, rows = 3, style }: {
  label: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  rows?: number
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={[{ marginBottom: 12 }, style]}>
      <T size={12} dim style={{ marginBottom: 5 }}>{label}</T>
      <Input multiline value={value} onChangeText={onChangeText} placeholder={placeholder} style={{ minHeight: Math.max(76, rows * 22) }} />
    </View>
  )
}

/** A switch in the accent. */
export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Switch
      value={value}
      onValueChange={(v) => { tap(); onChange(v) }}
      disabled={disabled}
      trackColor={{ true: colors.accent, false: colors.line }}
      thumbColor={colors.ink}
      ios_backgroundColor={colors.line}
    />
  )
}

export function Spinner({ label, style }: { label?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingVertical: 30, alignItems: 'center', gap: 10 }, style]}>
      <ActivityIndicator color={colors.inkDim} />
      {label ? <T faint size={14}>{label}</T> : null}
    </View>
  )
}

/** .empty: centred faint text in a dashed box. */
export function Empty({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.empty, style]}>
      {typeof children === 'string' ? <T faint size={14} align="center">{children}</T> : children}
    </View>
  )
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }, style]} />
}

/** A row of label + value + chevron, the native form of a tappable list row. */
export function Row({ icon, label, value, onPress, right, danger }: {
  icon?: string
  label: string
  value?: string
  onPress?: () => void
  right?: React.ReactNode
  danger?: boolean
}) {
  return (
    <Press haptic={!!onPress} onPress={onPress} disabled={!onPress && !right} style={s.row}>
      {icon ? <Icon name={icon} size={18} color={danger ? colors.vizCrit : colors.inkDim} /> : null}
      <T size={15} color={danger ? colors.vizCrit : colors.ink} style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      {value ? <T size={14} faint numberOfLines={1}>{value}</T> : null}
      {right}
      {onPress && !right ? <Icon name="ChevronRight" size={16} color={colors.inkFaint} /> : null}
    </Press>
  )
}

export const s = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, minHeight: TAP,
  },
  btnSmall: { paddingVertical: 6, paddingHorizontal: 11, minHeight: 36 },
  iconBtn: { width: TAP, height: TAP, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 16, marginBottom: 14,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: 13, minHeight: 36, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel,
  },
  chipOn: { borderColor: colors.accent },
  outChip: { minHeight: TAP, backgroundColor: colors.panel2 },
  outChipOn: { borderColor: mix(colors.accent, 55, colors.line), backgroundColor: mix(colors.accent, 12, colors.panel2) },
  segWrap: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 4, flexGrow: 0, marginBottom: 14 },
  seg: { flexDirection: 'row', gap: 6, paddingVertical: 9, paddingHorizontal: 8, borderRadius: 7, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  input: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 10, minHeight: TAP, color: colors.ink, fontSize: 16,
  },
  empty: {
    paddingVertical: 40, paddingHorizontal: 20, alignItems: 'center',
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingVertical: 10 },
})
