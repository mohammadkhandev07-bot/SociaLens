interface VerifiedBadgeProps {
  type: 'blue' | 'yellow' | null | undefined
  className?: string
}

// Yellow is reserved for SociaLensOfficial specifically - it's set once,
// directly in the database, and nothing in the admin panel can hand out
// A second one. Blue is the one admins can grant to anyone else.
export function VerifiedBadge({ type, className = 'text-sm' }: VerifiedBadgeProps) {
  if (!type) return null
  return (
    <span className={type === 'yellow' ? `text-yellow-500 ${className}` : `text-cyan-500 ${className}`}>
      ✓
    </span>
  )
}
