"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { KeyRound, UserRound } from "lucide-react";
import { SettingsShell } from "@appkit/ui";

const PROFILE_NAV = [
  {
    label: "Personal",
    items: [
      { key: "account", label: "Account", icon: <UserRound /> },
      { key: "credentials", label: "Agent credentials", icon: <KeyRound /> },
    ],
  },
];

export default function ProfileLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeKey = pathname.startsWith("/profile/credentials") ? "credentials" : "account";

  return (
    <SettingsShell
      title="Profile"
      description="Manage your personal account, security, and agent runtime access."
      back={{ href: "/", label: "Back to dashboard" }}
      nav={PROFILE_NAV}
      activeKey={activeKey}
      onSelect={(key) => router.push(key === "credentials" ? "/profile/credentials" : "/profile")}
      contentWidth="narrow"
      linkRender={({ href, className, children: linkChildren }) => (
        <Link href={href} className={className}>{linkChildren}</Link>
      )}
    >
      {children}
    </SettingsShell>
  );
}
