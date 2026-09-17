import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

// Generated once for this project - a VAPID key pair just identifies "this
// server" to the push service, it isn't a per-deployment secret you need
// to rotate, so it's baked in here instead of making you set it up in
// environment variables. (The public half is also hardcoded in
// usePushSubscription.ts - both halves have to match.)
// Generated once for this project - a VAPID key pair just identifies "this
// server" to the push service, it isn't a per-deployment secret you need
// to rotate. Reads from an env var if one's set (recommended once this
// repo is public/shared, so the private half isn't sitting in source
// control) and falls back to the original baked-in pair otherwise, so
// nothing breaks if you don't set one. (The public half is also in
// usePushSubscription.ts - both halves have to match.)
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BGI4kJnzbedMSJ9-cgol7_P8MnNzsyXzGjSG6QZwSZtKX1qCXvrcoxuXvH9FwDNrW0-rjpf8aZWBMcGn9EYrT1k'
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'NXrDfGWfCOQQWysEldmbeAB3hdepebohRluzEXFf1fQ'

let configured = false
function ensureConfigured() {
  if (configured) return
  webpush.setVapidDetails('mailto:support@socialens.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  configured = true
}

export interface PushPayload {
  title: string
  body: string
  url: string
  /** 'call' shows Accept/Decline actions and a distinct look in the service worker. */
  kind?: 'call' | 'message' | 'generic'
  tag?: string
  callId?: string
  chatId?: string
}

/**
 * Sends a Web Push notification to every device a user is subscribed on.
 * This is what makes a call or message notify someone even when SociaLens
 * isn't open in a browser tab - same mechanism WhatsApp Web / every other
 * PWA relies on (native OS notification, played with the OS's own sound;
 * a custom in-app ringtone only plays once the person opens the app - the
 * Notification API can't play a custom sound while the page is closed).
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  ensureConfigured()

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
      } catch (err: any) {
        // 404/410 = the subscription is dead (user revoked permission,
        // uninstalled, etc.) - clean it up so we stop trying.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
        }
      }
    })
  )
}
