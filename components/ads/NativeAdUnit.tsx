'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Only one Adsterra Native Banner code is currently approved for SociaLens.
 * Keep one live instance and use the provider's snippet directly in the page
 * body. Do not duplicate this fixed container ID or wrap the tag in an iframe.
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
  const [status, setStatus] = useState<'loading' | 'loaded' | 'unavailable'>('loading')

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    // Prevent simultaneous instances of the one approved ad code.
    if (activeNativeBanner) {
      setStatus('unavailable')
      return
    }

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
    script.onload = () => setStatus('loaded')
    script.onerror = () => setStatus('unavailable')
    mount.appendChild(script)

    return () => {
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
      data-adsterra-status={status}
      aria-label="Sponsored advertisement"
    />
  )
}
