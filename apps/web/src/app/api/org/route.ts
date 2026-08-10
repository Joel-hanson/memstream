import {
  createOrg,
  createOrgInvite,
  getOrg,
  isOrgId,
  listOrgs,
  memstreamDatabaseUrl,
  redeemOrgInvite,
} from "@memstream/engine";
import { jsonError, jsonOk, readJsonBody, webRepoRoot } from "@/lib/api";
import { guardConsoleApi } from "@/lib/console-auth";

export const runtime = "nodejs";

function orgHeader(req: Request): string | null {
  const h = req.headers.get("x-memstream-org")?.trim() || "";
  return isOrgId(h) ? h : null;
}

export async function GET(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonOk({
      configured: false,
      org: null,
      orgs: [],
      detail: "MEMSTREAM_DATABASE_URL not configured",
    });
  }

  try {
    const headerOrg = orgHeader(req);
    const [orgs, current] = await Promise.all([
      listOrgs(root),
      headerOrg ? getOrg(headerOrg, root) : Promise.resolve(null),
    ]);
    return jsonOk({
      configured: true,
      org: current,
      orgs,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err), 500);
  }
}

export async function POST(req: Request) {
  const denied = guardConsoleApi(req);
  if (denied) return denied;

  const root = webRepoRoot();
  if (!memstreamDatabaseUrl(root)) {
    return jsonError("MEMSTREAM_DATABASE_URL required", 503);
  }

  const body = ((await readJsonBody(req as never)) || {}) as {
    name?: string;
    action?: "create" | "invite" | "join";
    org_id?: string;
    code?: string;
    label?: string;
  };

  const action = body.action || "create";
  try {
    if (action === "create") {
      const org = await createOrg({ name: body.name || "", root });
      return jsonOk({ org });
    }
    if (action === "invite") {
      const orgId = body.org_id?.trim() || orgHeader(req) || "";
      if (!orgId) return jsonError("org_id required", 400);
      const invite = await createOrgInvite({
        orgId,
        label: body.label,
        root,
      });
      return jsonOk({ invite });
    }
    if (action === "join") {
      const redeemed = await redeemOrgInvite({
        code: body.code || "",
        root,
      });
      return jsonOk(redeemed);
    }
    return jsonError("unknown action", 400);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : String(err));
  }
}
