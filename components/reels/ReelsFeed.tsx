'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { ReelCard } from './ReelCard'
import { AdReelSlot } from '@/components/ads/AdReelSlot'
import { interleaveAds } from '@/lib/utils/adInsertion'
import { PostWithProfile } from '@/lib/types/database.types'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface ReelsFeedProps {
  reels: PostWithProfile[]
  isLoading: boolean
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
}

export function ReelsFeed({ reels = [], isLoading, onLoadMore, hasMore, isLoadingMore }: ReelsFeedProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetches the next batch of reels once someone's a couple videos out
  // from the end of what's loaded - matches the "keep the next few ready
  // before you get there" prefetch feel of Reels/Shorts, instead of
  // pulling every video up front on open.
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return
    if (activeIndex >= reels.length - 3) onLoadMore()
  }, [activeIndex, reels.length, onLoadMore, hasMore, isLoadingMore])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const scrollTop = containerRef.current.scrollTop
    const height = containerRef.current.clientHeight
    const newIndex = Math.round(scrollTop / height)
    setActiveIndex(newIndex)
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <LoadingSpinner className="text-white" />
      </div>
    )
  }

  if (!reels || reels.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-black text-white gap-3">
        <div className="text-5xl">🎬</div>
        <p className="font-semibold">No reels yet</p>
        <p className="text-sm text-white/50">Be the first to upload!</p>
      </div>
    )
  }

  const items = useMemo(() => {
  if (!Array.isArray(reels) || reels.length === 0) return []
  return interleaveAds(reels, 3, 8)
}, [reels])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-scroll snap-y snap-mandatory"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {items.map((item, index) => {
        if (item === 'ad') {
          return (
            <AdReelSlot
              key={`ad-${index}`}
              isActive={index === activeIndex}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(m => !m)}
            />
          )
        }
        return (
          <ReelCard
            key={(item as PostWithProfile).id}
            post={item as PostWithProfile}
            isActive={index === activeIndex}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted(m => !m)}
          />
        )
      })}
    </div>
  )
}
