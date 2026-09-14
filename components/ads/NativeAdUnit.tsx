'use client'

import { useMemo, useState } from 'react'

// Adsterra's snippet is designed for one ad slot per page - the container
// id it looks for is fixed to this exact string. SociaLens needs several
// independent ad slots live at once (a Reels feed, a Home feed, Explore,
// Stories can each have their own), so instead of dropping this snippet
// straight into the page, each slot gets its own tiny same-document
// iframe with a fresh copy of this exact HTML inside it. Each iframe has
// its own document, so `getElementById` inside it only ever finds the one
// container that belongs to it - no collisions, no "only the first one on
// the page actually works" problem, and the ad network's own script/CSS
// never touches SociaLens's real DOM at all.
const AD_SCRIPT_SRC = 'https://pl31324966.profitableratecpmnetwork.com/881f5b6409710d9bc02f368e7ca74528/invoke.js'
const AD_CONTAINER_ID = 'container-881f5b6409710d9bc02f368e7ca74528'

interface NativeAdUnitProps {
  className?: string
  style?: React.CSSProperties
  /** Background behind the ad while it loads/if the network returns nothing -
   * match whatever surface it's sitting on (a reel is black, a post card is
   * the app's card background, etc.) so there's never a flash of mismatched
   * color. */
  background?: string
}

export function NativeAdUnit({ className, style, background = 'transparent' }: NativeAdUnitProps) {
  const [loaded, setLoaded] = useState(false)

  const srcDoc = useMemo(() => `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  html, body { margin: 0; padding: 0; background: ${background}; overflow: hidden; }
  #${AD_CONTAINER_ID} { width: 100%; }
  img { max-width: 100%; }
</style>
</head>
<body>
<div id="${AD_CONTAINER_ID}"></div>
<script async data-cfasync="false" src="${AD_SCRIPT_SRC}"></script>
</body>
</html>`, [])

  return (
    <iframe
      srcDoc={srcDoc}
      className={className}
      style={{ width: '100%', border: 'none', display: 'block', background, ...style }}
      scrolling="no"
      loading="lazy"
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-forms"
      title="Sponsored"
      onLoad={() => setLoaded(true)}
      aria-hidden={!loaded}
    />
  )
}
