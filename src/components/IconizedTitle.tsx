import type { ReactNode } from "react";
import { parseIcons } from "@/lib/iconMap";

/**
 * Renders a title string with :shortcode: tokens replaced by emoji.
 * Pure presentational — no tooltip, no interaction.
 *
 * `renderText` lets a caller draw the plain stretches itself — the public
 * page marks the parts a visitor's filter matched. Without it they are text.
 */
export function IconizedTitle({ title, renderText }: { title: string; renderText?: (text: string) => ReactNode }) {
  const segments = parseIcons(title);
  return (
    <span className="inline-flex items-baseline gap-0">
      {segments.map((seg, i) =>
        seg.kind === "icon" ? (
          <span key={i} className="inline-block mx-[1px]" title={`:${seg.shortcode}:`}>
            {seg.emoji}
          </span>
        ) : (
          <span key={i}>{renderText ? renderText(seg.value) : seg.value}</span>
        ),
      )}
    </span>
  );
}