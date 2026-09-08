'use client'

import { useState } from 'react'
import { PostCard } from '@/components/feed/PostCard'
import { PostSkeleton } from '@/components/feed/PostSkeleton'
import { AdsterraBanner } from '@/components/shared/AdsterraBanner'
import { StoriesBar } from '@/components/stories/StoriesBar'
import { useFeedPosts } from '@/lib/hooks/usePosts'
import { useUser } from '@/lib/hooks/useUser'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { InfiniteScrollSentinel } from '@/components/shared/InfiniteScrollSentinel'

export default function FeedPage() {
  const { user } = useUser()
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useFeedPosts(user?.id)
  const posts = data?.pages.flatMap(page => page.posts) ?? []
  const supabase = createClient()
  const queryClient = useQueryClient()

  const handleDeletePost = async (postId: string) => {
    if (!user) return
    const { data, error } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId)
      .eq('user_id', user.id)
      .select('id')

    if (error || !data || data.length === 0) {
      alert('Could not delete this post. Please try again.')
      return
    }
    queryClient.invalidateQueries({ queryKey: ['feed-posts'] })
  }

  return (
    <div className="max-w-xl mx-auto">
      {/* Stories */}
      <StoriesBar />

      {/* feed */}
      <div>
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => <PostSkeleton key={i} />)
          : posts.length === 0
          ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-lg font-medium">No posts to show right now</p>
              <p className="text-sm mt-1">Follow people to fill your feed with their posts</p>
            </div>
          )
          : posts.map((post, index) => {
              const isFirstSuggested = post.is_suggested && !posts[index - 1]?.is_suggested
              return (
                <div key={post.id}>
                  {isFirstSuggested && (
                    <div className="px-4 py-3 text-sm font-semibold text-muted-foreground border-t">
                      Suggested for you
                    </div>
                  )}
                  <PostCard post={post} onDelete={handleDeletePost} />
                  {(index + 1) % 4 === 0 && (
                    <div className="border-y bg-muted/20 py-1">
                      <AdsterraBanner slotKey={`feed_${index}`} />
                    </div>
                  )}
                </div>
              )
            })
        }
      </div>
      <InfiniteScrollSentinel onIntersect={fetchNextPage} hasMore={!!hasNextPage} isLoading={isFetchingNextPage} />
    </div>
  )
}
