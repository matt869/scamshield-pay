"use client";

import { useState } from "react";
import { useLanguage } from "./LanguageToggle";

/** Uses the phone's own share menu where there is one, otherwise copies the link. */
export function ShareResult({ verdict, headline }: { verdict: string; headline: string }) {
  const { copy } = useLanguage();
  const [status, setStatus] = useState<string | null>(null);

  async function share() {
    const url = window.location.href;
    const text = copy.result.shareText(verdict, headline);
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "ScamShield Pay", text, url });
        return;
      } catch (error) {
        // Closing the share menu is a choice, not an error.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setStatus(copy.result.linkCopied);
    } catch {
      setStatus(url);
    }
  }

  return (
    <div className="share-result">
      <button type="button" className="button button-secondary" onClick={share}>
        {copy.result.share}
      </button>
      <p className="fine-print">{copy.result.shareNote}</p>
      {status && (
        <p className="confirmation" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
