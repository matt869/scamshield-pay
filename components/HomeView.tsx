"use client";

import { useLanguage } from "./LanguageToggle";
import { MarkedMessage } from "./RedFlagList";
import { ScamInput } from "./ScamInput";

export function HomeView() {
  const { copy } = useLanguage();
  const home = copy.home;
  return (
    <div className="home-grid">
      <div className="home-main">
        <p className="eyebrow">{home.eyebrow}</p>
        <h1 className="display">{home.title}</h1>
        <p className="lead">{home.lead}</p>
        <ScamInput />
        <p className="fine-print">{home.privacy}</p>
      </div>

      <aside className="home-example" aria-label={home.exampleLabel}>
        <p className="example-label">{home.exampleLabel}</p>
        <p className="stamp stamp-small" aria-hidden="true">
          {home.exampleStamp}
        </p>
        <MarkedMessage message={home.exampleMessage} quotes={home.exampleMarks} label="" />
        <ol className="example-notes">
          {home.exampleNotes.map((note, index) => (
            <li key={note}>
              <span className="flag-number" aria-hidden="true">
                {index + 1}
              </span>
              {note}
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
