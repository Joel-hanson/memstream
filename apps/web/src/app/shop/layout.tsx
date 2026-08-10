import type { Metadata } from "next";
import { Fraunces } from "next/font/google";

const shopDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-shop-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Acme Supply",
  description: "Demo storefront — live writes into CockroachDB",
};

export default function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${shopDisplay.variable} shop-app min-h-screen bg-[oklch(0.985_0.004_85)] text-foreground`}
    >
      {children}
    </div>
  );
}
