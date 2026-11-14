'use client'

import { useEffect, useRef, useState } from 'react'

const AD_SCRIPT_SRC = 'https://bicea.org/21/881f5b6409710d9bc02f368e7ca74528'
const AD_CONTAINER_ID = 'container-881f5b6409710d9bc02f368e7ca74528'

let activeNativeBanner: HTMLElement | null = null
let activeNativeOwner: symbol | null = null
let activeNativePriority = false
let activeNativeRelease: (() => void) | null = null
const NATIVE_PRIORITY_EVENT = 'socialens:native-ad-priority'

interface NativeAdUnitProps {
  className?: string
  style?: React.CSSProperties
  background?: string
  priority?: boolean
}

export function NativeAdUnit({ className, style, background = 'transparent', priority = false }: NativeAdUnitProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [scriptState, setScriptState] = useState<'loading' | 'loaded' | 'error' | 'duplicate'>('loading')
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const handlePriority = (event: Event) => {
      if (priority) return
      setPaused((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener(NATIVE_PRIORITY_EVENT, handlePriority)
    if (!priority && activeNativePriority) setPaused(true)
    return () => window.removeEventListener(NATIVE_PRIORITY_EVENT, handlePriority)
  }, [priority])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (paused || (!priority && activeNativePriority)) return

    if (priority) {
      activeNativePriority = true
      window.dispatchEvent(new CustomEvent(NATIVE_PRIORITY_EVENT, { detail: true }))
      activeNativeRelease?.()
    }

    if (activeNativeBanner) {
      setScriptState('duplicate')
      return
    }

    setScriptState('loading')
    let disposed = false
    const owner = Symbol('native-ad')
    const container = document.createElement('div')
    container.id = AD_CONTAINER_ID
    container.style.width = '100%'
    container.style.minHeight = '100px'
    activeNativeBanner = container
    activeNativeOwner = owner
    mount.appendChild(container)

    const script = document.createElement('script')
    script.async = true
    script.setAttribute('data-cfasync', 'false')
    script.src = AD_SCRIPT_SRC
    script.onload = () => {
      if (!disposed) setScriptState('loaded')
    }
    script.onerror = () => {
      if (!disposed) setScriptState('error')
    }
    mount.appendChild(script)

    const release = () => {
      if (activeNativeOwner !== owner) return
      disposed = true
      script.onload = null
      script.onerror = null
      script.remove()
      container.remove()
      activeNativeBanner = null
      activeNativeOwner = null
      activeNativeRelease = null
    }
    activeNativeRelease = release

    return () => {
      release()
      if (priority) {
        activeNativePriority = false
        window.dispatchEvent(new CustomEvent(NATIVE_PRIORITY_EVENT, { detail: false }))
      }
    }
  }, [paused, priority])

  return (
    <div
      ref={mountRef}
      className={className}
      style={{
        width: '100%',
        minHeight: 100,
        display: 'block',
        overflow: 'visible',
        background,
        ...style,
      }}
      data-adsterra-script-state={scriptState}
      aria-label="Sponsored advertisement"
    />
  )
}
