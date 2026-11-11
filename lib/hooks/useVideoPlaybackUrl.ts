'use client'

import { useEffect, useState } from 'react'

/**
 * Resolves the transcoded rendition only while the video is eligible to load.
 * Pending jobs are polled with a bounded retry window; legacy and permanently
 * failed jobs retain the original URL so existing media is not broken.
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

    setPlaybackUrl(null)

    const check = async () => {
      try {
        const response = await fetch(`/api/media/playback?url=${encodeURIComponent(originalUrl)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`Playback lookup failed: ${response.status}`)
        const result = await response.json() as { status?: string; playbackUrl?: string | null }

        if (cancelled) return
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
      } catch {
        if (cancelled) return
        // Transient API/network failures get a few retries before falling back.
        if (attempts >= 3) {
          setPlaybackUrl(originalUrl)
          return
        }
      }

      attempts += 1
      if (attempts >= 20) {
        setPlaybackUrl(originalUrl)
        return
      }
      timer = setTimeout(check, 3000)
    }

    void check()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [originalUrl, enabled])

  return playbackUrl
}
