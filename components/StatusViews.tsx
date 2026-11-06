"use client";

import Link from "next/link";
import { useLanguage } from "./LanguageToggle";

export function LostView() {
  const { copy } = useLanguage();
  return (
    <div className="stack">
      <h1 className="page-title">{copy.status.notFoundTitle}</h1>
      <p>{copy.status.notFoundBody}</p>
      <div className="kit-actions">
        <Link className="button button-primary" href="/">
          {copy.nav.check}
        </Link>
        <Link className="button button-secondary" href="/help">
          {copy.nav.help}
        </Link>
      </div>
    </div>
  );
}

/** Shown when a page fails. Like a failed check, it must never read as reassurance. */
export function ErrorView({ onRetry }: { onRetry: () => void }) {
  const { copy } = useLanguage();
  return (
    <div className="stack">
      <h1 className="page-title">{copy.status.errorTitle}</h1>
      <p className="alert" role="alert">
        {copy.status.errorBody}
      </p>
      <div className="kit-actions">
        <button type="button" className="button button-primary" onClick={onRetry}>
          {copy.status.retry}
        </button>
        <Link className="button button-secondary" href="/help">
          {copy.nav.help}
        </Link>
      </div>
    </div>
  );
}
