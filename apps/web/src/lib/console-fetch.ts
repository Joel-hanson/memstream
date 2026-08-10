/** Browser fetch wrapper that sends the optional console token + org context. */

import { readStoredOrgId } from "@/lib/org-session";

function bearerToken(): string {
  return (
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_MEMSTREAM_CONSOLE_TOKEN?.trim()) ||
    ""
  );
}

/** fetch() with Authorization Bearer and X-Memstream-Org when set. */
export function consoleFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = bearerToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const orgId = readStoredOrgId();
  if (orgId && !headers.has("X-Memstream-Org")) {
    headers.set("X-Memstream-Org", orgId);
  }
  return fetch(input, { ...init, headers });
}
