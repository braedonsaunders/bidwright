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
        {/* Neutralize Next.js 16 devtools overlay that blocks text selection.
            The devtools create a <nextjs-portal> with shadow DOM containing a
            position:fixed inset:0 element with userSelect:none. We force
            pointer-events:none on the portal so it can't capture mouse events. */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            function fixPortal() {
              document.querySelectorAll('nextjs-portal').forEach(function(el) {
                el.style.pointerEvents = 'none';
                if (el.shadowRoot) {
                  var style = document.createElement('style');
                  style.textContent = '* { pointer-events: none !important; user-select: text !important; -webkit-user-select: text !important; }';
                  if (!el.shadowRoot.querySelector('[data-fix-selection]')) {
                    style.setAttribute('data-fix-selection', '');
                    el.shadowRoot.appendChild(style);
                  }
                }
              });
            }
            // Run on load and watch for new portals
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', fixPortal);
            } else {
              fixPortal();
            }
            new MutationObserver(fixPortal).observe(document.body, { childList: true, subtree: false });
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
