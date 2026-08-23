import "./globals.css";
import Nav from "@/components/Nav";
import { ThemeSync } from "@/components/ThemeSync";

// Plain, synchronous inline script rather than next/script's
// beforeInteractive strategy -- same choice gm-money-web made after
// confirming beforeInteractive could silently fail to apply data-theme
// on specific routes (see that repo's app/layout.tsx for the full
// story). A raw <script> in <head> runs synchronously in document
// order, with no dependency on Next's own script-queueing runtime.
//
// Default is 'dark', not 'system' -- the owner is the sole user of this
// app and explicitly prefers dark, so there's no reason to make him
// pick it every time a browser's localStorage is empty (a fresh
// browser/device, or after clearing site data). An explicit System/Light
// choice in Settings still always wins once one is saved.
const THEME_BOOTSTRAP_SCRIPT = `
(() => {
  try {
    const storageKey = 'skrybix-theme';
    const savedTheme = window.localStorage.getItem(storageKey);
    const theme = savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system'
      ? savedTheme
      : 'dark';

    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export const metadata = {
  title: "Skrybix",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <Nav />
        <div className="site-atmosphere" aria-hidden="true" />
        <main className="site-main">{children}</main>
      </body>
    </html>
  );
}
