const CACHE_NAME = 'geolink-v5'
const OFFLINE_URL = '/offline'

const PRECACHE = [
  '/',
  '/feed',
  '/offline',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)

  // Only handle requests belonging to SociaLens itself.
  if (url.origin !== self.location.origin) {
    return
  }

  // Handle Web Share Target POST.
  if (
    request.method === 'POST' &&
    url.pathname === '/share'
  ) {
    event.respondWith(handleShareTarget(request))
    return
  }

  // Service worker caching is only for GET requests.
  if (request.method !== 'GET') {
    return
  }

  const isApi = url.pathname.startsWith('/api/')

  const isVideo =
    request.destination === 'video' ||
    /\.(mp4|m4v|webm|mov|ogg)(?:$|\?)/i.test(url.pathname)

  const isNavigation = request.mode === 'navigate'

  /*
   * IMPORTANT:
   *
   * Do NOT cache:
   * - API responses
   * - video responses
   * - navigation documents
   *
   * Video requests can use HTTP Range / 206 Partial Content.
   * Caching a partial video response can make Android WebView
   * unable to load the complete video.
   *
   * Navigation requests are network-first so a new Vercel
   * deployment is not hidden behind an old cached page.
   */
  const shouldNotCache =
    isApi ||
    isVideo ||
    isNavigation

  event.respondWith(
    fetch(
      request,
      shouldNotCache
        ? { cache: 'no-store' }
        : { cache: 'default' }
    )
      .then(response => {

        /*
         * Only cache normal non-API, non-video, non-navigation
         * successful responses.
         */
        if (
          response.ok &&
          !shouldNotCache
        ) {
          const clone = response.clone()

          caches.open(CACHE_NAME)
            .then(cache => {
              return cache.put(request, clone)
            })
            .catch(() => {})
        }

        return response
      })
      .catch(() => {
        return caches.match(request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse
            }

            return caches.match(OFFLINE_URL)
          })
      })
  )
})

async function handleShareTarget(request) {
  const origin = new URL(request.url).origin

  try {
    await request.formData()
  } catch (error) {
    // Ignore share parsing errors.
  }

  return Response.redirect(
    `${origin}/share/handle`,
    303
  )
}

self.addEventListener('push', event => {
  if (!event.data) {
    return
  }

  let data = {
    title: 'GeoLink',
    body: 'New notification',
    url: '/feed',
    kind: 'generic',
  }

  try {
    data = {
      ...data,
      ...event.data.json(),
    }
  } catch (error) {
    // Ignore invalid push payload.
  }

  const isCall = data.kind === 'call'
  const isMessage = data.kind === 'message'

  event.waitUntil(
    self.registration.showNotification(
      data.title,
      {
        body: data.body,

        icon: '/icons/icon-192x192.png',

        badge: '/icons/icon-72x72.png',

        vibrate: isCall
          ? [400, 200, 400, 200, 400, 200, 400]
          : [200, 100, 200],

        data: {
          url: data.url,
          kind: data.kind,
          callId: data.callId,
          chatId: data.chatId,
        },

        tag: data.tag || 'geolink',

        renotify: true,

        requireInteraction: isCall,

        actions: isCall
          ? [
              {
                action: 'accept',
                title: 'Accept',
              },
              {
                action: 'decline',
                title: 'Decline',
              },
            ]
          : isMessage
            ? [
                {
                  action: 'reply',
                  title: 'Open chat',
                },
              ]
            : [],
      }
    )
  )
})

self.addEventListener('notificationclick', event => {
  const notification = event.notification

  const {
    url,
    kind,
    callId,
    chatId,
  } = notification.data || {}

  notification.close()

  /*
   * Decline incoming call directly from notification.
   */
  if (
    kind === 'call' &&
    event.action === 'decline'
  ) {
    event.waitUntil(
      fetch(
        '/api/calls/decline',
        {
          method: 'POST',

          credentials: 'same-origin',

          headers: {
            'Content-Type': 'application/json',
          },

          body: JSON.stringify({
            callId,
          }),
        }
      ).catch(() => {})
    )

    return
  }

  let targetUrl =
    url ||
    (chatId
      ? `/chat/${chatId}`
      : '/feed')

  /*
   * Preserve incoming call ID in the URL.
   *
   * This is important when the app is completely closed.
   * A newly opened page can read the call ID after startup.
   */
  if (
    kind === 'call' &&
    callId
  ) {
    const separator =
      targetUrl.includes('?')
        ? '&'
        : '?'

    targetUrl =
      `${targetUrl}${separator}incomingCall=${encodeURIComponent(callId)}`
  }

  event.waitUntil(
    clients
      .matchAll({
        type: 'window',
      })
      .then(clientList => {

        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl)
            client.focus()

            return
          }
        }

        return clients.openWindow(targetUrl)
      })
  )
})

self.addEventListener('message', event => {

  /*
   * Force the new service worker to activate.
   */
  if (
    event.data?.type === 'SKIP_WAITING'
  ) {
    self.skipWaiting()
  }

  /*
   * App badge support.
   */
  if (
    event.data?.type === 'SET_BADGE' &&
    'setAppBadge' in navigator
  ) {
    navigator
      .setAppBadge(event.data.count)
      .catch(() => {})
  }

  if (
    event.data?.type === 'CLEAR_BADGE' &&
    'clearAppBadge' in navigator
  ) {
    navigator
      .clearAppBadge()
      .catch(() => {})
  }
})
