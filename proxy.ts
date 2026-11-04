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

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)",
    "/(api|trpc)(.*)",
  ],
};
