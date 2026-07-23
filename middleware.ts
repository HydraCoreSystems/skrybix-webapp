import { NextRequest, NextResponse } from "next/server";

// Server-enforced HTTP Basic Auth gate. Runs before every request (Vercel
// Edge Middleware), so it protects API routes and server actions too, not
// just page navigation — a frontend-only lock screen would be trivially
// bypassed by hitting a route directly. Deliberately fails closed if
// SITE_PASSWORD isn't configured, rather than silently letting requests
// through unauthenticated.
export function middleware(request: NextRequest) {
  const validPassword = process.env.SITE_PASSWORD;
  if (!validPassword) {
    return new NextResponse("Site password not configured", { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const [, password] = decoded.split(":");
    if (password === validPassword) {
      return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Skrybix"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
