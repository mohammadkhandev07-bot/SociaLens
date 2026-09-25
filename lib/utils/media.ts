/**
 * A transparent poster prevents Android WebView's default video poster from
 * covering the media element before the first real frame is presented.
 */
export const BLANK_VIDEO_POSTER =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

/**
 * Supabase Storage media is served through our same-origin Next.js proxy.
 * Android WebView is much more reliable with a same-origin response that
 * explicitly preserves HTTP byte ranges and the video MIME type.
 *
 * Non-Supabase URLs are left untouched so existing external media keeps
 * working normally.
 */
export function getMediaPlaybackUrl(src: string): string {
  if (!src) return src

  try {
    const url = new URL(src, window.location.origin)
    const configuredSupabase = process.env.NEXT_PUBLIC_SUPABASE_URL

    if (!configuredSupabase) return src

    const supabase = new URL(configuredSupabase)
    const isSupabaseStorage =
      url.protocol === 'https:' &&
      url.host === supabase.host &&
      url.pathname.startsWith('/storage/v1/object/')

    return isSupabaseStorage
      ? `/api/media/proxy?url=${encodeURIComponent(url.toString())}`
      : src
  } catch {
    return src
  }
}

/** Kept for backwards compatibility with older components. */
export function getMediaProxyUrl(src: string): string {
  return `/api/media/proxy?url=${encodeURIComponent(src)}`
}
