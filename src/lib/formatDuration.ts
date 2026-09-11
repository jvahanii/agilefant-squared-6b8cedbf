/**
 * "1h 30m", "45m", "2h". Lives on its own so the public page can show time
 * without pulling in TimeLogDialog and everything it imports.
 */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
