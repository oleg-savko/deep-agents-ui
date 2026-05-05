"use client";

import { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME } from "@/app/consts/themes";


function readThemeFromDom() {
  const themeFromDom = document.documentElement.dataset?.theme;
  if (!themeFromDom) return THEME.DEFAULT;

  return themeFromDom;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return THEME.DEFAULT;

    return readThemeFromDom();
  });

  const toggleTheme = () => {
    const currentTheme = readThemeFromDom();
    const nextTheme =
      currentTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK;
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);

    setTheme(nextTheme);
  };

  const isDark = theme === THEME.DARK;
  const Icon = isDark ? Moon : Sun;
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleTheme}
      title={label}
    >
      <Icon className="h-4 w-4" />
      <span>{isDark ? "Dark" : "Light"}</span>
    </Button>
  );
}

