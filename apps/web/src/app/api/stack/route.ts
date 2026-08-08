import { stackOutputs } from "@memstream/engine";
import { jsonOk } from "@/lib/api";
import { requireConsoleAuth } from "@/lib/console-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const denied = requireConsoleAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const stackName = url.searchParams.get("stack_name") || "memstream-demo";
  const region = url.searchParams.get("region") || "us-east-1";
  return jsonOk({ outputs: stackOutputs(stackName, region) });
}
