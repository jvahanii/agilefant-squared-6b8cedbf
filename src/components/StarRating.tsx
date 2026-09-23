import { Star } from "lucide-react";

/**
 * A work item's rating, one to five stars.
 *
 * Clicking a star sets that many; clicking the star a rated item already ends
 * on takes the rating away, so "no stars" stays reachable without a separate
 * control. An unrated item shows five empty outlines rather than nothing, so a
 * list of unrated items still says where to click.
 */
export function StarRating({
  rating,
  onRate,
  disabled = false,
  label,
  className = "",
}: {
  rating: number | undefined;
  onRate?: (rating: number | undefined) => void;
  disabled?: boolean;
  /** What is being rated, for readers who cannot see the row. */
  label: string;
  className?: string;
}) {
  const stars = [1, 2, 3, 4, 5];
  const readOnly = disabled || !onRate;
  return (
    <span
      className={`inline-flex shrink-0 items-center ${className}`}
      role="group"
      aria-label={`Rating for ${label}: ${rating ? `${rating} of 5` : "unrated"}`}
    >
      {stars.map((star) => {
        const filled = (rating ?? 0) >= star;
        return (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            // Clicking the star it already ends on clears it.
            onClick={(e) => {
              e.stopPropagation();
              onRate?.(rating === star ? undefined : star);
            }}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-pressed={filled}
            title={rating === star ? "Click again to remove the rating" : `Rate ${star} of 5`}
            className={`p-px leading-none ${readOnly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          >
            <Star
              className={`h-3.5 w-3.5 ${
                filled ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"
              }`}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </span>
  );
}
