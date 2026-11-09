import { describe, expect, it } from "vitest";
import { demoAnalysis, demoDisputeKit } from "@/lib/demo";
import { findQuote } from "@/lib/highlight";

describe("demo mode", () => {
  it("flags the grandparent scam as high risk with real quotes", () => {
    const message = "Grandma it's me. I need $4,000 for bail today. Please don't tell Mom and Dad. You can pay with gift cards from Target.";
    const result = demoAnalysis(message, "en");
    expect(result.risk).toBe("high");
    expect(result.red_flags.length).toBeGreaterThanOrEqual(3);
    for (const flag of result.red_flags) expect(flag.quote && findQuote(message, flag.quote)).toBeTruthy();
  });

  it("gives an ordinary reminder no warning signs, without calling it safe", () => {
    const result = demoAnalysis("Riverside Dental reminder: your cleaning is on Tuesday at 2:30 PM. Reply C to confirm.", "en");
    expect(result.risk).toBe("low");
    expect(result.headline).not.toMatch(/safe/i);
  });

  it("writes Spanish reports for Spanish readers", () => {
    expect(demoAnalysis("AVISO FINAL: pague en 24 horas para evitar una multa", "es").headline).toMatch(/señal/);
  });

  it("marks unknown letter details as blanks instead of inventing them", () => {
    const kit = demoDisputeKit(
      { paymentMethod: "gift_card", institution: "", amount: "$500", paymentDate: "", recipient: "", whatHappened: "They said my grandson was in jail." },
      "en",
    );
    expect(kit.letter_body).toContain("[date of payment]");
    expect(kit.letter_body).toContain("$500");
  });
});
