import type { Analysis, DisputeDetails, DisputeKit, Language, RedFlag, ScamType } from "./types";

/**
 * Demo mode: pattern rules instead of Claude, for running the app without an API key, such as at a
 * hackathon. Every page says so. It must never be switched on for real users, because simple rules
 * miss scams that a person or a model would catch.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

interface Rule {
  pattern: RegExp;
  serious: boolean;
  type?: ScamType;
  flag: Record<Language, Pick<RedFlag, "title" | "explanation">>;
}

const RULES: Rule[] = [
  {
    // Only a request to pay with gift cards, so "thanks for the gift card" stays harmless.
    pattern:
      /[^.!?\n]{0,15}\b(pay|buy|purchase|send|get|scratch|pag\w*|compr\w*|env[ií]\w*|bumili|bilhin|bili|magbayad|bayad\w*|magpadala|ipadala|padala)\b[^.!?\n]{0,40}\b(gift ?cards?|tarjetas? de regalo)\b[^.!?\n]{0,20}|\b(gift ?cards?|tarjetas? de regalo)\b[^.!?\n]{0,30}\b(codes?|numbers?|c[oó]digos?|n[uú]meros?|numero)\b/iu,
    serious: true,
    flag: {
      en: { title: "It asks for gift cards", explanation: "Real companies and government offices do not take payment in gift cards." },
      es: { title: "Pide tarjetas de regalo", explanation: "Las empresas y oficinas de gobierno reales no aceptan pagos con tarjetas de regalo." },
      fil: { title: "Humihingi ito ng gift card", explanation: "Hindi tumatanggap ng bayad na gift card ang totoong kumpanya o opisina ng gobyerno." },
    },
  },
  {
    pattern: /[^.!?\n]{0,30}\b(bitcoin|crypto\w*|criptomonedas?|usdt)\b[^.!?\n]{0,20}/iu,
    serious: true,
    type: "investment_or_crypto",
    flag: {
      en: { title: "It asks for cryptocurrency", explanation: "Crypto payments usually cannot be reversed, which is why scammers ask for them." },
      es: { title: "Pide criptomonedas", explanation: "Los pagos con criptomonedas casi nunca se pueden revertir." },
      fil: { title: "Humihingi ito ng crypto", explanation: "Kadalasang hindi na maibabalik ang bayad na crypto, kaya ito ang hinihingi ng mga scammer." },
    },
  },
  {
    pattern: /[^.!?\n]{0,30}\b(anydesk|teamviewer|ultraviewer|remote access|acceso remoto)\b[^.!?\n]{0,20}/iu,
    serious: true,
    type: "tech_support",
    flag: {
      en: { title: "It asks for access to your device", explanation: "Remote-access tools let a stranger control your device and see your accounts." },
      es: { title: "Pide acceso a su dispositivo", explanation: "Estos programas permiten que un desconocido controle su dispositivo y vea sus cuentas." },
      fil: { title: "Gusto nitong makapasok sa device ninyo", explanation: "Sa mga app na ito, makokontrol ng taong hindi ninyo kilala ang device ninyo at makikita ang mga account ninyo." },
    },
  },
  {
    pattern:
      /[^.!?\n]{0,30}\b(infected|virus|malware|hacked|security alert|do not turn off|don'?t turn off|infectad[ao]|alerta de seguridad|no apague|na-?hack|huwag i-?off)\b[^.!?\n]{0,30}/iu,
    serious: true,
    type: "tech_support",
    flag: {
      en: { title: "It claims your device has a problem", explanation: "Real companies do not send pop-ups or texts saying your device is infected and asking you to call." },
      es: { title: "Dice que su dispositivo tiene un problema", explanation: "Las empresas reales no envían avisos de virus pidiéndole que llame." },
      fil: { title: "Sinasabi nitong may problema ang device ninyo", explanation: "Hindi nagpapadala ang totoong kumpanya ng text o pop-up na may virus kayo at kailangan ninyong tumawag." },
    },
  },
  {
    pattern:
      /[^.!?\n]{0,30}\b(deposit|fee|activation|processing|taxes|impuestos?|dep[oó]sito|cargo)\b[^.!?\n]{0,40}\b(required|to (activate|receive|claim|release|start)|para (recibir|activar|cobrar|ma-?release|makuha|ma-?reserve|ma-?claim))\b[^.!?\n]{0,20}|\b(debe|must|need to|have to) (pay|pagar)\b[^.!?\n]{0,40}|[^.!?\n]{0,30}\b(placement fee|processing fee|reservation fee|bayad muna|magbayad muna)\b[^.!?\n]{0,30}/iu,
    serious: true,
    type: "job_or_task",
    flag: {
      en: { title: "It asks you to pay first to get money", explanation: "Paying a fee to receive a prize, a job, or a refund is a classic scam." },
      es: { title: "Le pide pagar primero para recibir dinero", explanation: "Pagar una cuota para recibir un premio, un trabajo o un reembolso es una estafa clásica." },
      fil: { title: "Pinapabayad muna kayo bago makatanggap", explanation: "Klasikong scam ang paghingi ng bayad para makuha ang premyo, trabaho, o refund." },
    },
  },
  {
    pattern:
      /\b(you('ve| have)? won|congratulations|winner|claim your (prize|reward)|ganó|ganador|felicidades|nanalo ka|panalo ka|napili kayo|napili ka)\b[^.!?\n]{0,40}|\b(earn|make|gane|kikita ka ng) \$?₱?\d[\d,]*[^.!?\n]{0,15}\b(a day|per day|a week|al d[ií]a|por d[ií]a|kada araw|isang araw|bawat araw)\b|\bwork from home\b|\btrabaj[oa] desde casa\b|\bdoble (ang )?pera\b/iu,
    serious: false,
    type: "prize_or_lottery",
    flag: {
      en: { title: "It promises easy money", explanation: "Surprise prizes and easy jobs are bait to get your money or details." },
      es: { title: "Promete dinero fácil", explanation: "Los premios sorpresa y los trabajos fáciles son un anzuelo para quitarle dinero o datos." },
      fil: { title: "Nangangako ito ng madaling pera", explanation: "Pain ang biglaang premyo at madaling trabaho para makuha ang pera o impormasyon ninyo." },
    },
  },
  {
    pattern:
      /\b(please )?(don'?t|do not|never) (tell|inform|call)\b[^.!?\n]{0,30}|\bno (le |les )?(digas?|cuentes?|avises?)\b[^.!?\n]{0,30}|\bkeep (this|it) (a )?secret\b|\b(huwag|wag)\b[^.!?\n]{0,25}\b(sabihin|sasabihin|ipaalam|banggitin|ikwento|ipagsabi)\b[^.!?\n]{0,30}|\batin[- ]atin lang\b/iu,
    serious: true,
    type: "family_emergency",
    flag: {
      en: { title: "It tells you to keep this secret", explanation: "Scammers ask for secrecy so nobody can warn you." },
      es: { title: "Le pide guardar el secreto", explanation: "Los estafadores piden secreto para que nadie pueda advertirle." },
      fil: { title: "Pinapalihim nito sa inyo", explanation: "Pinapalihim ng mga scammer para walang makapagbabala sa inyo." },
    },
  },
  {
    pattern:
      /\b(final notice|urgent|immediately|within \d+ (hours?|days?)|today|right now|before it expires|aviso final|urgente|de inmediato|inmediatamente|en \d+ horas|hoy|ahora mismo|ngayon na|ngayon din|ngayong araw|agad-agad|huling paalala|last slot|limited slots?|sa loob ng \d+ oras)\b[^.!?\n]{0,30}|\b(call|claim|act|reply|respond|pay|verify|llame|responda|pague)\b(\s+\w+){0,4}\s+now\b/iu,
    serious: false,
    flag: {
      en: { title: "It rushes you", explanation: "A tight deadline is meant to stop you from checking first." },
      es: { title: "Le apura", explanation: "Un plazo corto busca que no verifique antes de actuar." },
      fil: { title: "Minamadali kayo nito", explanation: "Ang maikling deadline ay para hindi na kayo makapagsuri muna." },
    },
  },
  {
    pattern:
      /[^.!?\n]{0,30}\b(arrest\w*|fine|suspend\w*|suspension|lawsuit|arrest|multa|arresto|suspensi[oó]n|demanda|kakasuhan|huhulihin|aarestuhin|mamultahan|ma-?suspend)\b[^.!?\n]{0,20}/iu,
    serious: false,
    type: "government_impersonation",
    flag: {
      en: { title: "It threatens you", explanation: "Threats of fines, arrest, or a closed account are used to scare people into paying." },
      es: { title: "Le amenaza", explanation: "Las amenazas de multas, arresto o cierre de cuenta buscan asustarle para que pague." },
      fil: { title: "Tinatakot kayo nito", explanation: "Ginagamit ang banta ng multa, pag-aresto, o pagsara ng account para takutin kayong magbayad." },
    },
  },
  {
    pattern: /[^.!?\n]{0,30}\b(password|passcode|verification code|one[- ]time code|otp|social security|ssn|pin|contraseña|c[oó]digo de verificaci[oó]n|seguro social)\b[^.!?\n]{0,20}/iu,
    serious: true,
    type: "account_phishing",
    flag: {
      en: { title: "It asks for private details", explanation: "No real company asks for your password or a one-time code by message." },
      es: { title: "Pide datos privados", explanation: "Ninguna empresa real le pide su contraseña o un código por mensaje." },
      fil: { title: "Humihingi ito ng pribadong impormasyon", explanation: "Walang totoong kumpanya na hihingi ng password o OTP ninyo sa mensahe." },
    },
  },
  {
    pattern: /https?:\/\/\S+|www\.\S+/iu,
    serious: false,
    type: "account_phishing",
    flag: {
      en: { title: "It contains a link", explanation: "Links in unexpected messages often lead to fake sites. Type the real address yourself instead." },
      es: { title: "Tiene un enlace", explanation: "Los enlaces en mensajes inesperados suelen llevar a sitios falsos. Escriba usted la dirección real." },
      fil: { title: "May link ito", explanation: "Kadalasang papunta sa pekeng site ang link sa hindi inaasahang mensahe. Kayo mismo ang mag-type ng totoong address." },
    },
  },
  {
    pattern:
      /[^.!?\n]{0,30}\b(zelle|venmo|cash ?app|wire transfer|western union|moneygram|giro|gcash|e-?wallet|padala\w*|ipadala|magpadala)\b[^.!?\n]{0,20}/iu,
    serious: false,
    flag: {
      en: { title: "It asks for a payment that is hard to undo", explanation: "Payment apps and wire transfers are hard to reverse once sent." },
      es: { title: "Pide un pago difícil de revertir", explanation: "Las aplicaciones de pago y los giros son difíciles de revertir." },
      fil: { title: "Humihingi ito ng bayad na mahirap bawiin", explanation: "Mahirap nang bawiin ang perang naipadala sa e-wallet, payment app, o remittance." },
    },
  },
];

const COPY: Record<Language, { high: [string, string]; medium: [string, string]; low: [string, string]; steps: string[] }> = {
  en: {
    high: ["This message shows several signs of a scam.", "It uses pressure and asks for things real organizations do not. Do not pay or reply."],
    medium: ["This message has a warning sign.", "It may be harmless, but check with the sender through a channel you already trust before acting."],
    low: ["We found no clear warning signs in this message.", "Our demo rules did not match anything. That does not prove the message is real."],
    steps: [
      "Do not click links, call numbers, or pay using anything in this message.",
      "Contact the company or person yourself, using a number or website you already trust.",
      "Talk it over with someone you trust before you send any money.",
    ],
  },
  es: {
    high: ["Este mensaje muestra varias señales de estafa.", "Usa presión y pide cosas que las organizaciones reales no piden. No pague ni responda."],
    medium: ["Este mensaje tiene una señal de advertencia.", "Puede ser inofensivo, pero verifique con el remitente por un medio de confianza antes de actuar."],
    low: ["No encontramos señales claras de advertencia en este mensaje.", "Nuestras reglas de demostración no encontraron nada. Eso no prueba que el mensaje sea real."],
    steps: [
      "No abra enlaces, no llame a números ni pague usando nada de este mensaje.",
      "Comuníquese usted con la empresa o la persona, con un número o sitio web en el que ya confíe.",
      "Hable con alguien de confianza antes de enviar dinero.",
    ],
  },
  fil: {
    high: ["Maraming palatandaan ng scam ang mensaheng ito.", "Minamadali kayo nito at humihingi ng mga bagay na hindi hinihingi ng totoong organisasyon. Huwag magbayad o sumagot."],
    medium: ["May palatandaan ng scam ang mensaheng ito.", "Baka wala itong masamang pakay, pero tanungin muna ang nagpadala sa paraang pinagkakatiwalaan na ninyo bago kumilos."],
    low: ["Wala kaming nakitang malinaw na palatandaan ng scam sa mensaheng ito.", "Walang tumugma sa aming demo rules. Hindi ito patunay na totoo ang mensahe."],
    steps: [
      "Huwag i-click ang mga link, tawagan ang mga numero, o magbayad gamit ang anumang nasa mensaheng ito.",
      "Kayo mismo ang kumontak sa kumpanya o tao, gamit ang numero o website na pinagkakatiwalaan na ninyo.",
      "Pag-usapan muna ito kasama ang taong pinagkakatiwalaan ninyo bago magpadala ng pera.",
    ],
  },
};

export function demoAnalysis(message: string, language: Language): Analysis {
  const matched = RULES.map((rule) => ({ rule, match: rule.pattern.exec(message) })).filter((m) => m.match);
  const serious = matched.some((m) => m.rule.serious);
  const risk = serious || matched.length >= 2 ? "high" : matched.length === 1 ? "medium" : "low";
  const [headline, summary] = COPY[language][risk];
  return {
    risk,
    scam_type: matched.find((m) => m.rule.type)?.rule.type ?? (matched.length ? "other" : "none_identified"),
    headline,
    summary,
    red_flags: matched.map(({ rule, match }) => ({ ...rule.flag[language], quote: match?.[0].trim() || null })),
    next_steps: COPY[language].steps,
  };
}

export function demoDisputeKit(details: DisputeDetails, language: Language): DisputeKit {
  const fill = (value: string, placeholder: string) => value.trim() || `[${placeholder}]`;
  if (language === "es") {
    return {
      letter_subject: "Reporte de fraude y solicitud de ayuda",
      letter_body: `Estimados señores de ${fill(details.institution, "nombre del banco o la empresa")}:\n\nEl ${fill(details.paymentDate, "fecha del pago")} envié ${fill(details.amount, "monto")} a ${fill(details.recipient, "destinatario")}. Ahora creo que fue un fraude. Esto es lo que pasó: ${details.whatHappened}\n\nLes pido que detengan cualquier transferencia pendiente, investiguen e intenten recuperar los fondos, protejan mi cuenta y me confirmen por escrito el número de caso.\n\nAtentamente,\n[su nombre]\n[últimos cuatro dígitos de su cuenta]`,
      call_script: [
        "Llame al número de su tarjeta o estado de cuenta y pida el departamento de fraude.",
        "Diga: \"Envié dinero por una estafa y necesito reportarlo hoy\".",
        "Dé la fecha, el monto y a quién le pagó.",
        "Pida que detengan cualquier pago pendiente y que intenten recuperar el dinero.",
        "Anote el número de caso y el nombre de la persona que le atendió.",
      ],
      evidence_checklist: ["Capturas de pantalla de los mensajes", "Recibos o comprobantes del pago", "El número o correo que le contactó", "Fechas y horas de cada contacto"],
    };
  }
  if (language === "fil") {
    return {
      letter_subject: "Report ng panloloko at paghingi ng tulong",
      letter_body: `Sa ${fill(details.institution, "pangalan ng bangko o kumpanya")}:\n\nNoong ${fill(details.paymentDate, "petsa ng pagbabayad")}, nagpadala ako ng ${fill(details.amount, "halaga")} kay ${fill(details.recipient, "pinadalhan")}. Naniniwala na ako ngayon na panloloko ito. Ito ang nangyari: ${details.whatHappened}\n\nHinihiling ko po na pigilan ang anumang nakabinbing transfer, imbestigahan at subukang bawiin ang pera, protektahan ang aking account, at kumpirmahin sa sulat ang case number.\n\nLubos na gumagalang,\n[inyong pangalan]\n[huling apat na numero ng inyong account]`,
      call_script: [
        "Tawagan ang numerong nasa card, statement, o opisyal na app, at hanapin ang fraud department.",
        "Sabihin: \"Nagpadala po ako ng pera dahil sa scam, at kailangan ko itong i-report ngayon.\"",
        "Ibigay ang petsa, ang halaga, at kung kanino kayo nagbayad.",
        "Hilingin na pigilan ang anumang nakabinbing bayad at subukang bawiin ang pera.",
        "Isulat ang case number at ang pangalan ng nakausap ninyo.",
      ],
      evidence_checklist: ["Screenshot ng mga mensahe", "Resibo o patunay ng bayad", "Ang numero o email na kumontak sa inyo", "Petsa at oras ng bawat kontak"],
    };
  }
  return {
    letter_subject: "Fraud report and request for help",
    letter_body: `Dear ${fill(details.institution, "name of bank or company")},\n\nOn ${fill(details.paymentDate, "date of payment")}, I sent ${fill(details.amount, "amount")} to ${fill(details.recipient, "who you paid")}. I now believe this was fraud. Here is what happened: ${details.whatHappened}\n\nPlease stop any pending transfer, investigate and try to recover the funds, protect my account, and confirm the case number in writing.\n\nSincerely,\n[your name]\n[last four digits of your account]`,
    call_script: [
      "Call the number on your card or statement and ask for the fraud department.",
      "Say: \"I sent money because of a scam, and I need to report it today.\"",
      "Give the date, the amount, and who you paid.",
      "Ask them to stop any pending payment and to try to recover the money.",
      "Write down the case number and the name of the person you spoke to.",
    ],
    evidence_checklist: ["Screenshots of the messages", "Receipts or payment confirmations", "The number or email that contacted you", "Dates and times of each contact"],
  };
}
