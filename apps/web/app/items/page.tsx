"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ItemsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings?tab=items");
  }, [router]);
  return null;
}
