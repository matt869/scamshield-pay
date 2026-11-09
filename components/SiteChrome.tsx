"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LanguageToggle, useLanguage } from "./LanguageToggle";

export function SiteHeader({ demo = false }: { demo?: boolean }) {
  const { copy } = useLanguage();
  const pathname = usePathname();
  return (
    <>
    {demo && (
      <p className="demo-banner" role="note">
        {copy.footer.demo}
      </p>
    )}
    <header className="site-header">
      <a className="skip-link" href="#main">
        {copy.nav.skip}
      </a>
      <Link className="brand" href="/">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={32} height={32} />
        <span>ScamShield Pay</span>
      </Link>
      <nav aria-label={copy.nav.main}>
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
          {copy.nav.check}
        </Link>
        <Link href="/help" aria-current={pathname === "/help" ? "page" : undefined}>
          {copy.nav.help}
        </Link>
      </nav>
      <LanguageToggle />
    </header>
    </>
  );
}

export function SiteFooter() {
  const { copy } = useLanguage();
  return (
    <footer className="site-footer">
      <p>{copy.footer.emergency}</p>
      <p>{copy.footer.notAffiliated}</p>
    </footer>
  );
}
