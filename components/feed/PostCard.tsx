'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Heart, MessageCircle, Share2, MoreHorizontal, Trash2, Repeat2, Flag } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ShareModal } from '@/components/shared/ShareModal'
import { PostCaption } from '@/components/shared/PostCaption'
import { SaveButton } from '@/components/shared/SaveButton'
import { RepostBadge } from '@/components/shared/RepostBadge'
import { VerifiedBadge } from '@/components/shared/VerifiedBadge'
import { CommentThread } from '@/components/shared/CommentThread'
import { ReportModal } from '@/components/shared/ReportModal'
import { PostWithProfile } from '@/lib/types/database.types'
import { formatTimeAgo, formatCount, getAvatarUrl } from '@/lib/utils/helpers'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useQueryClient } from '@tanstack/react-query'
import { useIsReposted, useToggleRepost } from '@/lib/hooks/useRepost'

interface PostCardProps {
  post: PostWithProfile
  onDelete?: (postId: string) => void
}

export function PostCard({ post, onDelete }: PostCardProps) {
  const { user, profile } = useUser()
  const [liked, setLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(post.likes_count)
  const [showComments, setShowComments] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const supabase = createClient()
  const queryClient = useQueryClient()
  const articleRef = useRef<HTMLElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const hasCountedViewRef = useRef(false)

  const { data: isReposted = false } = useIsReposted(post.id, user?.id)
  const toggleRepost = useToggleRepost()

  useEffect(() => {
    if (!user) return
    if (post.is_liked !== undefined) { setLiked(post.is_liked); return }
    supabase.from('likes').select('id').eq('post_id', post.id).eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setLiked(!!data))
  }, [post.id, user?.id])

  // Counts a view the first time this post actually scrolls into view -
  // Not just when the component mounts (it might be far down an
  // unopened feed) and never more than once per mount, so scrolling past
  // It back and forth doesn't inflate the count.
  useEffect(() => {
    const el = articleRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasCountedViewRef.current) {
          hasCountedViewRef.current = true
          supabase.rpc('increment_post_views', { post_id: post.id }).then(() => {})
          observer.disconnect()
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [post.id])

  // Pauses this post's video the moment it scrolls mostly out of view -
  // otherwise a video someone started playing keeps running (and making
  // sound) even after they've scrolled well past it in the feed.
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) {
          videoEl.pause()
        }
      },
      { threshold: 0.25 }
    )
    observer.observe(videoEl)
    return () => observer.disconnect()
  }, [post.media_url])

  const toggleComments = () => {
    setShowComments((v) => !v)
  }

  const handleLike = async () => {
    if (!user) return
    const newLiked = !liked
    setLiked(newLiked)
    setLikesCount(prev => newLiked ? prev + 1 : prev - 1)
    if (newLiked) {
      await supabase.from('likes').insert({ post_id: post.id, user_id: user.id })
      await supabase.rpc('increment_likes', { post_id: post.id })
      if (user.id !== post.user_id) {
        await supabase.from('notifications').insert({
          user_id: post.user_id, actor_id: user.id, type: 'like', post_id: post.id,
        })
      }
    } else {
      await supabase.from('likes').delete().eq('post_id', post.id).eq('user_id', user.id)
      await supabase.rpc('decrement_likes', { post_id: post.id })
    }
    queryClient.invalidateQueries({ queryKey: ['feed-posts'] })
    queryClient.invalidateQueries({ queryKey: ['explore-posts'] })
  }

  const handleRepost = () => {
    if (!user) return
    toggleRepost.mutate({ postId: post.id, userId: user.id, postOwnerId: post.user_id, repost: !isReposted })
  }

  const isOwner = user?.id === post.user_id

  return (
    <article ref={articleRef} className="border-b bg-card">
      <RepostBadge reposters={post.reposted_by ?? []} variant="inline" />

      <div className="flex items-center justify-between px-4 py-3">
        <Link href={`/profile/${post.profiles.username}`} className="flex items-center gap-2.5">
          <Avatar className="h-9 w-9">
            <AvatarImage src={getAvatarUrl(post.profiles.avatar_url)} />
            <AvatarFallback>{post.profiles.username?.[0]?.toUpperCase()}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold text-sm leading-none flex items-center gap-1">
              {post.profiles.username}
              {post.profiles.is_verified && <VerifiedBadge type={post.profiles.verification_type} className="text-xs" />}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatTimeAgo(post.created_at)}</p>
          </div>
        </Link>
        {(isOwner || user) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOwner ? (
                <DropdownMenuItem className="text-destructive" onClick={() => onDelete?.(post.id)}>
                  <Trash2 className="h-4 w-4 mr-2" /> Delete Post
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => setShowReport(true)}>
                  <Flag className="h-4 w-4 mr-2" /> Report
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {post.media_url && post.media_type === 'image' && (
        <div className="relative w-full bg-muted" style={{ maxHeight: '480px', aspectRatio: '4/3' }}>
          <Image src={post.media_url} alt="Post" fill className="object-contain" sizes="(max-width: 640px) 100vw, 600px" />
        </div>
      )}
      {post.media_url && post.media_type === 'video' && (
        <div className="w-full bg-black" style={{ maxHeight: '480px' }}>
          <video ref={videoRef} src={post.media_url} controls className="w-full" style={{ maxHeight: '480px', objectFit: 'contain' }} preload="metadata" />
        </div>
      )}

      {post.content && (
        <div className="px-4 pt-2 pb-1">
          <PostCaption
            content={post.content}
            forceExpanded={!post.media_url}
            prefix={<span className="font-semibold mr-1">{post.profiles.username} </span>}
          />
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleLike}>
            <Heart className={`h-5 w-5 transition-all ${liked ? 'fill-red-500 text-red-500 scale-110' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleComments}>
            <MessageCircle className={`h-5 w-5 ${showComments ? 'fill-foreground' : ''}`} />
          </Button>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setShowShare(true)}>
              <Share2 className="h-5 w-5" />
            </Button>
            {post.shares_count > 0 && <span className="text-xs text-muted-foreground -ml-1 mr-1">{formatCount(post.shares_count)}</span>}
          </div>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleRepost} disabled={toggleRepost.isPending}>
              <Repeat2 className={`h-5 w-5 ${isReposted ? 'text-green-500 animate-repost-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <SaveButton postId={post.id} className="h-9 w-9 flex items-center justify-center rounded-md hover:bg-accent transition-colors" />
        </div>
      </div>

      {likesCount > 0 && <p className="px-4 text-sm font-semibold pb-1">{formatCount(likesCount)} likes</p>}

      {showComments && (
        <div className="border-t px-4 pt-3 pb-3">
          <CommentThread
            target="post"
            targetId={post.id}
            currentUserId={user?.id}
            ownerId={post.user_id}
            commentRestrictedUntil={profile?.restrict_comment_until}
            listClassName="max-h-48 mb-3"
          />
        </div>
      )}

      {showShare && <ShareModal post={post} onClose={() => setShowShare(false)} />}
      {showReport && user && (
        <ReportModal
          reporterId={user.id}
          reportedUserId={post.user_id}
          targetType="post"
          targetId={post.id}
          onClose={() => setShowReport(false)}
        />
      )}
    </article>
  )
}
