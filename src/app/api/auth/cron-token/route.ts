import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CRON_TOKEN_SCOPE,
  createCronAccessToken,
  getAppLoginPassword,
  isAuthorizedRequest,
} from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    ttlSeconds: z.number().int().positive().optional(),
    ttlMinutes: z.number().int().positive().optional(),
  })
  .default({});

export async function POST(request: Request) {
  if (!isAuthorizedRequest(request)) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHORIZED", error: "请先登录后再操作。" },
      { status: 401 },
    );
  }

  const password = getAppLoginPassword();
  if (!password) {
    return NextResponse.json(
      {
        ok: false,
        code: "MISSING_LOGIN_PASSWORD",
        error: "缺少 APP_LOGIN_PASSWORD 环境变量。",
      },
      { status: 500 },
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_BODY", error: "请求体参数错误。" },
      { status: 400 },
    );
  }

  const ttlSeconds =
    parsed.data.ttlSeconds ?? (parsed.data.ttlMinutes ?? 60) * 60;
  const tokenResult = createCronAccessToken(password, ttlSeconds);

  return NextResponse.json(
    {
      ok: true,
      tokenType: "cron",
      scope: CRON_TOKEN_SCOPE,
      ttlSeconds: tokenResult.ttlSeconds,
      expiresAt: tokenResult.expiresAt,
      token: tokenResult.token,
    },
    { status: 200 },
  );
}
