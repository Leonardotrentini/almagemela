import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export function GET() {
  const html = fs.readFileSync(path.join(process.cwd(), 'acesso', 'index.html'), 'utf8');
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function HEAD() {
  return GET();
}
