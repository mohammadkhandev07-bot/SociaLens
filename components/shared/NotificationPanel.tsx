'use client'

import { useEffect, useState, useRef } from 'react'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/useUser'
import { formatTimeAgo, getAvatarUrl } from '@/lib/utils/helpers'
import { cn } from '@/lib/utils/helpers'
import { VerifiedBadge } from '@/components/shared/VerifiedBadge'

interface Notification {
  id: string
  type:
    | 'like' | 'comment' | 'follow' | 'unfollow' | 'message' | 'new_post'
    | 'blocked' | 'unblocked'
    | 'share_post' | 'photo' | 'video' | 'voice_message'
    | 'story_reply' | 'message_reply' | 'repost'
    | 'comment_like' | 'comment_react' | 'comment_reply'
    | 'story_like' | 'story_react' | 'story_comment'
    | 'story_comment_like' | 'story_comment_react' | 'story_comment_reply'
    | 'call' | 'verified'
  is_read: boolean
  created_at: string
  message: string | null
  context_text: string | null
  emoji: string | null
  post_id: string | null
  story_id: string | null
  comment_id: string | null
  actor: { id: string; username: string; avatar_url: string | null; is_verified?: boolean; verification_type?: 'blue' | 'yellow' | null }
}

function setBadge(count: number) {
  if ('setAppBadge' in navigator) {
    if (count > 0) (navigator as any).setAppBadge(count).catch(() => {})
    else (navigator as any).clearAppBadge().catch(() => {})
  }
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: count > 0 ? 'SET_BADGE' : 'CLEAR_BADGE', count
    })
  }
  document.title = count > 0 ? `(${count}) SociaLens` : 'SociaLens - Connect With The World'
}

async function showNativeNotification(title: string, body: string, url: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker.ready
    await reg.showNotification(title, {
      body, icon: '/icons/icon-192x192.png', badge: '/icons/icon-72x72.png',
      vibrate: [200, 100, 200], data: { url }, tag: 'socialens', renotify: true,
    } as any)
  } catch { new Notification(title, { body, icon: '/icons/icon-192x192.png' }) }
}

