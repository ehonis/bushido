/*
 * The coach: a tab you can sit in, and a bubble you can ask from
 * (app/src/coach.jsx).
 *
 * Both render the same conversation store (lib/coachapi.jsx): the bubble is for
 * quick chats, but a quick chat you later want back should be findable, and the
 * only way to guarantee that is for there to be one place things go.
 *
 * It is an agent with tools that can go and read the brain, the log and the web
 * before it answers, and can append a memory.
 *
 * THE OFFERS ARE THE ONLY THING IT CAN DO TO THE DAY, and even those it cannot do
 * alone: a session card lands when the user taps it, through the same `onPlace`
 * the day list's own taps go through, and the finger rules are enforced in the
 * engine before any suggestion is read (AGENTS.md §7).
 *
 * Native: the tab lays itself out (the thread scrolls, the composer rides the
 * keyboard and otherwise sits above the floating bar); a thread row swipes to
 * delete; the bubble opens as a page sheet.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Animated as RNAnimated, FlatList, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import Animated, { useAnimatedStyle } from 'react-native-reanimated'
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable'
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radius, TAP } from '../theme'
import { T } from '../ui/Text'
import { Btn, Press } from '../ui/kit'
import { Popover } from '../ui/Sheet'
import { confirm } from '../ui/menu'
import { impact, success } from '../ui/haptics'
import { Icon } from '../lib/icons'
import { useCoach } from '../lib/coachapi.jsx'
import { Markdown } from '../lib/markdown'
import { DOCK_CLEAR } from '../shell/Screen'

/* --------------------------------------------------------------- the tab */

export function CoachTab({ plan, onPlace }: any) {
  const { threads, active, asking, error, open, start, send, remove } = useCoach() as any
  const [showList, setShowList] = useState(false)
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  return (
    <View style={st.tab}>
      <Press haptic onPress={() => setShowList(v => !v)} style={st.toggle} accessibilityRole="button"
        accessibilityState={{ expanded: showList }}>
        <Icon name="Layers" size={15} color={colors.ink} />
        <T size={13} style={{ flex: 1 }} numberOfLines={1}>{active?.title || 'New chat'}</T>
        <Icon name={showList ? 'ChevronUp' : 'ChevronDown'} size={14} color={colors.ink} />
      </Press>

      {showList && (
        <View style={[st.list, { maxHeight: height * 0.4 }]}>
          <FlatList
            data={threads}
            keyExtractor={(t: any) => String(t.id)}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={(
              <>
                <Press haptic onPress={() => { start(); setShowList(false) }} style={st.newChat} accessibilityRole="button">
                  <Icon name="Plus" size={15} color={colors.inkDim} />
                  <T size={13} dim>New chat</T>
                </Press>
                {!threads.length && (
                  <T size={13} dim style={{ paddingHorizontal: 2, paddingVertical: 4 }}>
                    Nothing yet. Ask it something — it can read your log, your athlete profile
                    and the web before it answers.
                  </T>
                )}
              </>
            )}
            renderItem={({ item: t }: any) => (
              <ThreadRow t={t} on={active?.id === t.id}
                onOpen={() => { open(t.id); setShowList(false) }}
                onDelete={() => remove(t.id)} />
            )}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          />
        </View>
      )}

      <Conversation plan={plan} thread={active} asking={asking} error={error}
        onSend={send} onPlace={onPlace} restPad={DOCK_CLEAR + insets.bottom} />
    </View>
  )
}

/** A thread in the list. Swipe left to delete it, with a confirm: it is gone from the box too. */
function ThreadRow({ t, on, onOpen, onDelete }: any) {
  const ref = useRef<SwipeableMethods>(null)
  const ask = async () => {
    const ok = await confirm(`Delete “${t.title}”?`, { message: 'The conversation is removed from the server.' })
    ref.current?.close()
    if (ok) onDelete()
  }
  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Press onPress={ask} style={st.del} accessibilityLabel={`Delete ${t.title}`}>
          <Icon name="Trash2" size={18} color={colors.white} />
          <T size={12} weight={600} color={colors.white}>Delete</T>
        </Press>
      )}
    >
      <Press haptic onPress={onOpen} style={[st.row, on && st.rowOn]} accessibilityRole="button">
        <T size={13} weight={600} color={on ? colors.ink : colors.inkDim} numberOfLines={1}>{t.title}</T>
        {t.last ? <T size={11} dim numberOfLines={1}>{t.last}</T> : null}
        <T size={10} faint>{`${when(t.updatedAt)} · ${t.messages} messages`}</T>
      </Press>
    </ReanimatedSwipeable>
  )
}

/* ------------------------------------------------------------ the bubble */

