import type { Metadata, Viewport } from "next";
import { Archivo, Atkinson_Hyperlegible_Next } from "next/font/google";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/LanguageToggle";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { isDemoMode } from "@/lib/demo";
import { t } from "@/lib/i18n";
import { resolveLanguage } from "@/lib/language-server";
import "./globals.css";

const display = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-display" });
// Designed by the Braille Institute for low-vision readers, which suits this audience.
const body = Atkinson_Hyperlegible_Next({ subsets: ["latin"], variable: "--font-body", adjustFontFallback: false });

export const viewport: Viewport = { themeColor: "#f7faf6" };

export async function generateMetadata(): Promise<Metadata> {
  const { meta } = t(await resolveLanguage());
  return {
    title: { default: meta.title, template: "%s · ScamShield Pay" },
    description: meta.description,
    icons: { icon: "/logo.svg" },
    openGraph: { title: meta.title, description: meta.description, siteName: "ScamShield Pay", type: "website" },
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const language = await resolveLanguage();
  return (
    <html lang={language} className={`${display.variable} ${body.variable}`}>
      <body>
        <LanguageProvider initial={language}>
          <SiteHeader demo={isDemoMode()} />
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <SiteFooter />
        </LanguageProvider>
      </body>
    </html>
  );
}
