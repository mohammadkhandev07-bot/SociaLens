'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useUser } from '@/lib/hooks/useUser'
import { useCallEngine, peerAvatar, type CallType } from '@/lib/hooks/useCall'
import { useCallSettings } from '@/lib/hooks/useChatSettings'
import { usePushSubscription } from '@/lib/hooks/usePushSubscription'
import { useNativePush } from '@/lib/hooks/useNativePush'
import { IncomingCallModal } from './IncomingCallModal'
import { CallScreen } from './CallScreen'
import { PermissionGate } from './PermissionGate'

interface StartCallPeer {
  id: string
  username: string
  avatar_url: string | null
}

interface CallContextValue {
  startCall: (peer: StartCallPeer, chatId: string | null, type: CallType) => Promise<void>
  isCallActive: boolean
  reportBlocked: (reason: string) => void
}

const CallContext = createContext<CallContextValue | null>(null)

export function useCallContext() {
  const ctx = useContext(CallContext)
  if (!ctx) throw new Error('useCallContext must be used within CallProvider')
  return ctx
}

/**
 * Mounted once near the root (see ResponsiveLayout) so a call can ring in
 * from anywhere in the app, not just the chat page. Renders the incoming
 * call screen, the active call screen, and a self-contained error banner
 * as global overlays.
 *
 * The error banner is driven directly by this component's own state
 * (bannerError below) rather than routing through the separate Toast
 * module - that removes a whole class of "the message technically fired
 * but nothing rendered" bugs, since the exact same render that owns the
 * call state also owns what's displayed for it.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUser()
  const engine = useCallEngine(user?.id)
  const { data: callSettings } = useCallSettings(user?.id)
  usePushSubscription(user?.id)
  useNativePush(user?.id)
  const [bannerError, setBannerError] = useState<string | null>(null)

  // Tapping "Accept" on the OS call notification (see public/sw.js) lands
  // here with ?incomingCall=<id> in the URL - including on a cold start,
  // where SociaLens was fully closed and this is the very first render.
  // Read it once, then wait for that same call to actually show up as
  // ringing (via the realtime listener/fallback poll in useCallEngine)
  // before accepting it, since it may not have arrived yet on this first
  // render. Stripped from the address bar immediately so refreshing or
  // navigating back doesn't re-trigger it.
  //
  // The native Android app's Decline button (see CallMessagingService.kt)
  // uses the same trick with ?declineCall=<id> instead - the notification
  // there can't safely call /api/calls/decline on its own (that route
  // needs the person's real logged-in session, which only this WebView
  // actually has), so it opens the app long enough for this same code
  // path to make that authenticated call for it.
  const pendingAcceptCallId = useRef<string | null>(null)
  const pendingDeclineCallId = useRef<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const incomingCall = params.get('incomingCall')
    const declineCall = params.get('declineCall')
    if (!incomingCall && !declineCall) return
    if (incomingCall) pendingAcceptCallId.current = incomingCall
    if (declineCall) pendingDeclineCallId.current = declineCall
    params.delete('incomingCall')
    params.delete('declineCall')
    const rest = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
  }, [])

  useEffect(() => {
    if (!pendingAcceptCallId.current) return
    if (engine.phase === 'incoming-ringing' && engine.call?.id === pendingAcceptCallId.current) {
      pendingAcceptCallId.current = null
      engine.acceptIncoming()
    }
  }, [engine.phase, engine.call?.id, engine.acceptIncoming])

  useEffect(() => {
    if (!pendingDeclineCallId.current) return
    if (engine.phase === 'incoming-ringing' && engine.call?.id === pendingDeclineCallId.current) {
      pendingDeclineCallId.current = null
      engine.rejectIncoming()
    }
  }, [engine.phase, engine.call?.id, engine.rejectIncoming])

  // Whenever the call engine reports an error (permission denied, DB
  // Insert failed, etc.) surface it here, auto-dismissing after a bit.
  useEffect(() => {
    if (!engine.error) return
    setBannerError(engine.error)
    const timer = setTimeout(() => setBannerError(null), 7000)
    return () => clearTimeout(timer)
  }, [engine.error])

  const reportBlocked = (reason: string) => {
    setBannerError(reason)
    window.setTimeout(() => setBannerError((current) => (current === reason ? null : current)), 5000)
  }

  const startCall = async (peer: StartCallPeer, chatId: string | null, type: CallType) => {
    console.log('[SociaLens Call] startCall requested', { peer, chatId, type, phase: engine.phase })
    if (engine.phase !== 'idle') {
      reportBlocked('You are already on a call.')
      return
    }
    await engine.startCall(peer.id, chatId, type, peer)
  }

  const value: CallContextValue = { startCall, isCallActive: engine.phase !== 'idle', reportBlocked }

  const peerName = engine.peer?.username || 'Unknown'
  const peerAvatarUrl = peerAvatar(engine.peer)

  return (
    <CallContext.Provider value={value}>
      {children}

      {bannerError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] max-w-[92vw] flex items-center gap-3 bg-red-600 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-2xl">
          <span>{bannerError}</span>
          <button onClick={() => setBannerError(null)} className="shrink-0 opacity-80 hover:opacity-100">✕</button>
        </div>
      )}

      {engine.phase === 'incoming-ringing' && engine.call && (
        <IncomingCallModal
          callerName={peerName}
          callerAvatar={peerAvatarUrl}
          type={engine.call.type}
          ringtoneId={callSettings?.ringtone}
          ringtoneVolume={callSettings?.volume}
          onAccept={engine.acceptIncoming}
          onReject={engine.rejectIncoming}
        />
      )}

      {(engine.phase === 'permission-prompt' || engine.phase === 'permission-blocked') && engine.call && (
        <PermissionGate
          mode={engine.phase === 'permission-blocked' ? 'blocked' : 'prompt'}
          type={engine.call.type}
          peerName={peerName}
          onAllow={engine.phase === 'permission-blocked' ? engine.recheckPermission : engine.confirmPermissionAndConnect}
          onCancel={engine.hangup}
        />
      )}

      {(engine.phase === 'outgoing-ringing' || engine.phase === 'connecting' || engine.phase === 'in-call') && engine.call && (
        <CallScreen
          phase={engine.phase}
          type={engine.call.type}
          peerName={peerName}
          peerAvatar={peerAvatarUrl}
          localStream={engine.localStream}
          remoteStream={engine.remoteStream}
          isMuted={engine.isMuted}
          isCameraOff={engine.isCameraOff}
          callDurationSec={engine.callDurationSec}
          error={engine.error}
          ringtoneId={callSettings?.ringtone}
          ringtoneVolume={callSettings?.volume}
          onEnd={engine.phase === 'outgoing-ringing' ? engine.cancelOutgoing : engine.hangup}
          onToggleMute={engine.toggleMute}
          onToggleCamera={engine.toggleCamera}
        />
      )}
    </CallContext.Provider>
  )
}
