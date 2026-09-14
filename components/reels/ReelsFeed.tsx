'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
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

export function ReelsFeed({
  reels = [],
  isLoading,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
}: ReelsFeedProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isMuted, setIsMuted] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)

  /*
   * IMPORTANT:
   * All hooks are declared before any conditional return.
   * This prevents React hook-order errors such as:
   * "Rendered more hooks than during the previous render"
   */

  const handleScroll = useCallback(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const height = container.clientHeight

    if (height <= 0) {
      return
    }

    const scrollTop = container.scrollTop
    const newIndex = Math.round(scrollTop / height)

    setActiveIndex((previousIndex) => {
      return previousIndex === newIndex ? previousIndex : newIndex
    })
  }, [])

  /*
   * Add ads between reels.
   * Only calculate this from valid reel data.
   */
  const items =
    Array.isArray(reels) && reels.length > 0
      ? interleaveAds(reels, 3, 8)
      : []

  /*
   * Load more reels when the user is close to the end.
   */
  useEffect(() => {
    if (!onLoadMore) {
      return
    }

    if (!hasMore) {
      return
    }

    if (isLoadingMore) {
      return
    }

    if (items.length === 0) {
      return
    }

    const remainingItems = items.length - 1 - activeIndex

    if (remainingItems <= 3) {
      onLoadMore()
    }
  }, [
    activeIndex,
    items.length,
    onLoadMore,
    hasMore,
    isLoadingMore,
  ])

  /*
   * Keep active index valid if the feed becomes shorter
   * after loading/refreshing reels.
   */
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndex(0)
      return
    }

    const maxIndex = items.length - 1

    if (activeIndex > maxIndex) {
      setActiveIndex(maxIndex)
    }
  }, [items.length, activeIndex])

  /*
   * Loading state
   */
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        <LoadingSpinner className="text-white" />
      </div>
    )
  }

  /*
   * Empty state
   */
  if (!Array.isArray(reels) || reels.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-black text-white">
        <div className="text-5xl" aria-hidden="true">
          🎬
        </div>

        <p className="font-semibold">
          No reels yet
        </p>

        <p className="text-sm text-white/50">
          Be the first to upload!
        </p>
      </div>
    )
  }

  /*
   * Main reels feed
   */
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full w-full overflow-y-scroll snap-y snap-mandatory overscroll-y-contain"
      style={{
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {items.map((item, index) => {
        /*
         * Ad item
         */
        if (item === 'ad') {
          return (
            <AdReelSlot
              key={`reel-ad-${index}`}
              isActive={index === activeIndex}
              isMuted={isMuted}
              onToggleMute={() => {
                setIsMuted((previous) => !previous)
              }}
            />
          )
        }

        /*
         * Reel item
         */
        const reel = item as PostWithProfile

        return (
          <ReelCard
            key={reel.id}
            post={reel}
            isActive={index === activeIndex}
            isMuted={isMuted}
            onToggleMute={() => {
              setIsMuted((previous) => !previous)
            }}
          />
        )
      })}

      /*
       * Loading indicator for pagination.
       * This does not replace the existing reels.
       */
      {isLoadingMore && (
        <div className="flex min-h-[80px] items-center justify-center bg-black">
          <LoadingSpinner className="text-white" />
        </div>
      )}
    </div>
  )
}
