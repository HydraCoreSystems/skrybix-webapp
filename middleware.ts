import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

// Server-enforced session gate. Runs before every request (Vercel Edge
// Middleware) except /login and /plant, so it protects API routes and
// server actions too, not just page navigation — a frontend-only lock
// screen would be trivially bypassed by hitting a route directly. Fails
// closed if AUTH_SECRET isn't configured, rather than silently letting
// requests through unauthenticated.
//
// /plant/** (the public QR-code landing pages for mothers and cuttings)
// must stay open to anyone -- that's the whole point of a QR code on a
// physical label a customer receives. They must never require the site
// password.
export async function middleware(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return new NextResponse("Auth not configured", { status: 500 });
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (await verifySessionToken(secret, token)) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|plant).*)"],
};
