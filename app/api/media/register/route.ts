import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { objectPath?: unknown; sourceBytes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const objectPath = typeof body.objectPath === 'string' ? body.objectPath : ''
  const sourceBytes = Number(body.sourceBytes)
  const parts = objectPath.split('/')
  if (
    parts.length !== 2 ||
    parts[0] !== user.id ||
    !parts[1] ||
    parts[1] === '.' ||
    parts[1] === '..' ||
    !/\.(mp4|m4v|mov|webm)$/i.test(parts[1]) ||
    !Number.isSafeInteger(sourceBytes) ||
    sourceBytes <= 0
  ) {
    return NextResponse.json({ error: 'Invalid video object' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: files, error: storageError } = await admin.storage
    .from('posts')
    .list(user.id, { search: parts[1], limit: 100 })

  if (storageError) {
    console.error('Could not verify uploaded video object:', storageError.message)
    return NextResponse.json({ error: 'Could not verify uploaded video' }, { status: 503 })
  }

  if (!files?.some(file => file.name === parts[1])) {
    return NextResponse.json({ error: 'Uploaded video was not found' }, { status: 404 })
  }

  const { error: queueError } = await admin.from('video_processing_jobs').upsert(
    {
      owner_id: user.id,
      bucket: 'posts',
      original_path: objectPath,
      status: 'queued',
      source_bytes: sourceBytes,
    },
    { onConflict: 'bucket,original_path', ignoreDuplicates: true },
  )

  if (queueError) {
    console.error('Could not register uploaded video for processing:', queueError.message)
    return NextResponse.json({ error: 'Could not queue video processing' }, { status: 503 })
  }

  return NextResponse.json({ status: 'queued' }, { status: 202 })
}
