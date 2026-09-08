'use client'

import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

interface InfiniteScrollSentinelProps {
  onIntersect: () => void
  hasMore: boolean
  isLoading: boolean
}

// Sits at the bottom of a list. The moment it scrolls into view, it
// triggers loading the next page - the same "load more as you scroll"
// pattern Instagram/Facebook use, instead of fetching an entire feed's
// worth of posts up front.
export function InfiniteScrollSentinel({ onIntersect, hasMore, isLoading }: InfiniteScrollSentinelProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onIntersect()
      },
      { rootMargin: '600px' } // starts loading well before it's actually visible, so scrolling never outruns it
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onIntersect, hasMore])

  if (!hasMore) return null

  return (
    <div ref={ref} className="flex justify-center py-6">
      {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
    </div>
  )
}
