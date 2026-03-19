import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AUTH_COOKIE_NAME,
  createSessionToken,
  getAppLoginPassword,
  getSessionTtlSeconds,
} from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const configuredPassword = getAppLoginPassword();
  if (!configuredPassword) {
    return NextResponse.json(
      {
        ok: false,
        code: "MISSING_LOGIN_PASSWORD",
        error: "缺少 APP_LOGIN_PASSWORD 环境变量。",
      },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_JSON", error: "请求体必须是 JSON。" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, code: "INVALID_BODY", error: "password 字段不能为空。" },
      { status: 400 },
    );
  }

  if (parsed.data.password !== configuredPassword) {
    return NextResponse.json(
      { ok: false, code: "INVALID_PASSWORD", error: "密码错误。" },
      { status: 401 },
    );
  }

  const ttlSeconds = getSessionTtlSeconds();
  const token = createSessionToken(configuredPassword, ttlSeconds);

  const response = NextResponse.json(
    { ok: true, expiresIn: ttlSeconds },
    { status: 200 },
  );

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds,
  });

  return response;
}
