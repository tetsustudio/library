import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // The registry JSON is static and public: anyone can install from it.
  async headers() {
    return [
      {
        source: '/r/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=300' },
        ],
      },
    ]
  },
}

export default nextConfig
