'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, PlusCircle, X, ExternalLink } from 'lucide-react'
import { useUser } from '@/lib/hooks/useUser'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { useCreateStory } from '@/lib/hooks/useStories'
import { getPlatformNameFromUrl } from '@/lib/utils/platformName'
import { SharedContentStoryModal } from '@/components/stories/SharedContentStoryModal'

// Lands here right after someone picks SociaLens from another app's share
// sheet (see app/share/route.ts, which does the actual upload and hands
// off to this page via redirect). This is the "what do you want to do
// with this?" step - WhatsApp's equivalent is the "Add to Your Status"
// option that shows up the same way.
function ShareHandleContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { user, loading } = useUser()
  const { createTextStory } = useCreateStory()

  const title = params.get('title') || ''
  const text = params.get('text') || ''
  const sharedUrl = params.get('url') || ''
  const mediaUrl = params.get('mediaUrl') || ''
  const mediaType = (params.get('mediaType') || '') as 'image' | 'video' | ''
  const platformName = getPlatformNameFromUrl(sharedUrl || text)
  const captionText = title || text || sharedUrl

  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [storyFile, setStoryFile] = useState<File | null>(null)
  const [postingTextStory, setPostingTextStory] = useState(false)

  const hasContent = !!(mediaUrl || sharedUrl || text || title)

  const handleAddToStory = async () => {
    setError(null)
    if (mediaUrl && mediaType) {
      // The photo/video was already uploaded by the /share route - pull it
      // back down into a real File so it can go through the normal story
      // editor (position the caption, add music, etc.) before posting.
      setPreparing(true)
      try {
        const res = await fetch(mediaUrl)
        const blob = await res.blob()
        const ext = mediaType === 'video' ? 'mp4' : 'jpg'
        const file = new File([blob], `shared.${ext}`, { type: blob.type || (mediaType === 'video' ? 'video/mp4' : 'image/jpeg') })
        setStoryFile(file)
      } catch {
        setError("Couldn't load the shared content. Please try sharing again.")
      } finally {
        setPreparing(false)
      }
      return
    }

    // Text/link-only share (no photo or video) - post a simple text story
    // straight away with the link attached, no separate editor needed.
    if (!user) return
    setPostingTextStory(true)
    setError(null)
    try {
      await createTextStory.mutateAsync({
        userId: user.id,
        scenes: [{
          id: 'shared',
          text: captionText.slice(0, 200) || (platformName ? `Shared from ${platformName}` : 'Shared link'),
          duration: 6,
          backgroundColor: 'gradient:#ec4899:#8b5cf6',
          textColor: '#ffffff',
          textX: 50,
          textY: 50,
          textSize: 28,
        }],
        linkUrl: sharedUrl || null,
        linkLabel: platformName,
      })
      router.replace('/feed')
    } catch {
      setError("Couldn't post your story. Please try again.")
    } finally {
      setPostingTextStory(false)
    }
  }

  if (loading) return <PageLoader />

  if (storyFile && user) {
    return (
      <SharedContentStoryModal
        userId={user.id}
        file={storyFile}
        mediaType={mediaType === 'video' ? 'video' : 'photo'}
        linkUrl={sharedUrl || null}
        linkLabel={platformName}
        onClose={() => router.replace('/feed')}
        onBack={() => setStoryFile(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex items-center justify-between px-4 h-14 border-b">
        <span className="font-bold bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">SociaLens</span>
        <button onClick={() => router.replace('/feed')} className="text-muted-foreground hover:text-foreground">
          <X className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 max-w-lg w-full mx-auto p-4 flex flex-col">
        <p className="text-sm text-muted-foreground mb-3">
          {platformName ? `Shared from ${platformName}` : 'Shared with SociaLens'}
        </p>

        {!hasContent ? (
          <p className="text-sm text-muted-foreground text-center py-16">Nothing came through with this share. You can close this and try again.</p>
        ) : (
          <div className="rounded-2xl border overflow-hidden bg-muted/30 mb-6">
            {mediaUrl && mediaType === 'video' && (
              <video src={mediaUrl} controls className="w-full max-h-80 bg-black" />
            )}
            {mediaUrl && mediaType === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl} alt="Shared content" className="w-full max-h-80 object-contain bg-black" />
            )}
            {(title || text || sharedUrl) && (
              <div className="p-4 space-y-1">
                {title && <p className="font-semibold text-sm">{title}</p>}
                {text && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{text}</p>}
                {sharedUrl && (
                  <p className="text-sm text-blue-500 flex items-center gap-1.5 break-all">
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" /> {sharedUrl}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        {hasContent && (
          <button
            onClick={handleAddToStory}
            disabled={preparing || postingTextStory}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-pink-500/40 hover:bg-pink-500/5 font-medium transition-colors disabled:opacity-60"
          >
            {preparing || postingTextStory ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlusCircle className="h-5 w-5 text-pink-500" />}
            Add to Story
          </button>
        )}

        <button onClick={() => router.replace('/feed')} className="mt-4 text-sm text-muted-foreground text-center">
          Not now
        </button>
      </main>
    </div>
  )
}

export default function ShareHandlePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ShareHandleContent />
    </Suspense>
  )
}
