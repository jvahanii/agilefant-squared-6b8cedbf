/**
 * A T-rex, the mark of a list kept in step with Jira. Drawn in the current
 * text colour, in a 24-unit box like the lucide icons beside it.
 */
export function TRexIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" className={className} aria-hidden="true">
      <path d="M12.5 2.5h8a1.5 1.5 0 0 1 1.5 1.5v4h-4v1h2.5v1.5H16V12h2.5v1.5H16.5V15L15 17v4h1.5v1.5h-3.5v-4.5l-1.5-1-1 2v2.5h1v1.5H8v-4.5l-1-2C5 15.5 3 16.5 1 18c1.5-4 4.5-6.5 8-7.5l2-.5V4a1.5 1.5 0 0 1 1.5-1.5Zm2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </svg>
  );
}
