const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function normalizeRepo(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/+$/, "");
}

export function ensureRepoFormat(input: string): string {
  const normalized = normalizeRepo(input);
  if (!REPO_PATTERN.test(normalized)) {
    throw new Error("repo 参数格式错误，必须是 owner/name。");
  }
  return normalized;
}

export function splitRepo(repo: string): { owner: string; name: string } {
  const normalized = ensureRepoFormat(repo);
  const [owner, name] = normalized.split("/");
  return { owner, name };
}

export function toSafeTag(tag: string): string {
  return encodeURIComponent(tag.trim());
}

export function parseBoolean(
  input: string | null | undefined,
  fallback: boolean,
): boolean {
  if (input == null) {
    return fallback;
  }

  const normalized = input.trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function toIsoOrNow(value: string | null | undefined): string {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return new Date().toISOString();
}

export function compareReleaseOrder(
  candidate: { published_at: string; release_id: number },
  existing: { published_at: string; release_id: number },
): number {
  const candidateTime = Date.parse(candidate.published_at);
  const existingTime = Date.parse(existing.published_at);
  const candidateValid = Number.isFinite(candidateTime);
  const existingValid = Number.isFinite(existingTime);

  if (candidateValid && existingValid && candidateTime !== existingTime) {
    return candidateTime > existingTime ? 1 : -1;
  }
  if (candidateValid && !existingValid) {
    return 1;
  }
  if (!candidateValid && existingValid) {
    return -1;
  }
  if (candidate.release_id !== existing.release_id) {
    return candidate.release_id > existing.release_id ? 1 : -1;
  }
  return 0;
}
