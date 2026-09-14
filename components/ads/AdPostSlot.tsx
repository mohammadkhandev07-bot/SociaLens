'use client'

import { Heart, MessageCircle, Share2, Bookmark } from 'lucide-react'
import { NativeAdUnit } from './NativeAdUnit'

// Sits in the Home feed / Explore grid at a randomized position (see
// lib/utils/adInsertion.ts) styled exactly like a real PostCard: same
// header row, same media area, same action-icon row underneath. The
// action icons are decorative (an ad isn't likeable/saveable content) -
// the only tell, by design, is the small "Sponsored" label where a
// timestamp would normally sit, matching how Instagram labels a
// sponsored post while keeping the rest of the layout identical.
export function AdPostSlot() {
  return (
    <article className="border-b bg-card">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center shrink-0">
          <span className="text-white text-sm font-bold">Ad</span>
        </div>
        <div>
          <p className="font-semibold text-sm leading-none">Sponsored</p>
        </div>
      </div>

      <div className="relative w-full bg-muted" style={{ minHeight: 280 }}>
        <NativeAdUnit background="var(--card, #fff)" />
      </div>

      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4 opacity-70">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Share2 className="h-6 w-6" />
        </div>
        <Bookmark className="h-6 w-6 opacity-70" />
      </div>
    </article>
  )
}
