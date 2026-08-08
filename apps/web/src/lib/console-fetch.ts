/** Browser fetch wrapper that sends the optional console token. */

function bearerToken(): string {
  return (
    (typeof process !== "undefined" &&
      process.env.NEXT_PUBLIC_MEMSTREAM_CONSOLE_TOKEN?.trim()) ||
    ""
  );
}

/** fetch() with Authorization Bearer when NEXT_PUBLIC_MEMSTREAM_CONSOLE_TOKEN is set. */
export function consoleFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = bearerToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
