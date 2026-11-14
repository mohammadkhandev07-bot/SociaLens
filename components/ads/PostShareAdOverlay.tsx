'use client'

import { AdsterraBannerUnit } from './AdsterraBannerUnit'

interface PostShareAdOverlayProps {
  progress?: number
}

export function PostShareAdOverlay({ progress = 0 }: PostShareAdOverlayProps) {
  return (
    <div className="fixed inset-0 bg-background z-[300] flex flex-col items-center justify-center gap-4 px-6">
      <p className="text-xs font-medium text-muted-foreground tracking-wide">Sponsored</p>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden border bg-card p-2">
        <AdsterraBannerUnit size="300x250" priority />
      </div>
      <div className="w-full max-w-sm space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Posting...</span>
          <span className="font-medium tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-pink-500 to-purple-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  )
}
