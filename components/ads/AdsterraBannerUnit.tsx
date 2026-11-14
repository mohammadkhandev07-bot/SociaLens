'use client'

import { useEffect, useRef, useState } from 'react'

export type AdsterraBannerSize = '300x250' | '320x50' | '468x60' | '728x90'

const BANNER_CONFIG: Record<AdsterraBannerSize, { key: string; width: number; height: number }> = {
  '300x250': { key: '5a5d4c69ffe0f94dec2425369d6625be', width: 300, height: 250 },
  '320x50': { key: '4f2064563ed2e70d95d496c9c86f753f', width: 320, height: 50 },
  '468x60': { key: '9c6dbc532efe8f7d2fc85c29c8416918', width: 468, height: 60 },
  '728x90': { key: '54d64196ac81fac2a3ec240eb95b1ae2', width: 728, height: 90 },
}

let activeBannerKey: string | null = null
let activeBannerOwner: symbol | null = null
let activeBannerPriority = false
let activeBannerRelease: (() => void) | null = null
const BANNER_PRIORITY_EVENT = 'socialens:display-ad-priority'

interface AdsterraBannerUnitProps {
  size: AdsterraBannerSize
  className?: string
  priority?: boolean
}

export function AdsterraBannerUnit({ size, className = '', priority = false }: AdsterraBannerUnitProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error' | 'duplicate'>('loading')
  const [paused, setPaused] = useState(false)
  const config = BANNER_CONFIG[size]

  useEffect(() => {
    const handlePriority = (event: Event) => {
      if (priority) return
      setPaused((event as CustomEvent<boolean>).detail)
    }
    window.addEventListener(BANNER_PRIORITY_EVENT, handlePriority)
    if (!priority && activeBannerPriority) setPaused(true)
    return () => window.removeEventListener(BANNER_PRIORITY_EVENT, handlePriority)
  }, [priority])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    if (paused || (!priority && activeBannerPriority)) return

    if (priority) {
      activeBannerPriority = true
      window.dispatchEvent(new CustomEvent(BANNER_PRIORITY_EVENT, { detail: true }))
      activeBannerRelease?.()
    }

    if (activeBannerKey) {
      setStatus('duplicate')
      return
    }

    setStatus('loading')
    let disposed = false
    const owner = Symbol('display-ad')
    activeBannerOwner = owner
    activeBannerKey = config.key

    const wrapper = document.createElement('div')
    wrapper.style.width = `${config.width}px`
    wrapper.style.height = `${config.height}px`
    wrapper.style.maxWidth = '100%'
    wrapper.style.margin = '0 auto'
    wrapper.style.overflow = 'hidden'
    mount.appendChild(wrapper)

    ;(window as any).atOptions = {
      key: config.key,
      format: 'iframe',
      height: config.height,
      width: config.width,
      params: {},
    }

    const script = document.createElement('script')
    script.async = true
    script.src = `https://bicea.org/22/${config.key}`
    script.onload = () => {
      if (!disposed) setStatus('loaded')
    }
    script.onerror = () => {
      if (!disposed) setStatus('error')
    }
    wrapper.appendChild(script)

    const release = () => {
      if (activeBannerOwner !== owner) return
      disposed = true
      script.onload = null
      script.onerror = null
      script.remove()
      wrapper.remove()
      activeBannerKey = null
      activeBannerOwner = null
      activeBannerRelease = null
    }
    activeBannerRelease = release

    return () => {
      release()
      if (priority) {
        activeBannerPriority = false
        window.dispatchEvent(new CustomEvent(BANNER_PRIORITY_EVENT, { detail: false }))
      }
    }
  }, [config.key, config.width, config.height, paused, priority])

  return (
    <div
      ref={mountRef}
      className={`w-full flex justify-center overflow-hidden ${className}`}
      data-adsterra-banner={size}
      data-adsterra-status={status}
      aria-label="Sponsored advertisement"
    />
  )
}

export function ResponsiveAdsterraBanner({ className = '' }: { className?: string }) {
  const [size, setSize] = useState<AdsterraBannerSize | null>(null)

  useEffect(() => {
    const chooseSize = () => {
      const width = window.innerWidth
      setSize(width < 640 ? '320x50' : width < 1024 ? '468x60' : '728x90')
    }
    chooseSize()
    window.addEventListener('resize', chooseSize)
    return () => window.removeEventListener('resize', chooseSize)
  }, [])

  if (!size) return <div className={`w-full min-h-[50px] ${className}`} />
  return <AdsterraBannerUnit size={size} className={className} />
}
