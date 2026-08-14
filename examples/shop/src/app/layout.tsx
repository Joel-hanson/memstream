import type { Metadata } from "next";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const shopSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-shop-sans",
  display: "swap",
});

const shopDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-shop-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Acme Supply",
  description: "Example customer app — live writes into CockroachDB for Memstream",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${shopSans.variable} ${shopDisplay.variable} ${jetbrainsMono.variable}`}
    >
      <body className="shop-app min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
