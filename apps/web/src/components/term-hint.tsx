"use client";

import { RiInformationLine } from "@remixicon/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Inline label + info tooltip for product jargon. */
export function TermHint({
  children,
  hint,
  className,
}: {
  children: React.ReactNode;
  hint: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            className="inline-flex shrink-0 cursor-help text-muted-foreground transition-colors hover:text-foreground"
            aria-label={
              typeof children === "string"
                ? `What is ${children}?`
                : "More information"
            }
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <RiInformationLine className="size-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          sideOffset={6}
          className="max-w-[16rem] text-left leading-relaxed"
        >
          {hint}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
