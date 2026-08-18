import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { siteDescription, siteTitle } from "./site-metadata";

export const metadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
