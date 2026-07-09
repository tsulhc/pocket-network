import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ACCESS_TOKEN = process.env.PRIVATE_DASHBOARD_ACCESS_TOKEN;
const COOKIE_NAME = "pocket_provider_auth";

export function middleware(request: NextRequest) {
  if (!ACCESS_TOKEN) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get(COOKIE_NAME)?.value;
  if (cookieToken === ACCESS_TOKEN) {
    return NextResponse.next();
  }

  const queryToken = request.nextUrl.searchParams.get("auth");
  if (queryToken === ACCESS_TOKEN) {
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(COOKIE_NAME, ACCESS_TOKEN, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  }

  // Allow API requests — consumed internally by the public dashboard
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow static assets
  if (
    request.nextUrl.pathname.startsWith("/_next/") ||
    request.nextUrl.pathname.startsWith("/favicon") ||
    request.nextUrl.pathname.match(/\.(ico|png|svg|jpg|jpeg|webp|css|js)$/)
  ) {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/api/auth/unauthorized", request.url));
}

export const config = {
  matcher: ["/((?!_next|favicon|api/auth/unauthorized).*)"],
};
