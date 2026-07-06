/**
 * Middleware runs at the edge before any route handler — used here purely
 * as a cheap "is there a session at all" gate to redirect anonymous users
 * to /login. Fine-grained per-document role checks (Owner/Editor/Viewer)
 * intentionally happen in the route handlers instead (see auth.ts,
 * getDocumentRole), because that requires a DB lookup that shouldn't run
 * on every single request at the edge for routes that don't need it.
 */
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const session = await auth();
  const isProtected = req.nextUrl.pathname.startsWith("/documents");

  if (isProtected && !session?.user) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/documents/:path*"],
  runtime: "nodejs",
};
