'use client'

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PostWithProfile } from '@/lib/types/database.types'

const FEED_PAGE_SIZE = 10
const EXPLORE_PAGE_SIZE = 15
const REELS_PAGE_SIZE = 8

async function fetchPostsWithLikes(posts: PostWithProfile[], userId: string) {
  const supabase = createClient()
  if (!posts.length || !userId) return posts

  const postIds = posts.map(p => p.id)
  const { data: likes } = await supabase
    .from('likes')
    .select('post_id')
    .eq('user_id', userId)
    .in('post_id', postIds)

  const likedSet = new Set(likes?.map(l => l.post_id) ?? [])
  return posts.map(p => ({ ...p, is_liked: likedSet.has(p.id) }))
}

// Loads the feed page by page (10 posts at a time, newest first) instead
// Of pulling everything a person follows into memory on every visit -
// the same "load more as you scroll" behavior Instagram/Facebook use.
// Own posts and reposts are two separate tables, so each page pulls a
// batch from both (bounded by the same cursor), merges them by date, and
// only keeps the top page-size worth - the cursor for the next page is
// simply the oldest item actually shown, so nothing gets skipped or
// repeated at the boundary between pages.
export function useFeedPosts(userId?: string) {
  const supabase = createClient()

  return useInfiniteQuery({
    queryKey: ['feed-posts', userId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!userId) return { posts: [] as PostWithProfile[], nextCursor: null as string | null }

      const { data: following } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId)
        .eq('status', 'accepted')

      const followingIds = following?.map(f => f.following_id) ?? []
      followingIds.push(userId)

      let ownQuery = supabase
        .from('posts')
        .select('*, profiles(*)')
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })
        .limit(FEED_PAGE_SIZE)
      if (pageParam) ownQuery = ownQuery.lt('created_at', pageParam)
      const { data, error } = await ownQuery
      if (error) throw error
      const ownPosts = await fetchPostsWithLikes(data as PostWithProfile[], userId)

      // Reposts by people you follow (and your own reposts) also show up
      // in the feed - the post itself still displays the ORIGINAL
      // author's name/avatar, only a small "X reposted" badge on top
      // Shows who reposted it. Sorted into the feed by when it was
      // reposted, not when the original post was first made.
      let repostQuery = supabase
        .from('reposts')
        .select('created_at, profiles!reposts_user_id_fkey(id,username,avatar_url,is_verified,verification_type), posts(*, profiles(*))')
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })
        .limit(FEED_PAGE_SIZE)
      if (pageParam) repostQuery = repostQuery.lt('created_at', pageParam)
      const { data: reposts } = await repostQuery

      const repostedPosts: PostWithProfile[] = (reposts || [])
        .filter((r: any) => r.posts)
        .map((r: any) => ({
          ...(r.posts as PostWithProfile),
          created_at: r.created_at, // sort position = when it was reposted
          reposted_by: [r.profiles],
        }))
      const repostedWithLikes = await fetchPostsWithLikes(repostedPosts, userId)

      let merged = [...ownPosts, ...repostedWithLikes]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, FEED_PAGE_SIZE)

      // The feed should never sit empty just because you don't follow
      // anyone yet (or the people you follow haven't posted much) - once
      // it's running thin on the very first page, top it up with public
      // posts from everyone else, the same way Instagram fills your feed
      // with "Suggested" content. Row Level Security still applies here,
      // so private accounts and restricted post_privacy settings stay
      // hidden exactly like they do everywhere else in the app. Only
      // done on the first page - later pages just end once real
      // followed/reposted content runs out.
      const MIN_FEED_SIZE = 5
      if (!pageParam && merged.length < MIN_FEED_SIZE) {
        const excludeIds = merged.map((p) => p.id)
        let suggestedQuery = supabase
          .from('posts')
          .select('*, profiles(*)')
          .order('created_at', { ascending: false })
          .limit(20)
        if (excludeIds.length > 0) {
          suggestedQuery = suggestedQuery.not('id', 'in', `(${excludeIds.join(',')})`)
        }
        const { data: suggested } = await suggestedQuery
        if (suggested && suggested.length > 0) {
          const suggestedWithLikes = await fetchPostsWithLikes(suggested as PostWithProfile[], userId)
          const tagged = suggestedWithLikes.map((p) => ({ ...p, is_suggested: true }))
          merged = [...merged, ...tagged]
        }
      }

      // Next page starts just before the oldest post shown here. Fewer
      // than a full page from BOTH sources means there's nothing older
      // left to fetch.
      const gotFullPage = ownPosts.length === FEED_PAGE_SIZE || repostedWithLikes.length === FEED_PAGE_SIZE
      const oldest = merged.length > 0 ? merged[merged.length - 1].created_at : null
      return { posts: merged, nextCursor: gotFullPage ? oldest : null }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!userId,
    staleTime: 30000,
  })
}

