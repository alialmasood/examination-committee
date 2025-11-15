import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'barcode.tec-it.com',
      },
      {
        protocol: 'https',
        hostname: 'api.qrserver.com',
      },
    ],
  },
  turbopack: {
    resolveAlias: {
      '@': './',
      '@/src': './src',
    },
  },
};

export default nextConfig;
