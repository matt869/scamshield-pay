"use client";

import Link from "next/link";
import { useLanguage } from "./LanguageToggle";
import resources from "@/data/resources.json";

export function HelpView() {
  const { language, copy } = useLanguage();
  const help = copy.help;

  return (
    <div className="stack-large help-page">
      <div className="stack">
        <p className="eyebrow">{help.pageTitle}</p>
        <h1 className="page-title">{help.title}</h1>
        <p className="lead">{help.lead}</p>
      </div>

      <section className="help-step">
        <span className="step-number" aria-hidden="true">1</span>
        <div>
          <h2>{help.stepOneTitle}</h2>
          <p>{help.stepOneBody}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{help.method}</th>
                  <th scope="col">{help.whatToDo}</th>
                </tr>
              </thead>
              <tbody>
                {resources.paymentGuidance.map((entry) => (
                  <tr key={entry.methods[0]}>
                    <th scope="row">{entry[language].title}</th>
                    <td>{entry[language].action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine-print">{help.verifyNote}</p>
        </div>
      </section>

      <section className="help-step">
        <span className="step-number" aria-hidden="true">2</span>
        <div>
          <h2>{help.stepTwoTitle}</h2>
          <ul className="plain-list">
            {help.stepTwoItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="help-step">
        <span className="step-number" aria-hidden="true">3</span>
        <div>
          <h2>{help.stepThreeTitle}</h2>
          <p>{help.stepThreeBody}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{help.where}</th>
                  <th scope="col">{help.when}</th>
                </tr>
              </thead>
              <tbody>
                {resources.contacts.map((contact) => (
                  <tr key={contact.id}>
                    <th scope="row">
                      <a
                        href={contact.href ?? contact.url[language]}
                        {...(contact.href ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                      >
                        {contact.label[language]}
                      </a>
                      <span className="contact-name">{contact.name[language]}</span>
                    </th>
                    <td>{contact.use[language]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="honest-box">
        <h2>{help.warningTitle}</h2>
        <p>{help.warning}</p>
      </section>

      <p>
        <Link href="/">{help.backToCheck}</Link>
      </p>
    </div>
  );
}
