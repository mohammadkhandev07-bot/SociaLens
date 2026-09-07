'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RING_TIMEOUT_MS } from '@/lib/utils/webrtc'
import { getAvatarUrl } from '@/lib/utils/helpers'
import { canAccessByPrivacy } from '@/lib/utils/privacyAccess'

export type CallType = 'audio' | 'video'
export type CallStatus = 'ringing' | 'accepted' | 'rejected' | 'missed' | 'ended' | 'cancelled' | 'busy'
export type CallProviderName = 'agora' | 'daily'

export interface CallRow {
  id: string
  chat_id: string | null
  caller_id: string
  callee_id: string
  type: CallType
  status: CallStatus
  created_at: string
  started_at: string | null
  ended_at: string | null
}

interface PeerProfile {
  id: string
  username: string
  avatar_url: string | null
  is_verified?: boolean
  verification_type?: 'blue' | 'yellow' | null
}

export type CallPhase = 'idle' | 'outgoing-ringing' | 'incoming-ringing' | 'connecting' | 'permission-prompt' | 'permission-blocked' | 'in-call'

function describeCallError(err: any, context: 'media' | 'connect'): string {
  if (context === 'media') {
    if (err?.name === 'NotAllowedError' || err?.message?.includes('Permission')) {
      return "Camera/microphone access was denied. Please allow access in your browser's site settings and try again."
    }
    if (err?.name === 'NotFoundError') return 'No camera or microphone was found on this device.'
    if (err?.name === 'NotReadableError') return 'Your camera/microphone is already in use by another app.'
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'This browser (or this connection) does not support calls. Calling needs a modern browser over HTTPS.'
    }
    const detail = err?.message || err?.code || err?.name
    return detail ? `Could not connect the call: ${detail}` : 'Could not access your camera/microphone.'
  }
  const msg = String(err?.message || '')
  if (msg.includes('AGORA_APP_ID') || msg.includes('AGORA_APP_CERTIFICATE')) {
    return 'Calling isn\'t fully set up yet - Agora API keys are missing from the server environment variables.'
  }
  if (msg.includes('DAILY_API_KEY') || msg.includes('DAILY_DOMAIN')) {
    return 'Calling isn\'t fully set up yet - Daily API keys are missing from the server environment variables.'
  }
  if (msg.includes('does not exist') || msg.includes('schema cache') || err?.code === '42P01') {
    return 'Calling isn\'t set up on the server yet - the "calls" database table is missing. Run supabase-migration-calls-v2.sql in the Supabase SQL Editor.'
  }
  return msg || 'Could not connect the call.'
}

/** Adds a track to a persistent MediaStream, replacing any existing track of the same kind. */
function upsertTrack(stream: MediaStream, track: MediaStreamTrack) {
  stream.getTracks().filter((t) => t.kind === track.kind).forEach((t) => stream.removeTrack(t))
  stream.addTrack(track)
}
function removeTracksOfKind(stream: MediaStream, kind: string) {
  stream.getTracks().filter((t) => t.kind === kind).forEach((t) => stream.removeTrack(t))
}

/**
 * Drives one call end-to-end:
 *  - Global listener for incoming calls (works from any page, not just chat)
 *  - call lifecycle (ring timeout, accept, reject, cancel, hangup) via the
 *    "calls" Supabase table + realtime, same as before
 *  - the actual audio/video transport, via Agora.io (primary) or Daily.co
 *    (automatic fallback once Agora's free minutes for the month are used
 *    up) - see /api/calls/connect for how that's decided server-side
 *
 * Mounted once, high up in the tree (see CallProvider), so an incoming
 * call can interrupt whatever page the person is currently on.
 */
