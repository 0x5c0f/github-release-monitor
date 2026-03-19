import { NextResponse } from "next/server";

import { ApiError, toApiError } from "@/lib/server/errors";
import { getServerEnv } from "@/lib/server/env";
import { pollWatchedRepos } from "@/lib/server/release-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getBearerToken(headerValue: string | null): string | null {
  if (!headerValue) {
    return null;
  }
  const [scheme, token] = headerValue.split(" ");
  if (!scheme || !token) {
    return null;
  }
  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token.trim();
}

function isCronAuthorized(request: Request): boolean {
  const { cronAuthToken } = getServerEnv();
  if (!cronAuthToken) {
    return false;
  }

  const authHeader = request.headers.get("authorization");
  const bearerToken = getBearerToken(authHeader);
  if (bearerToken && bearerToken === cronAuthToken) {
    return true;
  }

  const customToken = request.headers.get("x-cron-token");
  if (customToken && customToken === cronAuthToken) {
    return true;
  }

  return false;
}

async function handlePoll(request: Request) {
  try {
    if (!isCronAuthorized(request)) {
      throw new ApiError(401, "UNAUTHORIZED", "Cron token 校验失败。");
    }

    const result = await pollWatchedRepos();
    return NextResponse.json(
      {
        ok: true,
        mode: "polling",
        ...result,
      },
      { status: 200 },
    );
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      { ok: false, code: apiError.code, error: apiError.message },
      { status: apiError.status },
    );
  }
}

export async function GET(request: Request) {
  return handlePoll(request);
}

export async function POST(request: Request) {
  return handlePoll(request);
}
