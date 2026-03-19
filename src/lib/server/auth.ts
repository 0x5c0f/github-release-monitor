import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE_NAME = "grm_auth";
export const AUTH_HEADER_NAME = "x-app-password";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, password: string): string {
  return createHmac("sha256", password).update(payload).digest("base64url");
}

function extractCookieValue(cookieHeader: string | null, key: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((item) => item.trim());
  for (const cookie of cookies) {
    if (!cookie.startsWith(`${key}=`)) {
      continue;
    }
    return cookie.slice(key.length + 1);
  }
  return null;
}

export function getAppLoginPassword(): string | null {
  const preferred = process.env.APP_LOGIN_PASSWORD?.trim();
  if (preferred) {
    return preferred;
  }
  const legacy = process.env.APP_PASSWORD?.trim();
  if (legacy) {
    return legacy;
  }
  return null;
}

export function getSessionTtlSeconds(): number {
  const raw = process.env.APP_SESSION_TTL_SECONDS?.trim();
  if (!raw) {
    return 60 * 60 * 24;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60 * 60 * 24;
  }

  return parsed;
}

export function createSessionToken(password: string, ttlSeconds: number): string {
  const payload = JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    nonce: randomBytes(12).toString("hex"),
  });

  const encodedPayload = base64UrlEncode(payload);
  const signature = signPayload(encodedPayload, password);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  password: string,
): boolean {
  if (!token) {
    return false;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = signPayload(encodedPayload, password);
  if (!safeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as {
      exp?: number;
    };
    if (!payload.exp || !Number.isFinite(payload.exp)) {
      return false;
    }
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export function isAuthorizedRequest(request: Request): boolean {
  const password = getAppLoginPassword();
  if (!password) {
    return false;
  }

  const headerPassword = request.headers.get(AUTH_HEADER_NAME);
  if (headerPassword && safeEqual(headerPassword, password)) {
    return true;
  }

  const cookieToken = extractCookieValue(
    request.headers.get("cookie"),
    AUTH_COOKIE_NAME,
  );
  return verifySessionToken(cookieToken, password);
}
