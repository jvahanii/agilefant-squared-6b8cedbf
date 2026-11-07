/**
 * One run of a saved Gmail search, from the moment the picker is shown: the
 * rows it finds, which of them are ticked, and how far it has got.
 *
 * A run is four steps, each filling in the rows the one before put on screen:
 *
 *  1. the mail — the postings the alerts link to;
 *  2. the career pages the search names (job searches) — their new positions;
 *  3. the postings themselves, read by the server — deadlines, closed, cities;
 *  4. the postings the server is refused (Jobly), read through the browser's
 *     posting reader, for a superuser who has it.
 *
 * The rows are usable from the end of step 1; until step 3 is done the
 * progress bar says how much is left and nothing can be imported. Step 4 runs
 * on with the list already usable.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import {
  distinctJobs,
  emailCountOf,
  foundWhere,
  pageCountOf,
  repeatedRows,
  rowKey,
  sameJobRows,
  startingReason,
  uncheckedReason,
  type CareerPageNote,
  type PreviewLink,
} from "@/lib/gmailPreview";
import { explainGmailError } from "@/lib/gmailOAuth";
import { callGmail, type ImportMode, type RunnableSearch } from "@/lib/gmailConnector";
import { postingReaderAvailable, readableInBrowser, readPostingFacts } from "@/lib/postingReader";

/** Postings read per posting_facts call — the server accepts at most this many. */
const POSTINGS_PER_CALL = 6;
/** Postings read per search, as the server capped it when it read them itself. */
const MAX_POSTINGS_READ = 40;

/**
 * How far along the search is, out of a hundred, when each part begins.
 * Reading Gmail and the career pages take a few seconds between them and say
 * nothing of how far they have got, so they are given a small fixed share;
 * the postings are read a few at a time and move the bar the rest of the way.
 */
export const SEARCH_PROGRESS = { gmail: 8, pages: 22, postings: 30 } as const;

type PostingFacts = { url: string; deadline: string | null; applicationsClosed: boolean; cities?: string[] | null };

/** What the steps of a run need from the picker around them. */
interface Run {
  organizationId: string;
  search: RunnableSearch;
  mode: ImportMode;
  /** The picker has gone, or started over: stop, and set nothing. */
  cancelled: () => boolean;
  setStage: (stage: string) => void;
  setProgress: (progress: number | null) => void;
  /** Put these rows on screen, ticking them as startingReason says. */
  show: (rows: PreviewLink[]) => void;
}

/** "Found 5 jobs in 2 emails." — so far. */
const foundSoFar = (rows: PreviewLink[]) =>
  `Found ${distinctJobs(rows)} job${distinctJobs(rows) === 1 ? "" : "s"} ${foundWhere(emailCountOf(rows), pageCountOf(rows))}.`;

/** Step 1: the postings the alerts link to, newest email first. */
async function readMail(run: Run): Promise<PreviewLink[]> {
  run.setStage("Searching Gmail…");
  const res = await callGmail<{ links: PreviewLink[] }>({
    action: "preview",
    organizationId: run.organizationId,
    query: run.search.query,
    maxMessages: 25,
    mode: run.mode,
    backlogId: run.search.backlog_id,
    // The whole tree, so a posting already filed into another list counts as
    // one that has been seen.
    treeId: run.search.tree_id,
    // The postings are read in step 3, batch by batch, so the wait can say how
    // far it has got instead of sitting on "Searching Gmail…".
    readPostings: false,
  });
  return [...res.links].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
}

/**
 * Step 2: the career pages the search names, after the mail — the positions on
 * them that are neither in the tree nor left by an earlier run. An extra: if
 * the pages cannot be read, the mail is still worth showing.
 */