export function useCallEngine(currentUserId?: string) {
  const supabase = createClient()

  const [phase, setPhase] = useState<CallPhase>('idle')
  const [call, setCall] = useState<CallRow | null>(null)
  const [peer, setPeer] = useState<PeerProfile | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [isMuted, setIsMuted] = useState(false)
  const [isCameraOff, setIsCameraOff] = useState(false)
  const [callDurationSec, setCallDurationSec] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const localStreamObjRef = useRef<MediaStream>(new MediaStream())
  const remoteStreamObjRef = useRef<MediaStream>(new MediaStream())
  const agoraRef = useRef<{ client: any; audioTrack: any; videoTrack: any } | null>(null)
  const dailyRef = useRef<any>(null)
  const providerRef = useRef<CallProviderName | null>(null)
  const startedAtMsRef = useRef<number | null>(null)

  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const callRef = useRef<CallRow | null>(null)
  const pendingCallRef = useRef<CallRow | null>(null)
  const remoteLeftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectingCallIdRef = useRef<string | null>(null)
  const roleRef = useRef<'caller' | 'callee' | null>(null)

  useEffect(() => { callRef.current = call }, [call])
  useEffect(() => { console.log('[SociaLens Call] phase changed ->', phase) }, [phase])

  const clearRingTimeout = () => { if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null } }
  const clearDurationTimer = () => { if (durationIntervalRef.current) { clearInterval(durationIntervalRef.current); durationIntervalRef.current = null } }
  const clearRemoteLeftTimeout = () => { if (remoteLeftTimeoutRef.current) { clearTimeout(remoteLeftTimeoutRef.current); remoteLeftTimeoutRef.current = null } }

  const reportUsageAndCleanupTransport = useCallback(async () => {
    const activeCall = callRef.current
    const provider = providerRef.current
    if (activeCall && provider && startedAtMsRef.current) {
      const seconds = Math.round((Date.now() - startedAtMsRef.current) / 1000)
      try {
        await fetch('/api/calls/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId: activeCall.id, durationSeconds: seconds }),
        })
      } catch { /* best-effort - never block hangup on this */ }
    }

    if (agoraRef.current) {
      const { client, audioTrack, videoTrack } = agoraRef.current
      try { audioTrack?.close() } catch {}
      try { videoTrack?.close() } catch {}
      try { await client.leave() } catch {}
      agoraRef.current = null
    }
    if (dailyRef.current) {
      try { await dailyRef.current.leave() } catch {}
      try { dailyRef.current.destroy() } catch {}
      dailyRef.current = null
    }
    providerRef.current = null
    startedAtMsRef.current = null
  }, [])

  // Logs a finished call into the chat as a message, like a normal phone
  // app does ("Voice call - 2:14", "Missed call", etc). Only the caller's
  // side writes this (mirroring how only the caller's usage gets counted
  // above) so a call never ends up logged twice - whichever side actually
  // hangs up, the caller's own listener always eventually notices the
  // final status and logs it exactly once.
  const logCallToChat = async (call: CallRow, status: CallStatus) => {
    if (!call.chat_id) return
    const durationSec = startedAtMsRef.current ? Math.round((Date.now() - startedAtMsRef.current) / 1000) : 0
    const outcome = durationSec > 0 ? 'completed' : status
    try {
      await supabase.from('messages').insert({
        chat_id: call.chat_id,
        sender_id: call.caller_id,
        content: JSON.stringify({ callType: call.type, outcome, durationSec }),
        media_type: 'call',
      })
      // Also update the chat list preview - without this a call never
      // shows up there at all, only inside the conversation itself.
      const preview =
        outcome === 'completed' ? '📞 Voice call'
        : outcome === 'missed' ? '📞 Missed call'
        : outcome === 'rejected' ? '📞 Call declined'
        : outcome === 'cancelled' ? '📞 Cancelled call'
        : '📞 Voice call'
      await supabase
        .from('chats')
        .update({
          last_message: preview,
          last_message_time: new Date().toISOString(),
          last_message_type: 'call',
          last_message_sender_id: call.caller_id,
        })
        .eq('id', call.chat_id)
    } catch (e) {
      console.error('[SociaLens Call] failed to log call to chat', e)
    }
  }

  // Full teardown - stops media, tears down whichever provider is active,
  // and resets every piece of state back to idle. Used whenever a call
  // ends for ANY reason (hangup, reject, cancel, timeout, error).
  const cleanup = useCallback((logStatus?: CallStatus) => {
    const callToLog = callRef.current
    if (callToLog && logStatus && roleRef.current === 'caller') {
      void logCallToChat(callToLog, logStatus)
    }

    clearRingTimeout()
    clearDurationTimer()
    clearRemoteLeftTimeout()
    void reportUsageAndCleanupTransport()

    localStreamObjRef.current.getTracks().forEach((t) => { t.stop(); localStreamObjRef.current.removeTrack(t) })
    remoteStreamObjRef.current.getTracks().forEach((t) => remoteStreamObjRef.current.removeTrack(t))

    roleRef.current = null
    pendingCallRef.current = null
    connectingCallIdRef.current = null
    setLocalStream(null)
    setRemoteStream(null)
    setCall(null)
    setPeer(null)
    setPhase('idle')
    setIsMuted(false)
    setIsCameraOff(false)
    setCallDurationSec(0)
  }, [reportUsageAndCleanupTransport])

  const updateCallStatus = useCallback(async (callId: string, patch: Partial<Pick<CallRow, 'status' | 'started_at' | 'ended_at'>>) => {
    await supabase.from('calls').update(patch).eq('id', callId)
  }, [])

  // ------------------------------------------------------------------
  // Joins the actual audio/video transport (Agora or Daily, whichever
  // /api/calls/connect decides) once both sides have accepted the call.
  // ------------------------------------------------------------------
  const doConnectMedia = useCallback(async (activeCall: CallRow) => {
    setPhase('connecting')
    try {
      const res = await fetch('/api/calls/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: activeCall.id }),
      })
      const info = await res.json()
      if (!res.ok) throw new Error(info?.error || 'Could not connect the call.')

      providerRef.current = info.provider

      if (info.provider === 'agora') {
        const { default: AgoraRTC } = await import('agora-rtc-sdk-ng')
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
        agoraRef.current = { client, audioTrack: null, videoTrack: null }

        client.on('user-published', async (remoteUser: any, mediaType: 'audio' | 'video') => {
          try {
            await client.subscribe(remoteUser, mediaType)
            const track = mediaType === 'audio' ? remoteUser.audioTrack : remoteUser.videoTrack
            if (track) {
              upsertTrack(remoteStreamObjRef.current, track.getMediaStreamTrack())
              setRemoteStream(remoteStreamObjRef.current)
              setPhase('in-call')
              if (!startedAtMsRef.current) startedAtMsRef.current = Date.now()
            }
          } catch (subErr) {
            console.error('[Agora] subscribe failed', subErr)
          }
          // The other side is back - cancel any pending "they disconnected" grace timer.
          if (remoteLeftTimeoutRef.current) { clearTimeout(remoteLeftTimeoutRef.current); remoteLeftTimeoutRef.current = null }
        })
        client.on('user-unpublished', (_remoteUser: any, mediaType: 'audio' | 'video') => {
          removeTracksOfKind(remoteStreamObjRef.current, mediaType === 'audio' ? 'audio' : 'video')
        })
        // A brief network blip can make Agora report the other person as
        // having "left" even though they're still on the call and about
        // to reconnect - so this doesn't end the call immediately. It
        // waits a few seconds for them to reappear (user-published above)
        // before actually treating it as a real hangup.
        client.on('user-left', () => {
          if (remoteLeftTimeoutRef.current) clearTimeout(remoteLeftTimeoutRef.current)
          remoteLeftTimeoutRef.current = setTimeout(() => {
            remoteLeftTimeoutRef.current = null
            cleanup('ended')
          }, 8000)
        })
        client.on('connection-state-change', (curState: string, _prevState: string, reason: string) => {
          console.log('[Agora] connection state ->', curState, reason)
        })

        await client.join(info.appId, info.channel, info.token, info.uid)

        const audioTrack = await AgoraRTC.createMicrophoneAudioTrack()
        upsertTrack(localStreamObjRef.current, audioTrack.getMediaStreamTrack())
        let videoTrack: any = null
        if (activeCall.type === 'video') {
          try {
            videoTrack = await AgoraRTC.createCameraVideoTrack()
            upsertTrack(localStreamObjRef.current, videoTrack.getMediaStreamTrack())
          } catch (camErr) {
            // No usable camera on this device - don't fail the whole call
            // over it, just continue as audio-only and let them know why.
            console.warn('[Agora] camera unavailable, continuing audio-only', camErr)
            videoTrack = null
            setError('No camera found on this device - continuing with audio only.')
          }
        }
        agoraRef.current.audioTrack = audioTrack
        agoraRef.current.videoTrack = videoTrack
        setLocalStream(localStreamObjRef.current)
        await client.publish([audioTrack, videoTrack].filter(Boolean))
      } else {
        const { default: Daily } = await import('@daily-co/daily-js')
        const call = Daily.createCallObject({ subscribeToTracksAutomatically: true })
        dailyRef.current = call

        call.on('track-started', (ev: any) => {
          if (!ev?.track) return
          const targetStream = ev.participant?.local ? localStreamObjRef.current : remoteStreamObjRef.current
          upsertTrack(targetStream, ev.track)
          if (ev.participant?.local) setLocalStream(localStreamObjRef.current)
          else {
            setRemoteStream(remoteStreamObjRef.current)
            setPhase('in-call')
            if (!startedAtMsRef.current) startedAtMsRef.current = Date.now()
          }
        })
        call.on('track-stopped', (ev: any) => {
          if (!ev?.track) return
          const targetStream = ev.participant?.local ? localStreamObjRef.current : remoteStreamObjRef.current
          targetStream.removeTrack(ev.track)
        })
        call.on('left-meeting', () => cleanup('ended'))
        call.on('error', (ev: any) => { console.error('[Daily] error', ev); setError(describeCallError(ev, 'connect')) })

        await call.join({ url: info.roomUrl, token: info.token })
        if (activeCall.type === 'audio') await call.setLocalVideo(false)
      }
    } catch (err: any) {
      console.error('connectMedia failed', err)
      // A camera/mic error here (rather than a network/provider error)
      // means the permission pre-check above didn't catch it in time -
      // most commonly an installed home-screen app on some Android
      // phones that never surfaces the real permission prompt at all.
      // Fall back to the same explainer screen (in its "blocked" form)
      // instead of just leaving them with a generic error, since it also
      // offers "open in browser" as a working escape hatch.
      const errName = String(err?.name || '')
      const errMsg = String(err?.message || err?.code || '')
      const isMediaError = ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(errName)
        || /permission|not allowed|notallowed|denied/i.test(errMsg)
        || !navigator.mediaDevices?.getUserMedia
      if (isMediaError) {
        pendingCallRef.current = activeCall
        setPhase('permission-blocked')
        return
      }
      const message = describeCallError(err, 'media')
      setError(message)
      await updateCallStatus(activeCall.id, { status: 'ended', ended_at: new Date().toISOString() })
      cleanup('ended')
    }
  }, [cleanup, updateCallStatus])

  // Checks the browser's current camera/mic permission state (where the
  // Permissions API is available - Safari doesn't support querying
  // 'camera'/'microphone', in which case we just proceed straight to the
  // real request, which is exactly what happened before this existed).
  const checkMediaPermission = async (type: CallType): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> => {
    if (!navigator.permissions?.query) return 'unknown'
    try {
      const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      if (mic.state === 'denied') return 'denied'
      if (type === 'audio') return mic.state as 'granted' | 'prompt'
      const cam = await navigator.permissions.query({ name: 'camera' as PermissionName })
      if (cam.state === 'denied') return 'denied'
      return (mic.state === 'granted' && cam.state === 'granted') ? 'granted' : 'prompt'
    } catch {
      return 'unknown'
    }
  }

  // Gatekeeper in front of doConnectMedia: if the browser has never been
  // asked before, show our own friendly explainer first (so people
  // understand why we're asking, before the real browser prompt appears -
  // people are far more likely to hit "Allow" that way). If access was
  // already explicitly blocked, there's no popup that can fix that - only
  // the person changing it in their browser's site settings can - so we
  // show clear instructions instead of just quietly failing.
  const connectMedia = useCallback(async (activeCall: CallRow) => {
    // The realtime listener and the polling backstop can both notice
    // "this call just got accepted" within moments of each other - without
    // this guard, that would spin up two Agora/Daily connections for the
    // same call, which then fight each other (this is what was producing
    // the "PeerConnection already disconnected" error). Whichever path
    // notices first claims the call id; the other becomes a no-op.
    if (connectingCallIdRef.current === activeCall.id) return
    connectingCallIdRef.current = activeCall.id
    // The caller's original "ringing" timeout (45s) must stop the moment
    // the call is actually accepted - otherwise it keeps counting down in
    // the background and force-ends a perfectly healthy call anywhere from
    // a few seconds to tens of seconds later, depending on how long the
    // callee took to pick up.
    clearRingTimeout()

    pendingCallRef.current = activeCall
    const state = await checkMediaPermission(activeCall.type)
    if (state === 'denied') {
      setPhase('permission-blocked')
      return
    }
    if (state === 'prompt') {
      setPhase('permission-prompt')
      return
    }
    await doConnectMedia(activeCall)
  }, [doConnectMedia])

  // Called when the person taps "Allow camera & microphone" on our
  // explainer screen - this click IS the user gesture the browser needs
  // to show its own native permission prompt.
  const confirmPermissionAndConnect = useCallback(async () => {
    if (!pendingCallRef.current) return
    await doConnectMedia(pendingCallRef.current)
  }, [doConnectMedia])

  // Called from the "I've fixed it" button on the blocked-access screen -
  // re-checks in case they just changed the site setting.
  const recheckPermission = useCallback(async () => {
    if (!pendingCallRef.current) return
    const state = await checkMediaPermission(pendingCallRef.current.type)
    if (state === 'denied') {
      setError('Still blocked. Make sure you reloaded the page after changing the browser setting.')
      return
    }
    if (state === 'prompt') {
      setPhase('permission-prompt')
      return
    }
    await doConnectMedia(pendingCallRef.current)
  }, [doConnectMedia])

  // ------------------------------------------------------------------
  // Outgoing call
  // ------------------------------------------------------------------
  const startCall = useCallback(async (calleeId: string, chatId: string | null, type: CallType, calleeProfile: PeerProfile) => {
    if (!currentUserId) return
    setError(null)
    roleRef.current = 'caller'
    try {
      // Call Privacy gate (Settings > Privacy > Call Privacy) - checked
      // before ever creating the call row, so a disallowed call never
      // even starts ringing on the other end.
      const { data: calleeProfileRow } = await supabase.from('profiles').select('call_privacy').eq('id', calleeId).single()
      const allowed = await canAccessByPrivacy(supabase, currentUserId, calleeId, (calleeProfileRow as any)?.call_privacy, 'call')
      if (!allowed) {
        setError("This person isn't accepting calls right now")
        roleRef.current = null
        return
      }

      console.log('[SociaLens Call] inserting call row into Supabase...', { calleeId, chatId, type })
      const { data: newCall, error: insertError } = await supabase
        .from('calls')
        .insert({ chat_id: chatId, caller_id: currentUserId, callee_id: calleeId, type, status: 'ringing' })
        .select()
        .single()
      console.log('[SociaLens Call] insert result', { newCall, insertError })
      if (insertError || !newCall) throw insertError || new Error('Could not start call')

      setCall(newCall as CallRow)
      setPeer(calleeProfile)
      setPhase('outgoing-ringing')
      console.log('[SociaLens Call] phase -> outgoing-ringing, call row:', newCall)

      // Fire-and-forget - notifies the callee with a system notification
      // even if they don't have SociaLens open right now.
      fetch('/api/push/notify-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: newCall.id }),
      }).catch(() => {})

      ringTimeoutRef.current = setTimeout(async () => {
        await updateCallStatus(newCall.id, { status: 'missed' })
        cleanup('missed')
      }, RING_TIMEOUT_MS)
    } catch (err: any) {
      console.error('[SociaLens Call] startCall failed', err)
      const message = describeCallError(err, 'connect')
      setError(message)
      cleanup()
    }
  }, [currentUserId, cleanup, updateCallStatus])

  const cancelOutgoing = useCallback(async () => {
    if (!call) return
    await updateCallStatus(call.id, { status: 'cancelled' })
    cleanup('cancelled')
  }, [call, cleanup])

  // ------------------------------------------------------------------
  // Incoming call
  // ------------------------------------------------------------------
  const acceptIncoming = useCallback(async () => {
    if (!call) return
    clearRingTimeout()
    roleRef.current = 'callee'
    try {
      await updateCallStatus(call.id, { status: 'accepted', started_at: new Date().toISOString() })
      const acceptedCall = { ...call, status: 'accepted' as CallStatus }
      setCall(acceptedCall)
      await connectMedia(acceptedCall)
    } catch (err: any) {
      console.error('acceptIncoming failed', err)
      setError(describeCallError(err, 'media'))
      await updateCallStatus(call.id, { status: 'rejected' })
      cleanup()
    }
  }, [call, cleanup, connectMedia])

  const rejectIncoming = useCallback(async () => {
    if (!call) return
    await updateCallStatus(call.id, { status: 'rejected' })
    cleanup()
  }, [call, cleanup])

  const endCall = useCallback(async (finalStatus: CallStatus = 'ended') => {
    const current = callRef.current
    if (current) {
      await updateCallStatus(current.id, { status: finalStatus, ended_at: new Date().toISOString() })
    }
    cleanup(finalStatus)
  }, [cleanup])

  const toggleMute = useCallback(() => {
    const next = !isMuted
    setIsMuted(next)
    if (agoraRef.current?.audioTrack) agoraRef.current.audioTrack.setEnabled(!next)
    if (dailyRef.current) dailyRef.current.setLocalAudio(!next)
  }, [isMuted])

  const toggleCamera = useCallback(() => {
    const next = !isCameraOff
    setIsCameraOff(next)
    if (agoraRef.current?.videoTrack) agoraRef.current.videoTrack.setEnabled(!next)
    if (dailyRef.current) dailyRef.current.setLocalVideo(!next)
  }, [isCameraOff])

  // Call duration timer, running once the transport is actually live.
  useEffect(() => {
    if (phase === 'in-call') {
      const startedAt = call?.started_at ? new Date(call.started_at).getTime() : Date.now()
      durationIntervalRef.current = setInterval(() => {
        setCallDurationSec(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
      }, 1000)
    } else {
      clearDurationTimer()
    }
    return clearDurationTimer
  }, [phase, call?.started_at])

  // ------------------------------------------------------------------
  // Global listeners - work from anywhere in the app, not just the chat
  // page, so a call can ring while someone's browsing the feed.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!currentUserId) return

    const channel = supabase
      .channel(`calls-listener:${currentUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${currentUserId}` },
        async (payload: any) => {
          const row = payload.new as CallRow
          if (row.status !== 'ringing') return
          roleRef.current = 'callee'
          const { data: callerProfile } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, is_verified, verification_type')
            .eq('id', row.caller_id)
            .single()
          setCall(row)
          setPeer(callerProfile as PeerProfile)
          setPhase('incoming-ringing')

          ringTimeoutRef.current = setTimeout(() => cleanup(), RING_TIMEOUT_MS)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls', filter: `caller_id=eq.${currentUserId}` },
        (payload: any) => handleStatusUpdate(payload.new as CallRow)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${currentUserId}` },
        (payload: any) => handleStatusUpdate(payload.new as CallRow)
      )
      .subscribe()

    function handleStatusUpdate(row: CallRow) {
      if (!callRef.current || row.id !== callRef.current.id) return

      if (row.status === 'accepted' && roleRef.current === 'caller') {
        const acceptedCall = { ...callRef.current, status: 'accepted' as CallStatus }
        setCall(acceptedCall)
        connectMedia(acceptedCall)
        return
      }
      if (['rejected', 'missed', 'cancelled', 'busy', 'ended'].includes(row.status)) {
        cleanup(row.status)
      }
    }

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId])

  // ------------------------------------------------------------------
  // Reliability backstop for the realtime listener above. Realtime
  // websockets can lag or get suspended (mobile browsers throttle
  // background tabs, network switches between wifi/cellular, etc.) - when
  // that happens, an incoming call can arrive late or not visibly at all.
  // This polls every few seconds as a safety net so a call is never
  // missed for more than a moment, even if the realtime event itself
  // never arrives. It's deliberately lightweight (one small query) and
  // only runs while idle or actively ringing, not during a live call.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!currentUserId) return

    const poll = async () => {
      // Catch a missed "someone is calling me" event - only relevant when
      // we're not already dealing with some other call.
      if (phase === 'idle') {
        const { data: incoming } = await supabase
          .from('calls')
          .select('*')
          .eq('callee_id', currentUserId)
          .eq('status', 'ringing')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (incoming && Date.now() - new Date(incoming.created_at).getTime() < RING_TIMEOUT_MS) {
          roleRef.current = 'callee'
          const { data: callerProfile } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, is_verified, verification_type')
            .eq('id', incoming.caller_id)
            .single()
          setCall(incoming as CallRow)
          setPeer(callerProfile as PeerProfile)
          setPhase('incoming-ringing')
          ringTimeoutRef.current = setTimeout(() => cleanup(), RING_TIMEOUT_MS - (Date.now() - new Date(incoming.created_at).getTime()))
        }
        return
      }

      // Catch a missed status change (callee accepted/rejected, caller
      // cancelled, etc) on whatever call is currently active - this needs
      // to run for the ENTIRE life of a call (ringing, connecting, in-call),
      // not just while idle - otherwise a caller stuck on "Ringing..."
      // never notices the callee already picked up if the realtime event
      // for it happens to get lost.
      const current = callRef.current
      if (current) {
        const { data: fresh } = await supabase.from('calls').select('status').eq('id', current.id).single()
        if (fresh && fresh.status !== current.status) {
          if (fresh.status === 'accepted' && roleRef.current === 'caller') {
            const acceptedCall = { ...current, status: 'accepted' as CallStatus }
            setCall(acceptedCall)
            connectMedia(acceptedCall)
          } else if (['rejected', 'missed', 'cancelled', 'busy', 'ended'].includes(fresh.status)) {
            cleanup(fresh.status)
          }
        }
      }
    }

    const intervalId = setInterval(poll, 4000)
    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, phase])

  return {
    phase,
    call,
    peer,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    callDurationSec,
    error,
    startCall,
    cancelOutgoing,
    acceptIncoming,
    rejectIncoming,
    hangup: () => endCall('ended'),
    toggleMute,
    toggleCamera,
    confirmPermissionAndConnect,
    recheckPermission,
  }
}

export function peerAvatar(peer: PeerProfile | null) {
  return getAvatarUrl(peer?.avatar_url ?? null)
}
