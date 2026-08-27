import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Constant-time string comparison using XOR.
 * Prevents timing side-channel attacks on token comparison.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * API Authentication Middleware
 *
 * When MC_API_TOKEN is set in .env.local, all /api/* requests require
 * a matching Authorization: Bearer <token> header.
 *
 * When MC_API_TOKEN is NOT set, all requests pass through (backwards
 * compatible for local-only development with zero configuration).
 */
export function middleware(request: NextRequest) {
  const token = process.env.MC_API_TOKEN;

  // No token configured = open access (default local dev experience)
  if (!token) return NextResponse.next();

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
  }

  // Expect "Bearer <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return NextResponse.json(
      { error: 'Invalid Authorization format. Expected: Bearer <token>' },
      { status: 401 },
    );
  }

  if (!timingSafeEqual(parts[1], token)) {
    return NextResponse.json({ error: 'Invalid API token' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
