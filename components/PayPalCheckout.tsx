"use client";

import { PayPalButtons, PayPalScriptProvider } from "@paypal/react-paypal-js";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { useLanguage } from "./LanguageToggle";

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; body: T }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, body: (await response.json().catch(() => ({}))) as T };
}

export function PayPalCheckout({ checkId, clientId }: { checkId: string; clientId: string }) {
  const { copy } = useLanguage();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  return (
    <div className="paypal-checkout">
      <h2>{copy.pay.payWith}</h2>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {processing && (
        <p className="status" role="status">
          <span className="pulse" aria-hidden="true" /> {copy.pay.processing}
        </p>
      )}
      <PayPalScriptProvider options={{ clientId, currency: "USD", intent: "capture", components: "buttons" }}>
        <PayPalButtons
          style={{ layout: "vertical", label: "pay", color: "black", height: 52 }}
          forceReRender={[checkId]}
          createOrder={async () => {
            setError(null);
            const result = await postJson<{ orderId?: string; error?: string }>("/api/paypal/create-order", {
              checkId,
            });
            if (result.body.error === "already_paid") {
              router.push(`/success?id=${checkId}`);
            }
            if (!result.ok || !result.body.orderId) {
              setError(result.body.error === "rate_limited" ? copy.pay.rateLimited : copy.pay.failed);
              throw new Error("Could not create the order");
            }
            return result.body.orderId;
          }}
          onApprove={async (data, actions) => {
            setProcessing(true);
            const result = await postJson<{ status?: string; error?: string }>("/api/paypal/capture-order", {
              orderId: data.orderID,
            });
            if (result.body.error === "instrument_declined") {
              setProcessing(false);
              setError(copy.pay.declined);
              // PayPal's documented recovery: reopen checkout so another method can be chosen.
              await actions.restart();
              return;
            }
            if (result.ok && (result.body.status === "completed" || result.body.status === "pending")) {
              router.push(`/success?id=${checkId}`);
              return;
            }
            setProcessing(false);
            setError(copy.pay.failed);
          }}
          onError={() => setError((current) => current ?? copy.pay.failed)}
        />
      </PayPalScriptProvider>
    </div>
  );
}

export function InvoiceForm({ checkId }: { checkId: string }) {
  const { language, copy } = useLanguage();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(copy.pay.invalidEmail);
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ sent?: boolean; error?: string }>("/api/paypal/create-invoice", {
        checkId,
        email: email.trim(),
        language,
      });
      if (result.ok && result.body.sent) setSent(true);
      else if (result.body.error === "invalid_email") setError(copy.pay.invalidEmail);
      else if (result.body.error === "rate_limited") setError(copy.pay.rateLimited);
      else setError(copy.pay.unavailable);
    } catch {
      setError(copy.pay.unavailable);
    }
    setBusy(false);
  }

  return (
    <div className="invoice-form">
      <h2>{copy.pay.orInvoice}</h2>
      <p>{copy.pay.invoiceBody}</p>
      {sent ? (
        <p className="confirmation" role="status">
          {copy.pay.invoiceSent}
        </p>
      ) : (
        <form onSubmit={submit} noValidate>
          <label htmlFor="invoice-email">{copy.pay.emailLabel}</label>
          <input
            id="invoice-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={busy}
            aria-invalid={error === copy.pay.invalidEmail}
          />
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button className="button button-secondary" type="submit" disabled={busy}>
            {busy ? copy.pay.invoiceSending : copy.pay.invoiceSubmit}
          </button>
        </form>
      )}
    </div>
  );
}
