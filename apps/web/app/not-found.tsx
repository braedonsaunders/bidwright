"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg text-fg">
      <div className="text-center">
        <h1 className="text-4xl font-semibold">404</h1>
        <p className="mt-2 text-sm text-fg/50">{t("title")}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
