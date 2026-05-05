"use client";

import { useEffect, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import {
  DEFAULT_LOCALE,
  getLocaleDirection,
  normalizeLocale,
  type SupportedLocale,
} from "@/lib/i18n";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import frCaMessages from "@/messages/fr-CA.json";
import deMessages from "@/messages/de.json";
import ptBrMessages from "@/messages/pt-BR.json";
import zhCnMessages from "@/messages/zh-CN.json";
import jaMessages from "@/messages/ja.json";
import koMessages from "@/messages/ko.json";
import hiMessages from "@/messages/hi.json";
import arMessages from "@/messages/ar.json";

type Messages = Record<string, unknown>;

const messages: Record<SupportedLocale, Messages> = {
  en: enMessages,
  es: esMessages,
  "fr-CA": frCaMessages,
  de: deMessages,
  "pt-BR": ptBrMessages,
  "zh-CN": zhCnMessages,
  ja: jaMessages,
  ko: koMessages,
  hi: hiMessages,
  ar: arMessages,
};

function mergeMessages<T extends Record<string, unknown>>(fallback: T, overrides: Partial<T>): T {
  const merged = { ...fallback };
  for (const [key, value] of Object.entries(overrides)) {
    const fallbackValue = fallback[key];
    if (
      value &&
      fallbackValue &&
      typeof value === "object" &&
      typeof fallbackValue === "object" &&
      !Array.isArray(value) &&
      !Array.isArray(fallbackValue)
    ) {
      merged[key as keyof T] = mergeMessages(
        fallbackValue as Record<string, unknown>,
        value as Record<string, unknown>,
      ) as T[keyof T];
    } else if (value !== undefined) {
      merged[key as keyof T] = value as T[keyof T];
    }
  }
  return merged;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { organization } = useAuth();
  const locale = normalizeLocale(organization?.language);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = getLocaleDirection(locale);
  }, [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={mergeMessages(messages[DEFAULT_LOCALE], messages[locale] ?? {})}>
      {children}
    </NextIntlClientProvider>
  );
}
