"use client";

import { RiArrowDownSLine } from "@remixicon/react";
import { cn } from "@/lib/utils";

export function Advanced({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onToggle}
      >
        Advanced
        <RiArrowDownSLine
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? <div className="space-y-3 border-t p-3">{children}</div> : null}
    </div>
  );
}
