import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import RegisterSW from "./register-sw";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SHAU - نظام كلية الشرق للعلوم التقنية التخصصية",
  description: "نظام إدارة شامل لكلية الشرق للعلوم التقنية التخصصية",
  manifest: "/manifest.json",
  themeColor: "#991b1b",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SHAU",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  },
  other: {
    "application-name": "SHAU",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "apple-mobile-web-app-title": "SHAU",
    "format-detection": "telephone=no",
    "mobile-web-app-capable": "yes",
    "msapplication-TileColor": "#991b1b",
    "msapplication-tap-highlight": "no",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body
        className={`${cairo.variable} font-sans antialiased`}
      >
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
