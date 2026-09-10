'use client'

import { useState } from 'react'
import { Share2, Copy, Check, Loader2 } from 'lucide-react'

interface ExternalShareBarProps {
  // Called only when the user actually taps the button - builds/returns the
  // public share link (and can do any side effect needed to create it,
  // like an Aperonix reply which has to be saved somewhere public first).
  getShareUrl: () => Promise<string> | string
  shareTitle: string
  shareText: string
}

// Sits at the top of a Share modal, above the in-app followers/following
// list. Tapping it hands off to the device's own native share sheet
// (navigator.share) - which lists every app on the phone capable of
// receiving a share (WhatsApp, Messages, Gmail, etc.), exactly like
// tapping "Share" on a photo from the phone's own gallery would. On a
// browser that doesn't support that (mainly older/desktop browsers), it
// falls back to just copying the link.
export function ExternalShareBar({ getShareUrl, shareTitle, shareText }: ExternalShareBarProps) {
  const [preparing, setPreparing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleShare = async () => {
    setError(null)
    setPreparing(true)
    try {
      const url = await getShareUrl()
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({ title: shareTitle, text: shareText, url })
        } catch {
          // User backed out of the native share sheet - not an error.
        }
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      }
    } catch {
      setError("Couldn't create a share link. Please try again.")
    } finally {
      setPreparing(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b space-y-2">
      <button
        onClick={handleShare}
        disabled={preparing}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-pink-500/40 hover:bg-pink-500/5 text-sm font-medium transition-colors disabled:opacity-60"
      >
        {preparing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : copied ? (
          <Check className="h-4 w-4 text-green-500" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        {preparing ? 'Preparing link...' : copied ? 'Link copied!' : 'Share outside SociaLens'}
      </button>
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}
      <p className="text-center text-[11px] text-muted-foreground leading-relaxed">
        Opens your phone's own share menu (WhatsApp, Messages & more). Anyone who opens the link can view it - no sign-in needed.
      </p>
    </div>
  )
}
