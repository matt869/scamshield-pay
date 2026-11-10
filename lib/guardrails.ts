import { findQuote } from "./highlight";
import type { Analysis, Language, RedFlag } from "./types";

/**
 * Deterministic checks on Claude's report. The message being judged is attacker-controlled, so a
 * crafted one might talk the model into a soft verdict or a poisoned next step. These rules hold
 * regardless of what the model returned.
 */

interface HardSignal {
  pattern: RegExp;
  flag: Record<Language, Pick<RedFlag, "title" | "explanation">>;
}

const HARD_SIGNALS: HardSignal[] = [
  {
    // Text aimed at an AI reader has no innocent reason to be in a message sent to a person.
    pattern:
      /\b(ignore|disregard|forget)\b.{0,30}\b(previous|prior|above|earlier|all)\b.{0,30}\b(instructions?|prompts?|rules?)\b|\b(ignora|ignore|olvida)\b.{0,30}\b(instrucciones|indicaciones)\b|\b(classify|mark|rate|label)\b.{0,30}\b(this|message)\b.{0,30}\b(safe|legitimate|low risk)\b|\b(clasifica|marca)\b.{0,30}\b(seguro|leg[ií]timo)\b/iu,
    flag: {
      en: {
        title: "It tries to instruct an automated checker",
        explanation: "The message contains wording aimed at software that reviews it. Real messages have no reason to do this.",
      },
      es: {
        title: "Intenta dar órdenes a un revisor automático",
        explanation: "El mensaje tiene frases dirigidas al programa que lo revisa. Un mensaje real no tiene motivo para hacer eso.",
      },
      fil: {
        title: "Sinusubukan nitong utusan ang awtomatikong checker",
        explanation: "May mga salita sa mensahe na para sa software na sumusuri dito. Walang dahilan ang totoong mensahe para gawin ito.",
      },
    },
  },
  {
    pattern:
      /\b(pay|payment|buy|purchase|send|get)\b.{0,50}\bgift ?cards?\b|\bgift ?cards?\b.{0,50}\b(pay|payment|codes?|numbers?|scratch)\b|\b(pag\w*|compr\w*|env[ií]\w*)\b.{0,50}\btarjetas? de regalo\b|\btarjetas? de regalo\b.{0,50}\b(pag\w*|c[oó]digos?|n[uú]meros?)\b|\b(bumili|bilhin|bili|magbayad|bayaran|bayad|magpadala|ipadala|padala|isend)\w*\b.{0,50}\bgift ?cards?\b/iu,
    flag: {
      en: {
        title: "It asks for gift cards",
        explanation: "Real companies and government offices do not take payment in gift cards. Money sent this way is very hard to get back.",
      },
      es: {
        title: "Pide tarjetas de regalo",
        explanation: "Las empresas y oficinas de gobierno reales no aceptan pagos con tarjetas de regalo. Ese dinero es muy difícil de recuperar.",
      },
      fil: {
        title: "Humihingi ito ng gift card",
        explanation: "Hindi tumatanggap ng bayad na gift card ang totoong kumpanya o opisina ng gobyerno. Napakahirap bawiin ang perang ipinadala sa ganitong paraan.",
      },
    },
  },
  {
    pattern:
      /\b(send|pay|deposit|transfer|buy)\b.{0,50}\b(bitcoin|btc|crypto\w*|usdt|ethereum)\b|\b(bitcoin|crypto) atm\b|\b(env[ií]\w*|pag\w*|deposit\w*|transfier\w*|compr\w*)\b.{0,50}\b(bitcoin|criptomonedas?|cripto)\b|\bcajero de (bitcoin|cripto\w*)\b|\b(magpadala|ipadala|padala|magbayad|bayad|mag-?invest|i-?invest|bumili|bili|magdeposito|ideposito)\w*\b.{0,50}\b(bitcoin|btc|crypto\w*|usdt|ethereum)\b/iu,
    flag: {
      en: {
        title: "It asks for cryptocurrency",
        explanation: "Crypto payments usually cannot be reversed, which is why scammers ask for them.",
      },
      es: {
        title: "Pide criptomonedas",
        explanation: "Los pagos con criptomonedas casi nunca se pueden revertir. Por eso los estafadores los piden.",
      },
      fil: {
        title: "Humihingi ito ng crypto",
        explanation: "Kadalasang hindi na maibabalik ang bayad na crypto. Kaya ito ang hinihingi ng mga scammer.",
      },
    },
  },
  {
    pattern:
      /\b(anydesk|teamviewer|ultraviewer|rustdesk|logmein|remote access|acceso remoto)\b|\b(kontrolin|ma-?kontrol|ma-?access|i-?access)\b.{0,30}\b(cellphone|cp|phone|selpon|computer|kompyuter|laptop)\b/iu,
    flag: {
      en: {
        title: "It asks for access to your device",
        explanation: "Remote-access tools let someone control your device and see your accounts. Do not install them for a stranger.",
      },
      es: {
        title: "Pide acceso a su dispositivo",
        explanation: "Los programas de acceso remoto permiten que otra persona controle su dispositivo y vea sus cuentas. No los instale para un desconocido.",
      },
      fil: {
        title: "Gusto nitong makapasok sa device ninyo",
        explanation: "Sa mga remote-access app, makokontrol ng ibang tao ang device ninyo at makikita ang mga account ninyo. Huwag itong i-install para sa taong hindi ninyo kilala.",
      },
    },
  },
  {
    pattern:
      /\b(do not|don'?t|never)\b.{0,20}\b(tell|inform|contact|call)\b.{0,30}\b(anyone|anybody|family|bank|police|mom|dad|mum|parents|husband|wife|kids|children|son|daughter)\b|\bkeep (this|it) (a )?(secret|confidential|between us)\b|\bno (le |les )?(diga|digas|cuente|cuentes|avise|avises)\b.{0,30}\b(nadie|familia|banco|polic[ií]a|mam[aá]|pap[aá]|padres|esposo|esposa|hijos?|hijas?)(?!\p{L})|\b(huwag|wag)\b.{0,25}\b(sabihin|sasabihin|ipaalam|banggitin|ikwento|ipagsabi)\b|\batin[- ]atin lang\b|\b(sikreto|secret) (lang |muna )?(natin|muna)\b/iu,
    flag: {
      en: {
        title: "It tells you to keep this secret",
        explanation: "Scammers ask for secrecy so nobody can warn you. Talk to someone you trust before doing anything.",
      },
      es: {
        title: "Le pide guardar el secreto",
        explanation: "Los estafadores piden secreto para que nadie pueda advertirle. Hable con alguien de confianza antes de hacer nada.",
      },
      fil: {
        title: "Pinapalihim nito sa inyo",
        explanation: "Pinapalihim ng mga scammer para walang makapagbabala sa inyo. Kausapin muna ang taong pinagkakatiwalaan ninyo bago gumawa ng kahit ano.",
      },
    },
  },
  {
    // Fake OFW and job recruiters ask for a fee before the job exists.
    pattern:
      /\bplacement fee\b|\b(reservation|processing|medical|training|deployment) fee\b.{0,60}\b(trabaho|abroad|job|work|visa|deploy\w*|alis|slot)\b|\b(trabaho|abroad|job|visa|slot)\b.{0,60}\b(reservation|processing|medical|training|deployment) fee\b/iu,
    flag: {
      en: {
        title: "It asks for a fee to get a job",
        explanation: "Recruiters who ask you to pay a placement or processing fee before you start are a common job scam, especially for work abroad.",
      },
      es: {
        title: "Pide un pago para darle un trabajo",
        explanation: "Pedir una cuota de colocación o de trámite antes de empezar es una estafa común de empleo, sobre todo para trabajos en el extranjero.",
      },
      fil: {
        title: "Humihingi ito ng bayad para sa trabaho",
        explanation: "Karaniwang scam sa trabaho, lalo na sa abroad, ang paghingi ng placement fee o processing fee bago pa kayo magsimula. Suriin muna ang recruiter sa DMW.",
      },
    },
  },
];

const CONTACT_DETAILS = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|info|xyz|top|io|co|gov|us)\b|[\w.+-]+@[\w-]+\.\w+|\+?\d[\d\s().-]{6,}\d/iu;

