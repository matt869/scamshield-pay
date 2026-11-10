import type { RedFlag } from "./types";

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "mark"; text: string; flagNumber: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Finds a quote in the message, ignoring case and differences in whitespace. */
export function findQuote(message: string, quote: string): [start: number, end: number] | null {
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const match = new RegExp(words.map(escapeRegExp).join("\\s+"), "iu").exec(message);
  return match ? [match.index, match.index + match[0].length] : null;
}

/**
 * Puts flags in reading order, by where each quote first appears in the message, so the marks
 * and the list share the numbers 1, 2, 3 down the page. A flag whose quote is missing, not found,
 * or overlaps an earlier mark cannot be marked: it goes last, with `quote` set to null.
 */
export function orderFlags(message: string, flags: RedFlag[]): Array<{ flag: RedFlag; quote: string | null }> {
  const located = flags
    .map((flag) => ({ flag, found: flag.quote ? findQuote(message, flag.quote) : null }))
    .sort((a, b) => (a.found?.[0] ?? Number.MAX_SAFE_INTEGER) - (b.found?.[0] ?? Number.MAX_SAFE_INTEGER));

  const marked: Array<{ flag: RedFlag; quote: string | null }> = [];
  const unmarked: Array<{ flag: RedFlag; quote: string | null }> = [];
  let lastEnd = -1;
  for (const { flag, found } of located) {
    if (found && found[0] >= lastEnd) {
      marked.push({ flag, quote: flag.quote });
      lastEnd = found[1];
    } else {
      unmarked.push({ flag, quote: null });
    }
  }
  return [...marked, ...unmarked];
}

/**
 * Splits the message into plain and marked runs. `quotes[i]` is marked as flag number i + 1.
 * A quote that overlaps an earlier one in the list is left unmarked, so the numbering stays
 * stable and a passage is never marked twice.
 */
export function segmentMessage(message: string, quotes: Array<string | null>): MessageSegment[] {
  const ranges: Array<{ start: number; end: number; flagNumber: number }> = [];
  quotes.forEach((quote, index) => {
    if (!quote) return;
    const found = findQuote(message, quote);
    if (!found) return;
    const [start, end] = found;
    if (ranges.some((range) => start < range.end && end > range.start)) return;
    ranges.push({ start, end, flagNumber: index + 1 });
  });
  ranges.sort((a, b) => a.start - b.start);

  const segments: MessageSegment[] = [];
  let cursor = 0;
  for (const { start, end, flagNumber } of ranges) {
    if (start > cursor) segments.push({ kind: "text", text: message.slice(cursor, start) });
    segments.push({ kind: "mark", text: message.slice(start, end), flagNumber });
    cursor = end;
  }
  if (cursor < message.length) segments.push({ kind: "text", text: message.slice(cursor) });
  return segments;
}
