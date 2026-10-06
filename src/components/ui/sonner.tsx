"use client";

import { Toaster } from "sonner";
import { useAppTheme } from "@/app/hooks/useAppTheme";

export function AppToaster() {
  const theme = useAppTheme();

  return (
    <Toaster
      theme={theme}
      position="top-center"
      richColors
      closeButton
    />
  );
}
