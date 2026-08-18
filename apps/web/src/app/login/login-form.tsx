"use client";

import { MemstreamMark } from "@/components/memstream-mark";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const USERNAME_MAX = 64;
const PASSWORD_MAX = 128;

type FieldErrors = {
  username?: string;
  password?: string;
};

function validateLogin(
  username: string,
  password: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const user = username.trim();
  if (!user) {
    errors.username = "Username is required";
  } else if (user.length > USERNAME_MAX) {
    errors.username = `Username must be at most ${USERNAME_MAX} characters`;
  } else if (!/^[a-zA-Z0-9._@-]+$/.test(user)) {
    errors.username =
      "Use letters, numbers, and . _ @ - only";
  }
  if (!password) {
    errors.password = "Password is required";
  } else if (password.length > PASSWORD_MAX) {
    errors.password = `Password must be at most ${PASSWORD_MAX} characters`;
  }
  return errors;
}

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("demo");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (busy) return;

    const nextErrors = validateLogin(username, password);
    setFieldErrors(nextErrors);
    setError(null);
    if (nextErrors.username || nextErrors.password) return;

    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        detail?: string;
        fields?: FieldErrors;
      };
      if (!res.ok) {
        if (data.fields) setFieldErrors(data.fields);
        setError(data.detail || "Sign-in failed");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center bg-primary text-primary-foreground">
            <MemstreamMark className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-medium tracking-tight">Memstream</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to open the console
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 border p-4" noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(fieldErrors.username) || undefined}>
              <FieldLabel htmlFor="username">Username</FieldLabel>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                required
                maxLength={USERNAME_MAX}
                aria-invalid={Boolean(fieldErrors.username) || undefined}
                aria-describedby={
                  fieldErrors.username ? "username-error" : undefined
                }
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (fieldErrors.username) {
                    setFieldErrors((prev) => ({ ...prev, username: undefined }));
                  }
                }}
                disabled={busy}
              />
              {fieldErrors.username ? (
                <FieldError id="username-error">{fieldErrors.username}</FieldError>
              ) : null}
            </Field>
            <Field data-invalid={Boolean(fieldErrors.password) || undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                required
                maxLength={PASSWORD_MAX}
                aria-invalid={Boolean(fieldErrors.password) || undefined}
                aria-describedby={
                  fieldErrors.password ? "password-error" : undefined
                }
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) {
                    setFieldErrors((prev) => ({ ...prev, password: undefined }));
                  }
                }}
                disabled={busy}
              />
              {fieldErrors.password ? (
                <FieldError id="password-error">{fieldErrors.password}</FieldError>
              ) : null}
            </Field>
          </FieldGroup>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Spinner /> : null}
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        {/* <p className="text-center text-[0.65rem] text-muted-foreground">
          Default demo credentials:{" "}
          <span className="font-mono">demo</span> /{" "}
          <span className="font-mono">demo</span>. Override with{" "}
          <span className="font-mono">MEMSTREAM_DEMO_USER</span> /{" "}
          <span className="font-mono">MEMSTREAM_DEMO_PASSWORD</span>. Passwords
          are stored hashed in Cockroach (
          <span className="font-mono">memstream_operators</span>). Set{" "}
          <span className="font-mono">MEMSTREAM_AUTH_DISABLED=1</span> to skip
          the login gate locally.
        </p> */}
      </div>
    </div>
  );
}
