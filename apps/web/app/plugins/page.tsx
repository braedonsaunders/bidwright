"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PluginsRoute() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=plugins");
  }, [router]);
  return null;
}
