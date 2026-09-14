/**
 * Interleaves an 'ad' marker into a list of real items at randomized gaps,
 * so an ad never lands in the same rhythm twice (sometimes after 3 items,
 * sometimes 5, sometimes 8) - deliberately not a fixed "every N" pattern,
 * which is what makes a pattern noticeable and easy to tune out.
 *
 * minGap/maxGap are inclusive. Returns a new array mixing real items with
 * the string 'ad' at the chosen positions - map over it and render your
 * own ad component wherever you see 'ad'.
 */
export function interleaveAds<T>(items: T[], minGap = 3, maxGap = 8): (T | 'ad')[] {
  const result: (T | 'ad')[] = []
  let sinceLastAd = 0
  let nextGap = randomGap(minGap, maxGap)

  for (const item of items) {
    result.push(item)
    sinceLastAd++
    if (sinceLastAd >= nextGap) {
      result.push('ad')
      sinceLastAd = 0
      nextGap = randomGap(minGap, maxGap)
    }
  }
  return result
}

function randomGap(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
