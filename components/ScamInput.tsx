"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import sampleData from "@/data/sample-scams.json";
import { MESSAGE_MAX_CHARS, MESSAGE_MIN_CHARS } from "@/lib/types";
import { useLanguage } from "./LanguageToggle";

export function ScamInput() {
  const { language, copy } = useLanguage();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < MESSAGE_MIN_CHARS) return setError(copy.input.tooShort);
    if (trimmed.length > MESSAGE_MAX_CHARS) return setError(copy.input.tooLong);

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, language }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (response.ok && body.id) {
        router.push(`/result?id=${body.id}`);
        return;
      }
      setError(body.error === "rate_limited" ? copy.input.rateLimited : copy.input.unavailable);
    } catch {
      setError(copy.input.unavailable);
    }
    setBusy(false);
  }

  const over = message.length > MESSAGE_MAX_CHARS;

  return (
    <form className="scam-input" onSubmit={submit} noValidate>
      <label htmlFor="message">{copy.input.label}</label>
      <p id="message-hint" className="hint">
        {copy.input.hint}
      </p>
      <textarea
        id="message"
        name="message"
        rows={7}
        value={message}
        placeholder={copy.input.placeholder}
        aria-describedby="message-hint message-count"
        aria-invalid={error === copy.input.tooShort || error === copy.input.tooLong || over}
        onChange={(event) => setMessage(event.target.value)}
        disabled={busy}
      />
      <p id="message-count" className={over ? "count count-over" : "count"}>
        {copy.input.count(message.length, MESSAGE_MAX_CHARS)}
      </p>

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <button className="button button-primary" type="submit" disabled={busy}>
        {copy.input.submit}
      </button>
      {busy && (
        <p className="status" role="status">
          <span className="pulse" aria-hidden="true" /> {copy.input.checking}
        </p>
      )}

      <div className="samples">
        <p>{copy.input.tryExample}</p>
        <ul>
          {sampleData.samples.map((sample) => (
            <li key={sample.id}>
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => {
                  setMessage(sample.message[language]);
                  setError(null);
                  document.getElementById("message")?.focus();
                }}
              >
                {sample.label[language]}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
