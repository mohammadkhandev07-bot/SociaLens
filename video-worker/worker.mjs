import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const pollMs = Number(process.env.POLL_INTERVAL_MS || 2500)
const batchSize = Number(process.env.BATCH_SIZE || 2)

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk.toString() })
    child.stderr.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-4000)}`))
    })
  })
}

async function processJob(job) {
  const workDir = await mkdtemp(join(tmpdir(), 'socialens-video-'))
  const inputPath = join(workDir, 'source')
  const outputPath = join(workDir, 'compatible.mp4')
  const outputObjectPath = `${job.owner_id}/compatible/${job.id}.mp4`
  let leaseLost = false
  const leaseHeartbeat = setInterval(async () => {
    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .update({
          locked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'processing')
        .eq('lease_token', job.lease_token)
        .select('id')
        .maybeSingle()

      if (error) {
        console.error('Could not renew video job lease:', job.id, error.message)
      } else if (!data) {
        leaseLost = true
        console.error('Video job lease was reclaimed by another worker:', job.id)
      }
    } catch (error) {
      console.error('Video job lease heartbeat failed:', job.id, error?.message || error)
    }
  }, 60_000)
  leaseHeartbeat.unref?.()

  try {
    const { data: source, error: downloadError } = await supabase.storage
      .from(job.bucket).download(job.original_path)
    if (downloadError || !source) throw downloadError || new Error('Original video download returned no data')

    const sourceBuffer = Buffer.from(await source.arrayBuffer())
    if (!sourceBuffer.length) throw new Error('Original video is empty')
    await writeFile(inputPath, sourceBuffer)

    const probeText = await run('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height',
      '-of', 'json', inputPath,
    ])
    const probe = JSON.parse(probeText)
    if (!probe.streams?.length) throw new Error('Uploaded file contains no video stream')

    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-sn', '-dn',
      '-vf', "scale=w='if(gte(iw,ih),min(1280,iw),min(720,iw))':h='if(gte(iw,ih),min(720,ih),min(1280,ih))':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-r', '30',
      '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.1',
      '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
      '-maxrate', '2M', '-bufsize', '4M',
      '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-ac', '2', '-ar', '48000',
      '-movflags', '+faststart',
      outputPath,
    ])

    const outputProbeText = await run('ffprobe', [
      '-v', 'error', '-show_entries',
      'stream=codec_type,codec_name,profile,level,pix_fmt,width,height,sample_rate,channels',
      '-of', 'json', outputPath,
    ])
    const outputProbe = JSON.parse(outputProbeText)
    const video = outputProbe.streams?.find(stream => stream.codec_type === 'video')
    const audio = outputProbe.streams?.find(stream => stream.codec_type === 'audio')
    if (!video || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' || !String(video.profile || '').toLowerCase().includes('baseline') || video.level !== 31 || (video.width * video.height) > 921600) {
      throw new Error('Output validation failed: expected H.264 video with yuv420p pixels')
    }
    if (Math.max(video.width, video.height) > 1280) {
      throw new Error('Output validation failed: rendition exceeds 1280 pixels on its longest edge')
    }
    if (audio && (audio.codec_name !== 'aac' || audio.profile !== 'LC' || audio.sample_rate !== '48000' || audio.channels !== 2)) {
      throw new Error('Output validation failed: expected AAC-LC audio')
    }

    if (leaseLost) throw new Error('Processing lease was reclaimed; stopping stale worker')

    const outputBuffer = await readFile(outputPath)
    const { error: uploadError } = await supabase.storage.from(job.bucket).upload(
      outputObjectPath,
      outputBuffer,
      { contentType: 'video/mp4', cacheControl: '31536000', upsert: true },
    )
    if (uploadError) throw uploadError

    const { data: completedJob, error: updateError } = await supabase.from('video_processing_jobs').update({
      status: 'ready',
      playback_path: outputObjectPath,
      source_bytes: sourceBuffer.length,
      output_bytes: outputBuffer.length,
      completed_at: new Date().toISOString(),
      locked_until: null,
      lease_token: null,
      updated_at: new Date().toISOString(),
      last_error: null,
    }).eq('id', job.id).eq('status', 'processing').eq('lease_token', job.lease_token).select('id').maybeSingle()
    if (updateError) throw updateError
    if (!completedJob) throw new Error('Processing lease was reclaimed before completion')

    console.log(JSON.stringify({ event: 'video_ready', jobId: job.id, sourceBytes: sourceBuffer.length, outputBytes: outputBuffer.length }))
    return true
  } catch (error) {
    const message = String(error?.message || error).slice(0, 2000)
    const terminal = job.attempts >= job.max_attempts
    const delaySeconds = Math.min(300, 15 * (2 ** Math.max(0, job.attempts - 1)))
    const { data: failedJob, error: updateError } = await supabase.from('video_processing_jobs').update({
      status: terminal ? 'failed' : 'queued',
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      locked_until: null,
      lease_token: null,
      updated_at: new Date().toISOString(),
      last_error: message,
    }).eq('id', job.id).eq('status', 'processing').eq('lease_token', job.lease_token).select('id').maybeSingle()
    if (updateError) console.error('Could not record failed job', job.id, updateError.message)
    else if (!failedJob) console.error('Could not update failed job because this worker no longer owns its lease', job.id)
    console.error(JSON.stringify({ event: 'video_failed', jobId: job.id, attempt: job.attempts, terminal, error: message }))
    return false
  } finally {
    clearInterval(leaseHeartbeat)
    await rm(workDir, { recursive: true, force: true })
  }
}

const runOnce = process.env.RUN_ONCE === 'true'
const maxJobsPerRun = Math.max(1, Math.min(10, Number(process.env.MAX_JOBS_PER_RUN || 2)))

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true })
}

console.log(JSON.stringify({
  event: 'worker_started',
  mode: runOnce ? 'run-once' : 'persistent',
  batchSize,
  maxJobsPerRun: runOnce ? maxJobsPerRun : null,
}))

let processedCount = 0
while (!stopping) {
  const remaining = runOnce ? maxJobsPerRun - processedCount : batchSize
  if (runOnce && remaining <= 0) break

  const claimLimit = runOnce ? Math.min(batchSize, remaining) : batchSize
  const { data: jobs, error } = await supabase.rpc('claim_video_processing_jobs', { p_limit: claimLimit })
  if (error) {
    console.error('Queue claim failed:', error.message)
    if (runOnce) process.exitCode = 1
    await new Promise(resolve => setTimeout(resolve, pollMs))
    if (runOnce) break
    continue
  }
  if (!jobs?.length) {
    if (runOnce) break
    await new Promise(resolve => setTimeout(resolve, pollMs))
    continue
  }

  const results = await Promise.all(jobs.map(processJob))
  if (results.some(result => result === false)) process.exitCode = 1
  processedCount += jobs.length
}

console.log(JSON.stringify({ event: 'worker_stopped', processedCount, stopping }))
