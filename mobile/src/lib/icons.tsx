/*
 * The icon registry, ported from app/src/lib/icons.jsx: the same lucide glyphs
 * under the same names, from lucide-react-native (lucide drawn with
 * react-native-svg). One deep import per icon, so the bundle carries these and
 * not all of lucide.
 *
 * plan.json refers to icons by string name, so anything it can name must be
 * registered here, exactly as on the web. Unknown names fall back to a dot rather
 * than crashing. The second block is chrome the native screens need that the web
 * draws with CSS or the browser (a back chevron, a search glass).
 *
 * Generated from the web registry; to add one, confirm the file exists:
 *   ls node_modules/lucide-react-native/dist/esm/icons | grep -i <name>
 */
import React from 'react'
import type { ColorValue, StyleProp, ViewStyle } from 'react-native'
import { colors } from '../theme'
// Renamed in later lucide releases; the web's names are kept.
import Waves from 'lucide-react-native/icons/waves-horizontal'
import Trash2 from 'lucide-react-native/icons/trash'
import InfinityIcon from 'lucide-react-native/icons/infinity'
import History from 'lucide-react-native/icons/rotate-ccw-clock'
import CalendarDays from 'lucide-react-native/icons/calendar-days'
import Map from 'lucide-react-native/icons/map'
import Gauge from 'lucide-react-native/icons/gauge'
import NotebookPen from 'lucide-react-native/icons/notebook-pen'
import ShoppingBag from 'lucide-react-native/icons/shopping-bag'
import FlaskConical from 'lucide-react-native/icons/flask-conical'
import Feather from 'lucide-react-native/icons/feather'
import Shield from 'lucide-react-native/icons/shield'
import Dumbbell from 'lucide-react-native/icons/dumbbell'
import Mountain from 'lucide-react-native/icons/mountain'
import Moon from 'lucide-react-native/icons/moon'
import LogOut from 'lucide-react-native/icons/log-out'
import Flame from 'lucide-react-native/icons/flame'
import Target from 'lucide-react-native/icons/target'
import Timer from 'lucide-react-native/icons/timer'
import Check from 'lucide-react-native/icons/check'
import Circle from 'lucide-react-native/icons/circle'
import ChevronDown from 'lucide-react-native/icons/chevron-down'
import TriangleAlert from 'lucide-react-native/icons/triangle-alert'
import CircleCheck from 'lucide-react-native/icons/circle-check'
import CircleSlash from 'lucide-react-native/icons/circle-slash'
import Info from 'lucide-react-native/icons/info'
import ExternalLink from 'lucide-react-native/icons/external-link'
import Eye from 'lucide-react-native/icons/eye'
import EyeOff from 'lucide-react-native/icons/eye-off'
import X from 'lucide-react-native/icons/x'
import Pencil from 'lucide-react-native/icons/pencil'
import Footprints from 'lucide-react-native/icons/footprints'
import Hand from 'lucide-react-native/icons/hand'
import Sunrise from 'lucide-react-native/icons/sunrise'
import RotateCw from 'lucide-react-native/icons/rotate-cw'
import ClipboardCheck from 'lucide-react-native/icons/clipboard-check'
import PersonStanding from 'lucide-react-native/icons/person-standing'
import Move from 'lucide-react-native/icons/move'
import Sunset from 'lucide-react-native/icons/sunset'
import Umbrella from 'lucide-react-native/icons/umbrella'
import Repeat from 'lucide-react-native/icons/repeat'
import Grid2x2 from 'lucide-react-native/icons/grid-2x2'
import Sprout from 'lucide-react-native/icons/sprout'
import Users from 'lucide-react-native/icons/users'
import Route from 'lucide-react-native/icons/route'
import Plus from 'lucide-react-native/icons/plus'
import Layers from 'lucide-react-native/icons/layers'
import Expand from 'lucide-react-native/icons/expand'
import Activity from 'lucide-react-native/icons/activity'
import Bike from 'lucide-react-native/icons/bike'
import Sparkles from 'lucide-react-native/icons/sparkles'
import Waypoints from 'lucide-react-native/icons/waypoints'
import MoveHorizontal from 'lucide-react-native/icons/move-horizontal'
import ArrowUpDown from 'lucide-react-native/icons/arrow-up-down'
import Play from 'lucide-react-native/icons/play'
import Pause from 'lucide-react-native/icons/pause'
import SkipForward from 'lucide-react-native/icons/skip-forward'
import Minus from 'lucide-react-native/icons/minus'
import Flag from 'lucide-react-native/icons/flag'
import Volume2 from 'lucide-react-native/icons/volume-2'
import VolumeX from 'lucide-react-native/icons/volume-x'
import HeartPulse from 'lucide-react-native/icons/heart-pulse'
import House from 'lucide-react-native/icons/house'
import GitBranch from 'lucide-react-native/icons/git-branch'
import Bell from 'lucide-react-native/icons/bell'
import BellOff from 'lucide-react-native/icons/bell-off'
import Send from 'lucide-react-native/icons/send'
import ThumbsUp from 'lucide-react-native/icons/thumbs-up'
import ThumbsDown from 'lucide-react-native/icons/thumbs-down'
import Zap from 'lucide-react-native/icons/zap'
import Wind from 'lucide-react-native/icons/wind'
import TrendingUp from 'lucide-react-native/icons/trending-up'
import Droplets from 'lucide-react-native/icons/droplets'
import CalendarRange from 'lucide-react-native/icons/calendar-range'
import MessagesSquare from 'lucide-react-native/icons/messages-square'
import ListPlus from 'lucide-react-native/icons/list-plus'
import BatteryLow from 'lucide-react-native/icons/battery-low'
import Thermometer from 'lucide-react-native/icons/thermometer'
import Plane from 'lucide-react-native/icons/plane'
import Briefcase from 'lucide-react-native/icons/briefcase'
import Bandage from 'lucide-react-native/icons/bandage'
import ChevronRight from 'lucide-react-native/icons/chevron-right'
import ChevronLeft from 'lucide-react-native/icons/chevron-left'
import ChevronUp from 'lucide-react-native/icons/chevron-up'
import ArrowLeft from 'lucide-react-native/icons/arrow-left'
import Search from 'lucide-react-native/icons/search'
import Settings from 'lucide-react-native/icons/settings'
import User from 'lucide-react-native/icons/user'
import RefreshCw from 'lucide-react-native/icons/refresh-cw'
import Cloud from 'lucide-react-native/icons/cloud'
import CloudOff from 'lucide-react-native/icons/cloud-off'
import Copy from 'lucide-react-native/icons/copy'
import MessageCircle from 'lucide-react-native/icons/message-circle'
import ArrowUp from 'lucide-react-native/icons/arrow-up'
import Square from 'lucide-react-native/icons/square'
import Wifi from 'lucide-react-native/icons/wifi'
import WifiOff from 'lucide-react-native/icons/wifi-off'
import Link from 'lucide-react-native/icons/link'
import Unlink from 'lucide-react-native/icons/unlink'
import Star from 'lucide-react-native/icons/star'
import Clock from 'lucide-react-native/icons/clock'
import Ellipsis from 'lucide-react-native/icons/ellipsis'
import GripVertical from 'lucide-react-native/icons/grip-vertical'
import ArrowDown from 'lucide-react-native/icons/arrow-down'
import Lock from 'lucide-react-native/icons/lock'
import Server from 'lucide-react-native/icons/server'
import Weight from 'lucide-react-native/icons/weight'
import Vibrate from 'lucide-react-native/icons/vibrate'

