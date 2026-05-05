export const DEFAULT_LOCALE = "en" as const;

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English", nativeLabel: "English", dir: "ltr" },
  { code: "es", label: "Spanish", nativeLabel: "Español", dir: "ltr" },
  { code: "fr-CA", label: "French (Canada)", nativeLabel: "Français (Canada)", dir: "ltr" },
  { code: "de", label: "German", nativeLabel: "Deutsch", dir: "ltr" },
  { code: "pt-BR", label: "Portuguese (Brazil)", nativeLabel: "Português (Brasil)", dir: "ltr" },
  { code: "zh-CN", label: "Chinese (Simplified)", nativeLabel: "简体中文", dir: "ltr" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", dir: "ltr" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", dir: "ltr" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", dir: "ltr" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", dir: "rtl" },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]["code"];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && SUPPORTED_LOCALES.some((locale) => locale.code === value);
}

export function normalizeLocale(value: unknown): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

export function getLocaleDirection(locale: SupportedLocale) {
  return SUPPORTED_LOCALES.find((entry) => entry.code === locale)?.dir ?? "ltr";
}

export function localeDisplayName(locale: SupportedLocale) {
  const entry = SUPPORTED_LOCALES.find((candidate) => candidate.code === locale);
  return entry ? `${entry.nativeLabel} (${entry.label})` : locale;
}
