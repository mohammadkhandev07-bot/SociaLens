import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// This is what fixes the 404: manifest.json's "share_target" tells the OS
// that SociaLens can receive a share (so it shows up in the phone's share
// sheet next to WhatsApp, Gmail, etc.), and points it at POST /share -
// but until now nothing here actually handled that request. The browser
// navigates here directly as a real POST when someone picks SociaLens
// from another app's share sheet, so this has to be a Route Handler (a
// page component can't receive a POST) rather than a normal page.
export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    // Not signed in on this device yet - come back to this once logged in
    // isn't preserved (the shared file wouldn't survive the round trip
    // anyway), but at least this sends them somewhere real instead of a 404.
    return NextResponse.redirect(new URL('/login', origin))
  }

  let title = ''
  let text = ''
  let sharedUrl = ''
  let mediaUrl = ''
  let mediaType = ''

  try {
    const formData = await request.formData()
    title = formData.get('title')?.toString() || ''
    text = formData.get('text')?.toString() || ''
    sharedUrl = formData.get('url')?.toString() || ''
    const file = formData.get('media') as File | null

    if (file && file.size > 0) {
      const isVideo = file.type.startsWith('video')
      const ext = file.name?.split('.').pop() || (isVideo ? 'mp4' : 'jpg')
      const path = `${user.id}/${Date.now()}.${ext}`
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { error: uploadError } = await supabase.storage.from('shared-content').upload(path, bytes, {
        contentType: file.type || undefined,
        cacheControl: '3600',
      })
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from('shared-content').getPublicUrl(path)
        mediaUrl = urlData.publicUrl
        mediaType = isVideo ? 'video' : 'image'
      }
    }
  } catch (err) {
    console.error('share_target: could not read shared content', err)
  }

  const params = new URLSearchParams()
  if (title) params.set('title', title)
  if (text) params.set('text', text)
  if (sharedUrl) params.set('url', sharedUrl)
  if (mediaUrl) { params.set('mediaUrl', mediaUrl); params.set('mediaType', mediaType) }

  return NextResponse.redirect(new URL(`/share/handle?${params.toString()}`, origin))
}

// Someone navigating to /share directly (not via the share sheet) has
// nothing to hand off - send them to the app instead of a bare 404.
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/feed', request.nextUrl.origin))
}
