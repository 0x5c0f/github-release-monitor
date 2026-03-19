import { cookies } from "next/headers";

import CronTokenPanel from "@/components/cron-token-panel";
import LoginGate from "@/components/login-gate";
import ReleaseMonitor from "@/components/release-monitor";
import LogoutButton from "@/components/logout-button";
import { parseBoolean } from "@/lib/shared";
import {
  AUTH_COOKIE_NAME,
  getAppLoginPassword,
  verifySessionToken,
} from "@/lib/server/auth";

function parseWatchRepos(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export default async function Home() {
  const password = getAppLoginPassword();
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value ?? null;
  const isAuthenticated = Boolean(
    password && verifySessionToken(sessionToken, password),
  );

  const watchRepos = parseWatchRepos(process.env.WATCH_REPOS);
  const defaultRepo = watchRepos[0] ?? process.env.DEFAULT_REPO?.trim() ?? "";
  const defaultIncludePrerelease = parseBoolean(
    process.env.DEFAULT_INCLUDE_PRERELEASE,
    false,
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 md:px-8 md:py-14">
      <header className="mb-8">
        <div className="inline-flex items-center rounded-full border border-[#d5c6af] bg-[#fff5e4]/90 px-4 py-1 text-xs font-semibold tracking-[0.15em] text-[#8a6b3f]">
          GitHub Release 监听 + 中文翻译总结
        </div>
        <h1 className="mt-4 text-3xl font-bold leading-tight text-[#2f2516] md:text-4xl">
          GitHub Release Monitor
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-[#62523b] md:text-base">
          默认读取最新发布并展示中文总结，也支持按 tag 查询指定版本。后端使用
          Cron 轮询 + Vercel Blob，仅保留最近 N 条缓存结果。
        </p>
      </header>

      {!password ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          缺少环境变量 <code>APP_LOGIN_PASSWORD</code>，请先配置后再访问。
        </section>
      ) : null}

      {password && !isAuthenticated ? (
        <LoginGate />
      ) : null}

      {password && isAuthenticated ? (
        <>
          <div className="mb-4 flex justify-end">
            <LogoutButton />
          </div>
          <ReleaseMonitor
            defaultRepo={defaultRepo}
            defaultIncludePrerelease={defaultIncludePrerelease}
            watchRepos={watchRepos}
          />
          <div className="mt-6">
            <CronTokenPanel />
          </div>
        </>
      ) : null}
    </main>
  );
}