// Explore's "most liked" grid, paged in the same spirit - fetches by
// engagement rank rather than time, so the cursor here is a row offset
// instead of a timestamp.
export function useExplorePosts(userId?: string) {
  const supabase = createClient()

  return useInfiniteQuery({
    queryKey: ['explore-posts', userId],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles(*)')
        .order('likes_count', { ascending: false })
        .range(pageParam, pageParam + EXPLORE_PAGE_SIZE - 1)

      if (error) throw error
      const posts = userId ? await fetchPostsWithLikes(data as PostWithProfile[], userId) : (data as PostWithProfile[])
      return {
        posts,
        nextCursor: data.length === EXPLORE_PAGE_SIZE ? pageParam + EXPLORE_PAGE_SIZE : null,
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30000,
  })
}

export function useReelsPosts(userId?: string) {
  const supabase = createClient()

  return useInfiniteQuery({
    queryKey: ['reels-posts', userId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('posts')
        .select('*, profiles(*)')
        .eq('media_type', 'video')
        .order('created_at', { ascending: false })
        .limit(REELS_PAGE_SIZE)
      if (pageParam) query = query.lt('created_at', pageParam)
      const { data, error } = await query

      if (error) throw error
      let posts = data as PostWithProfile[]
      if (userId) posts = await fetchPostsWithLikes(posts, userId)
      const nextCursor = data.length === REELS_PAGE_SIZE ? (posts[posts.length - 1]?.created_at ?? null) : null

      if (!userId || posts.length === 0) return { posts, nextCursor }

      // Reels already show everyone's videos (not just people you follow),
      // so reposts don't need a separate duplicate entry here like the
      // home feed does - this just checks whether someone you follow
      // reposted one of these same videos, so the "X reposted" badge can
      // still show on it.
      const { data: following } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId)
        .eq('status', 'accepted')
      const followingIds = (following || []).map(f => f.following_id)
      if (followingIds.length === 0) return { posts, nextCursor }

      const { data: reposts } = await supabase
        .from('reposts')
        .select('post_id, created_at, profiles!reposts_user_id_fkey(id,username,avatar_url,is_verified,verification_type)')
        .in('post_id', posts.map(p => p.id))
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })

      if (!reposts || reposts.length === 0) return { posts, nextCursor }
      // Multiple people you follow can repost the same reel - collect ALL of
      // them per post (most recent first) instead of overwriting down to
      // just the last one, so the "X reposted" badge can show everyone.
      const repostMap = new Map<string, any[]>()
      for (const r of reposts as any[]) {
        const existing = repostMap.get(r.post_id) ?? []
        existing.push(r.profiles)
        repostMap.set(r.post_id, existing)
      }
      const withReposts = posts.map(p => repostMap.has(p.id) ? { ...p, reposted_by: repostMap.get(p.id) } : p)
      return { posts: withReposts, nextCursor }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30000,
  })
}
