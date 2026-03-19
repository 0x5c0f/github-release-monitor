"use client";

import { type FormEvent, useState } from "react";

export default function LoginGate() {
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };

      if (!response.ok || !payload.ok) {
        setErrorMessage(payload.error ?? "登录失败，请重试。");
        return;
      }

      window.location.reload();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "登录失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="mx-auto mt-12 w-full max-w-md rounded-3xl border border-[#d9ccb8] bg-[#fffaf2]/90 p-6 shadow-[0_24px_80px_-42px_rgba(125,95,42,0.65)] backdrop-blur">
      <h2 className="text-xl font-bold text-[#2f2516]">请输入访问密码</h2>
      <p className="mt-2 text-sm text-[#6f5a3c]">
        登录成功后将写入会话 cookie，后续页面与 API 请求会自动携带鉴权信息。
      </p>

      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold tracking-wide text-[#7b6648]">
            访问密码
          </span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-xl border border-[#d8c7ae] bg-white px-4 py-3 text-[#2c2418] outline-none transition focus:border-[#c79849] focus:ring-2 focus:ring-[#f5ddb6]"
            placeholder="请输入密码"
          />
        </label>

        {errorMessage ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting || password.trim().length === 0}
          className="w-full rounded-full bg-[#b4772c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#99611f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "登录中..." : "登录"}
        </button>
      </form>
    </section>
  );
}
