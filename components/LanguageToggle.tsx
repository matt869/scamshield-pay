"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { type Copy, t } from "@/lib/i18n";
import type { Language } from "@/lib/types";

interface LanguageContextValue {
  language: Language;
  copy: Copy;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ initial, children }: { initial: Language; children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initial);
  const router = useRouter();

  const setLanguage = useCallback(
    (next: Language) => {
      setLanguageState(next);
      document.documentElement.lang = next;
      document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
      // Re-renders the server parts, such as the tab title, in the new language.
      router.refresh();
    },
    [router],
  );

  return (
    <LanguageContext.Provider value={{ language, copy: t(language), setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useLanguage must be used inside LanguageProvider");
  return value;
}

/** Each button names its language in that language, so a reader can find their own. */
export function LanguageToggle() {
  const { language, copy, setLanguage } = useLanguage();
  const options: Array<{ value: Language; label: string }> = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
  ];
  return (
    <div className="language-toggle" role="group" aria-label={copy.nav.language}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.value}
          aria-pressed={language === option.value}
          onClick={() => setLanguage(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
