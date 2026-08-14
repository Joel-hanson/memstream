"use client";

import { Children, type ReactNode, useEffect, useRef, useState } from "react";
import { cn, formatRelativeTime } from "@/lib/utils";

/** Compact bordered list — sizes to content, scrolls only when tall. */
export function LogList({
  children,
  empty,
  className,
  maxHeightClass = "max-h-64",
}: {
  children?: ReactNode;
  empty?: ReactNode;
  className?: string;
  maxHeightClass?: string;
}) {
  const items = Children.toArray(children);
  return (
    <div className={cn("border bg-background", className)}>
      {items.length > 0 ? (
        <ul className={cn("divide-y overflow-y-auto", maxHeightClass)}>
          {items}
        </ul>
      ) : (
        <div className="px-3 py-4 text-xs text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}

export function LogLineRow({
  meta,
  body,
  tone = "default",
}: {
  meta?: string;
  body: string;
  tone?: "default" | "error" | "muted";
}) {
  return (
    <li
      className={cn(
        "px-3 py-2",
        tone === "error" && "bg-destructive/5",
        tone === "muted" && "bg-muted/20",
      )}
    >
      {meta ? (
        <div
          className={cn(
            "mb-0.5 text-[0.65rem]",
            tone === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {meta}
        </div>
      ) : null}
      <p
        className={cn(
          "text-xs leading-snug whitespace-pre-wrap",
          tone === "error" ? "text-destructive" : "text-foreground",
        )}
      >
        {body}
      </p>
    </li>
  );
}

/** Job / process log lines as a tight list (not a tall empty pre). */
export function LogLines({
  lines,
  empty = "No log output yet.",
  error,
  className,
  maxHeightClass,
}: {
  lines: string[];
  empty?: ReactNode;
  error?: string | null;
  className?: string;
  maxHeightClass?: string;
}) {
  const cleaned = lines.map((l) => l.trimEnd()).filter((l) => l.length > 0);
  return (
    <LogList
      className={className}
      empty={empty}
      maxHeightClass={maxHeightClass}
    >
      {error ? (
        <LogLineRow key="error" meta="Error" body={error} tone="error" />
      ) : null}
      {cleaned.map((line, i) => (
        <LogLineRow key={`${i}-${line.slice(0, 24)}`} body={line} />
      ))}
    </LogList>
  );
}

export type MemoryChunk = {
  created_at: string;
  rule_name: string;
  table_name: string;
  body: string;
};

function chunkKey(c: MemoryChunk): string {
  return `${c.created_at}|${c.rule_name}|${c.table_name}|${c.body}`;
}

/** Structured memory chunks — rule/table meta + readable body. */
export function MemoryChunkList({
  chunks,
  empty,
  className,
  maxHeightClass = "max-h-80",
}: {
  chunks: MemoryChunk[];
  empty?: ReactNode;
  className?: string;
  maxHeightClass?: string;
}) {
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef(new Map<string, number>());
  const [flashKeys, setFlashKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const keys = chunks.map(chunkKey);
    if (seenRef.current === null) {
      seenRef.current = new Set(keys);
      return;
    }

    const incoming = keys.filter((key) => !seenRef.current!.has(key));
    if (incoming.length === 0) return;

    for (const key of incoming) {
      seenRef.current.add(key);
    }
    setFlashKeys((prev) => {
      const next = new Set(prev);
      for (const key of incoming) next.add(key);
      return next;
    });

    for (const key of incoming) {
      const existing = timersRef.current.get(key);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(key);
        setFlashKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 1500);
      timersRef.current.set(key, timer);
    }
  }, [chunks]);

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  return (
    <LogList
      className={className}
      empty={empty}
      maxHeightClass={maxHeightClass}
    >
      {chunks.map((c) => {
        const key = chunkKey(c);
        return (
          <li
            key={key}
            className={cn(
              "px-3 py-2.5",
              flashKeys.has(key) && "animate-memory-in",
            )}
          >
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-[0.65rem] text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {c.rule_name}
                </span>
                {" · "}
                {c.table_name}
              </span>
              <span className="shrink-0 text-[0.65rem] text-muted-foreground tabular-nums">
                {formatRelativeTime(c.created_at)}
              </span>
            </div>
            <p className="text-xs leading-relaxed text-foreground">{c.body}</p>
          </li>
        );
      })}
    </LogList>
  );
}
