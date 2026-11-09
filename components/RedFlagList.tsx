"use client";

import { Fragment } from "react";
import { findQuote, segmentMessage } from "@/lib/highlight";
import type { RedFlag } from "@/lib/types";
import { useLanguage } from "./LanguageToggle";

/**
 * The message exactly as received, with numbered marks keyed to the list beside it. Everything
 * here is rendered as plain text: links in a scam message must never become clickable.
 */
export function MarkedMessage({
  message,
  quotes,
  label,
}: {
  message: string;
  quotes: Array<string | null>;
  label: string;
}) {
  const { copy } = useLanguage();
  return (
    <figure className="marked-message">
      <figcaption>{label}</figcaption>
      <blockquote>
        {segmentMessage(message, quotes).map((segment, index) =>
          segment.kind === "text" ? (
            <Fragment key={index}>{segment.text}</Fragment>
          ) : (
            <mark key={index}>
              {segment.text}
              <sup className="mark-number" aria-hidden="true">
                {segment.flagNumber}
              </sup>
              <span className="visually-hidden"> ({copy.result.markLabel(segment.flagNumber)})</span>
            </mark>
          ),
        )}
      </blockquote>
    </figure>
  );
}

export function RedFlagList({
  message,
  flags,
  reportLanguage,
}: {
  message: string;
  flags: RedFlag[];
  reportLanguage: string;
}) {
  const { copy } = useLanguage();
  // Numbered in reading order, so the marks run 1, 2, 3 down the message. Signs that cannot be
  // pointed at in the message come last.
  const ordered = flags
    .map((flag) => ({ flag, at: flag.quote ? (findQuote(message, flag.quote)?.[0] ?? null) : null }))
    .sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER));
  const quotes = ordered.map(({ flag, at }) => (at === null ? null : flag.quote));

  return (
    <section className="findings">
      <div className="findings-message">
        <MarkedMessage message={message} quotes={quotes} label={copy.result.yourMessage} />
      </div>
      <div className="findings-list">
        <h2>{copy.result.whatWeFound}</h2>
        {flags.length === 0 ? (
          <p>{copy.result.noFlags}</p>
        ) : (
          <ol className="flag-list" lang={reportLanguage}>
            {ordered.map(({ flag }, index) => (
              <li key={index}>
                <span className="flag-number" aria-hidden="true">
                  {index + 1}
                </span>
                <div>
                  <h3>{flag.title}</h3>
                  <p>{flag.explanation}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
