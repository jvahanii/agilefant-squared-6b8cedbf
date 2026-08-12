import { parseIcons } from "@/lib/iconMap";

/**
 * Renders a title string with :shortcode: tokens replaced by emoji.
 * Pure presentational — no tooltip, no interaction.
 */
export function IconizedTitle({ title }: { title: string }) {
  const segments = parseIcons(title);
  return (
    <span className="inline-flex items-baseline gap-0">
      {segments.map((seg, i) =>
        seg.kind === "icon" ? (
          <span key={i} className="inline-block mx-[1px]" title={`:${seg.shortcode}:`}>
            {seg.emoji}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </span>
  );
}