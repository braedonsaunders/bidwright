import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import { AuthProvider, ImpersonationBanner } from "@/components/auth-provider";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${sora.variable} ${plexMono.variable}`}>
      <body>
        {/* Force text selection — Next.js 16 devtools overlay blocks it */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var style = document.createElement('style');
            style.textContent = '* { -webkit-user-select: text !important; user-select: text !important; } .select-none { -webkit-user-select: none !important; user-select: none !important; }';
            document.head.appendChild(style);
            // Also watch for dynamically injected overlays
            new MutationObserver(function(mutations) {
              mutations.forEach(function(m) {
                m.addedNodes.forEach(function(node) {
                  if (node.nodeType === 1 && node.style && node.style.userSelect === 'none') {
                    node.style.userSelect = 'text';
                    node.style.webkitUserSelect = 'text';
                    node.style.pointerEvents = 'none';
                  }
                });
              });
            }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
          })();
        `}} />
        <AuthProvider>
          <ImpersonationBanner />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
