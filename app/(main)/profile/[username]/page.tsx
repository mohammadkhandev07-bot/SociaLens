import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ProfileHeader } from '@/components/profile/ProfileHeader'
import { ProfileTabs } from '@/components/profile/ProfileTabs'
import { LockedProfileView } from '@/components/profile/LockedProfileView'
import { FollowRequestsDialog } from '@/components/profile/FollowRequestsDialog'

interface ProfilePageProps {
  params: Promise<{ username: string }>
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params
  const supabase = await createClient()

  // Middleware already verified this request is authenticated (a network
  // round-trip to Supabase's auth server) before this page even started
  // rendering - getSession() here just reads that already-validated
  // Session back out of the cookie locally, instead of paying for a
  // second full auth-server round-trip for the exact same check.
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user ?? null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single()

  if (!profile) notFound()

  const isOwn = user?.id === profile.id

  let isFollowing = false
  // Whether the PROFILE OWNER follows this viewer back - a fully locked
  // Private account only opens up to people the owner themselves follows.
  let ownerFollowsViewer = false
  if (user && !isOwn) {
    const [{ data: follow }, { data: ownerFollowsMe }] = await Promise.all([
      supabase.from('follows').select('status').eq('follower_id', user.id).eq('following_id', profile.id).single(),
      supabase.from('follows').select('id').eq('follower_id', profile.id).eq('following_id', user.id).eq('status', 'accepted').maybeSingle(),
    ])
    isFollowing = follow?.status === 'accepted'
    ownerFollowsViewer = !!ownerFollowsMe
  }

  const isLocked = profile.is_private && !isOwn && !ownerFollowsViewer

  if (isLocked) {
    return <LockedProfileView profile={profile} currentUserId={user?.id} />
  }

  return (
    <div className="max-w-xl mx-auto">
      <ProfileHeader profile={profile} currentUserId={user?.id} />
      {isOwn && profile.is_private && (
        <div className="px-4 pb-2">
          <FollowRequestsDialog userId={profile.id} />
        </div>
      )}
      <ProfileTabs
        profileId={profile.id}
        isPrivate={profile.is_private}
        isFollowing={isFollowing}
        isOwn={isOwn}
      />
    </div>
  )
}
