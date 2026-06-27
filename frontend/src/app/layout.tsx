import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "SubStrata — Memory-Driven Land Classification",
  description: "A self-improving land-cover classification agent that gets less wrong over time — through memory, not retraining.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-slate-100 text-slate-900 min-h-screen antialiased">{children}</body>
    </html>
  );
}
