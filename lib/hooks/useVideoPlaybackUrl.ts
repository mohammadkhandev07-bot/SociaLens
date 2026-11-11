'use client'

import { useEffect, useState } from 'react'

/**
 * Resolves the compatible rendition only while a video is eligible to load.
 * A queued conversion is polled until it becomes ready or fails; transient
 * lookup failures temporarily fall back to the original without abandoning
 * the background lookup, so a slow conversion can still replace it later.
 */
export function useVideoPlaybackUrl(originalUrl: string | null | undefined, enabled: boolean) {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !originalUrl) {
      setPlaybackUrl(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    let consecutiveErrors = 0

    setPlaybackUrl(null)

    const schedule = (delay: number) => {
      if (!cancelled) timer = setTimeout(check, delay)
    }

    const check = async () => {
      try {
        const response = await fetch(`/api/media/playback?url=${encodeURIComponent(originalUrl)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`Playback lookup failed: ${response.status}`)
        const result = await response.json() as { status?: string; playbackUrl?: string | null }

        if (cancelled) return
        consecutiveErrors = 0

        if (result.status === 'ready' && result.playbackUrl) {
          setPlaybackUrl(result.playbackUrl)
          return
        }
        if (result.status === 'untracked' || result.status === 'failed') {
          setPlaybackUrl(originalUrl)
          return
        }
        if (result.status !== 'queued' && result.status !== 'processing') {
          setPlaybackUrl(originalUrl)
          return
        }

        // Do not give up on slow conversions: keep checking while this video
        // remains near the viewport, with a capped interval to limit requests.
        attempts += 1
        schedule(Math.min(15_000, 3_000 + attempts * 1_000))
      } catch {
        if (cancelled) return
        consecutiveErrors += 1
        if (consecutiveErrors >= 4) {
          // Keep the video usable while the API recovers; a later successful
          // status check can still switch playback to the compatible rendition.
          setPlaybackUrl(originalUrl)
        }
        if (consecutiveErrors >= 20) return
        schedule(Math.min(15_000, 3_000 * consecutiveErrors))
      }
    }

    void check()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [originalUrl, enabled])

  return playbackUrl
}
