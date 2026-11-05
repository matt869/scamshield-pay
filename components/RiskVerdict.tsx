"use client";

import type { Analysis } from "@/lib/types";
import { useLanguage } from "./LanguageToggle";

/** The rubber stamp: the one loud thing on the page. The words carry the meaning, not the color. */
export function RiskVerdict({ analysis, reportLanguage }: { analysis: Analysis; reportLanguage: string }) {
  const { copy } = useLanguage();
  return (
    <section className={`verdict verdict-${analysis.risk}`} aria-labelledby="verdict-stamp">
      <h1 id="verdict-stamp" className="stamp">
        {copy.verdict[analysis.risk]}
      </h1>
      <div className="verdict-text" lang={reportLanguage}>
        <p className="verdict-headline">{analysis.headline}</p>
        <p>{analysis.summary}</p>
      </div>
      {analysis.risk === "low" && <p className="verdict-caveat">{copy.verdict.lowCaveat}</p>}
    </section>
  );
}
