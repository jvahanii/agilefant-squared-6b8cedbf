import { Megaphone } from "lucide-react";
import { linkifySegments } from "@/lib/publicBacklog";

/**
 * A notice shown above every public link, to whoever opens one.
 *
 * Data rather than markup, so replacing it or taking it down is an edit to one
 * constant. Each has an end: an event announced after it has happened is worse
 * than no announcement, and nobody should have to remember to come back and
 * delete it.
 */
export interface Announcement {
  paragraphs: string[];
  /** Shown until this moment, then not at all. */
  until: string;
}

export const CURRENT_ANNOUNCEMENT: Announcement | null = {
  paragraphs: [
    'Helsinki LeSS meetup is back, with Bas Vodde opening the series with "Secret measurement of healthy team dynamics" 🩺 Rumour has it this is better and more useful than any talk of the latest fad! ✨',
    "Tue 22nd, at Netlight Helsinki, Pohjoisesplanadi 33 A, doors open at 17, pizza 🍕 and something to drink, showtime around 18:00, close at 20ish.",
    "Enroll at https://lnkd.in/dTtRQVSV",
  ],
  // The end of the evening in Helsinki. The meetup closes around 20:00, and a
  // visitor opening a link that night is still better told than not.
  until: "2026-09-22T23:59:59+03:00",
};

export function PublicAnnouncement({
  announcement = CURRENT_ANNOUNCEMENT,
  now = Date.now(),
}: {
  announcement?: Announcement | null;
  now?: number;
}) {
  if (!announcement) return null;
  const until = new Date(announcement.until).getTime();
  if (Number.isNaN(until) || now > until) return null;

  return (
    <aside
      aria-label="Announcement"
      className="mb-6 flex gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm"
    >
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 space-y-1.5">
        {announcement.paragraphs.map((paragraph, i) => (
          <p key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
            {linkifySegments(paragraph).map((segment, j) =>
              segment.href ? (
                <a
                  key={j}
                  href={segment.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-medium text-primary underline underline-offset-2 hover:no-underline"
                >
                  {segment.text}
                </a>
              ) : (
                <span key={j}>{segment.text}</span>
              ),
            )}
          </p>
        ))}
      </div>
    </aside>
  );
}
