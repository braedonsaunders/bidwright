"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RatesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=rates");
  }, [router]);
  return null;
}
