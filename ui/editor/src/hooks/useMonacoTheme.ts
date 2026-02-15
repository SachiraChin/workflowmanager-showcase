import { useMemo } from "react";
import { useTheme } from "@/components/theme-provider";

export function useMonacoTheme(): "vs" | "vs-dark" {
  const { resolvedTheme } = useTheme();
  return useMemo(() => (resolvedTheme === "dark" ? "vs-dark" : "vs"), [resolvedTheme]);
}
