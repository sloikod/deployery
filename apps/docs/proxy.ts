import { NextRequest, NextResponse } from 'next/server';
import { isMarkdownPreferred } from 'fumadocs-core/negotiation';
import { docsContentRoute } from '@/lib/shared';

const reservedPrefixes = ['/api', '/og', '/llms', '/_next'];

function isReservedPath(pathname: string) {
  if (pathname === '/favicon.ico') return true;
  return reservedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function toMarkdownPath(pathname: string) {
  const normalized =
    pathname === '/' ? '' : pathname.replace(/\/$/, '').replace(/\.mdx$/, '');

  return `${docsContentRoute}${normalized}/content.md`;
}

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isReservedPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.endsWith('.mdx')) {
    return NextResponse.rewrite(new URL(toMarkdownPath(pathname), request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    return NextResponse.rewrite(new URL(toMarkdownPath(pathname), request.nextUrl));
  }

  return NextResponse.next();
}
