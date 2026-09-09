import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";
import { fetchBranding } from "@/lib/branding";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

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
    <html lang="pt-BR">
      {isColor && (
        <head>
          <style>{`:root{--primary:${b.primaryColor};--ring:${b.primaryColor}}`}</style>
        </head>
      )}
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
