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
