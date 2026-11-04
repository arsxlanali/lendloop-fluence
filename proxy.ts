import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const isBoard = createRouteMatcher(["/board(.*)"]);
const configured =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

const clerk = configured
  ? clerkMiddleware(async (auth, request) => {
      if (isBoard(request)) await auth.protect();
    })
  : null;

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (clerk) return clerk(request, event);
  // Without Clerk keys only the setup screen works. In production that is a broken deploy:
  // fail closed rather than serve pages without the auth layer.
  if (process.env.NODE_ENV === "production")
    return new NextResponse("Service not configured", { status: 503 });
  return NextResponse.next();
}

// Only the signed-in area needs the middleware. The public homepage stays a static page served
// without running Clerk on the server (its sign-in button works client-side).
export const config = {
  matcher: ["/board/:path*", "/(api|trpc)(.*)"],
};