/**
 * The button in the + row, and the sheet it opens.
 *
 * Deliberately the SAME conversation component as the tab, so a quick question
 * and a long sitting differ only in how much room they get. It opens on whatever
 * thread is active, which is usually the last thing the user was talking about —
 * the commonest quick chat being a follow-up to one.
 */
export function CoachBubble({ plan, onPlace }: any) {
  const { active, asking, error, send, threads, open, start } = useCoach() as any
  const [isOpen, setOpen] = useState(false)
  const insets = useSafeAreaInsets()

  // Opening onto nothing is a blank box with no history. If the user has talked
  // before and nothing is loaded, pick up the most recent thread.
  const launch = async () => {
    impact()
    if (!active && threads[0]) await open(threads[0].id)
    setOpen(true)
  }

  return (
    <>
      <Press onPress={launch} style={st.fab} accessibilityLabel="Ask the coach" accessibilityRole="button">
        <Icon name="Sparkles" size={20} color={colors.accent} />
      </Press>
      {isOpen && (
        <Popover label={active?.title || 'Ask the coach'} onClose={() => setOpen(false)}>
          <View style={st.boxHead}>
            <Icon name="Sparkles" size={15} color={colors.accent} />
            <T size={13} weight={600} style={{ flex: 1 }} numberOfLines={1}>{active?.title || 'Ask the coach'}</T>
            <Press haptic onPress={() => start()} style={st.headBtn} accessibilityLabel="New chat">
              <Icon name="Plus" size={15} color={colors.inkFaint} />
            </Press>
            <Press haptic onPress={() => setOpen(false)} style={st.headBtn} accessibilityLabel="Close">
              <Icon name="X" size={16} color={colors.inkFaint} />
            </Press>
          </View>
          <View style={{ flex: 1, paddingHorizontal: 12 }}>
            <Conversation plan={plan} thread={active} asking={asking} error={error}
              onSend={send} onPlace={onPlace} compact restPad={insets.bottom + 12} />
          </View>
        </Popover>
      )}
    </>
  )
}

/* ------------------------------------------------------ the conversation */

const PROMPTS = [
  'What should I do today, and why that?',
  'Am I actually training my diagnosed weakness?',
  'Look at my last month and tell me what I am avoiding.',
  'How should I structure a week for the half iron without losing the 12a?',
]

/**
 * `restPad` is the space under the composer while the keyboard is down (the
 * floating bar on the tab, the home indicator in the sheet). With the keyboard
 * up the composer sits 8pt above it and the thread shrinks to fit.
 */
