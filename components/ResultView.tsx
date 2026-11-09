"use client";

import Link from "next/link";
import type { PublicCheck } from "@/lib/types";
import { useLanguage } from "./LanguageToggle";
import { RedFlagList } from "./RedFlagList";
import { RiskVerdict } from "./RiskVerdict";
import { ShareResult } from "./ShareResult";

export function ResultView({ check, price }: { check: PublicCheck; price: string }) {
  const { language, copy } = useLanguage();
  const { analysis } = check;

  return (
    <div className="stack-large">
      <RiskVerdict analysis={analysis} reportLanguage={check.language} />

      {check.language !== language && <p className="note">{copy.result.otherLanguage}</p>}

      <RedFlagList message={check.message} flags={analysis.red_flags} reportLanguage={check.language} />

      <section className="next-steps">
        <h2>{copy.result.nextSteps}</h2>
        <ol lang={check.language}>
          {analysis.next_steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </section>

      <ShareResult verdict={copy.verdict[analysis.risk]} headline={analysis.headline} />

      <section className="already-paid">
        <div>
          <h2>{copy.result.alreadyPaid}</h2>
          <p>{copy.result.alreadyPaidBody}</p>
          <Link className="button button-primary" href="/help">
            {copy.result.freeHelp}
          </Link>
        </div>
        <div className="already-paid-kit">
          {check.paymentStatus === "paid" ? (
            <Link className="button button-secondary" href={`/success?id=${check.id}`}>
              {copy.result.kitOwned}
            </Link>
          ) : check.paymentStatus === "none" ? (
            <>
              <h3>{copy.result.kitTitle}</h3>
              <p>{copy.result.kitBody(price)}</p>
              <Link className="button button-secondary" href={`/pay?id=${check.id}`}>
                {copy.result.kitCta}
              </Link>
            </>
          ) : null}
        </div>
      </section>

      <p className="fine-print">{copy.result.disclaimer}</p>
      <p>
        <Link href="/">{copy.result.checkAnother}</Link>
      </p>
    </div>
  );
}

export function NotFoundView() {
  const { copy } = useLanguage();
  return (
    <div className="stack">
      <h1 className="page-title">{copy.result.notFound}</h1>
      <p>{copy.result.notFoundBody}</p>
      <p>
        <Link className="button button-primary" href="/">
          {copy.result.checkAnother}
        </Link>
      </p>
    </div>
  );
}