async function readCareerPages(run: Run, rows: PreviewLink[]): Promise<{ rows: PreviewLink[]; pages: CareerPageNote[] }> {
  run.setStage(rows.length > 0 ? `${foundSoFar(rows)} Checking career pages…` : "Checking career pages…");
  try {
    const fromPages = await callGmail<{ pages?: CareerPageNote[]; links?: PreviewLink[] }>({
      action: "career_pages",
      organizationId: run.organizationId,
      queryId: run.search.id,
      treeId: run.search.tree_id,
    });
    return { rows: [...rows, ...(fromPages?.links ?? [])], pages: fromPages?.pages ?? [] };
  } catch (e) {
    // A server that does not know the action yet has no pages to read.
    if (!run.cancelled() && !/unknown action/i.test((e as Error).message)) {
      toast({
        title: "The career pages could not be read",
        description: `${(e as Error).message} The emails are listed as usual.`,
        variant: "destructive",
      });
    }
    return { rows, pages: [] };
  }
}

/**
 * Step 3: deadline and closed, from each posting the mail left undated — the
 * reading the server used to do inside the search, and to the same limit.
 * Jobly always refuses the server, so it is left to step 4 rather than waited
 * on here. Returns the rows with what the postings said, or null if the run
 * was cancelled meanwhile.
 */
async function readPostingsOnServer(run: Run, rows: PreviewLink[]): Promise<PreviewLink[] | null> {
  const found = foundSoFar(rows);
  // Read while the deadline or the city is unknown: a mail that states the
  // date still leaves the page as the only place that says where, and the
  // dialog shows it. A city the mail gave (Työmarkkinatori) needs no read.
  //
  // Deadlines first, cities with what is left, and the same cap over both — as
  // the server queues them. The Finnish boards give a date and never a city,
  // so one undivided list spends the whole budget on cities and leaves the
  // genuinely undated postings unread.
  const readable = rows.filter((l) => !l.applicationsClosed && !readableInBrowser(l.url));
  const toRead = [
    ...new Map(
      [...readable.filter((l) => !l.deadline), ...readable.filter((l) => l.deadline && l.cities === undefined)].map(
        (l) => [l.url, { url: l.url, date: l.date }],
      ),
    ).values(),
  ].slice(0, MAX_POSTINGS_READ);
  for (let at = 0; at < toRead.length; at += POSTINGS_PER_CALL) {
    run.setStage(`${found} Reading job postings for deadlines and cities… ${at}/${toRead.length}`);
    run.setProgress(SEARCH_PROGRESS.postings + ((100 - SEARCH_PROGRESS.postings) * at) / toRead.length);
    let facts: PostingFacts[];
    try {
      ({ facts } = await callGmail<{ facts: PostingFacts[] }>({
        action: "posting_facts",
        organizationId: run.organizationId,
        links: toRead.slice(at, at + POSTINGS_PER_CALL),
      }));
    } catch {
      // Deadlines are a nicety here; the import reads them again anyway.
      break;
    }
    if (run.cancelled()) return null;
    const byUrl = new Map(facts.map((f) => [f.url, f]));
    rows = rows.map((l) => {
      const f = byUrl.get(l.url);
      if (!f) return l;
      return {
        ...l,
        ...(!l.deadline && f.deadline ? { deadline: f.deadline } : {}),
        ...(f.applicationsClosed ? { applicationsClosed: true } : {}),
        // Carried to the import, so it need not read the page again. A city
        // already known stands: the mail named it, or the career page the
        // posting is listed on did.
        ...(Array.isArray(f.cities) && l.cities === undefined ? { cities: f.cities } : {}),
      };
    });
    // What these postings said, on their rows now rather than at the end.
    run.show(rows);
  }
  return run.cancelled() ? null : rows;
}

