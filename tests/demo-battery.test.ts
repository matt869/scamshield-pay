import { expect, it } from "vitest";
import { demoAnalysis } from "@/lib/demo";
import { applyGuardrails } from "@/lib/guardrails";

const CASES: Array<[string, "en" | "es", string]> = [
  // [expected, language, message]
  ["scam", "en", "USPS: Your package could not be delivered due to an incomplete address. Update your details here: https://usps-redeliver.example/track"],
  ["scam", "en", "Microsoft Security Alert: your computer has been infected. Call our certified technicians now at 202-555-0143. Do not turn off your computer."],
  ["scam", "en", "This is the IRS. You owe $2,340 in back taxes. A warrant will be issued for your arrest unless you pay today."],
  ["scam", "en", "Chase Fraud Alert: Did you attempt a $1,249.00 purchase at Walmart? Reply YES or NO. If NO, call 1-888-555-0100 immediately."],
  ["scam", "en", "Hi Mom, I dropped my phone in the toilet. This is my new number. Can you send me $800 on Zelle for rent? I'll pay you back Friday."],
  ["scam", "en", "Congratulations! You have won a $1,000 Walmart gift card. Claim your prize now before it expires."],
  ["scam", "en", "Your Amazon account has been locked due to suspicious activity. Verify your identity within 24 hours or your account will be permanently closed."],
  ["scam", "en", "Hello, I am a recruiter. Work from home, earn $500 a day liking videos. Message me on WhatsApp to start. A small deposit is required to activate your account."],
  ["scam", "en", "We sent you a verification code by mistake. Please send it back to me so I can fix my account."],
  ["scam", "en", "Your Social Security number has been suspended due to suspicious activity. Press 1 to speak to an officer."],
  ["scam", "es", "Hola mamá, cambié de número. Necesito que me hagas una transferencia urgente de $600, te explico después."],
  ["scam", "es", "Su cuenta bancaria ha sido bloqueada. Ingrese aquí para verificar sus datos: https://banco-seguro.example/login"],
  ["scam", "es", "Felicidades, ganó un premio de $5,000. Para recibirlo debe pagar $200 de impuestos con tarjetas de regalo."],
  ["safe", "en", "Hi, this is Riverside Dental reminding you of your cleaning on Tuesday at 2:30 PM. Reply C to confirm."],
  ["safe", "en", "Hey! Are we still on for dinner Saturday? I can pick you up at 6."],
  ["safe", "en", "Your prescription is ready for pickup at the pharmacy on Main Street."],
  ["safe", "en", "Thanks for the birthday gift card, Grandma! I love you."],
  ["safe", "en", "Reminder: the library is closed Monday for the holiday."],
  ["safe", "es", "Hola, ¿nos vemos el domingo en casa de la abuela? Lleva el postre."],
  ["safe", "es", "Su cita con el doctor es el jueves a las 10 de la mañana."],
];

// Demo mode is a stand-in for the AI, so the bar is modest: catch common scams, and never
// stamp an ordinary message "Stop. Do not pay."
it.each(CASES)("demo mode: %s (%s): %s", (expected, language, message) => {
  const result = applyGuardrails(demoAnalysis(message, language), message, language);
  if (expected === "scam") expect(result.risk).not.toBe("low");
  else expect(result.risk).not.toBe("high");
});
