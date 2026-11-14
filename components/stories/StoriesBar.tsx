'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Plus } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getAvatarUrl } from '@/lib/utils/helpers'
import { useActiveStories } from '@/lib/hooks/useStories'
import { useUser } from '@/lib/hooks/useUser'
import { AdStorySlot } from '@/components/ads/AdStorySlot'
import { AdStoryViewer } from '@/components/ads/AdStoryViewer'
import { interleaveAds } from '@/lib/utils/adInsertion'

const CreateStoryModal = dynamic(() => import('./CreateStoryModal').then(m => m.CreateStoryModal), { ssr: false })
const StoryViewer = dynamic(() => import('./StoryViewer').then(m => m.StoryViewer), { ssr: false })

export function StoriesBar() {
  const { user, profile } = useUser()
  const { data: groups = [] } = useActiveStories(user?.id)
  const [showCreate, setShowCreate] = useState(false)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [viewerStoryIndex, setViewerStoryIndex] = useState(0)
  const [showAdStory, setShowAdStory] = useState(false)
  const [adFromChain, setAdFromChain] = useState(false)

  const myGroup = groups.find((g) => g.userId === user?.id)
  const otherGroups = useMemo(() => groups.filter((g) => g.userId !== user?.id), [groups, user?.id])
  const otherItems = useMemo(() => {
    const withAds = interleaveAds(otherGroups, 3, 5)
    if (withAds.length === 0 || withAds[withAds.length - 1] !== 'ad') withAds.push('ad')
    return withAds
  }, [otherGroups])

  const handleReachEndOfStories = () => {
    setViewerIndex(null)
    setAdFromChain(true)
    setShowAdStory(true)
  }

  const handleAdGoBack = () => {
    setShowAdStory(false)
    setAdFromChain(false)
    const lastGroup = groups[groups.length - 1]
    setViewerIndex(groups.length - 1)
    setViewerStoryIndex(lastGroup ? lastGroup.stories.length - 1 : 0)
  }

  if (!profile) return null

  return (
    <div className="mx-4 mt-4 mb-2">
      <div className="flex gap-4 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => {
            if (myGroup) {
              setViewerStoryIndex(0)
              setViewerIndex(groups.indexOf(myGroup))
            } else {
              setShowCreate(true)
            }
          }}
          className="flex flex-col items-center gap-1 shrink-0 w-16"
        >
          <div className={`relative h-16 w-16 rounded-full flex items-center justify-center ${myGroup ? 'bg-gradient-to-br from-pink-500 via-purple-500 to-cyan-500 p-[2px]' : ''}`}>
            <Avatar className="h-full w-full border-2 border-background">
              <AvatarImage src={getAvatarUrl(profile.avatar_url)} />
              <AvatarFallback>{profile.username?.[0]?.toUpperCase()}</AvatarFallback>
            </Avatar>
            <button
              onClick={(e) => { e.stopPropagation(); setShowCreate(true) }}
              className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-pink-500 border-2 border-background flex items-center justify-center"
            >
              <Plus className="h-3 w-3 text-white" />
            </button>
          </div>
          <span className="text-[11px] text-muted-foreground truncate w-full text-center">Your Story</span>
        </button>

        {otherItems.map((item, index) => {
          if (item === 'ad') {
            return <AdStorySlot key={`ad-story-${index}`} onClick={() => { setAdFromChain(false); setShowAdStory(true) }} />
          }
          return (
            <button
              key={item.userId}
              onClick={() => {
                setViewerStoryIndex(0)
                setViewerIndex(groups.indexOf(item))
              }}
              className="flex flex-col items-center gap-1 shrink-0 w-16"
            >
              <div className="h-16 w-16 rounded-full bg-gradient-to-br from-pink-500 via-purple-500 to-cyan-500 p-[2px]">
                <Avatar className="h-full w-full border-2 border-background">
                  <AvatarImage src={getAvatarUrl(item.profile?.avatar_url)} />
                  <AvatarFallback>{item.profile?.username?.[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
              </div>
              <span className="text-[11px] text-muted-foreground truncate w-full text-center">{item.profile?.username}</span>
            </button>
          )
        })}
      </div>

      {showCreate && user && <CreateStoryModal userId={user.id} onClose={() => setShowCreate(false)} />}

      {viewerIndex !== null && (
        <StoryViewer
          groups={groups}
          startGroupIndex={viewerIndex}
          startStoryIndex={viewerStoryIndex}
          currentUserId={user?.id}
          onClose={() => setViewerIndex(null)}
          onReachEnd={handleReachEndOfStories}
        />
      )}

      {showAdStory && (
        <AdStoryViewer
          onClose={() => { setShowAdStory(false); setAdFromChain(false) }}
          onGoBack={adFromChain ? handleAdGoBack : undefined}
        />
      )}
    </div>
  )
}
