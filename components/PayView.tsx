"use client";

import Link from "next/link";
import { useLanguage } from "./LanguageToggle";
import { InvoiceForm, PayPalCheckout } from "./PayPalCheckout";

export function PayView({
  checkId,
  price,
  clientId,
  revoked,
}: {
  checkId: string;
  price: string;
  clientId: string | null;
  revoked: boolean;
}) {
  const { copy } = useLanguage();
  return (
    <div className="pay-layout">
      <div className="stack">
        <p className="eyebrow">{copy.pay.pageTitle}</p>
        <h1 className="page-title">{copy.pay.title}</h1>
        <p className="price">{copy.pay.price(price)}</p>
        <h2>{copy.pay.includes}</h2>
        <ul className="plain-list">
          {copy.pay.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="honest-box">
          <h2>{copy.pay.honestTitle}</h2>
          <p>{copy.pay.honest}</p>
        </div>
        <p>
          {copy.pay.freeNote} <Link href="/help">{copy.pay.freeLink}</Link>
        </p>
      </div>

      <aside className="pay-panel">
        {revoked ? (
          <p className="alert" role="alert">
            {copy.pay.revoked}
          </p>
        ) : clientId ? (
          <>
            <PayPalCheckout checkId={checkId} clientId={clientId} />
            <InvoiceForm checkId={checkId} />
          </>
        ) : (
          <p className="alert" role="alert">
            {copy.pay.unavailable}
          </p>
        )}
        <p>
          <Link href={`/result?id=${checkId}`}>{copy.pay.back}</Link>
        </p>
      </aside>
    </div>
  );
}
