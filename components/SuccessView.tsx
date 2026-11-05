"use client";

import Link from "next/link";
import type { PublicCheck } from "@/lib/types";
import { DisputeHelper } from "./DisputeHelper";
import { useLanguage } from "./LanguageToggle";

export function SuccessView({ check }: { check: PublicCheck }) {
  const { copy } = useLanguage();

  if (check.paymentStatus === "paid") {
    return (
      <div className="stack-large">
        <div className="stack">
          <p className="eyebrow">{copy.success.pageTitle}</p>
          <h1 className="page-title">{copy.success.paidTitle}</h1>
          <p>{copy.success.keepLink}</p>
        </div>
        <DisputeHelper
          checkId={check.id}
          initialKit={check.disputeKit}
          initialKitLanguage={check.disputeKitLanguage}
        />
      </div>
    );
  }

  if (check.paymentStatus === "revoked") {
    return (
      <div className="stack">
        <h1 className="page-title">{copy.success.unpaidTitle}</h1>
        <p>{copy.pay.revoked}</p>
        <p>
          <Link href="/help">{copy.result.freeHelp}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1 className="page-title">{copy.success.pendingTitle}</h1>
      <p>{copy.success.pendingBody}</p>
      <p>{copy.success.unpaidBody}</p>
      <div className="kit-actions">
        <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
          {copy.success.refresh}
        </button>
        <Link className="button button-secondary" href={`/pay?id=${check.id}`}>
          {copy.success.goToPay}
        </Link>
      </div>
    </div>
  );
}
