"use client";

import { useRouter } from "next/navigation";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import sampleData from "@/data/sample-scams.json";
import { IMAGE_MAX_BASE64, type ImageInput, MESSAGE_MAX_CHARS, MESSAGE_MIN_CHARS } from "@/lib/types";
import { useLanguage } from "./LanguageToggle";

const MAX_IMAGE_SIDE = 1600;

/** Shrinks a photo or screenshot in the browser, so uploads are quick even on a slow connection. */
async function shrinkImage(file: File): Promise<ImageInput> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export function ScamInput() {
  const { language, copy } = useLanguage();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<{ input: ImageInput; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canPaste, setCanPaste] = useState(false);
  const text = copy.input;

  useEffect(() => {
    setCanPaste(typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function");
  }, []);

  async function pasteFromClipboard() {
    try {
      const pasted = await navigator.clipboard.readText();
      if (pasted.trim()) {
        setMessage(pasted);
        setImage(null);
        setError(null);
      }
    } catch {
      setError(text.pasteFailed);
    }
    document.getElementById("message")?.focus();
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError(text.notAnImage);
    try {
      const input = await shrinkImage(file);
      if (input.data.length > IMAGE_MAX_BASE64) return setError(text.screenshotTooBig);
      setImage({ input, preview: `data:${input.mediaType};base64,${input.data}` });
      setMessage("");
      setError(null);
    } catch {
      setError(text.notAnImage);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = message.trim();
    if (!image) {
      if (trimmed.length < MESSAGE_MIN_CHARS) return setError(text.tooShort);
      if (trimmed.length > MESSAGE_MAX_CHARS) return setError(text.tooLong);
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(image ? { image: image.input, language } : { message: trimmed, language }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
      if (response.ok && body.id) {
        router.push(`/result?id=${body.id}`);
        return;
      }
      const messages: Record<string, string> = {
        rate_limited: text.rateLimited,
        no_text_in_image: text.noTextInImage,
        image_needs_ai: text.imageNeedsAi,
      };
      setError(messages[body.error ?? ""] ?? text.unavailable);
    } catch {
      setError(text.unavailable);
    }
    setBusy(false);
  }

  const over = message.length > MESSAGE_MAX_CHARS;

  return (
    <form className="scam-input" onSubmit={submit} noValidate>
      <label htmlFor="message">{text.label}</label>
      <p id="message-hint" className="hint">
        {text.hint}
      </p>
      {canPaste && !image && (
        <button type="button" className="button button-secondary paste-button" onClick={pasteFromClipboard} disabled={busy}>
          {text.paste}
        </button>
      )}

      {image ? (
        <figure className="screenshot-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.preview} alt="" />
          <button type="button" className="link-button" onClick={() => setImage(null)} disabled={busy}>
            {text.removeScreenshot}
          </button>
        </figure>
      ) : (
        <>
          <textarea
            id="message"
            name="message"
            rows={6}
            value={message}
            placeholder={text.placeholder}
            aria-describedby="message-hint message-count"
            aria-invalid={error === text.tooShort || error === text.tooLong || over}
            onChange={(event) => setMessage(event.target.value)}
            disabled={busy}
          />
          <p id="message-count" className={over ? "count count-over" : "count"}>
            {text.count(message.length, MESSAGE_MAX_CHARS)}
          </p>
        </>
      )}

      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      <button className="button button-primary" type="submit" disabled={busy}>
        {text.submit}
      </button>
      {busy && (
        <p className="status" role="status">
          <span className="pulse" aria-hidden="true" /> {text.checking}
        </p>
      )}

      {!image && (
        <div className="screenshot-upload">
          <p className="screenshot-title">{text.orScreenshot}</p>
          <p className="hint">{text.screenshotHint}</p>
          <label className="button button-secondary file-button">
            {text.chooseScreenshot}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} disabled={busy} />
          </label>
        </div>
      )}

      <div className="samples">
        <p>{text.tryExample}</p>
        <ul>
          {sampleData.samples.map((sample) => (
            <li key={sample.id}>
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => {
                  setImage(null);
                  setMessage(sample.message[language]);
                  setError(null);
                  requestAnimationFrame(() => document.getElementById("message")?.focus());
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
