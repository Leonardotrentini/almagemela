/** @type {import('next').NextConfig} */
const HOTMART_CHECKOUT =
  'https://pay.hotmart.com/J107108736M?checkoutMode=10';

const nextConfig = {
  async redirects() {
    return [
      {
        source: '/mapa',
        destination: HOTMART_CHECKOUT,
        permanent: false, // 302
      },
      {
        source: '/acesso',
        destination: HOTMART_CHECKOUT,
        permanent: false, // 302
      },
    ];
  },
};

module.exports = nextConfig;
