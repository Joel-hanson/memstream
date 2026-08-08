import { cn } from "@/lib/utils";

/** Brand mark: live memory stream — geometric shards with a pulse node. */
export function MemstreamMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-4", className)}
      aria-hidden
    >
      {/* Left memory shard */}
      <path
        fill="currentColor"
        d="M2 6.5h6.2L10.5 12 8.2 17.5H2L4.3 12 2 6.5Z"
      />
      {/* Center stream facet */}
      <path
        fill="currentColor"
        fillOpacity="0.72"
        d="M9.1 6.5h5.8L17.2 12 14.9 17.5H9.1L11.4 12 9.1 6.5Z"
      />
      {/* Right outgoing stream */}
      <path
        fill="currentColor"
        fillOpacity="0.45"
        d="M15.8 6.5H22L19.7 12 22 17.5h-6.2L13.5 12l2.3-5.5Z"
      />
      {/* Live pulse node */}
      <circle cx="12" cy="12" r="1.65" fill="currentColor" />
    </svg>
  );
}
