const HOTMART_CHECKOUT =
  'https://pay.hotmart.com/J107108736M?checkoutMode=10';

module.exports = function handler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, HOTMART_CHECKOUT);
};
