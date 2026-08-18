"use client";

import { Button } from "@/components/ui/button";

export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium">Shop could not load</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {error.message.trim() || "A server-side exception occurred."}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
