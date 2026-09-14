'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { NativeAdUnit } from './NativeAdUnit'

interface AdStoryViewerProps {
  onClose: () => void
}

const DURATION_MS = 6000

// Deliberately a separate, simple component rather than reusing the real
// StoryViewer - that component is built entirely around real story rows
// (media_url, view/like/reply tracking, RPC calls, etc.), and hooking a
// fake ad "story" into all of that would be fragile. This mirrors just
// the parts that matter for the illusion: a top progress bar that fills
// and auto-advances (closes, here, since it's the only "story" in this
// viewer), a Sponsored label where a username sits, and a close button -
// visually consistent with a real story, without touching any of the
// real story-viewing logic.
export function AdStoryViewer({ onClose }: AdStoryViewerProps) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const pct = Math.min(100, ((Date.now() - start) / DURATION_MS) * 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(interval)
        onClose()
      }
    }, 50)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 bg-black z-[200] flex flex-col">
      <div className="absolute top-2 left-2 right-2 z-20 flex gap-1">
        <div className="h-0.5 flex-1 bg-white/30 rounded-full overflow-hidden">
          <div className="h-full bg-white transition-[width] duration-75 ease-linear" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="absolute top-6 left-3 right-3 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
            <span className="text-white text-xs font-bold">Ad</span>
          </div>
          <span className="text-white font-semibold text-sm drop-shadow">Sponsored</span>
        </div>
        <button onClick={onClose} className="text-white p-1">
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center" onClick={onClose}>
        <NativeAdUnit style={{ height: '100%' }} background="#000000" />
      </div>
    </div>
  )
}
