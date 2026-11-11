# SociaLens video compatibility worker

This worker converts uploaded post videos into a separate Android-friendly MP4 rendition. It never overwrites or deletes the original upload.

## Output profile

- MP4 container with `moov` metadata moved to the beginning (`faststart`) for progressive playback.
- H.264 AVC Baseline, level 3.1, `yuv420p`.
- Aspect ratio preserved; the longest output edge is capped at 1280 px (720p-class portrait/landscape).
- 30 fps output with a 2 Mbps video peak bitrate and 4 Mbps VBV buffer; AAC-LC stereo audio where an audio stream exists.
- Output is validated with ffprobe before it is uploaded and marked ready.

## Free GitHub Actions setup

The repository includes `.github/workflows/video-processing.yml`. On the default branch, it checks the queue every five minutes and can also be started manually from the Actions tab.

Add these two **repository Actions secrets** in GitHub Settings → Secrets and variables → Actions:

- `SUPABASE_URL`: the original SociaLens Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the service-role secret for that same project.

Never put the service-role key in source code, a committed `.env` file, Vercel client variables, or the Android app. Do not paste it into chat. GitHub Actions reads it only from the repository secret at runtime.

The workflow uses a standard GitHub-hosted Ubuntu runner. Standard runners are free for public repositories under GitHub's current Actions policy. GitHub can change its policies and impose service limits, so monitor the Actions usage page rather than treating any third-party allowance as a permanent guarantee.

### Processing timing and limits

- The workflow is scheduled every five minutes. A newly uploaded video is queued immediately, but conversion starts on the next scheduled run, not necessarily at the exact upload moment.
- GitHub scheduled workflows can be delayed during high load. The workflow can also be started manually.
- GitHub automatically disables scheduled workflows in public repositories after 60 days without repository activity; a maintainer must re-enable the schedule if that happens.
- Each run processes at most two jobs, one at a time, to keep resource use controlled. Additional queued videos are picked up by later runs.
- Failed jobs use the queue's bounded retry/backoff logic and are retried by a later run.
- This is a free scheduled worker, not a continuously running server. Do not promise instant processing or unlimited throughput.

## How upload registration works

The current Create Post flow uploads directly to Supabase Storage, then calls authenticated `POST /api/media/register` to verify ownership/existence and enqueue the video. The `/api/upload` route also enqueues post videos if another app flow uses it.

## Rollout

1. Review and apply `supabase/migrations/20261111_video_compatibility_pipeline.sql` to the **original SociaLens Supabase project**.
2. Add the two Actions secrets listed above.
3. Merge the reviewed pull request into the default branch so the scheduled workflow becomes active.
4. Run the workflow manually once and inspect its logs.
5. Confirm the known video and a new upload reach `ready`.
6. Test on physical Android devices and different real network conditions.

## Persistent-worker alternative

The same worker still supports persistent mode for a future always-on host. Without `RUN_ONCE=true`, it polls continuously. Optional settings are `POLL_INTERVAL_MS` (default 2500) and `BATCH_SIZE` (default 2; maximum 10).

## Safety and operational notes

- The original upload is retained unchanged; the compatible rendition is stored separately.
- Queue rows are internal-only. Browser roles cannot enumerate jobs or inspect worker errors.
- Jobs use renewable, tokenized leases to reduce duplicate processing.
- The migration backfills existing public-storage post videos. Review the queue size before applying it to a large production library.
- This workflow does not apply database migrations, deploy Vercel, or expose secrets to the browser.
- Validate on representative physical Android devices before treating this as a verified fix.
