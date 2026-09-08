'use client'

// Read-aloud uses the browser's own built-in voice directly - always has,
// this file used to try Microsoft's Edge TTS service first (via
// /api/aperonix/speak) and only fall back to the browser voice if that
// failed, but Microsoft's side of that workaround is unreliable enough
// that people were routinely waiting out a long timeout before ever
// hearing anything. The browser's native voice is instant and "good
// enough" is much better than "great, but usually late."
// Voice input (speech-to-text) always uses the browser's native API -
// support varies: best in Chrome/Edge, not available in Firefox.

let cachedVoices: SpeechSynthesisVoice[] = []

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      resolve([])
      return
    }
    const existing = window.speechSynthesis.getVoices()
    if (existing.length > 0) {
      cachedVoices = existing
      resolve(existing)
      return
    }
    // Voices often load asynchronously on first page load.
    window.speechSynthesis.onvoiceschanged = () => {
      cachedVoices = window.speechSynthesis.getVoices()
      resolve(cachedVoices)
    }
    // Fallback in case the event never fires (some browsers/OSes).
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 500)
  })
}

// Strips emojis and stray markdown symbols before speaking - without this,
// some voice engines literally announce emojis ("grinning face", "star",
// etc.) or read out "asterisk asterisk" around bold text, which sounds
// nothing like a real person talking.
function cleanTextForSpeech(text: string): string {
  return text
    // Emoji + pictograph + symbol + flag ranges, plus the invisible
    // variation-selector/zero-width-joiner characters emoji sequences use.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu, '')
    // Markdown formatting characters that would otherwise get spoken aloud.
    .replace(/[*_~`#]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Picks the nicest-sounding female English voice available on this device,
// for the fallback path only - Edge TTS (the primary path) always uses the
// same fixed voice, this is just what plays if that route is unreachable.
function pickAperonixVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const preferredNames = [
    'Google UK English Female', 'Google US English', 'Google हिन्दी',
    'Samantha', 'Microsoft Aria Online', 'Microsoft Jenny Online', 'Microsoft Zira',
    'Victoria', 'Karen', 'Moira', 'Tessa',
  ]
  for (const name of preferredNames) {
    const match = voices.find(v => v.name.includes(name))
    if (match) return match
  }
  // Any other Google voice at all still sounds better than most local ones.
  const anyGoogle = voices.find(v => v.name.startsWith('Google') && v.lang.startsWith('en'))
  if (anyGoogle) return anyGoogle
  // Fall back to anything explicitly flagged/named "female".
  const femaleMatch = voices.find(v => /female/i.test(v.name))
  if (femaleMatch) return femaleMatch
  // Last resort - any English voice at all.
  return voices.find(v => v.lang.startsWith('en')) || voices[0]
}

interface SpeakHandle {
  stop: () => void
}

async function speakWithBrowserVoice(cleaned: string, onEnd: () => void): Promise<SpeakHandle> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd()
    return { stop: () => {} }
  }

  window.speechSynthesis.cancel()
  const voices = cachedVoices.length ? cachedVoices : await loadVoices()
  const utterance = new SpeechSynthesisUtterance(cleaned)
  const voice = pickAperonixVoice(voices)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  utterance.pitch = 1.02
  utterance.rate = 0.93
  utterance.onend = onEnd
  utterance.onerror = onEnd

  window.speechSynthesis.speak(utterance)
  return { stop: () => window.speechSynthesis.cancel() }
}

export async function speakText(
  text: string,
  onEnd: () => void
): Promise<SpeakHandle> {
  const cleaned = cleanTextForSpeech(text)
  if (!cleaned) {
    onEnd()
    return { stop: () => {} }
  }

  return speakWithBrowserVoice(cleaned, onEnd)
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false
  return !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}

interface VoiceInputHandlers {
  onInterim: (transcript: string) => void
  onFinal: (transcript: string) => void
  onEnd: () => void
  onError?: () => void
}

// Wraps the browser's SpeechRecognition object (typed loosely as `any`
// since it isn't part of the standard TS DOM lib) into a simple
// start/stop control the UI can drive directly.
export function createVoiceInput(handlers: VoiceInputHandlers) {
  const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  if (!SpeechRecognitionCtor) return null

  const recognition = new SpeechRecognitionCtor()
  recognition.lang = navigator.language || 'en-US'
  recognition.interimResults = true
  recognition.continuous = false
  recognition.maxAlternatives = 1

  let finalTranscript = ''

  recognition.onresult = (event: any) => {
    let interim = ''
    finalTranscript = ''
    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript
      if (event.results[i].isFinal) finalTranscript += transcript
      else interim += transcript
    }
    handlers.onInterim(finalTranscript + interim)
  }

  recognition.onerror = () => {
    handlers.onError?.()
  }

  recognition.onend = () => {
    handlers.onFinal(finalTranscript.trim())
    handlers.onEnd()
  }

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
  }
}
