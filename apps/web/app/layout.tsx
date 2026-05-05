import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import { AuthProvider, ImpersonationBanner } from "@/components/auth-provider";
import { I18nProvider } from "@/components/i18n-provider";
import { RequireAuth } from "@/components/require-auth";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Bidwright",
  description: "AI-powered construction estimating platform.",
  icons: {
    icon: "/bidwright-icon.png",
    apple: "/bidwright-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${sora.variable} ${plexMono.variable}`}>
      <body>
        <AuthProvider>
          <I18nProvider>
            <ImpersonationBanner />
            <RequireAuth>{children}</RequireAuth>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
