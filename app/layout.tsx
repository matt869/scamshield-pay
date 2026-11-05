import type { Metadata } from "next";
import { Archivo, Atkinson_Hyperlegible_Next } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/LanguageToggle";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { languageFromHeader, t } from "@/lib/i18n";
import { LanguageSchema, type Language } from "@/lib/types";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display" });
// Designed by the Braille Institute for low-vision readers, which suits this audience.
const body = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-body", adjustFontFallback: false });

async function resolveLanguage(): Promise<Language> {
  const saved = LanguageSchema.safeParse((await cookies()).get("lang")?.value);
  if (saved.success) return saved.data;
  return languageFromHeader((await headers()).get("accept-language"));
}

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = t(await resolveLanguage());
  return { title: meta.title, description: meta.description, icons: { icon: "/logo.svg" } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await resolveLanguage();
  return (
    <html lang={language} className={`${display.variable} ${body.variable}`}>
      <body>
        <LanguageProvider initial={language}>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </LanguageProvider>
      </body>
    </html>
  );
}
