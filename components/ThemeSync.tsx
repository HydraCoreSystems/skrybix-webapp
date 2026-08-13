"use client";

import { useEffect } from "react";

// Defensive safety net on top of layout.tsx's inline bootstrap script.
// Ported directly from gm-money-web's ThemeSync.tsx, which found real
// cases of a heavy client-component page ending up with no data-theme
// attribute at all despite localStorage correctly holding an explicit
// preference and the bootstrap script being present -- re-asserting the
// saved preference once React has mounted is a safe point after
// whatever pre-hydration issue was clearing it.
export function ThemeSync() {
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("skrybix-theme");
      const theme = saved === "light" || saved === "dark" ? saved : null;
      const current = document.documentElement.getAttribute("data-theme");
      if (theme && current !== theme) {
        document.documentElement.setAttribute("data-theme", theme);
      } else if (!theme && current) {
        document.documentElement.removeAttribute("data-theme");
      }
    } catch {
      // Non-fatal -- worst case the page falls back to the OS preference.
    }
  }, []);

  return null;
}
