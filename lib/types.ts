import { z } from "zod";

export const LANGUAGES = ["en", "es"] as const;
export type Language = (typeof LANGUAGES)[number];
export const LanguageSchema = z.enum(LANGUAGES);

export const MESSAGE_MIN_CHARS = 15;
export const MESSAGE_MAX_CHARS = 8000;

export const RISK_LEVELS = ["high", "medium", "low"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const SCAM_TYPES = [
  "bank_impersonation",
  "government_impersonation",
  "delivery_or_toll",
  "tech_support",
  "family_emergency",
  "romance",
  "investment_or_crypto",
  "job_or_task",
  "prize_or_lottery",
  "marketplace_or_overpayment",
  "account_phishing",
  "other",
  "none_identified",
] as const;
export type ScamType = (typeof SCAM_TYPES)[number];

/**
 * What Claude must return for a message. Plain enums and strings only: the SDK turns this into
 * the JSON Schema that constrains the response.
 */
export const AnalysisSchema = z.object({
  risk: z.enum(RISK_LEVELS),
  scam_type: z.enum(SCAM_TYPES),
  headline: z.string(),
  summary: z.string(),
  red_flags: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      quote: z.string().nullable(),
    }),
  ),
  next_steps: z.array(z.string()),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** For a screenshot: the model also writes down the message it can see, which the page then marks up. */
export const ImageAnalysisSchema = AnalysisSchema.extend({ message_text: z.string() });

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** Base64 characters, about 3 MB of image. The browser shrinks screenshots well below this. */
export const IMAGE_MAX_BASE64 = 4_000_000;
export const ImageInputSchema = z.object({
  mediaType: z.enum(IMAGE_TYPES),
  data: z.string().min(100).max(IMAGE_MAX_BASE64).regex(/^[A-Za-z0-9+/]+=*$/),
});
export type ImageInput = z.infer<typeof ImageInputSchema>;
export type RedFlag = Analysis["red_flags"][number];

export const DisputeKitSchema = z.object({
  letter_subject: z.string(),
  letter_body: z.string(),
  call_script: z.array(z.string()),
  evidence_checklist: z.array(z.string()),
});
export type DisputeKit = z.infer<typeof DisputeKitSchema>;

export const PAYMENT_METHODS = [
  "credit_card",
  "debit_card",
  "bank_transfer",
  "paypal",
  "zelle_or_app",
  "gift_card",
  "crypto",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DisputeDetailsSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),
  institution: z.string().trim().max(120),
  amount: z.string().trim().max(40),
  paymentDate: z.string().trim().max(40),
  recipient: z.string().trim().max(200),
  whatHappened: z.string().trim().min(10).max(3000),
});
export type DisputeDetails = z.infer<typeof DisputeDetailsSchema>;

export type PaymentStatus = "none" | "paid" | "revoked";

/** One submitted message and everything that hangs off it. */
export interface CheckRecord {
  id: string;
  message: string;
  language: Language;
  analysis: Analysis;
  createdAt: number;
  expiresAt: number;
  paymentStatus: PaymentStatus;
  paidAt: number | null;
  invoicesSent: number;
  disputeKit: DisputeKit | null;
  disputeKitLanguage: Language | null;
  disputeGenerations: number;
}

/** The fields a page may hand to the browser. */
export type PublicCheck = Pick<
  CheckRecord,
  "id" | "message" | "language" | "analysis" | "paymentStatus" | "disputeKit" | "disputeKitLanguage"
>;

export function toPublicCheck(record: CheckRecord): PublicCheck {
  const { id, message, language, analysis, paymentStatus, disputeKit, disputeKitLanguage } = record;
  return { id, message, language, analysis, paymentStatus, disputeKit, disputeKitLanguage };
}
