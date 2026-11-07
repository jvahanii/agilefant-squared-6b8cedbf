/**
 * How the picker lists what a search found: a heading for each email or
 * career page, and under it a row for each posting, with its tick, labels,
 * cities and — for one about to be imported or already in the tree — stars
 * and a switch to mirror it.
 */
import { Globe, LinkIcon, Mail, MapPin } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { StarRating } from "@/components/StarRating";
import {
  careerPageLine,
  cityLine,
  deadlineLabel,
  gmailMessageUrl,
  isCareerPageRow,
  senderAddress,
  senderName,
  alsoInLabel,
  type CareerPageNote,
  type PreviewLink,
  type groupBySourceEmail,
} from "@/lib/gmailPreview";
import type { WorkItem } from "@/types/models";

type Group = ReturnType<typeof groupBySourceEmail>[number];

/**
 * The source email (or career page), above the jobs it produced. It reads as a
 * heading rather than a first row: solid bar, an envelope, and the subject in
 * its own weight — the postings beneath sit in from its edge. The subject
 * wraps rather than truncates, since a digest subject is long and what
 * identifies it sits at the end.
 */
export function GroupHeading({
  group,
  page,
  allChecked,
  alreadyIn,
  onTickAll,
}: {
  group: Group;
  /** Set when the rows came from a career page rather than an email. */
  page: CareerPageNote | undefined;
  allChecked: boolean;
  alreadyIn: string | null;
  onTickAll: (on: boolean) => void;
}) {
  const fromPage = isCareerPageRow(group);
  return (
    <div className="flex items-start gap-2 border-b bg-muted px-2 py-2">
      <Checkbox
        checked={allChecked}
        onCheckedChange={(c) => onTickAll(!!c)}
        className="mt-0.5"
        aria-label={`Select all ${group.links.length} from ${group.subject}`}
      />
      {fromPage ? (
        <Globe className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-semibold leading-snug break-words">{group.subject}</p>
        {fromPage ? (
          <p className="text-xs text-muted-foreground break-all">Career page · {page?.url ?? group.from}</p>
        ) : (
          <p className="text-xs text-muted-foreground break-words">
            {senderName(group.from)}
            {senderAddress(group.from) && <span className="break-all"> &lt;{senderAddress(group.from)}&gt;</span>}
            {group.date && ` · ${new Date(group.date).toLocaleString()}`}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {fromPage
            ? `${group.links.length} new job${group.links.length === 1 ? "" : "s"} from this page${
                page ? ` · ${careerPageLine(page)}` : ""
              }`
            : `${group.links.length} job${group.links.length === 1 ? "" : "s"} in this email${alreadyIn ? ` · ${alreadyIn}` : ""}`}
        </p>
      </div>
      {fromPage ? (
        page && (
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline shrink-0 text-muted-foreground hover:text-foreground"
            title="Open this career page"
          >
            Open page
          </a>
        )
      ) : (
        <a
          href={gmailMessageUrl(group.messageId)}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline shrink-0 text-muted-foreground hover:text-foreground"
          title="Open this email in Gmail"
        >
          Open in Gmail
        </a>
      )}
    </div>
  );
}

/** Stars and the mirror switch: for the item the import will make, or the one already in the tree. */
export interface RowExtras {
  /** For an unticked row whose posting is already imported: that item. */
  existing: WorkItem | undefined;
  /** The rating chosen for the item the import will make. */
  rating: number | undefined;
  onRate: (rating: number | undefined) => void;
  /** Where the rows switched on are mirrored; null when nowhere. */
  mirror: null | {
    label: string;
    /** Switched on — or, for an existing item, already mirrored there. */
    on: boolean;
    /** An existing item already mirrored: a mirror once made is not taken back here. */
    locked: boolean;
    onChange: (on: boolean) => void;
  };
  importing: boolean;
}

export function PostingRow({
  link,
  ticked,
  reasonUnticked,
  folded,
  onTick,
  extras,
}: {
  link: PreviewLink;
  ticked: boolean;
  /** Why the row is not going to be imported, when it is unticked for a reason. */
  reasonUnticked: string | null;
  /** The other emails that carried this posting, folded into this row. */
  folded: { count: number; subjects: string[] } | undefined;
  onTick: (on: boolean) => void;
  extras: RowExtras;
}) {
  const l = link;
  return (
    // Not a <label>: a click anywhere on one toggled the row, so reading a
    // cut-off line of cities unticked the posting it belonged to. The tick
    // follows the checkbox and the title line only.
    <div className="flex items-start gap-2 text-sm">
      <Checkbox checked={ticked} onCheckedChange={(c) => onTick(!!c)} className="mt-0.5" aria-label={l.title || l.url} />
      <span className="min-w-0 flex-1">
        {/* The whole employer and job name, never cut: it is what the decision
            to import rests on. The labels keep their place and the line wraps
            instead. */}
        <span className="flex cursor-pointer flex-wrap items-baseline gap-2 font-medium text-sm" onClick={() => onTick(!ticked)}>
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            // Opening the posting is not choosing it.
            onClick={(e) => e.stopPropagation()}
            className="break-words underline decoration-muted-foreground/50 hover:text-primary hover:decoration-primary"
          >
            {l.title}
          </a>
          <span className="flex shrink-0 items-baseline gap-2">
            <span
              className={`align-middle text-[10px] font-normal uppercase tracking-wide border rounded px-1 py-0.5 ${
                l.applicationsClosed ? "border-destructive/40 text-destructive" : l.deadline ? "" : "text-muted-foreground"
              }`}
            >
              {deadlineLabel(l)}
            </span>
            {l.alreadyImported && (
              // Its own colour: which list a posting is already in is the
              // thing worth spotting while scanning, and it read as one more
              // grey label.
              <span className="align-middle text-[10px] font-normal uppercase tracking-wide rounded px-1 py-0.5 border border-primary/40 bg-primary/10 text-primary">
                {l.alreadyIn ? `already in ${l.alreadyIn}` : "already imported"}
              </span>
            )}
            {l.alsoIn && (
              // A colour of its own again: on the shortlist, or applied for,
              // is not the same news as filed somewhere in the tree.
              <span className="align-middle text-[10px] font-normal uppercase tracking-wide rounded px-1 py-0.5 border border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                {l.alreadyImported ? "also in" : "already in"} {l.alsoIn}
              </span>
            )}
          </span>
        </span>
        {/* Why this row is not going to be imported. A row the reader unticked
            says so too, rather than leaving the line out and looking unticked
            for no reason. */}
        {!ticked && reasonUnticked && (
          <span className="block text-xs text-muted-foreground">Not selected: {reasonUnticked}. Tick it to import anyway.</span>
        )}
        {/* Two cities and a count, like the item's name; all of them on hover. */}
        {!!l.cities?.length && (
          <span className="block truncate text-xs text-foreground/80" title={l.cities.join(", ")}>
            <MapPin className="w-3 h-3 inline mr-1 text-muted-foreground" aria-hidden="true" />
            {cityLine(l.cities)}
          </span>
        )}
        <span className="block truncate text-xs text-muted-foreground">
          <LinkIcon className="w-3 h-3 inline mr-1" />
          {l.url}
        </span>
        {/* The emails folded into this row. Said plainly rather than shown as
            rows of their own: the same posting listed three times read as
            three jobs, and the import merges them into one item anyway. */}
        {folded && (
          <span className="block truncate text-xs text-muted-foreground" title={folded.subjects.join("\n")}>
            <Mail className="w-3 h-3 inline mr-1" aria-hidden="true" />
            {alsoInLabel(folded.count)}
          </span>
        )}
        {(ticked || extras.existing) && <RateAndMirror title={l.title || l.url} extras={extras} />}
      </span>
    </div>
  );
}

/**
 * A ticked row rates and mirrors the item the import will create. An unticked
 * row whose posting is already in the tree acts on that existing item instead
 * — no second item is made of it.
 */
function RateAndMirror({ title, extras }: { title: string; extras: RowExtras }) {
  const { existing, mirror, importing } = extras;
  return (
    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      <StarRating rating={existing ? existing.rating : extras.rating} onRate={extras.onRate} disabled={importing} label={title} />
      {/* Whether the import into the chosen list also mirrors this one.
          Independent of the rating, which travels with the item the import
          creates. For an existing item the switch mirrors it directly; a
          mirror once made is not taken back here. */}
      {mirror && (
        <span className="ml-2 flex items-center gap-1.5">
          <Switch
            checked={mirror.on}
            onCheckedChange={mirror.onChange}
            disabled={importing || mirror.locked}
            aria-label={`Mirror ${title} to ${mirror.label}`}
          />
          <span className="truncate">Mirror to {mirror.label}</span>
        </span>
      )}
    </span>
  );
}
