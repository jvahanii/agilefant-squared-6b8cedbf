import { parseDuration } from "@/lib/parseDuration";
import { formatDuration } from "@/lib/formatDuration";

/**
 * How a duration field will be read, shown under it before anything is saved.
 *
 * A plain "45" once meant 45 hours, and entries of 30h and 45h went in unseen,
 * typed as minutes. The rule is friendlier now, but any rule can surprise
 * someone; saying what it made of the input costs one line and catches the
 * slip while it is still a keystroke away from being fixed.
 */
export function DurationReading({ input }: { input: string }) {
  if (!input.trim()) return null;
  const minutes = parseDuration(input);
  return (
    <p className="text-[11px] text-muted-foreground" aria-live="polite">
      {minutes ? `= ${formatDuration(minutes)}` : "Not a duration — try 45, 1.5 or 1h 30m"}
    </p>
  );
}
