/**
 * DecoratorBadges - Renders badge decorators from addon metadata.
 *
 * Displays text badges with optional colors.
 * Used alongside content, not as a wrapper.
 */

interface BadgeInfo {
  text: string;
  color?: string;
  source: string;
}

interface DecoratorBadgesProps {
  /** Array of badge info from getDecorators() */
  badges: BadgeInfo[];
  /** Additional CSS classes */
  className?: string;
}

export function DecoratorBadges({ badges, className }: DecoratorBadgesProps) {
  if (badges.length === 0) return null;

  return (
    <div className={className}>
      {badges.map((badge, idx) => (
        <span
          key={idx}
          className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300"
          style={badge.color ? { backgroundColor: `${badge.color}30`, color: badge.color } : undefined}
          title={`Source: ${badge.source}`}
        >
          {badge.text}
        </span>
      ))}
    </div>
  );
}
