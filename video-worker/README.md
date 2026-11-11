# SociaLens video compatibility worker

This isolated Docker worker converts uploaded post videos into a separate Android-friendly MP4 rendition. It never overwrites or deletes the original upload.

## Output profile

- MP4 container with `moov` metadata moved to the beginning (`faststart`) for progressive playback.
- H.264 AVC Baseline, level 3.1, `yuv420p`.
- Aspect ratio preserved; the longest output edge is capped at 1280 px (720p-class portrait/landscape).
- 30 fps output with a 2 Mbps video peak bitrate and 4 Mbps VBV buffer for slower connections; AAC-LC stereo audio where an audio stream exists.
- Output is validated with ffprobe before it is uploaded and marked ready.

## Required secrets

Set these only in the worker host's secret/environment settings:

- `SUPABASE_URL`: the original SociaLens Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the service-role secret for that same project. Never add this value to GitHub, Vercel client variables, or the Android app.

Optional settings: `POLL_INTERVAL_MS` (default 2500), `BATCH_SIZE` (default 2; maximum 10).

## Deploy

1. Apply `supabase/migrations/20261111_video_compatibility_pipeline.sql` to the original SociaLens Supabase project.
2. Build and run this directory as a Docker service on a host that supports persistent background processes.
3. Configure the two required secrets.
4. Deploy the Next.js changes. The current Create Post flow uploads directly to Supabase Storage, then calls `POST /api/media/register` to verify ownership/existence and enqueue the video. The `/api/upload` route also enqueues video uploads if another app flow uses it.
5. Check worker logs for `video_ready` events and confirm rows reach `ready`.

The worker is intentionally not run in a Vercel request. Scale worker replicas gradually and monitor CPU, memory, storage egress, queue age, and failure rate. Each worker claims jobs using PostgreSQL row locks with `SKIP LOCKED`; jobs have leases and bounded exponential retries.

## Important rollout notes

- The migration queues existing Supabase public-storage post videos for backfill. Monitor the initial queue depth and scale worker capacity gradually before applying it to a large production library.
- A pending conversion is not served as if it were ready. The client waits for the rendition and uses the original only for legacy/untracked or permanently failed jobs.
- Queue rows are not readable by browser clients. The authenticated playback endpoint uses a server-only service-role client to read only the requested object's processing state.
- Worker jobs use a renewable, tokenized lease so a slow transcode cannot be claimed and finalized by two workers at once.
- This PR does not provision a paid worker host or expose service-role secrets. Worker deployment and migration application are explicit production rollout steps.
- Validate on representative physical Android devices before treating this as a verified fix.
