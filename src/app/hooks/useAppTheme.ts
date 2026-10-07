"use client";

import { useSyncExternalStore } from "react";
import { THEME } from "@/app/consts/themes";

export type AppTheme = (typeof THEME)["LIGHT"] | (typeof THEME)["DARK"];

function readTheme(): AppTheme {
  const theme = document.documentElement.dataset.theme;
  return theme === THEME.LIGHT ? THEME.LIGHT : THEME.DARK;
}

function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribe, readTheme, () => THEME.DEFAULT);
}