const FALLBACK_STEPS: Record<Language, string[]> = {
  en: [
    "Do not click links, call numbers, or pay using anything in this message.",
    "Contact the company or person yourself, using a number or website you already trust.",
  ],
  es: [
    "No abra enlaces, no llame a números ni pague usando nada de este mensaje.",
    "Comuníquese usted con la empresa o la persona, con un número o sitio web que ya conozca y en el que confíe.",
  ],
  fil: [
    "Huwag i-click ang mga link, tawagan ang mga numero, o magbayad gamit ang anumang nasa mensaheng ito.",
    "Kayo mismo ang kumontak sa kumpanya o tao, gamit ang numero o website na pinagkakatiwalaan na ninyo.",
  ],
};

const RAISED_REPORT: Record<Language, { headline: string; summary: string }> = {
  en: {
    headline: "This message has at least one serious warning sign.",
    summary: "We found a sign that often appears in scams. Check for yourself before you pay or reply.",
  },
  es: {
    headline: "Este mensaje tiene al menos una señal de advertencia seria.",
    summary: "Encontramos una señal que suele aparecer en estafas. Verifique por su cuenta antes de pagar o responder.",
  },
  fil: {
    headline: "May kahit isang seryosong palatandaan ng scam ang mensaheng ito.",
    summary: "May nakita kaming palatandaan na madalas makita sa mga scam. Suriin muna ninyo bago magbayad o sumagot.",
  },
};

export function applyGuardrails(analysis: Analysis, message: string, language: Language): Analysis {
  // A quote that is not really in the message would mark up something the sender never wrote.
  const redFlags: RedFlag[] = analysis.red_flags.map((flag) => ({
    ...flag,
    quote: flag.quote && findQuote(message, flag.quote) ? flag.quote : null,
  }));

  const triggered = HARD_SIGNALS.filter((signal) => signal.pattern.test(message));

  // Next steps are instructions the reader will follow, so they must never carry contact details
  // that could have come from the sender.
  const safeSteps = analysis.next_steps.filter((step) => !CONTACT_DETAILS.test(step));

  let risk = analysis.risk;
  let headline = analysis.headline;
  let summary = analysis.summary;
  if (triggered.length > 0 && risk === "low") {
    risk = "medium";
    headline = RAISED_REPORT[language].headline;
    summary = RAISED_REPORT[language].summary;
  }

  const addedFlags: RedFlag[] =
    risk === analysis.risk
      ? []
      : triggered.map((signal) => ({ ...signal.flag[language], quote: null }));

  return {
    ...analysis,
    risk,
    headline,
    summary,
    red_flags: [...addedFlags, ...redFlags],
    next_steps: safeSteps.length > 0 ? safeSteps : FALLBACK_STEPS[language],
  };
}