export function useSearchRun({
  search,
  mode,
  organizationId,
  canReadInBrowser,
  alsoInByUrl,
  onClose,
}: {
  search: RunnableSearch;
  mode: ImportMode;
  organizationId: string;
  /** Whether postings the server is refused may be read through the browser. */
  canReadInBrowser: boolean;
  /** The other list each posting is already in (shortlist, applied), by URL. */
  alsoInByUrl: Map<string, string>;
  /** Called when the search fails. */
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  /** The search came back empty — said in place of the list. */
  const [nothingFound, setNothingFound] = useState(false);
  /** What the search is doing, for the line shown while any of it is under way. */
  const [stage, setStage] = useState("Searching Gmail…");
  /**
   * How far the search has got, out of a hundred — or null once all of it is
   * done. The list is on screen from the moment the mail has been read; the
   * career pages and the postings fill it in after that, and until they have
   * the bar says how much is left and nothing can be imported.
   */
  const [progress, setProgress] = useState<number | null>(SEARCH_PROGRESS.gmail);
  const [preview, setPreview] = useState<PreviewLink[]>([]);
  /** The career pages this run read, with what each had to say. */
  const [pages, setPages] = useState<CareerPageNote[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  /** Step 4's progress, while it is under way. */
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  /** Rows ticked or unticked by hand, which a late answer must not overrule. */
  const touched = useRef(new Set<string>());
  /**
   * Rows unticked by hand. A row unticked for a reason of its own says which;
   * one unticked here used to say nothing at all, and read as unticked for no
   * reason. State rather than the ref above, because the row has to re-render.
   */
  const [untickedByHand, setUntickedByHand] = useState<Record<string, boolean>>({});
  /** The latest of alsoInByUrl, for the run to read as it puts rows on screen. */
  const alsoInRef = useRef(alsoInByUrl);
  alsoInRef.current = alsoInByUrl;
  /** The other list a row's posting is in now, or null; job searches only. */
  const whereElse = (l: PreviewLink) => alsoInRef.current.get(l.url) ?? null;

  /** Tick or untick rows, remembering that the reader did it. */
  const chooseRows = (keys: string[], on: boolean) => {
    keys.forEach((k) => touched.current.add(k));
    setSelected((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = on;
      return next;
    });
    setUntickedByHand((prev) => {
      const next = { ...prev };
      for (const k of keys) {
        if (on) delete next[k];
        else next[k] = true;
      }
      return next;
    });
  };

  /** Untick these rows, unless the reader has ticked or unticked them by hand. */
  const untickUntouched = (keys: string[]) =>
    setSelected((prev) => {
      const next = { ...prev };
      for (const key of keys) if (!touched.current.has(key)) next[key] = false;
      return next;
    });

  useEffect(() => {
    let cancelled = false;
    const run: Run = {
      organizationId,
      search,
      mode,
      cancelled: () => cancelled,
      setStage,
      setProgress,
      // The rows go on screen as soon as there are any, and again each time
      // something is learnt about them: first as the mail gave them, then with
      // the career pages' jobs, then with what each posting says. They used to
      // wait for all of it — which is most of the wait, and none of it needed
      // to read the list.
      //
      // Anything startingReason names starts unchecked — already in the tree,
      // no longer accepting applications, past its closing date, or a repeat
      // of a posting another email already lists. They stay importable on
      // purpose, and the row says which it is. A row the reader has ticked or
      // unticked by hand keeps what they chose.
      //
      // Each row comes with the other list its posting is already in, if any
      // (see the effect below). Told here as well as there: the rows put on
      // screen here would otherwise replace the ones that effect has just told,
      // and when both land in one render React sees the list unchanged and the
      // effect never runs again — the row lost its "already in" for good.
      show: (shown) => {
        const rows = mode === "jobs" ? shown.map((l) => ((l.alsoIn ?? null) === whereElse(l) ? l : { ...l, alsoIn: whereElse(l) })) : shown;
        const repeats = new Map([...sameJobRows(rows), ...repeatedRows(rows)]);
        setPreview(rows);
        setSelected((prev) =>
          Object.fromEntries(
            rows.map((l) => {
              const key = rowKey(l);
              return [key, touched.current.has(key) ? !!prev[key] : startingReason(l, repeats) === null];
            }),
          ),
        );
        setLoading(false);
      },
    };

    /**
     * Step 4: postings the server was refused (Jobly), read through the
     * browser when the posting reader extension is there. Rows gain their
     * deadline and city as each answer arrives.
     */
    const readPostingsInBrowser = async (rows: PreviewLink[]) => {
      // Read while the city is unknown, even with a date from the mail: the
      // server cannot read these pages at import, so this is the only chance
      // to learn where the job is.
      const urls = [
        ...new Set(rows.filter((l) => l.cities === undefined && !l.applicationsClosed && readableInBrowser(l.url)).map((l) => l.url)),
      ];
      if (urls.length === 0 || !(await postingReaderAvailable())) return;
      if (cancelled) return;
      setReading({ done: 0, total: urls.length });
      for (const [i, url] of urls.entries()) {
        const reference = rows.find((l) => l.url === url)?.date || new Date().toISOString();
        const facts = await readPostingFacts(url, reference);
        if (cancelled) return;
        if (facts.cities) {
          setPreview((prev) => prev.map((l) => (l.url === url ? { ...l, cities: facts.cities } : l)));
        }
        if (facts.deadline || facts.closed) {
          setPreview((prev) =>
            prev.map((l) =>
              l.url === url
                ? { ...l, deadline: l.deadline ?? facts.deadline, applicationsClosed: l.applicationsClosed || !!facts.closed }
                : l,
            ),
          );
          // What was just learnt can make the row one to leave alone: closed,
          // or a closing date already past. Never overrules a row the reader
          // has ticked or unticked by hand.
          if (uncheckedReason({ ...facts, deadline: facts.deadline, applicationsClosed: facts.closed })) {
            untickUntouched(rows.filter((l) => l.url === url).map(rowKey));
          }
        }
        setReading({ done: i + 1, total: urls.length });
      }
      setReading(null);
    };

    (async () => {
      try {
        let rows = await readMail(run);
        if (cancelled) return;
        if (rows.length > 0) run.show(rows);
        setProgress(SEARCH_PROGRESS.pages);

        if (mode === "jobs") {
          const fromPages = await readCareerPages(run, rows);
          if (cancelled) return;
          setPages(fromPages.pages);
          rows = fromPages.rows;
          if (rows.length > 0) run.show(rows);
        }
        if (rows.length === 0) {
          // Nothing to pick — usually because every alert has been read. Said
          // in place, with a way out, rather than by closing on a small toast:
          // a dialog that vanishes looks like one that failed.
          setNothingFound(true);
          setProgress(null);
          setLoading(false);
          return;
        }
        setProgress(SEARCH_PROGRESS.postings);

        if (mode === "jobs") {
          const read = await readPostingsOnServer(run, rows);
          if (read === null) return;
          rows = read;
        }
        run.show(rows);
        setProgress(null);

        if (canReadInBrowser) await readPostingsInBrowser(rows);
      } catch (e) {
        if (cancelled) return;
        const message = (e as Error).message;
        toast({
          title: message.includes("gmail_not_connected") ? "Connect Gmail again" : "Gmail search failed",
          // An expired connection lands here too, so say where the fix is.
          description: message.includes("gmail_not_connected")
            ? "Gmail is not connected, or the connection has expired. Reconnect it under Bells & Whistles → Your Gmail account."
            : explainGmailError(message),
          variant: "destructive",
        });
        onClose();
      } finally {
        if (!cancelled) {
          setLoading(false);
          setProgress(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // One search per mount: the caller remounts to run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each row is told whether its posting is in one of the lists beside the
  // tree (the shortlist, the jobs applied for), and kept told: they are on
  // screen behind this dialog and can change while it is open. A row found to
  // be there that is not in the import tree any more would be imported as a
  // second item, so it is unticked — unless the reader has already ticked or
  // unticked it by hand.
  useEffect(() => {
    if (mode !== "jobs") return;
    const where = whereElse;
    const stale = preview.filter((l) => (l.alsoIn ?? null) !== where(l));
    if (stale.length === 0) return;
    setPreview((prev) => prev.map((l) => ((l.alsoIn ?? null) === where(l) ? l : { ...l, alsoIn: where(l) })));
    const found = stale.filter((l) => where(l) && !l.alreadyImported).map(rowKey);
    if (found.length > 0) untickUntouched(found);
  }, [mode, preview, alsoInByUrl]);

  return { loading, nothingFound, stage, progress, preview, pages, selected, untickedByHand, reading, chooseRows };
}
