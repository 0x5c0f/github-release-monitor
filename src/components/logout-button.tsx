"use client";

import { useState } from "react";

export default function LogoutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleLogout() {
    setIsSubmitting(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      window.location.reload();
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isSubmitting}
      className="rounded-full border border-[#c49d62] bg-white px-4 py-2 text-xs font-semibold text-[#7a5018] transition hover:bg-[#fff4e1] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isSubmitting ? "退出中..." : "退出登录"}
    </button>
  );
}