export function NotificationPanel() {
  const { user } = useUser()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(0)
  const supabase = createClient()

  const clip = (s: string | null, n = 40) => (s && s.length > n ? `${s.slice(0, n)}...` : s || '')

  const getNotifText = (n: Notification) => {
    switch (n.type) {
      case 'like': return 'liked your post'
      case 'comment': return `commented on your post: "${clip(n.message)}"`
      case 'follow': return 'started following you'
      case 'unfollow': return 'unfollowed you'
      case 'message': return 'sent you a message'
      case 'blocked': return 'blocked you'
      case 'unblocked': return 'unblocked you'
      case 'new_post': return 'shared a new post'
      case 'share_post': return 'shared a post with you'
      case 'photo': return 'sent a photo'
      case 'video': return 'sent a video'
      case 'voice_message': return 'sent a voice message'
      case 'story_reply': return `replied to your story: "${clip(n.message)}"`
      case 'message_reply': return `replied to your message: "${clip(n.message)}"`
      case 'repost': return 'reposted your post'
      case 'comment_like': return `liked your comment: "${clip(n.message)}"`
      case 'comment_react': return `reacted ${n.emoji ?? ''} to your comment: "${clip(n.message)}"`
      case 'comment_reply': return `replied to your comment "${clip(n.context_text, 25)}": "${clip(n.message)}"`
      case 'story_like': return 'liked your story'
      case 'story_react': return `reacted ${n.emoji ?? ''} to your story`
      case 'story_comment': return `commented on your story: "${clip(n.message)}"`
      case 'story_comment_like': return `liked your story comment: "${clip(n.message)}"`
      case 'story_comment_react': return `reacted ${n.emoji ?? ''} to your story comment: "${clip(n.message)}"`
      case 'story_comment_reply': return `replied to your story comment "${clip(n.context_text, 25)}": "${clip(n.message)}"`
      case 'call':
        return n.message === 'missed' ? 'missed call'
          : n.message === 'rejected' ? 'call declined'
          : n.message === 'cancelled' ? 'cancelled call'
          : 'called you'
      case 'verified': return "verified your account - congratulations! \ud83c\udf89 You now have the blue tick."
      default: return ''
    }
  }

  const getNotifLink = (n: Notification) => {
    switch (n.type) {
      // Feed/story links stay generic - there's no deep-link-to-a-specific-
      // Post or story route yet, so these just open the feed, same as before.
      case 'like': case 'comment': case 'new_post': case 'repost':
      case 'comment_like': case 'comment_react': case 'comment_reply':
      case 'story_like': case 'story_react': case 'story_comment':
      case 'story_comment_like': case 'story_comment_react': case 'story_comment_reply':
        return '/feed'
      case 'follow': case 'unfollow': return `/profile/${n.actor?.username}`
      case 'message': case 'message_reply': case 'story_reply': case 'share_post':
      case 'photo': case 'video': case 'voice_message': case 'call':
        return '/chat'
      case 'blocked': case 'unblocked': return '/'
      case 'verified': return '/feed'
      default: return '/feed'
    }

  }

  const fetchNotifications = async () => {
    if (!user) return

    const { data: myProfile } = await supabase
      .from('profiles')
      .select('notifications_muted')
      .eq('id', user.id)
      .single()

    if ((myProfile as any)?.notifications_muted) {
      setNotifications([])
      setUnreadCount(0)
      setBadge(0)
      prevCountRef.current = 0
      return
    }

    const { data: onlyFrom } = await supabase
      .from('privacy_selected_users')
      .select('selected_user_id')
      .eq('owner_id', user.id)
      .eq('category', 'notify')
    const allowedActorIds = (onlyFrom || []).map((r: any) => r.selected_user_id)

    let query = supabase
      .from('notifications')
      .select('*, actor:profiles!notifications_actor_id_fkey(id, username, avatar_url, is_verified, verification_type)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    // "Notify me about" list (Settings > Notifications) - when the user
    // has picked specific people, only their activity shows up here.
    // An empty list means no restriction (notified about everyone).
    if (allowedActorIds.length > 0) {
      query = query.in('actor_id', allowedActorIds)
    }

    const { data } = await query

    if (data) {
      setNotifications(data as Notification[])
      const unread = data.filter(n => !n.is_read).length
      setUnreadCount(unread)
      setBadge(unread)

      // Show a native OS notification when something new arrives while
      // the tab is backgrounded - except for anything chat/call related,
      // which already gets its own dedicated push notification sent
      // straight from the server the instant it's sent or started (see
      // sendMessage in useRealtimeMessages.ts and startCall in
      // useCall.ts). Doing it here too was firing a second, duplicate
      // notification for the same message/photo/video/voice
      // note/shared post/reply/call every time - this covers every type
      // that route already handles, not just plain text messages.
      const CHAT_AND_CALL_TYPES = new Set([
        'message', 'photo', 'video', 'voice_message', 'share_post',
        'story_reply', 'message_reply', 'call',
      ])
      if (unread > prevCountRef.current && document.hidden) {
        const newest = data.find(n => !n.is_read)
        if (newest && !CHAT_AND_CALL_TYPES.has(newest.type)) {
          await showNativeNotification('SociaLens', `${newest.actor?.username} ${getNotifText(newest)}`, getNotifLink(newest))
        }
      }
      prevCountRef.current = unread
    }
  }

  const markAllRead = async () => {
    if (!user) return
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    setUnreadCount(0)
    setBadge(0)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  useEffect(() => {
    if (!user) return
    fetchNotifications()

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }

    // Clear badge when app becomes visible
    const handleVisibility = () => { if (!document.hidden) { setBadge(0) } }
    document.addEventListener('visibilitychange', handleVisibility)

    // Realtime
    const channel = supabase.channel(`notifs:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => fetchNotifications())
      .subscribe()

    const interval = setInterval(fetchNotifications, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [user])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleOpen = () => {
    const newOpen = !open
    setOpen(newOpen)
    if (newOpen) { markAllRead(); setBadge(0) }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button onClick={handleOpen}
        className="relative p-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-80 bg-card border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <h3 className="font-bold text-base">Notifications</h3>
            {notifications.length > 0 && (
              <button onClick={async () => {
                if (!user) return
                await supabase.from('notifications').delete().eq('user_id', user.id)
                setNotifications([]); setUnreadCount(0); setBadge(0)
              }} className="text-xs text-muted-foreground hover:text-destructive">Clear all</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                <Bell className="h-8 w-8 opacity-30" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : notifications.map(n => (
              <Link key={n.id} href={getNotifLink(n)} onClick={() => setOpen(false)}
                className={cn('flex items-start gap-3 px-4 py-3 hover:bg-accent transition-colors', !n.is_read && 'bg-primary/5')}>
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarImage src={getAvatarUrl(n.actor?.avatar_url)} />
                  <AvatarFallback>{n.actor?.username?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">{n.actor?.username}</span>
                    {n.actor?.is_verified && <VerifiedBadge type={n.actor.verification_type} className="text-xs mx-1" />}
                    {' '}<span className="text-muted-foreground">{getNotifText(n)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatTimeAgo(n.created_at)}</p>
                </div>
                {!n.is_read && <div className="h-2 w-2 rounded-full bg-pink-500 shrink-0 mt-1.5" />}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
