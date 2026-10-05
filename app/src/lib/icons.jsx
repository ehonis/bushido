/*
 * Icon registry. Named imports only, so Vite tree-shakes the rest of lucide out
 * of the bundle — importing the whole library would add megabytes for 20 glyphs.
 *
 * plan.json refers to icons by string name, so anything it can name must be
 * registered here. Unknown names fall back to a dot rather than crashing.
 */
import {
  CalendarDays, Map, Gauge, NotebookPen, ShoppingBag, FlaskConical,
  Waves, Feather, Shield, Dumbbell, Mountain, Moon, LogOut,
  Flame, Target, Timer, Check, Circle, ChevronDown,
  TriangleAlert, CircleCheck, CircleSlash, Info, ExternalLink, Trash2,
  Eye, EyeOff, X, Pencil,
  Footprints, Hand, Sunrise, RotateCw, ClipboardCheck, PersonStanding, Move,
  Sunset, Umbrella, Repeat, Grid2x2, Sprout, Users, Route, Plus, Layers, Expand,
  Activity, Bike, Sparkles, Waypoints, MoveHorizontal, ArrowUpDown,
  Play, Pause, SkipForward, Minus, Flag, Volume2, VolumeX,
  HeartPulse, House, GitBranch,
  Bell, BellOff, Send, ThumbsUp, ThumbsDown,
  // The endurance kinds on the planner and the week planner, 2026-09-19.
  Zap, Wind, TrendingUp, Droplets, CalendarRange, MessagesSquare,
  // The hand-built route through the planner, 2026-09-22.
  ListPlus,
  // Why the user is resting, 2026-09-25.
  BatteryLow, Thermometer, Plane, Briefcase, Bandage,
  // Aliased: an unaliased `Infinity` import shadows the global inside this
  // module, which is a trap for whoever next edits it.
  Infinity as InfinityIcon,
} from 'lucide-react'

const REGISTRY = {
  CalendarDays, Map, Gauge, NotebookPen, ShoppingBag, FlaskConical,
  Waves, Feather, Shield, Dumbbell, Mountain, Moon, LogOut,
  Flame, Target, Timer, Check, Circle, ChevronDown,
  TriangleAlert, CircleCheck, CircleSlash, Info, ExternalLink, Trash2,
  Eye, EyeOff, X, Pencil,
  Footprints, Hand, Sunrise, RotateCw, ClipboardCheck, PersonStanding, Move,
  Sunset, Umbrella, Repeat, Grid2x2, Sprout, Users, Route, Plus, Layers, Expand,
  Activity, Bike, Sparkles, Waypoints, MoveHorizontal, ArrowUpDown,
  Play, Pause, SkipForward, Minus, Flag, Volume2, VolumeX,
  HeartPulse, House, GitBranch,
  Bell, BellOff, Send, ThumbsUp, ThumbsDown,
  Zap, Wind, TrendingUp, Droplets, CalendarRange, MessagesSquare,
  ListPlus,
  BatteryLow, Thermometer, Plane, Briefcase, Bandage,
  Infinity: InfinityIcon,
}

/**
 * Is this a name plan.json may use?
 *
 * An unknown name renders as a dot rather than crashing, which is the right
 * failure on a phone and the wrong one in a test: a kind whose icon was misspelt
 * in content looks like a bug the user caused. The smoke suite asks this for every icon
 * the planner's kinds and groups name.
 */
export const hasIcon = (name) => Boolean(REGISTRY[name])

export function Icon({ name, size = 16, className, strokeWidth = 1.75, ...rest }) {
  const C = REGISTRY[name] || Circle
  return <C size={size} strokeWidth={strokeWidth} className={className} aria-hidden="true" {...rest} />
}

/**
 * Bushido's own mark — the ECG trace off the favicon.
 *
 * Not in the registry above: that maps the names `plan.json` uses to lucide
 * glyphs, and this is the app's logo rather than a glyph content can ask for.
 *
 * The same nine points as `public/icon.svg`, scaled from its 512 box onto the
 * 2.5–21.5 span lucide draws inside so it sits level with the text beside it. The
 * tail ends ABOVE the baseline on purpose — a heartbeat's recovery and an
 * elevation profile at once, which is the whole idea of the icon.
 */
export function BushidoMark({ size = 18, className, ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth={1.9}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" {...rest}
    >
      <path d="M2.5 12.32 H8.15 L9.82 6.54 L12.13 17.46 L14.05 10.78 H15.85 L17.65 8.47 H21.5" />
    </svg>
  )
}

export const TAB_ICONS = {
  today: 'CalendarDays',
  week: 'Target',
  log: 'NotebookPen',
  progress: 'Gauge',
  // A finish line for the standing things, waypoints for the ones Totem writes.
  // Neither reuses the Week tab's target: two identical glyphs in one bar is a
  // bar you have to read rather than recognise.
  achievements: 'Flag',
  goals: 'Waypoints',
  coach: 'Sparkles',
}

export const VERDICT_ICONS = {
  supported: 'CircleCheck',
  mixed: 'TriangleAlert',
  refuted: 'CircleSlash',
}
