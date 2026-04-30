import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { AuthHeaderProvider } from "@/providers/AuthHeaderProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

const themeInitScript = `
(function () {
  try {
    var storedTheme = localStorage.getItem("theme");
    var systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
      
    var theme = (storedTheme === "light") || (storedTheme === "dark") ? storedTheme : systemTheme;
    
    document.documentElement.dataset.theme = theme;
  } catch (e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body
        className={inter.className}
        suppressHydrationWarning
      >
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <NuqsAdapter>
          <AuthHeaderProvider>{children}</AuthHeaderProvider>
        </NuqsAdapter>
        <Toaster />
      </body>
    </html>
  );
}
