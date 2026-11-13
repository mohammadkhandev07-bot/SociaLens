'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * SociaLens currently has one approved Adsterra Native Banner code.
 * The provider's snippet uses a fixed container ID, so only one instance
 * may be mounted at a time. Render the snippet directly in the page body.
 */
const AD_SCRIPT_SRC = 'https://bicea.org/21/881f5b6409710d9bc02f368e7ca74528'
const AD_CONTAINER_ID = 'container-881f5b6409710d9bc02f368e7ca74528'

let activeNativeBanner: HTMLElement | null = null

interface NativeAdUnitProps {
  className?: string
  style?: React.CSSProperties
  background?: string
}

export function NativeAdUnit({ className, style, background = 'transparent' }: NativeAdUnitProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [scriptState, setScriptState] = useState<'loading' | 'loaded' | 'error' | 'duplicate'>('loading')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // Do not execute the provider's fixed-ID tag more than once concurrently.
    if (activeNativeBanner) {
      setScriptState('duplicate')
      return
    }

    let disposed = false
    const container = document.createElement('div')
    container.id = AD_CONTAINER_ID
    container.style.width = '100%'
    container.style.minHeight = '100px'
    activeNativeBanner = container
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

    return () => {
      disposed = true
      script.onload = null
      script.onerror = null
      script.remove()
      container.remove()
      if (activeNativeBanner === container) activeNativeBanner = null
    }
  }, [])

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