function Conversation({ plan, thread, asking, error, onSend, onPlace, compact = false, restPad }: any) {
  const [text, setText] = useState('')
  const scroller = useRef<ScrollView>(null)
  const messages: any[] = thread?.messages || []
  const { height: kb } = useReanimatedKeyboardAnimation()
  const padded = useAnimatedStyle(() => ({ paddingBottom: Math.max(Math.abs(kb.value) + 8, restPad) }), [restPad])

  useEffect(() => { scroller.current?.scrollToEnd({ animated: true }) }, [messages.length, asking])

  // The reply lands as one piece (the API does not stream), so the haptic is a
  // success when it does. Here rather than on `asking` falling, so the tab and
  // the sheet, both mounted, buzz once between them.
  const ask = async (q: string) => {
    impact()
    const t = await onSend(q)
    if (t) success()
  }

  const submit = () => {
    const t = text.trim()
    if (!t || asking) return
    setText('')
    ask(t)
  }

  return (
    <Animated.View style={[{ flex: 1 }, padded]}>
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={st.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
      >
        {!messages.length && !asking && (
          <View style={{ paddingVertical: 8, paddingHorizontal: 2 }}>
            <T size={13} dim>
              It can read your training log, your athlete profile in Totem’s brain,
              the app’s own content and the web — and it will go and look before it
              answers rather than guessing.
            </T>
            {!compact && (
              <View style={{ gap: 6, marginTop: 10 }}>
                {PROMPTS.map(q => (
                  <Press key={q} haptic onPress={() => ask(q)} style={st.prompt} accessibilityRole="button">
                    <T size={13} dim>{q}</T>
                  </Press>
                ))}
              </View>
            )}
          </View>
        )}

        {messages.map((m, i) => (
          <View key={i} style={[st.bubble, m.role === 'user' ? st.user : st.coach]}>
            {/* Their own messages are plain text — the user did not write markdown, and
                rendering it as if they had would mangle an asterisk they meant. */}
            {m.role === 'user'
              ? <T size={14} lineHeight={22} selectable>{m.text}</T>
              : <Markdown text={m.text} className="bubble-text md" />}

            {/* A memory it wrote. Shown because a thing that changed a file on their
                box should never be something the user has to go and find out. */}
            {m.wroteMemory ? (
              <View style={st.memory}>
                <Icon name="NotebookPen" size={12} color={colors.accent} />
                <T size={11} color={colors.accent} style={{ flex: 1 }}>{`Remembered: ${m.wroteMemory}`}</T>
              </View>
            ) : null}

            {/* Offers. They do not move the day until the user presses one. */}
            {Array.isArray(m.sessions) && m.sessions.length > 0 && (
              <View style={{ gap: 6, marginTop: 10 }}>
                {m.sessions.map((s: any, j: number) => {
                  const opt = (plan?.dailyMenu || []).find((o: any) => o.id === s.optId)
                  if (!opt) return null
                  return (
                    <Press key={j} onPress={() => { impact(); onPlace?.(s) }} style={st.offer} accessibilityRole="button">
                      <Icon name={opt.icon || 'Target'} size={15} color={colors.ink} />
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <T size={13.5} weight={600}>{opt.name}</T>
                        {s.why ? <T size={11} dim>{s.why}</T> : null}
                      </View>
                      <T size={11} color={colors.accent}>{s.action === 'main' ? 'Make it today' : 'Add it'}</T>
                    </Press>
                  )
                })}
              </View>
            )}
          </View>
        ))}

        {asking && (
          <View style={[st.bubble, st.coach, st.thinking]}>
            <Dots />
            <T size={12} dim>Reading your log and your profile…</T>
          </View>
        )}

        {error ? (
          <View style={[st.bubble, st.error]}>
            <Icon name="TriangleAlert" size={14} color={colors.bad} />
            <T size={12.5} color={colors.bad} style={{ flex: 1 }}>{String(error)}</T>
          </View>
        ) : null}
      </ScrollView>

      <View style={st.ask}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          placeholder="Ask it anything about your training"
          placeholderTextColor={colors.inkFaint}
          selectionColor={colors.accent}
          keyboardAppearance="dark"
          style={[st.input, { minHeight: compact ? 56 : 76 }]}
        />
        <Btn title={asking ? '…' : 'Ask'} onPress={submit} disabled={!text.trim() || asking} />
      </View>
    </Animated.View>
  )
}

/**
 * Three pulsing dots. A turn is an agent reading files; it can take a while,
 * and silence for two minutes reads as a broken box.
 */
function Dots() {
  const vals = useRef([0, 1, 2].map(() => new RNAnimated.Value(0.25))).current
  useEffect(() => {
    const loops = vals.map((v, i) => RNAnimated.loop(RNAnimated.sequence([
      RNAnimated.delay(i * 180),
      RNAnimated.timing(v, { toValue: 1, duration: 600, useNativeDriver: true }),
      RNAnimated.timing(v, { toValue: 0.25, duration: 600, useNativeDriver: true }),
    ])))
    loops.forEach(l => l.start())
    return () => loops.forEach(l => l.stop())
  }, [vals])
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {vals.map((v, i) => <RNAnimated.View key={i} style={[st.dot, { opacity: v }]} />)}
    </View>
  )
}

function when(iso: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const st = StyleSheet.create({
  tab: { flex: 1, paddingHorizontal: 16 },
  toggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP, marginBottom: 10, paddingHorizontal: 12,
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  list: { marginBottom: 10 },
  newChat: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: TAP, marginBottom: 6,
    backgroundColor: colors.panel2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radius.md,
  },
  row: {
    gap: 2, paddingVertical: 9, paddingHorizontal: 10, borderRadius: radius.md,
    borderWidth: 1, borderColor: 'transparent', backgroundColor: colors.bg,
  },
  rowOn: { backgroundColor: colors.panel2, borderColor: colors.line },
  del: {
    width: 84, marginLeft: 4, borderRadius: radius.md, backgroundColor: colors.vizCrit,
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  body: { gap: 10, paddingTop: 2, paddingHorizontal: 2, paddingBottom: 8 },
  bubble: { maxWidth: '90%', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  user: { alignSelf: 'flex-end', backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line },
  coach: { alignSelf: 'flex-start', paddingLeft: 0, maxWidth: '100%' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { alignSelf: 'stretch', maxWidth: '100%', borderWidth: 1, borderColor: colors.bad, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  memory: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  offer: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: TAP, paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  prompt: {
    minHeight: TAP, paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
  },
  ask: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  input: {
    flex: 1, maxHeight: 140, padding: 10, paddingTop: 10, textAlignVertical: 'top',
    backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    color: colors.ink, fontSize: 16, lineHeight: 22,
  },
  fab: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 8 },
  },
  boxHead: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 12, paddingRight: 8,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headBtn: { width: TAP, height: TAP, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
})
