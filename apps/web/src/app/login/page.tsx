import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { webRepoRoot } from "@/lib/api";
import { parseSessionValue, SESSION_COOKIE } from "@/lib/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const root = webRepoRoot();
  const jar = await cookies();
  const session = parseSessionValue(jar.get(SESSION_COOKIE)?.value, root);
  if (session) {
    redirect("/");
  }
  return <LoginForm />;
}
