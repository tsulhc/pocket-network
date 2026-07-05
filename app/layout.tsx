import type { Metadata } from "next";
import { Kumbh_Sans } from "next/font/google";

import "@/app/globals.css";
import SiteFooter from "@/app/site-footer";
import SiteNav from "@/app/site-nav";

const kumbhSans = Kumbh_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-kumbh-sans"
});

export const metadata: Metadata = {
  title: "Pocket Network Analytics",
  description: "Public service demand, relay, reward, and network coverage analytics for Pocket Network."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${kumbhSans.variable}`}>
      <body>
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
