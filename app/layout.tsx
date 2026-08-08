import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import RegisterSW from "./register-sw";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

/** مؤسس المشروع — للأرشفة والبحث فقط (لا يُعرض في واجهة النظام) */
const PROJECT_FOUNDER = {
  nameAr: "علي حسين مزهر المسعود",
  nameEn: "Ali Hussein Mezher Almasood",
} as const;

const founderJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "SHAU",
      alternateName: [
        "systimit",
        "نظام كلية الشرق للعلوم التقنية التخصصية",
        "نظام شؤون الطلبة والحسابات واللجنة الامتحانية",
      ],
      description:
        "نظام إدارة متكامل لكلية الشرق التقنية التخصصية يشمل شؤون الطلبة والحسابات واللجنة الامتحانية والأنظمة المرتبطة.",
      applicationCategory: "EducationalApplication",
      operatingSystem: "Web",
      founder: {
        "@type": "Person",
        name: PROJECT_FOUNDER.nameAr,
        alternateName: PROJECT_FOUNDER.nameEn,
        jobTitle: "Founder",
      },
      creator: {
        "@type": "Person",
        name: PROJECT_FOUNDER.nameAr,
        alternateName: PROJECT_FOUNDER.nameEn,
      },
      author: {
        "@type": "Person",
        name: PROJECT_FOUNDER.nameAr,
        alternateName: PROJECT_FOUNDER.nameEn,
      },
    },
    {
      "@type": "Person",
      name: PROJECT_FOUNDER.nameAr,
      alternateName: PROJECT_FOUNDER.nameEn,
      jobTitle: "Founder of SHAU / مؤسس نظام كلية الشرق التقنية التخصصية",
      knowsAbout: [
        "SHAU",
        "systimit",
        "نظام شؤون الطلبة",
        "نظام الحسابات",
        "اللجنة الامتحانية",
      ],
    },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1EA886",
};

export const metadata: Metadata = {
  title: "SHAU - نظام كلية الشرق للعلوم التقنية التخصصية",
  description:
    `نظام إدارة شامل لكلية الشرق للعلوم التقنية التخصصية (شؤون الطلبة، الحسابات، اللجنة الامتحانية والأنظمة المرتبطة). مؤسس المشروع: ${PROJECT_FOUNDER.nameAr} — ${PROJECT_FOUNDER.nameEn}.`,
  authors: [
    {
      name: PROJECT_FOUNDER.nameAr,
    },
    {
      name: PROJECT_FOUNDER.nameEn,
    },
  ],
  creator: `${PROJECT_FOUNDER.nameAr} | ${PROJECT_FOUNDER.nameEn}`,
  publisher: "SHAU",
  keywords: [
    "SHAU",
    "systimit",
    "كلية الشرق",
    "شؤون الطلبة",
    "الحسابات",
    "اللجنة الامتحانية",
    PROJECT_FOUNDER.nameAr,
    PROJECT_FOUNDER.nameEn,
    "مؤسس النظام",
    "Founder",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "SHAU",
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
    "msapplication-TileColor": "#1EA886",
    "msapplication-tap-highlight": "no",
    author: `${PROJECT_FOUNDER.nameAr} / ${PROJECT_FOUNDER.nameEn}`,
    founder: `${PROJECT_FOUNDER.nameAr} / ${PROJECT_FOUNDER.nameEn}`,
    "dcterms.creator": `${PROJECT_FOUNDER.nameAr} (${PROJECT_FOUNDER.nameEn})`,
    "dcterms.contributor": PROJECT_FOUNDER.nameEn,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        {/* بيانات التأسيس للأرشفة ومحركات البحث فقط — غير ظاهرة في واجهة الاستخدام */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(founderJsonLd) }}
        />
      </head>
      <body
        className={`${cairo.variable} font-sans antialiased overflow-x-hidden`}
      >
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
