import { NextResponse } from 'next/server';

const HOTMART_CHECKOUT =
  'https://pay.hotmart.com/J107108736M?checkoutMode=10';

export function GET() {
  return NextResponse.redirect(HOTMART_CHECKOUT, 302);
}

export function HEAD() {
  return NextResponse.redirect(HOTMART_CHECKOUT, 302);
}
