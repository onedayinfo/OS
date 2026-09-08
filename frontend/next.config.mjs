/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Com BACKEND_INTERNAL_URL definido, o servidor Next encaminha /api/* para o
  // backend na rede interna. Assim front e API ficam na MESMA origem pública
  // (cookie same-site) e nenhuma porta precisa ser exposta.
  async rewrites() {
    const target = process.env.BACKEND_INTERNAL_URL;
    if (!target) return [];
    return [{ source: '/api/:path*', destination: `${target.replace(/\/$/, '')}/api/:path*` }];
  },
};

export default nextConfig;
