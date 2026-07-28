import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { ApplicationFrame } from "@/components/app-shell";
import { SplashScreen } from "@/components/brand-splash";
import { I18nProvider } from "@/components/i18n-provider";
import { RequireAuth } from "@/components/require-auth";
import "@appkit/dashboard/primitives.css";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-bidwright-mono",
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
    <html
      lang="en"
      className={plexMono.variable}
      suppressHydrationWarning
    >
      <body>
        <SplashScreen />
        <AuthProvider>
          <I18nProvider>
            <RequireAuth>
              <ApplicationFrame>{children}</ApplicationFrame>
            </RequireAuth>
          </I18nProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
