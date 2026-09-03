const IANA_TIME_ZONE = /^(UTC|GMT|Etc\/[A-Za-z0-9_+-]+|[A-Za-z]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?)$/;

export function isIanaTimeZone(value: string | null | undefined): boolean {
  return typeof value === "string" && IANA_TIME_ZONE.test(value.trim());
}

function intlTimeZone(): string | null {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : null;
  } catch {
    return null;
  }
}

/**
 * next-intl throws ENVIRONMENT_FALLBACK when it cannot resolve a timezone
 * from the host. Electron-as-Node on Windows often has no TZ, or TZ is a
 * Windows display name like "Eastern Standard Time", which Intl rejects.
 */
export function resolveIanaTimeZone(
  envTz: string | undefined = process.env.TZ,
  hostTimeZone: string | null | undefined = intlTimeZone(),
): string {
  for (const candidate of [envTz, hostTimeZone]) {
    if (isIanaTimeZone(candidate)) return candidate!.trim();
  }
  return "UTC";
}
