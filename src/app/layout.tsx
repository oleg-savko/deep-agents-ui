import { Inter } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { AuthHeaderProvider } from "@/providers/AuthHeaderProvider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Next.js layouts export `metadata` next to the page component.
// eslint-disable-next-line react-refresh/only-export-components
export const metadata = { title: "Deep Agents" };

const themeInitScript = `
(function () {
  try {
    const storedTheme = localStorage.getItem("theme");
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
      
    const theme = (storedTheme === "light") || (storedTheme === "dark") ? storedTheme : systemTheme;
    
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
        <Toaster
          position="top-center"
          richColors
          closeButton
          theme="system"
        />
      </body>
    </html>
  );
}
