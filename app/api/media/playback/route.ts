import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rawUrl = request.nextUrl.searchParams.get('url')
  if (!rawUrl || !SUPABASE_URL) {
    return NextResponse.json({ error: 'Missing or invalid media URL' }, { status: 400 })
  }

  let input: URL
  let project: URL
  try {
    input = new URL(rawUrl)
    project = new URL(SUPABASE_URL)
  } catch {
    return NextResponse.json({ error: 'Invalid media URL' }, { status: 400 })
  }

  const prefix = '/storage/v1/object/public/'
  if (input.protocol !== 'https:' || input.host !== project.host || !input.pathname.startsWith(prefix)) {
    return NextResponse.json({ error: 'Unsupported media URL' }, { status: 400 })
  }

  let bucket = ''
  let originalPath = ''
  try {
    const objectParts = input.pathname.slice(prefix.length).split('/')
    bucket = decodeURIComponent(objectParts.shift() || '')
    originalPath = objectParts.map(part => decodeURIComponent(part)).join('/')
  } catch {
    return NextResponse.json({ error: 'Invalid media object path' }, { status: 400 })
  }

  if (bucket !== 'posts' || !originalPath || originalPath.includes('..')) {
    return NextResponse.json({ error: 'Unsupported media object' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    const { data: job, error } = await admin
      .from('video_processing_jobs')
      .select('status, playback_path')
      .eq('bucket', bucket)
      .eq('original_path', originalPath)
      .maybeSingle()

    if (error) {
      console.error('Video rendition lookup failed:', error.message)
      return NextResponse.json({ error: 'Could not check video processing status' }, { status: 503 })
    }

    // Legacy uploads predate this pipeline; preserve their existing playback URL.
    if (!job) return NextResponse.json({ status: 'untracked', playbackUrl: rawUrl }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })

    if (job.status === 'ready' && job.playback_path) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(job.playback_path)
      return NextResponse.json({ status: 'ready', playbackUrl: data.publicUrl }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
    }

    return NextResponse.json({ status: job.status, playbackUrl: null }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error) {
    console.error('Video playback status endpoint failed:', error)
    return NextResponse.json({ error: 'Could not check video processing status' }, { status: 503 })
  }
}
