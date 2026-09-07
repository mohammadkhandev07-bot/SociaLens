'use client'

import { useRef, useState, useEffect } from 'react'
import Link from 'next/link'
import { Heart, MessageCircle, Volume2, VolumeX, Share2, X, Repeat2, MoreVertical, Flag } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ShareModal } from '@/components/shared/ShareModal'
import { PostCaption } from '@/components/shared/PostCaption'
import { SaveButton } from '@/components/shared/SaveButton'
import { RepostBadge } from '@/components/shared/RepostBadge'
import { VerifiedBadge } from '@/components/shared/VerifiedBadge'
import { CommentThread } from '@/components/shared/CommentThread'
import { ReportModal } from '@/components/shared/ReportModal'
import { PostWithProfile } from '@/lib/types/database.types'
import { formatCount, getAvatarUrl } from '@/lib/utils/helpers'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { useIsReposted, useToggleRepost } from '@/lib/hooks/useRepost'

interface ReelCardProps {
  post: PostWithProfile
  isActive: boolean
  isMuted: boolean
  onToggleMute: () => void
}

export function ReelCard({ post, isActive, isMuted, onToggleMute }: ReelCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const seekBarRef = useRef<HTMLDivElement>(null)
  const [liked, setLiked] = useState(post.is_liked ?? false)
  const [likesCount, setLikesCount] = useState(post.likes_count)
  const [paused, setPaused] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [showShare, setShowShare] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [progress, setProgress] = useState(0) // 0-100
  const [seeking, setSeeking] = useState(false)
  const hasCountedViewRef = useRef(false)
  const { user, profile } = useUser()
  const supabase = createClient()

  const { data: isReposted = false } = useIsReposted(post.id, user?.id)
  const toggleRepost = useToggleRepost()

  useEffect(() => {
    if (!videoRef.current) return
    if (isActive && !showComments && !showShare) {
      // Browsers can block autoplay-with-sound without a prior tap on the
      // Page - if that happens, fall back to starting muted rather than
      // The video just not playing at all, and let the mute button take
      // Over from there.
      videoRef.current.play().catch(() => {
        if (videoRef.current) {
          videoRef.current.muted = true
          videoRef.current.play().catch(() => {})
        }
      })
      setPaused(false)
      if (!hasCountedViewRef.current) {
        hasCountedViewRef.current = true
        supabase.rpc('increment_post_views', { post_id: post.id }).then(() => {})
      }
    } else {
      videoRef.current.pause()
      // Scrolling away and back should always restart from the beginning,
      // like every other short-video feed - not resume from wherever it
      // was left off.
      videoRef.current.currentTime = 0
      setProgress(0)
      hasCountedViewRef.current = false
    }
  }, [isActive, showComments, showShare, post.id])

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted
  }, [isMuted])

  useEffect(() => {
    if (!user) return
    if (post.is_liked !== undefined) { setLiked(post.is_liked); return }
    supabase.from('likes').select('id').eq('post_id', post.id).eq('user_id', user.id)
      .maybeSingle().then(({ data }) => setLiked(!!data))
  }, [post.id, user?.id])

  const handleTap = () => {
    if (!videoRef.current || showComments || showShare) return
    if (videoRef.current.paused) { videoRef.current.play(); setPaused(false) }
    else { videoRef.current.pause(); setPaused(true) }
  }

  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (!v || !v.duration || seeking) return
    setProgress((v.currentTime / v.duration) * 100)
  }

  const seekFromClientX = (clientX: number) => {
    const bar = seekBarRef.current
    const v = videoRef.current
    if (!bar || !v || !v.duration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    v.currentTime = ratio * v.duration
    setProgress(ratio * 100)
  }

  const handleSeekPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    setSeeking(true)
    seekFromClientX(e.clientX)
  }
  const handleSeekPointerMove = (e: React.PointerEvent) => {
    if (!seeking) return
    e.stopPropagation()
    seekFromClientX(e.clientX)
  }
  const handleSeekPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    setSeeking(false)
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
  }

  const handleRepost = () => {
    if (!user) return
    toggleRepost.mutate({ postId: post.id, userId: user.id, postOwnerId: post.user_id, repost: !isReposted })
  }

  const openComments = () => {
    setShowComments(true)
  }

  return (
    <div className="relative w-full h-full flex-shrink-0 bg-black snap-start snap-always overflow-hidden">
      {/* Video */}
      <video ref={videoRef} src={post.media_url ?? ''} loop playsInline muted={isMuted}
        onClick={handleTap}
        onTimeUpdate={handleTimeUpdate}
        className="absolute inset-0 w-full h-full object-cover" />

      {paused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/40 rounded-full p-5">
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          </div>
        </div>
      )}

      <div className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.2) 0%, transparent 25%, transparent 55%, rgba(0,0,0,0.7) 100%)' }} />

      {/* Seek bar - YouTube-style, drag anywhere along it to jump to that point */}
      <div
        ref={seekBarRef}
        onPointerDown={handleSeekPointerDown}
        onPointerMove={handleSeekPointerMove}
        onPointerUp={handleSeekPointerUp}
        onPointerLeave={handleSeekPointerUp}
        className="absolute bottom-0 left-0 right-0 z-20 h-4 flex items-center touch-none cursor-pointer group/seek"
      >
        <div className="relative w-full h-1 group-hover/seek:h-1.5 bg-white/25 transition-all">
          <div className="absolute inset-y-0 left-0 bg-pink-500" style={{ width: `${progress}%` }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full bg-pink-500 opacity-0 group-hover/seek:opacity-100 transition-opacity"
            style={{ left: `${progress}%` }}
          />
        </div>
      </div>

      {/* Mute - top-right, so it stays clear of the back button which
          now also lives in this reel's top-left corner. */}
      <button onClick={onToggleMute} className="absolute top-3 right-3 z-20">
        <div className="p-1.5 rounded-full bg-black/40 backdrop-blur-sm">
          {isMuted ? <VolumeX className="h-4 w-4 text-white" /> : <Volume2 className="h-4 w-4 text-white" />}
        </div>
      </button>

      {/* Right actions - compact so Like never gets pushed off-screen on
          short phone viewports. */}
      <div className="absolute right-2 bottom-24 flex flex-col items-center gap-3.5 z-10">
        {/* Like */}
        <button onClick={handleLike} className="flex flex-col items-center gap-0.5">
          <div className={`p-1.5 rounded-full backdrop-blur-sm ${liked ? 'bg-red-500/20' : 'bg-black/30'}`}>
            <Heart className={`h-5 w-5 ${liked ? 'fill-red-500 text-red-500' : 'text-white'}`} />
          </div>
          <span className="text-white text-[10px] font-semibold drop-shadow">{formatCount(likesCount)}</span>
        </button>

        {/* Comment */}
        <button onClick={openComments} className="flex flex-col items-center gap-0.5">
          <div className="p-1.5 rounded-full bg-black/30 backdrop-blur-sm">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <span className="text-white text-[10px] font-semibold drop-shadow">{formatCount(post.comments_count)}</span>
        </button>

        {/* Share */}
        <button onClick={() => setShowShare(true)} className="flex flex-col items-center gap-0.5">
          <div className="p-1.5 rounded-full bg-black/30 backdrop-blur-sm">
            <Share2 className="h-5 w-5 text-white" />
          </div>
          <span className="text-white text-[10px] font-semibold drop-shadow">{post.shares_count > 0 ? formatCount(post.shares_count) : 'Share'}</span>
        </button>

        {/* Repost - the arrows spin in place when you repost, on top of
            the icon turning green, instead of just a flat color change. */}
        <button onClick={handleRepost} disabled={toggleRepost.isPending} className="flex flex-col items-center gap-0.5">
          <div className={`p-1.5 rounded-full backdrop-blur-sm ${isReposted ? 'bg-green-500/20' : 'bg-black/30'}`}>
            <Repeat2 className={`h-5 w-5 ${isReposted ? 'text-green-500 animate-repost-spin' : 'text-white'}`} />
          </div>
          <span className="text-white text-[10px] font-semibold drop-shadow">Repost</span>
        </button>

        {/* Save */}
        <SaveButton
          postId={post.id}
          className="p-1.5 rounded-full bg-black/30 backdrop-blur-sm"
          iconClassName="h-5 w-5 text-white"
        />

        {/* More - Report, for anyone else's reel */}
        {user && user.id !== post.user_id && (
          <div className="relative">
            <button onClick={() => setShowMenu(v => !v)} className="flex flex-col items-center gap-0.5">
              <div className="p-1.5 rounded-full bg-black/30 backdrop-blur-sm">
                <MoreVertical className="h-5 w-5 text-white" />
              </div>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
                <div className="absolute right-full bottom-0 mr-2 z-40 bg-card border rounded-xl shadow-xl overflow-hidden w-40">
                  <button
                    onClick={() => { setShowMenu(false); setShowReport(true) }}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-red-500 hover:bg-red-500/10"
                  >
                    <Flag className="h-3.5 w-3.5" /> Report
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* "X reposted" badge - shows every follower who reposted this reel,
          stacked neatly instead of collapsing down to just one name. */}
      <RepostBadge reposters={post.reposted_by ?? []} variant="overlay" />

      {/* Bottom info */}
      <div className="absolute bottom-6 left-3 right-16 z-10">
        <Link href={`/profile/${post.profiles.username}`} className="flex items-center gap-2.5 mb-2">
          <Avatar className="h-9 w-9 border-2 border-white/80">
            <AvatarImage src={getAvatarUrl(post.profiles.avatar_url)} />
            <AvatarFallback className="text-sm font-bold bg-gradient-to-br from-pink-500 to-purple-500 text-white">
              {post.profiles.username?.[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="text-white font-semibold text-sm drop-shadow flex items-center gap-1">
            @{post.profiles.username}
            {post.profiles.is_verified && <VerifiedBadge type={post.profiles.verification_type} className="text-xs" />}
          </span>
        </Link>
        {post.content && (
          <PostCaption
            content={post.content}
            forceExpanded={!post.media_url}
            className="max-w-xs"
            titleClassName="text-white text-sm drop-shadow leading-relaxed"
            captionClassName="text-white/90 text-sm drop-shadow leading-relaxed"
            buttonClassName="text-white/70 text-xs hover:underline font-medium drop-shadow"
          />
        )}
        <div className="flex items-center gap-2 mt-2">
          <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
            <span className="text-[8px] text-white">♪</span>
          </div>
          <p className="text-white/70 text-xs">Original Audio</p>
        </div>
      </div>

      {/* Comments Panel */}
      {showComments && (
        <div className="absolute inset-x-0 bottom-0 z-20 bg-card/95 backdrop-blur-md rounded-t-2xl flex flex-col"
          style={{ maxHeight: '60%' }} onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
            <h3 className="font-bold text-sm">Comments ({formatCount(post.comments_count)})</h3>
            <button onClick={() => setShowComments(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="px-4 py-3 flex-1 overflow-hidden flex flex-col">
            <CommentThread
              target="post"
              targetId={post.id}
              currentUserId={user?.id}
              ownerId={post.user_id}
              commentRestrictedUntil={profile?.restrict_comment_until}
              variant="compact"
              className="flex-1 flex flex-col min-h-0"
              listClassName="flex-1"
            />
          </div>
        </div>
      )}

      {/* Share Modal */}
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
    </div>
  )
}
