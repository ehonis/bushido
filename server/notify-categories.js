/*
 * What Bushido is allowed to interrupt for.
 *
 * Same shape as Totem's table (notify/categories.mjs in the personal-assistant
 * repo) and deliberately a different list: Totem does the personal stuff, Bushido
 * does health and training. Neither app knows about the other's categories.
 *
 * `pinned` is the column that matters. A pinned category ignores learned
 * weights, so no amount of thumbs-down can stop Bushido telling them the user finished a
 * workout — that one exists to close the loop on the thing the user just did.
 */

const HOUR = 60

export const BUSHIDO_CATEGORIES = {
  'workout.logged': {
    label: 'Workout logged',
    // Earned, immediate, and about something the user did sixty seconds ago. Waiting
    // until morning would make it a report rather than a response.
    quietHours: 'override',
    defaultEnabled: true,
    pinned: true,
    dedupeWindowMinutes: 0,
    slot: null,
  },
  'workout.unlogged': {
    label: 'Unlogged workout',
    quietHours: 'defer',
    defaultEnabled: true,
    dedupeWindowMinutes: 6 * HOUR,
    slot: 'evening',
  },
  'readiness.morning': {
    label: 'Morning readiness',
    quietHours: 'defer',
    defaultEnabled: true,
    dedupeWindowMinutes: 12 * HOUR,
    slot: 'morning',
  },
  'quota.pace': {
    label: 'Week quota',
    quietHours: 'defer',
    defaultEnabled: true,
    dedupeWindowMinutes: 24 * HOUR,
    slot: 'evening',
  },
  'goal.pace': {
    label: 'Goal pace',
    quietHours: 'defer',
    defaultEnabled: true,
    dedupeWindowMinutes: 7 * 24 * HOUR,
    slot: 'night',
  },
  'milestone.hit': {
    label: 'Milestones',
    quietHours: 'defer',
    defaultEnabled: true,
    pinned: true,
    dedupeWindowMinutes: 0,
    slot: null,
  },
  'body.warning': {
    label: 'Take it easy',
    quietHours: 'defer',
    defaultEnabled: true,
    dedupeWindowMinutes: 24 * HOUR,
    slot: 'morning',
  },
}
