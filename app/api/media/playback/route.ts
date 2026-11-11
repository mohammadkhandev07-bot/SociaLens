import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rawUrl = request.nextUrl.searchParams.get('url')
  if (!rawUrl || !SUPABASE_URL) {
    return NextResponse.json({ error: 'Missing or invalid media URL' }, { status: 400 })
  }

  try {
    const input = new URL(rawUrl)
    const project = new URL(SUPABASE_URL)
    const prefix = '/storage/v1/object/public/'
    if (input.protocol !== 'https:' || input.host !== project.host || !input.pathname.startsWith(prefix)) {
      return NextResponse.json({ error: 'Unsupported media URL' }, { status: 400 })
    }

    const objectParts = input.pathname.slice(prefix.length).split('/')
    const bucket = decodeURIComponent(objectParts.shift() || '')
    const originalPath = objectParts.map(part => decodeURIComponent(part)).join('/')
    if (bucket !== 'posts' || !originalPath || originalPath.includes('..')) {
      return NextResponse.json({ error: 'Unsupported media object' }, { status: 400 })
    }

    const { data: job, error } = await supabase
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
    if (!job) return NextResponse.json({ status: 'untracked', playbackUrl: rawUrl })

    if (job.status === 'ready' && job.playback_path) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(job.playback_path)
      return NextResponse.json({ status: 'ready', playbackUrl: data.publicUrl })
    }

    return NextResponse.json({ status: job.status, playbackUrl: null }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Invalid media URL' }, { status: 400 })
  }
}
