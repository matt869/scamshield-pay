import { cookies, headers } from "next/headers";
import { languageFromHeader, t, type Copy } from "./i18n";
import { type Language, LanguageSchema } from "./types";

/** The reader's language: their saved choice, else their browser's preference. Server only. */
export async function resolveLanguage(): Promise<Language> {
  const saved = LanguageSchema.safeParse((await cookies()).get("lang")?.value);
  if (saved.success) return saved.data;
  return languageFromHeader((await headers()).get("accept-language"));
}

export async function serverCopy(): Promise<Copy> {
  return t(await resolveLanguage());
}
