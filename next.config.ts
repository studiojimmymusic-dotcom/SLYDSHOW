import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'openai', 'opentype.js'],
};

export default nextConfig;
