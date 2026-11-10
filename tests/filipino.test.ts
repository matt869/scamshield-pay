import { describe, expect, it } from "vitest";
import resources from "@/data/resources.json";
import samples from "@/data/sample-scams.json";
import { demoAnalysis } from "@/lib/demo";
import { applyGuardrails } from "@/lib/guardrails";
import { findQuote } from "@/lib/highlight";
import { languageFromHeader, t } from "@/lib/i18n";
import { buildDisputePrompt } from "@/lib/prompts/dispute-letter";
import { buildClassifierPrompt, buildImagePrompt, SCAM_CLASSIFIER_SYSTEM } from "@/lib/prompts/scam-classifier";
import { type Analysis, LANGUAGES, LanguageSchema } from "@/lib/types";

function lowReport(): Analysis {
  return {
    risk: "low",
    scam_type: "none_identified",
    headline: "Walang malinaw na palatandaan.",
    summary: "Mukhang karaniwang mensahe.",
    red_flags: [],
    next_steps: ["Tanungin ang nagpadala gamit ang numerong kilala na ninyo."],
  };
}

/** Every key path in a dictionary, with the kind of value at the end of it. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return [`${path}:array`];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => shape(child, `${path}.${key}`));
  }
  return [`${path}:${typeof value}`];
}

describe("Filipino interface", () => {
  it("is a supported language", () => {
    expect(LANGUAGES).toContain("fil");
    expect(LanguageSchema.safeParse("fil").success).toBe(true);
  });

  it("has every key and function that English has", () => {
    expect(shape(t("fil"))).toEqual(shape(t("en")));
    expect(t("fil").result.markLabel(2)).toBe("palatandaan 2");
    expect(t("fil").input.count(1200, 8000)).toContain("8,000");
  });

  it("leaves no string empty or in English where Filipino is expected", () => {
    const fil = t("fil");
    const en = t("en");
    const strings = (value: unknown): string[] =>
      typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
    for (const text of strings(fil)) expect(text.trim()).not.toBe("");
    expect(fil.home.title).not.toBe(en.home.title);
    expect(fil.verdict.high).toBe("Tigil. Huwag magbayad.");
  });

  it("is chosen from the browser's language", () => {
    expect(languageFromHeader("fil-PH,fil;q=0.9,en;q=0.8")).toBe("fil");
    expect(languageFromHeader("tl")).toBe("fil");
    expect(languageFromHeader("es-MX")).toBe("es");
    expect(languageFromHeader("en-US")).toBe("en");
  });

  it.each(LANGUAGES)("marks every home-page example quote in the %s example message", (language) => {
    const { exampleMessage, exampleMarks } = t(language).home;
    for (const mark of exampleMarks) expect(findQuote(exampleMessage, mark)).not.toBeNull();
  });
});

describe("Filipino prompts", () => {
  it("asks for the report in Filipino and keeps quotes as written", () => {
    const prompt = buildClassifierPrompt("Padala ka na ngayon.", "fil");
    expect(prompt).toContain("Filipino (Tagalog)");
    expect(prompt).toContain('"po"');
    expect(prompt).toMatch(/"quote", which stays in the message's original language exactly as written/);
    expect(buildImagePrompt("fil")).toContain("Filipino (Tagalog)");
    expect(buildDisputePrompt("msg", {
      paymentMethod: "zelle_or_app",
      institution: "",
      amount: "",
      paymentDate: "",
      recipient: "",
      whatHappened: "Nagpadala ako ng pera.",
    }, "", "fil")).toContain("Filipino (Tagalog)");
  });

  it("keeps the Spanish and English instructions", () => {
    expect(buildClassifierPrompt("hola", "es")).toContain('Spanish, addressing the reader as "usted"');
    expect(buildClassifierPrompt("hello", "en")).toContain("report in English, except");
  });

  it("tells the classifier about Filipino languages and scams", () => {
    for (const phrase of ["Tagalog", "Taglish", "Bisaya", "placement", "e-wallet", "customs", "paluwagan", "love scams", "ayuda", "wag mo muna sabihin"]) {
      expect(SCAM_CLASSIFIER_SYSTEM).toContain(phrase);
    }
  });
});

describe("guardrails on Filipino phrasing", () => {
  it.each([
    ["secrecy", "Wag mong sabihin kay Mama, ako na bahala."],
    ["secrecy", "Huwag mo munang ipaalam sa pamilya mo ha."],
    ["secrecy", "Atin-atin lang ito, okay?"],
    ["job fee", "Congrats! Magbayad ng placement fee para sa trabaho mo sa abroad."],
    ["gift cards", "Bumili ka ng gift card at ipadala ang code."],
    ["crypto", "Mag-invest ka sa bitcoin ngayon, doble ang balik."],
    ["remote access", "Kailangan naming ma-access ang cellphone mo para ayusin."],
  ])("raises a low verdict for %s: %s", (_name, message) => {
    const result = applyGuardrails(lowReport(), message, "fil");
    expect(result.risk).toBe("medium");
    expect(result.headline).toBe("May kahit isang seryosong palatandaan ng scam ang mensaheng ito.");
    expect(result.red_flags.length).toBeGreaterThan(0);
    expect(result.red_flags[0]?.title).not.toMatch(/^It /);
  });

  it("leaves an ordinary Filipino message alone", () => {
    const result = applyGuardrails(lowReport(), "Kumain ka na ba? Uwi ka sa Linggo, may handaan kina Tita.", "fil");
    expect(result.risk).toBe("low");
  });

  it("falls back to Filipino next steps", () => {
    const result = applyGuardrails({ ...lowReport(), next_steps: ["Tumawag sa 0917 555 0123"] }, "Kumusta po kayo?", "fil");
    expect(result.next_steps[0]).toMatch(/^Huwag i-click/);
  });
});

describe("demo rules on Filipino phrasing", () => {
  it.each([
    ["rushes", "Bayaran mo ngayon na, kundi mawawala ang slot mo."],
    ["rushes", "Last slot na lang po ito para sa inyo."],
    ["hard to undo", "Padala mo na lang sa e-wallet ko."],
    ["pay first", "May placement fee na kailangan bago umalis."],
    ["secret", "Wag mo muna sabihin sa asawa mo."],
  ])("flags %s: %s", (_name, message) => {
    expect(demoAnalysis(message, "fil").risk).not.toBe("low");
  });

  it("writes demo results in Filipino", () => {
    const result = demoAnalysis("Padala mo na ngayon na sa e-wallet ko.", "fil");
    expect(result.headline).toMatch(/palatandaan/);
    expect(result.red_flags.every((flag) => !flag.title.startsWith("It "))).toBe(true);
  });
});

describe("Filipino samples", () => {
  it("gives every sample a Filipino label and message", () => {
    for (const sample of samples.samples) {
      for (const language of LANGUAGES) {
        expect(sample.label[language]).toBeTruthy();
        expect(sample.message[language]).toBeTruthy();
      }
    }
  });

  it("includes a Taglish overseas job offer with no real brand names", () => {
    const ofw = samples.samples.find((sample) => sample.id === "ofw");
    expect(ofw).toBeDefined();
    const message = ofw?.message.fil ?? "";
    expect(message).toMatch(/placement fee/i);
    expect(message).toMatch(/e-wallet/i);
    expect(message).toMatch(/ngayon na/i);
    expect(message).toMatch(/wag mo muna sabihin/i);
    expect(message).not.toMatch(/gcash|maya|paymaya|coins\.ph|bdo|bpi|metrobank|landbank|palawan|cebuana|lbc|western union/i);
    expect(applyGuardrails(demoAnalysis(message, "fil"), message, "fil").risk).toBe("high");
  });
});

describe("Philippine contacts", () => {
  const filContacts = resources.contacts.filter((contact) => contact.languages.includes("fil"));

  it("lists the four offices for Filipino readers, each with an official source", () => {
    expect(filContacts.map((contact) => contact.id)).toEqual(["cicc", "pnp-acg", "nbi-ccd", "bsp"]);
    for (const contact of filContacts) {
      const sources = ("source" in contact ? contact.source : undefined) ?? [];
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) expect(source).toMatch(/^https:\/\/([a-z0-9-]+\.)*gov\.ph\//);
    }
    expect(filContacts.find((contact) => contact.id === "cicc")?.href).toBe("tel:1326");
  });

  it("keeps the US offices for English and Spanish readers only", () => {
    const usContacts = resources.contacts.filter((contact) => contact.languages.includes("en"));
    expect(usContacts.map((contact) => contact.id)).toEqual(["ftc", "identity", "ic3", "cfpb", "aarp"]);
    expect(usContacts.every((contact) => !contact.languages.includes("fil"))).toBe(true);
  });

  it("has Filipino guidance for every payment method", () => {
    for (const entry of resources.paymentGuidance) {
      expect(entry.fil.title).toBeTruthy();
      expect(entry.fil.action).toBeTruthy();
    }
  });
});
