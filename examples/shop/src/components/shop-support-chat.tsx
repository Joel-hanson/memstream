"use client";

import { useEffect, useRef, useState } from "react";
import {
  RiCustomerService2Line,
  RiSparklingLine,
  RiSendPlane2Line,
} from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  STAFF_AGENT_SUGGESTIONS,
  SUPPORT_SUGGESTIONS,
} from "@/lib/shop-catalog";
import { cn } from "@/lib/utils";

type Citation = {
  table_name: string;
  rule_name: string;
  body: string;
  source_ts: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  citations?: Citation[];
  memoryReady?: boolean;
};

type AskResponse = {
  reply?: string;
  bullets?: string[];
  citations?: Citation[];
  memory_ready?: boolean;
  detail?: string;
};

export type ShopAskPersona = "customer" | "staff";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const PERSONA = {
  customer: {
    launcher: "Support",
    title: "Acme Support",
    description:
      "Help with your orders — we look up your ticket and live status.",
    welcome:
      "Hi Alex — ask about your order and we’ll check what’s going on.",
    placeholder: "Ask about your order…",
    assistantLabel: "Support",
    suggestions: SUPPORT_SUGGESTIONS,
    pendingLabel: "Checking your order…",
    icon: "support" as const,
  },
  staff: {
    launcher: "Agent",
    title: "Staff agent",
    description:
      "Ask across live memory + SQL — prior handoffs, why a customer is upset, stock patterns.",
    welcome:
      "Ops assist — search Memstream memory (including past cases), then confirm with Cockroach SQL. Each ask saves a handoff note.",
    placeholder: "Ask about customers, handoffs, stock…",
    assistantLabel: "Agent",
    suggestions: STAFF_AGENT_SUGGESTIONS,
    pendingLabel: "Searching memory, then confirming with SQL…",
    icon: "agent" as const,
  },
} as const;

/**
 * In-app ask sheet. Customer Support = shopper help.
 * Staff Agent = RAG demo surface (memory + SQL).
 */
export function ShopAskChat({
  persona,
  open,
  onOpenChange,
  highlight = false,
}: {
  persona: ShopAskPersona;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlight?: boolean;
}) {
  const copy = PERSONA[persona];
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: "welcome", role: "system", text: copy.welcome },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const personaRef = useRef(persona);

  useEffect(() => {
    if (personaRef.current === persona) return;
    personaRef.current = persona;
    setMessages([{ id: "welcome", role: "system", text: PERSONA[persona].welcome }]);
    setInput("");
    setPending(false);
  }, [persona]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open, pending]);

  async function ask(query: string) {
    const q = query.trim();
    if (!q || pending) return;

    setInput("");
    setMessages((prev) => [...prev, { id: uid(), role: "user", text: q }]);
    setPending(true);

    try {
      const res = await fetch("/api/shop/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, persona }),
      });
      const data = (await res.json()) as AskResponse;
      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: "assistant",
            text: data.detail || "Something went wrong. Try again in a moment.",
          },
        ]);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: data.reply || (data.bullets || []).join("\n") || "No answer.",
          citations: data.citations,
          memoryReady: data.memory_ready,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: "Could not reach the ask service. Is the web app still running?",
        },
      ]);
    } finally {
      setPending(false);
    }
  }

  const LauncherIcon =
    copy.icon === "agent" ? RiSparklingLine : RiCustomerService2Line;

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className={cn(
          "fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border border-primary/20 bg-primary px-4 py-3 text-sm text-primary-foreground shadow-md transition-transform duration-300 hover:-translate-y-0.5",
          highlight && "animate-in fade-in zoom-in-95 duration-500",
        )}
        aria-label={`Open ${copy.launcher}`}
      >
        <LauncherIcon className="size-4" />
        <span className="font-medium">{copy.launcher}</span>
        {highlight ? (
          <span className="size-2 animate-pulse rounded-full bg-primary-foreground" />
        ) : null}
      </button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="w-full gap-0 p-0 sm:max-w-md"
          showCloseButton
        >
          <SheetHeader className="border-b">
            <SheetTitle className="font-(family-name:--font-shop-display) text-base tracking-tight">
              {copy.title}
            </SheetTitle>
            <SheetDescription>{copy.description}</SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "animate-in fade-in slide-in-from-bottom-2 duration-300",
                    m.role === "user" && "ml-6 rounded-lg border border-border bg-muted/40 px-3 py-2",
                    m.role === "assistant" &&
                      "mr-2 rounded-lg border border-border bg-card px-3 py-2",
                    m.role === "system" && "text-xs text-muted-foreground",
                  )}
                >
                  {m.role !== "system" ? (
                    <div className="mb-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                      {m.role === "user" ? "You" : copy.assistantLabel}
                    </div>
                  ) : null}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {m.text}
                  </p>
                  {m.citations && m.citations.length > 0 ? (
                    <details
                      className="mt-2 border-t pt-2"
                      open={persona === "staff"}
                    >
                      <summary className="cursor-pointer text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
                        Memory cited ({m.citations.length})
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {m.citations.map((c, i) => (
                          <li
                            key={`${c.table_name}-${i}`}
                            className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">
                              {c.table_name}
                            </span>
                            <span> · {c.rule_name}</span>
                            <p className="mt-1 text-foreground/80">{c.body}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {m.role === "assistant" && m.memoryReady === false ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {persona === "staff"
                        ? "No chunks matched yet — check Live, then ask again."
                        : "Still catching up on recent activity — try again in a moment."}
                    </p>
                  ) : null}
                </div>
              ))}
              {pending ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="size-3.5" />
                  {copy.pendingLabel}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <div className="border-t px-4 py-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {copy.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={pending}
                    onClick={() => void ask(s)}
                    className="rounded-md border border-border bg-muted/30 px-2 py-1 text-left text-[0.65rem] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(input);
                }}
              >
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={copy.placeholder}
                  disabled={pending}
                  className="h-9"
                  aria-label={`${copy.launcher} question`}
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending || !input.trim()}
                  className="shrink-0"
                >
                  {pending ? <Spinner /> : <RiSendPlane2Line />}
                  Ask
                </Button>
              </form>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Prefer ShopAskChat; thin alias for older imports. */
export function ShopSupportChat({
  open,
  onOpenChange,
  highlight = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlight?: boolean;
}) {
  return (
    <ShopAskChat
      persona="customer"
      open={open}
      onOpenChange={onOpenChange}
      highlight={highlight}
    />
  );
}
