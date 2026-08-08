import { Spinner } from "@/components/ui/spinner";

export default function ShopLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="size-6" />
      <p className="font-mono text-xs">Loading shop…</p>
    </div>
  );
}
