'use client'

import { Heart, MessageCircle, Send, Bookmark, Volume2, VolumeX } from 'lucide-react'
import { NativeAdUnit } from './NativeAdUnit'

interface AdReelSlotProps {
  isActive: boolean
  isMuted: boolean
  onToggleMute: () => void
}

// Sits in the Reels swipe feed at a randomized position (see
// lib/utils/adInsertion.ts) styled exactly like a real reel: full-screen
// dark stage, the same bottom-left "account" info block, and the same
// right-side action rail - so scrolling past it feels identical to
// scrolling past any other reel. The action icons are decorative (an ad
// isn't likeable/commentable content), matching how a sponsored post on
// Instagram still shows the standard icon row without them doing anything
// meaningful. The only tell, by design, is the small "Sponsored" label
// where a username would be - required so this stays honest advertising
// rather than deceptive content.
export function AdReelSlot({ isActive, isMuted, onToggleMute }: AdReelSlotProps) {
  return (
    <div className="relative w-full h-full flex-shrink-0 bg-black snap-start snap-always overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        {isActive && <NativeAdUnit style={{ height: '100%' }} background="#000000" />}
      </div>

      <button onClick={onToggleMute} className="absolute top-3 right-3 z-20 h-9 w-9 rounded-full bg-black/30 flex items-center justify-center">
        {isMuted ? <VolumeX className="h-4 w-4 text-white" /> : <Volume2 className="h-4 w-4 text-white" />}
      </button>

      {/* Right-side action rail - visually matches ReelCard's, purely
          decorative here since there's no real post to like/save. */}
      <div className="absolute right-2 bottom-24 z-10 flex flex-col items-center gap-5">
        <div className="flex flex-col items-center gap-1 opacity-80">
          <Heart className="h-7 w-7 text-white" />
        </div>
        <div className="flex flex-col items-center gap-1 opacity-80">
          <MessageCircle className="h-7 w-7 text-white" />
        </div>
        <div className="flex flex-col items-center gap-1 opacity-80">
          <Send className="h-7 w-7 text-white" />
        </div>
        <div className="flex flex-col items-center gap-1 opacity-80">
          <Bookmark className="h-7 w-7 text-white" />
        </div>
      </div>

      {/* Bottom info - same position/shape as a real reel's account row. */}
      <div className="absolute bottom-6 left-3 right-16 z-10 pointer-events-none">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-full border-2 border-white/80 bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center">
            <span className="text-white text-sm font-bold">Ad</span>
          </div>
          <span className="text-white font-semibold text-sm drop-shadow">Sponsored</span>
        </div>
      </div>
    </div>
  )
}
