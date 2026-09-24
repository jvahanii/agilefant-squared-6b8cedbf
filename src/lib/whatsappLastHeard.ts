import { formatDistanceStrict } from "date-fns";

/**
 * What the WhatsApp integration says about when its phone last sent anything.
 *
 * The forwarding runs in MacroDroid on someone's phone; switched off, it said
 * nothing, and for nine days the list simply went quiet. This is only a fact —
 * no warning colour — because the phone sends only when someone writes in the
 * group: a quiet group and a silent phone look exactly alike from here. Whoever
 * knows the group has been busy will see the difference.
 */
export function whatsappLastHeard(lastReceivedAt: string | null | undefined, now: Date = new Date()): string {
  if (!lastReceivedAt) return "Not heard from the phone yet";
  const at = new Date(lastReceivedAt);
  if (Number.isNaN(at.getTime())) return "Not heard from the phone yet";
  // A minute's clock difference between phone, server and browser can put the
  // time a moment in the future; that is "just now", not "in 1 second".
  if (now.getTime() - at.getTime() < 60_000) return "Last heard from the phone just now";
  return `Last heard from the phone ${formatDistanceStrict(at, now)} ago`;
}
