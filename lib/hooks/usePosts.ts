'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { PostWithProfile } from '@/lib/types/database.types'

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

export function useFeedPosts(userId?: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: ['feed-posts', userId],
    queryFn: async () => {
      if (!userId) return []

      const { data: following } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', userId)
        .eq('status', 'accepted')

      const followingIds = following?.map(f => f.following_id) ?? []
      followingIds.push(userId)

      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles(*)')
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error
      const ownPosts = await fetchPostsWithLikes(data as PostWithProfile[], userId)

      // Reposts by people you follow (and your own reposts) also show up
      // in the feed - the post itself still displays the ORIGINAL
      // author's name/avatar, only a small "X reposted" badge on top
      // Shows who reposted it. Sorted into the feed by when it was
      // Reposted, not when the original post was first made.
      const { data: reposts } = await supabase
        .from('reposts')
        .select('created_at, profiles!reposts_user_id_fkey(id,username,avatar_url,is_verified,verification_type), posts(*, profiles(*))')
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })
        .limit(50)

      const repostedPosts: PostWithProfile[] = (reposts || [])
        .filter((r: any) => r.posts)
        .map((r: any) => ({
          ...(r.posts as PostWithProfile),
          created_at: r.created_at, // sort position = when it was reposted
          reposted_by: [r.profiles],
        }))
      const repostedWithLikes = await fetchPostsWithLikes(repostedPosts, userId)

      const merged = [...ownPosts, ...repostedWithLikes]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

      // The feed should never sit empty just because you don't follow
      // anyone yet (or the people you follow haven't posted much) - once
      // it's running thin, top it up with public posts from everyone
      // else, the same way Instagram fills your feed with "Suggested"
      // content. Row Level Security still applies here, so private
      // accounts and restricted post_privacy settings stay hidden exactly
      // like they do everywhere else in the app.
      const MIN_FEED_SIZE = 5
      if (merged.length < MIN_FEED_SIZE) {
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
          return [...merged, ...tagged]
        }
      }

      return merged
    },
    enabled: !!userId,
    staleTime: 30000,
  })
}

export function useExplorePosts(userId?: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: ['explore-posts', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles(*)')
        .order('likes_count', { ascending: false })
        .limit(30)

      if (error) throw error
      if (!userId) return data as PostWithProfile[]
      return fetchPostsWithLikes(data as PostWithProfile[], userId)
    },
    staleTime: 30000,
  })
}

export function useReelsPosts(userId?: string) {
  const supabase = createClient()

  return useQuery({
    queryKey: ['reels-posts', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*, profiles(*)')
        .eq('media_type', 'video')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error
      let posts = data as PostWithProfile[]
      if (userId) posts = await fetchPostsWithLikes(posts, userId)
      if (!userId || posts.length === 0) return posts

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
      if (followingIds.length === 0) return posts

      const { data: reposts } = await supabase
        .from('reposts')
        .select('post_id, created_at, profiles!reposts_user_id_fkey(id,username,avatar_url,is_verified,verification_type)')
        .in('post_id', posts.map(p => p.id))
        .in('user_id', followingIds)
        .order('created_at', { ascending: false })

      if (!reposts || reposts.length === 0) return posts
      // Multiple people you follow can repost the same reel - collect ALL of
      // them per post (most recent first) instead of overwriting down to
      // just the last one, so the "X reposted" badge can show everyone.
      const repostMap = new Map<string, any[]>()
      for (const r of reposts as any[]) {
        const existing = repostMap.get(r.post_id) ?? []
        existing.push(r.profiles)
        repostMap.set(r.post_id, existing)
      }
      return posts.map(p => repostMap.has(p.id) ? { ...p, reposted_by: repostMap.get(p.id) } : p)
    },
    staleTime: 30000,
  })
}
