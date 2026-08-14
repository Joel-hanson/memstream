import { authLoginRequired, ensureDemoOperator } from "@memstream/engine";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleApp } from "@/components/console-app";
import { webRepoRoot } from "@/lib/api";
import { parseSessionValue, SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const root = webRepoRoot();
  try {
    await ensureDemoOperator(root);
  } catch {
    /* best-effort */
  }
  const required = await authLoginRequired(root);
  if (required) {
    const jar = await cookies();
    const session = parseSessionValue(jar.get(SESSION_COOKIE)?.value, root);
    if (!session) {
      redirect("/login");
    }
  }
  return <ConsoleApp />;
}
