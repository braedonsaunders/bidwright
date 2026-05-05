export const organizationInfoSelect = {
  id: true,
  name: true,
  slug: true,
  settings: { select: { general: true } },
} as const;

type OrganizationInfoSource = {
  id: string;
  name: string;
  slug: string;
  settings?: { general?: unknown } | null;
};

export function organizationLanguage(settings?: { general?: unknown } | null) {
  const general = settings?.general;
  if (general && typeof general === "object" && !Array.isArray(general)) {
    const language = (general as Record<string, unknown>).language;
    if (typeof language === "string" && language.trim()) return language;
  }
  return "en";
}

export function organizationInfo(org: OrganizationInfoSource | null | undefined) {
  if (!org) return null;
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    language: organizationLanguage(org.settings),
  };
}
