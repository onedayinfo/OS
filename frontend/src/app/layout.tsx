import type { Metadata } from "next";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { fetchBranding } from "@/lib/branding";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const geist = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-sans", weight: "100 900" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export async function generateMetadata(): Promise<Metadata> {
  const b = await fetchBranding();
  return {
    title: b.companyName ?? "Sistema de OS",
    description: "Sistema de ordens de serviço",
    icons: b.hasLogo ? { icon: "/api/branding/logo" } : undefined,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const b = await fetchBranding();
  const isColor = b.primaryColor && /^#[0-9a-fA-F]{3,8}$/.test(b.primaryColor);
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {isColor && (
          <style>{`:root,:root[data-theme="dark"]{--primary:${b.primaryColor};--ring:${b.primaryColor}}`}</style>
        )}
      </head>
      <body className={`${geist.variable} ${jetbrainsMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
