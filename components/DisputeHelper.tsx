"use client";

import { type FormEvent, useState } from "react";
import { type DisputeDetails, type DisputeKit, type Language, PAYMENT_METHODS, type PaymentMethod } from "@/lib/types";
import { useLanguage } from "./LanguageToggle";

const EMPTY: DisputeDetails = {
  paymentMethod: "credit_card",
  institution: "",
  amount: "",
  paymentDate: "",
  recipient: "",
  whatHappened: "",
};

export function DisputeHelper({
  checkId,
  initialKit,
  initialKitLanguage,
}: {
  checkId: string;
  initialKit: DisputeKit | null;
  initialKitLanguage: Language | null;
}) {
  const { language, copy } = useLanguage();
  const [details, setDetails] = useState<DisputeDetails>(EMPTY);
  const [kit, setKit] = useState(initialKit);
  const [kitLanguage, setKitLanguage] = useState(initialKitLanguage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const text = copy.dispute;

  function update<K extends keyof DisputeDetails>(key: K, value: DisputeDetails[K]) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (details.whatHappened.trim().length < 10) return setError(text.tooShort);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId, language, details }),
      });
      const body = (await response.json().catch(() => ({}))) as { kit?: DisputeKit; error?: string };
      if (response.ok && body.kit) {
        setKit(body.kit);
        setKitLanguage(language);
        setCopied(false);
      } else if (body.error === "generation_limit") {
        setError(text.limit);
      } else if (body.error === "payment_required") {
        setError(text.notPaid);
      } else {
        setError(text.failed);
      }
    } catch {
      setError(text.failed);
    }
    setBusy(false);
  }

  async function copyLetter() {
    if (!kit) return;
    try {
      // The clipboard is unavailable on plain http and in some browsers, so failure is expected.
      await navigator.clipboard.writeText(`${kit.letter_subject}\n\n${kit.letter_body}`);
      setCopied(true);
    } catch {
      setError(text.copyFailed);
    }
  }

  return (
    <div className="stack-large">
      <form className="dispute-form" onSubmit={submit} noValidate>
        <h2>{text.formTitle}</h2>
        <p>{text.formBody}</p>

        <label htmlFor="payment-method">{text.paymentMethod}</label>
        <select
          id="payment-method"
          value={details.paymentMethod}
          onChange={(event) => update("paymentMethod", event.target.value as PaymentMethod)}
          disabled={busy}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {text.methods[method]}
            </option>
          ))}
        </select>

        <div className="field-row">
          <div>
            <label htmlFor="institution">{text.institution}</label>
            <input id="institution" maxLength={120} value={details.institution} disabled={busy} onChange={(event) => update("institution", event.target.value)} />
          </div>
          <div>
            <label htmlFor="amount">{text.amount}</label>
            <input id="amount" inputMode="decimal" maxLength={40} value={details.amount} disabled={busy} onChange={(event) => update("amount", event.target.value)} />
          </div>
          <div>
            <label htmlFor="payment-date">{text.paymentDate}</label>
            <input id="payment-date" maxLength={40} value={details.paymentDate} disabled={busy} onChange={(event) => update("paymentDate", event.target.value)} />
          </div>
          <div>
            <label htmlFor="recipient">{text.recipient}</label>
            <input id="recipient" maxLength={200} value={details.recipient} disabled={busy} onChange={(event) => update("recipient", event.target.value)} />
          </div>
        </div>

        <label htmlFor="what-happened">{text.whatHappened}</label>
        <p id="what-happened-hint" className="hint">
          {text.whatHappenedHint}
        </p>
        <textarea
          id="what-happened"
          rows={6}
          maxLength={3000}
          value={details.whatHappened}
          aria-describedby="what-happened-hint"
          disabled={busy}
          onChange={(event) => update("whatHappened", event.target.value)}
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" type="submit" disabled={busy}>
          {kit ? text.regenerate : text.generate}
        </button>
        {busy && (
          <p className="status" role="status">
            <span className="pulse" aria-hidden="true" /> {text.generating}
          </p>
        )}
      </form>

      {kit && (
        <article className="kit" lang={kitLanguage ?? language}>
          <p className="note">{text.review}</p>

          <section className="letter">
            <h2>{text.letterTitle}</h2>
            <p>
              <strong>{text.subject}:</strong> {kit.letter_subject}
            </p>
            <div className="letter-body">{kit.letter_body}</div>
            <div className="kit-actions">
              <button type="button" className="button button-secondary" onClick={copyLetter}>
                {copied ? text.copied : text.copy}
              </button>
              <button type="button" className="button button-secondary" onClick={() => window.print()}>
                {text.print}
              </button>
            </div>
          </section>

          <section>
            <h2>{text.scriptTitle}</h2>
            <p>{text.scriptIntro}</p>
            <ol className="script-list">
              {kit.call_script.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ol>
          </section>

          <section>
            <h2>{text.evidenceTitle}</h2>
            <ul className="plain-list">
              {kit.evidence_checklist.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>
        </article>
      )}
    </div>
  );
}
