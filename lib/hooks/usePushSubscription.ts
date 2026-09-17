'use client'

import { useEffect } from 'react'

// Same public key as lib/server/push.ts - safe to have in client code,
// that's what the "public" half of a VAPID key pair is for.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || 'BGI4kJnzbedMSJ9-cgol7_P8MnNzsyXzGjSG6QZwSZtKX1qCXvrcoxuXvH9FwDNrW0-rjpf8aZWBMcGn9EYrT1k'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/**
 * Registers this device for Web Push once the user is logged in, so calls
 * and messages can raise a system notification even when SociaLens isn't
 * open in a tab. Silently does nothing if the browser doesn't support
 * push, if the VAPID public key isn't configured, or if the person hasn't
 * granted notification permission - it never interrupts the app.
 */
export function usePushSubscription(userId?: string) {
  useEffect(() => {
    if (!userId) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    let cancelled = false

    ;(async () => {
      try {
        // Ask for permission the first time only - if the user already
        // said no, we don't nag them again on every load.
        if (Notification.permission === 'default') {
          const result = await Notification.requestPermission()
          if (result !== 'granted') return
        }
        if (Notification.permission !== 'granted') return

        const registration = await navigator.serviceWorker.ready
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          })
        }
        if (cancelled) return

        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription: subscription.toJSON() }),
        })
      } catch (err) {
        console.error('[push] subscription setup failed', err)
      }
    })()

    return () => { cancelled = true }
  }, [userId])
}
