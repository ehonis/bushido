// The visual system's components (docs/DESIGN.md, "Visual system"), the native
// twins of the base classes in styles.css: button.btn and its kinds, .iconbtn,
// .card, .section-head, .chip / .out-chip, .seg, label.field, .notefield,
// .empty, .list-row. Screens compose these rather than restyling Pressables by
// hand, so a tap target feels the same everywhere. Every one is at least 44pt
// tall (filter chips 36 with a gap): the app is used one-handed, mid-session.
import React from 'react'
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native'
import { colors, font, mix, radius, space, TAP } from '../theme'
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

export type BtnKind = 'primary' | 'secondary' | 'ghost' | 'bad' | 'quiet'

/**
 * button.btn. One `primary` per screen (the accent, filled); `secondary` is a
 * solid neutral for the other real choice; `ghost` is outlined, for backing
 * out; `quiet` is text for a minor action; `bad` is a destructive confirm.
 */
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
  const fg = kind === 'primary' ? colors.onAccent : kind === 'bad' ? colors.bg : kind === 'secondary' ? colors.ink : colors.inkDim
  return (
    <Press
      haptic
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      style={[s.btn, small && s.btnSmall, kindStyle[kind], flex && { flex: 1 }, style]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon ? <Icon name={icon} size={small ? 14 : 16} color={fg} /> : null}
      {title ? <T size={small ? font.small : font.body} weight={600} color={fg} numberOfLines={1}>{title}</T> : null}
      {children}
    </Press>
  )
}

const kindStyle: Record<BtnKind, ViewStyle> = {
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  secondary: { backgroundColor: colors.panel3, borderColor: colors.lineStrong },
  ghost: { backgroundColor: 'transparent', borderColor: colors.lineStrong },
  bad: { backgroundColor: colors.vizCrit, borderColor: colors.vizCrit },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
}

/**
 * .iconbtn (.modal-btn): a 44pt round target, an icon only, a label always.
 * Quiet until pressed. `bordered` is the web's .qbtn, a rounded square for a
 * control that has to read as one on its own (the ± beside a number).
 */
export function IconBtn({ icon, onPress, size = 18, color = colors.inkDim, label, style, bordered = false, disabled }: {
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
    <Pressable
      onPress={() => { tap(); onPress?.() }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [
        s.iconBtn,
        bordered && s.iconBtnBordered,
        pressed && !disabled ? { backgroundColor: colors.panel3 } : null,
        disabled ? { opacity: 0.4 } : null,
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  )
}

/** .card: a group of related things on panel, flat (a line, no shadow). `tone` tints the border. */
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

/** .card h2: a card's title, bigger than the body under it. */
export function H2({ children, style }: { children: React.ReactNode; style?: any }) {
  return <T size={font.title} weight={600} lineHeight={22} style={[{ marginBottom: space[1] }, style]}>{children}</T>
}

/** .sub: the muted line under a title, or a hint under a field. */
export function Sub({ children, style, size = font.small }: { children: React.ReactNode; style?: any; size?: number }) {
  return <T size={size} dim style={style}>{children}</T>
}

/**
 * .section-head: a group's title in sentence case, with an optional count or
 * action at the right. Replaces `<T caps>` labels (wave 2 moves screens over).
 */
export function SectionHeader({ title, right, style }: { title: string; right?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.sectionHead, style]}>
      <T size={font.body} weight={600} style={{ flex: 1 }} numberOfLines={1}>{title}</T>
      {typeof right === 'string' ? <Sub>{right}</Sub> : right}
    </View>
  )
}

/**
 * .chip (a filter, 36pt in a row with a gap) and, with `out`, .out-chip (an
 * answer to a question, 44pt). Selected is the accent tint: border and fill
 * change, not only the colour.
 */
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
      <T size={font.small} color={fg}>{label}</T>
    </Press>
  )
}

/** .seg: two to four mutually exclusive views; the selected one is raised. Scrolls when it cannot fit. */
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
        style={[s.seg, !scroll && { flex: 1 }, on && s.segOn]}
      >
        {o.icon ? <Icon name={o.icon} size={15} color={on ? colors.ink : colors.inkDim} /> : null}
        <T size={font.small} weight={500} color={on ? colors.ink : colors.inkDim} numberOfLines={1}>{o.label}</T>
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
      style={[s.input, multiline && { minHeight: 76, textAlignVertical: 'top', paddingTop: 11 }, boxStyle as any, style]}
    />
  )
})

/** label.field: the label above its control. */
export function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 6, flexGrow: 1, flexBasis: 110 }, style]}>
      <T size={font.small} dim>{label}</T>
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
      <T size={font.small} dim style={{ marginBottom: 6 }}>{label}</T>
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

/** .empty: says what goes here (and, as a child, offers the one way to put it there). */
export function Empty({ children, style, icon }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; icon?: string }) {
  return (
    <View style={[s.empty, style]}>
      {icon ? <Icon name={icon} size={24} color={colors.inkFaint} /> : null}
      {typeof children === 'string' ? <T dim size={font.body} align="center">{children}</T> : children}
    </View>
  )
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line }, style]} />
}

/** .list-row: one thing you can open. Icon, name, the one fact that matters, chevron. */
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
      {icon ? <Icon name={icon} size={20} color={danger ? colors.vizCrit : colors.inkDim} /> : null}
      <T size={font.body} weight={500} color={danger ? colors.vizCrit : colors.ink} style={{ flex: 1 }} numberOfLines={1}>{label}</T>
      {value ? <T size={font.small} dim tabular numberOfLines={1}>{value}</T> : null}
      {right}
      {onPress && !right ? <Icon name="ChevronRight" size={16} color={colors.inkFaint} /> : null}
    </Press>
  )
}

export const s = StyleSheet.create({
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[2],
    borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space[4], minHeight: TAP,
  },
  btnSmall: { paddingHorizontal: space[3], minHeight: 36 },
  iconBtn: { width: TAP, height: TAP, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  // A bordered one is a rounded square, the web's .qbtn (a ± beside a number).
  iconBtnBordered: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.card },
  card: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.card,
    padding: space[4], marginBottom: space[3],
  },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: space[6], marginBottom: space[2] },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: space[3], minHeight: 36, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2,
  },
  chipOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  outChip: { minHeight: TAP },
  outChipOn: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  segWrap: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control, padding: 3, flexGrow: 0, marginBottom: space[3] },
  seg: { flexDirection: 'row', gap: 6, paddingHorizontal: space[2], borderRadius: 8, alignItems: 'center', justifyContent: 'center', minHeight: 38 },
  segOn: { backgroundColor: colors.panel3, borderWidth: 1, borderColor: colors.lineStrong },
  input: {
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.control,
    paddingHorizontal: space[3], paddingVertical: 10, minHeight: TAP, color: colors.ink, fontSize: font.input,
  },
  empty: {
    paddingVertical: space[8], paddingHorizontal: space[5], alignItems: 'center', gap: space[3],
    borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, borderRadius: radius.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 52, paddingVertical: space[2] },
})
