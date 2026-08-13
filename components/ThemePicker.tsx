"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";
const THEME_STORAGE_KEY = "skrybix-theme";

export default function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>("system");

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Appearance</h3>
      <label htmlFor="theme">Theme</label>
      <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