const REGISTRY: Record<string, React.ComponentType<any>> = {
  CalendarDays, Map, Gauge, NotebookPen, ShoppingBag, FlaskConical, Feather, Shield, Dumbbell, Mountain, Moon, LogOut, Flame, Target, Timer, Check, Circle, ChevronDown, TriangleAlert, CircleCheck, CircleSlash, Info, ExternalLink, Eye, EyeOff, X, Pencil, Footprints, Hand, Sunrise, RotateCw, ClipboardCheck, PersonStanding, Move, Sunset, Umbrella, Repeat, Grid2x2, Sprout, Users, Route, Plus, Layers, Expand, Activity, Bike, Sparkles, Waypoints, MoveHorizontal, ArrowUpDown, Play, Pause, SkipForward, Minus, Flag, Volume2, VolumeX, HeartPulse, House, GitBranch, Bell, BellOff, Send, ThumbsUp, ThumbsDown, Zap, Wind, TrendingUp, Droplets, CalendarRange, MessagesSquare, ListPlus, BatteryLow, Thermometer, Plane, Briefcase, Bandage, Infinity: InfinityIcon,
  Waves, Trash2,
  // Native chrome.
  History,
  ChevronRight, ChevronLeft, ChevronUp, ArrowLeft, Search, Settings, User, RefreshCw, Cloud, CloudOff, Copy, MessageCircle, ArrowUp, Square, Wifi, WifiOff, Link, Unlink, Star, Clock, Ellipsis, GripVertical, ArrowDown, Lock, Server, Weight, Vibrate,
}

/** Is this a name plan.json may use? */
export const hasIcon = (name: string) => Boolean(REGISTRY[name])

export interface IconProps {
  name: string
  size?: number
  color?: ColorValue
  strokeWidth?: number
  style?: StyleProp<ViewStyle>
}

/** A lucide glyph by name. Colour defaults to --ink (the CSS currentColor). */
export function Icon({ name, size = 16, color = colors.ink, strokeWidth = 1.75, style }: IconProps) {
  const C = REGISTRY[name] || REGISTRY.Circle
  return <C size={size} color={color} strokeWidth={strokeWidth} style={style} />
}

export const TAB_ICONS: Record<string, string> = {
  today: 'CalendarDays',
  week: 'Target',
  log: 'NotebookPen',
  progress: 'Gauge',
  // A finish line for the standing things, waypoints for the ones Totem writes.
  achievements: 'Flag',
  goals: 'Waypoints',
  coach: 'Sparkles',
}

export const VERDICT_ICONS: Record<string, string> = {
  supported: 'CircleCheck',
  mixed: 'TriangleAlert',
  refuted: 'CircleSlash',
}
