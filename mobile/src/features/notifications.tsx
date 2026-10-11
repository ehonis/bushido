/*
 * Notifications, in the profile panel (app/src/notifications.jsx).
 *
 * On the web these are web push: a service worker and a VAPID subscription from
 * the Home Screen web app. A native app can only be reached through APNs, and the
 * server has no APNs sender, so there is nothing for this screen to subscribe
 * to. lib/push.js is not ported on purpose. The section keeps its place in the
 * profile and says where notifications still work.
 */
import React from 'react'
import { View } from 'react-native'
import { T } from '../ui/Text'
import { NotYet } from '../ui/NotYet'

export function NotificationsSection() {
  return (
    <View style={{ paddingBottom: 18 }}>
      <T size={14} weight={600} style={{ marginBottom: 10 }}>Notifications</T>
      <NotYet what="Notifications" icon="BellOff">
        Bushido’s notifications are web push, which only reaches the web app added to
        your Home Screen; they keep working there, and this app cannot receive them yet.
      </NotYet>
    </View>
  )
}
