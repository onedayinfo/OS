import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { fetchBranding } from "@/lib/branding";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const manrope = Manrope({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-heading" });

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
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {isColor && (
          <style>{`:root,:root[data-theme="dark"]{--primary:${b.primaryColor};--ring:${b.primaryColor}}`}</style>
        )}
      </head>
      <body className={`${inter.variable} ${manrope.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
