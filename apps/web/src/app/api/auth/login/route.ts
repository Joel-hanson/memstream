import {
  authLoginRequired,
  ensureDemoOperator,
  verifyOperatorPassword,
} from "@memstream/engine";
import { NextResponse } from "next/server";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  clearSessionCookieHeader,
  createSessionValue,
  parseSessionValue,
  readSessionCookie,
  sessionCookieHeader,
} from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const root = webRepoRoot();
  try {
    await ensureDemoOperator(root);
  } catch {
    /* best-effort seed */
  }
  const session = parseSessionValue(readSessionCookie(req), root);
  const required = await authLoginRequired(root);
  return jsonOk({
    authenticated: Boolean(session),
    username: session?.username ?? null,
    login_required: required,
  });
}

export async function POST(req: Request) {
  const limited = checkRateLimit(req, true);
  if (limited) return limited;

  const root = webRepoRoot();
  const body = ((await readJsonBody(req as never)) || {}) as {
    action?: string;
    username?: string;
    password?: string;
  };

  if (body.action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", clearSessionCookieHeader());
    return res;
  }

  try {
    await ensureDemoOperator(root);
  } catch (err) {
    return jsonError(
      err instanceof Error ? err.message : "Could not prepare demo operator",
      503,
    );
  }

  const username = body.username?.trim() || "";
  const password = body.password || "";
  const fields: { username?: string; password?: string } = {};
  if (!username) fields.username = "Username is required";
  else if (username.length > 64) {
    fields.username = "Username must be at most 64 characters";
  } else if (!/^[a-zA-Z0-9._@-]+$/.test(username)) {
    fields.username = "Use letters, numbers, and . _ @ - only";
  }
  if (!password) fields.password = "Password is required";
  else if (password.length > 128) {
    fields.password = "Password must be at most 128 characters";
  }
  if (fields.username || fields.password) {
    return NextResponse.json(
      {
        detail: "Check the highlighted fields",
        fields,
      },
      { status: 400 },
    );
  }

  const ok = await verifyOperatorPassword(username, password, root);
  if (!ok) {
    return jsonError("Invalid username or password", 401);
  }

  const session = createSessionValue(username, root);
  const res = NextResponse.json({ ok: true, username });
  res.headers.set("Set-Cookie", sessionCookieHeader(session));
  return res;
}
