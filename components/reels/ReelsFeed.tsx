'use client'

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { ReelCard } from './ReelCard'
import { AdReelSlot } from '@/components/ads/AdReelSlot'
import { interleaveAds, dedupeById } from '@/lib/utils/adInsertion'
import { PostWithProfile } from '@/lib/types/database.types'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'

interface ReelsFeedProps {
  reels: PostWithProfile[]
  isLoading: boolean
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean
}

export function ReelsFeed({ reels, isLoading, onLoadMore, hasMore, isLoadingMore }: ReelsFeedProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const items = useMemo(() => interleaveAds(dedupeById(reels), 3, 8), [reels])

  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return
    if (activeIndex >= items.length - 3) onLoadMore()
  }, [activeIndex, items.length, onLoadMore, hasMore, isLoadingMore])

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const scrollTop = containerRef.current.scrollTop
    const height = containerRef.current.clientHeight
    const newIndex = Math.round(scrollTop / height)
    setActiveIndex(newIndex)
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoadingSpinner className="text-white" />
      </div>
    )
  }

  if (reels.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-background text-foreground gap-3">
        <div className="text-5xl">🎬</div>
        <p className="font-semibold">No reels yet</p>
        <p className="text-sm text-muted-foreground">Be the first to upload!</p>
      </div>
    )
  }

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
              key={`ad-reel-${index}`}
              isActive={index === activeIndex}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(m => !m)}
            />
          )
        }
        return (
          <ReelCard
            key={item.id}
            post={item}
            isActive={index === activeIndex}
            shouldLoad={Math.abs(index - activeIndex) <= 1}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted(m => !m)}
          />
        )
      })}
    </div>
  )
}
