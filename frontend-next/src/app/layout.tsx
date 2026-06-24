import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/navbar";
import { FloatingJobPip } from "@/components/floating-job-pip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ESG 風險評分系統",
  description: "透明可解釋的 ESG 風險評分 — 台達電 / 中鋼 / 南山人壽",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full bg-gray-50">
        <Navbar />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <FloatingJobPip />
      </body>
    </html>
  );
}
