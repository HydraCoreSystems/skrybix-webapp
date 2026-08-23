"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";
const THEME_STORAGE_KEY = "skrybix-theme";

export default function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>("dark");
  // Gates the write effect below until after the read effect has run --
  // without this, the write effect's initial pass (still holding the
  // "dark" default from the very first render) can fire before the read
  // effect's setTheme(saved) is applied, briefly overwriting an actual
  // saved preference before self-correcting on the next render. Cheap
  // insurance against a real, if mostly harmless, race.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      setTheme(saved);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, ready]);

  return (
    <div className="card settings-option-card">
      <p className="eyebrow">Display</p><h3>Appearance</h3>
      <label htmlFor="theme">Theme</label>
      <select id="theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeChoice)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
