import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'openai', 'opentype.js'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./config.json', './fonts/**/*'],
  },
};

export default nextConfig;
