/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // prompts da IA são lidos do disco pelas rotas /api/ai/* (garante que entram no bundle da Vercel)
    outputFileTracingIncludes: { '/api/ai/**': ['./prompts/**/*'] },
  },
};

export default nextConfig;
