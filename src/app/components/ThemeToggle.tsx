"use client";

import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME } from "@/app/consts/themes";
import { useAppTheme } from "@/app/hooks/useAppTheme";

export function ThemeToggle() {
  const theme = useAppTheme();

  const toggleTheme = () => {
    const nextTheme = theme === THEME.DARK ? THEME.LIGHT : THEME.DARK;
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("theme", nextTheme);
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
