import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'openai'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./config.json'],
  },
};

export default nextConfig;
