"use client";

import { useCallback, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "dark" | "light";

function readThemeFromDom(): Theme {
  const themeFromDom = document.documentElement.dataset.theme;
  return themeFromDom === "light" ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "dark";
    return readThemeFromDom();
  });

  const toggleTheme = useCallback(() => {
    const currentTheme = readThemeFromDom();
    const nextTheme: Theme = (currentTheme === "dark") ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem("theme", nextTheme);
    } catch {
      // ignore
    }
    setTheme(nextTheme);
  }, [theme]);

  const isDark = theme === "dark";
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

