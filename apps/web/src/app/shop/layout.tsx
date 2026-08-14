import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acme Supply →",
  description: "Redirecting to the example shop app",
};

export default function ShopRedirectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
