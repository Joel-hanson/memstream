"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RiArrowDownSLine, RiSearchLine } from "@remixicon/react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TermHint } from "@/components/term-hint";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ProfileRule } from "@/lib/types";
import {
  extractTemplateTokens,
  insertTokenAtCursor,
  previewChunkTemplate,
  suggestedTokens,
  truncateTemplate,
} from "@/lib/chunk-template";

type Props = {
  rules: ProfileRule[];
  ruleEnabled: Record<string, boolean>;
  onToggle: (name: string, enabled: boolean) => void;
  onChangeTemplate: (name: string, template: string) => void;
};

function groupByTable(rules: ProfileRule[]): [string, ProfileRule[]][] {
  const map = new Map<string, ProfileRule[]>();
  for (const rule of rules) {
    const table = rule.table || "other";
    const list = map.get(table);
    if (list) list.push(rule);
    else map.set(table, [rule]);
  }
  return [...map.entries()];
}

function ruleMatches(rule: ProfileRule, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const cols = rule.when?.columns_changed?.join(" ") ?? "";
  const hay = `${rule.name} ${rule.table} ${cols} ${rule.chunk_template ?? ""}`;
  return hay.toLowerCase().includes(q);
}

function isRuleOn(
  ruleEnabled: Record<string, boolean>,
  name: string,
): boolean {
  return ruleEnabled[name] !== false;
}

export function RuleDraftList({
  rules,
  ruleEnabled,
  onToggle,
  onChangeTemplate,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [openTables, setOpenTables] = useState<Set<string>>(() => new Set());
  const initializedFor = useRef<string>("");

  const allGroups = useMemo(() => groupByTable(rules), [rules]);
  const multiTable = allGroups.length > 1;
  const showFilter = rules.length >= 6 || multiTable;

  const filteredGroups = useMemo(() => {
    const q = filter.trim();
    return allGroups
      .map(([table, tableRules]) => [
        table,
        q ? tableRules.filter((r) => ruleMatches(r, q)) : tableRules,
      ] as [string, ProfileRule[]])
      .filter(([, tableRules]) => tableRules.length > 0);
  }, [allGroups, filter]);

  const filteredRules = useMemo(
    () => filteredGroups.flatMap(([, tableRules]) => tableRules),
    [filteredGroups],
  );

  const included = rules.filter((r) => isRuleOn(ruleEnabled, r.name)).length;
  const filteredIncluded = filteredRules.filter((r) =>
    isRuleOn(ruleEnabled, r.name),
  ).length;

  // Collapse tables by default when there are multiple; keep first open.
  // Re-init when the rule set identity changes (new propose / load).
  useEffect(() => {
    const key = rules.map((r) => r.name).join("\0");
    if (key === initializedFor.current) return;
    initializedFor.current = key;
    setFilter("");
    setExpanded(null);
    if (allGroups.length <= 1) {
      setOpenTables(new Set(allGroups.map(([t]) => t)));
    } else {
      setOpenTables(new Set([allGroups[0]![0]]));
    }
  }, [rules, allGroups]);

  const prevFilter = useRef("");
  // While filtering, open matching groups. Clearing the filter collapses
  // back to the first table (multi-table only).
  useEffect(() => {
    const q = filter.trim();
    const wasFiltering = prevFilter.current.length > 0;
    prevFilter.current = q;
    if (q) {
      setOpenTables(new Set(filteredGroups.map(([t]) => t)));
      return;
    }
    if (wasFiltering && allGroups.length > 1) {
      setOpenTables(new Set([allGroups[0]![0]]));
    }
  }, [filter, filteredGroups, allGroups]);

  const toggleTable = (table: string) => {
    setOpenTables((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const setTableEnabled = (tableRules: ProfileRule[], enabled: boolean) => {
    for (const rule of tableRules) {
      onToggle(rule.name, enabled);
    }
  };

  return (
    <div className="border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
        <TermHint hint="Each rule watches a table (and optional column changes). Matching writes become a memory chunk. Expand a rule to edit the wording.">
          Rules
        </TermHint>
        <div className="flex items-center gap-2">
          {showFilter ? (
            <div className="flex items-center gap-1 font-normal">
              <button
                type="button"
                className="cursor-pointer text-[10px] uppercase tracking-wide hover:text-foreground"
                onClick={() => setTableEnabled(filteredRules, true)}
              >
                All
              </button>
              <span className="text-border">·</span>
              <button
                type="button"
                className="cursor-pointer text-[10px] uppercase tracking-wide hover:text-foreground"
                onClick={() => setTableEnabled(filteredRules, false)}
              >
                None
              </button>
            </div>
          ) : null}
          <span className="tabular-nums text-foreground">
            {filter.trim() ? (
              <>
                {filteredIncluded}
                <span className="text-muted-foreground">
                  {" "}
                  / {filteredRules.length} shown
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {included}/{rules.length}
                </span>
              </>
            ) : (
              <>
                {included}
                <span className="text-muted-foreground"> / {rules.length}</span>
              </>
            )}
          </span>
        </div>
      </div>
      {showFilter ? (
        <div className="border-b px-3 py-2">
          <div className="relative">
            <RiSearchLine
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by table, column, or rule…"
              className="h-7 pl-7"
              aria-label="Filter rules"
            />
          </div>
        </div>
      ) : null}
      <ScrollArea className="h-72">
        {filteredGroups.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No rules match “{filter.trim()}”.
          </p>
        ) : (
          <ul>
            {filteredGroups.map(([table, tableRules]) => {
              const tableOpen = !multiTable || openTables.has(table);
              const onCount = tableRules.filter((r) =>
                isRuleOn(ruleEnabled, r.name),
              ).length;
              const allOn = onCount === tableRules.length;
              const someOn = onCount > 0 && !allOn;

              return (
                <li key={table} className="border-b last:border-b-0">
                  {multiTable ? (
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-muted/80 px-3 py-1.5 backdrop-blur-sm">
                      <Checkbox
                        checked={someOn ? "indeterminate" : allOn}
                        onCheckedChange={(checked) =>
                          setTableEnabled(tableRules, checked === true)
                        }
                        aria-label={`Include all rules for ${table}`}
                      />
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 text-left"
                        onClick={() => toggleTable(table)}
                        aria-expanded={tableOpen}
                      >
                        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                          {table}
                          <span className="ml-1.5 tabular-nums text-muted-foreground/80">
                            ({onCount}/{tableRules.length})
                          </span>
                        </span>
                        <RiArrowDownSLine
                          className={cn(
                            "size-3.5 shrink-0 text-muted-foreground transition-transform",
                            tableOpen && "rotate-180",
                          )}
                          aria-hidden
                        />
                      </button>
                    </div>
                  ) : null}
                  {tableOpen ? (
                    <ul className="divide-y">
                      {tableRules.map((rule) => {
                        const isOn = isRuleOn(ruleEnabled, rule.name);
                        const isOpen = expanded === rule.name;
                        const template = rule.chunk_template ?? "";
                        const preview = template.trim()
                          ? previewChunkTemplate(template)
                          : "";
                        return (
                          <li
                            key={rule.name}
                            className={cn(!isOn && "opacity-60")}
                          >
                            <div className="flex items-start gap-3 px-3 py-2">
                              <Checkbox
                                className="mt-0.5"
                                checked={isOn}
                                onCheckedChange={(checked) =>
                                  onToggle(rule.name, checked === true)
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Include ${rule.name}`}
                              />
                              <button
                                type="button"
                                className="min-w-0 flex-1 cursor-pointer text-left"
                                onClick={() =>
                                  setExpanded((cur) =>
                                    cur === rule.name ? null : rule.name,
                                  )
                                }
                                aria-expanded={isOpen}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="font-mono text-xs text-primary">
                                      {rule.name}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {multiTable ? null : (
                                        <>
                                          {rule.table}
                                          {rule.when?.columns_changed?.length
                                            ? ` · ${rule.when.columns_changed.join(", ")}`
                                            : ""}
                                        </>
                                      )}
                                      {multiTable &&
                                      rule.when?.columns_changed?.length
                                        ? rule.when.columns_changed.join(", ")
                                        : null}
                                    </div>
                                  </div>
                                  <RiArrowDownSLine
                                    className={cn(
                                      "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                                      isOpen && "rotate-180",
                                    )}
                                    aria-hidden
                                  />
                                </div>
                                {!isOpen && preview ? (
                                  <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-foreground/80">
                                    {truncateTemplate(preview, 110)}
                                  </div>
                                ) : null}
                              </button>
                            </div>
                            {isOpen ? (
                              <RuleTemplateEditor
                                rule={rule}
                                template={template}
                                onChange={(next) =>
                                  onChangeTemplate(rule.name, next)
                                }
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function RuleTemplateEditor({
  rule,
  template,
  onChange,
}: {
  rule: ProfileRule;
  template: string;
  onChange: (next: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const chips = useMemo(() => {
    const fromRule = suggestedTokens(rule);
    const fromTemplate = extractTemplateTokens(template);
    return [...new Set([...fromRule, ...fromTemplate])];
  }, [rule, template]);
  const preview = useMemo(
    () => (template.trim() ? previewChunkTemplate(template) : "-"),
    [template],
  );

  const insert = (token: string) => {
    const el = taRef.current;
    const start = el?.selectionStart ?? template.length;
    const end = el?.selectionEnd ?? template.length;
    const { next, cursor } = insertTokenAtCursor(template, token, start, end);
    onChange(next);
    requestAnimationFrame(() => {
      const node = taRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="space-y-2 border-t bg-muted/20 px-3 py-3">
      <div className="text-[11px] font-medium text-muted-foreground">
        Chunk wording
      </div>
      <Textarea
        ref={taRef}
        value={template}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="font-mono"
        rows={4}
      />
      <div className="flex flex-wrap gap-1.5">
        {chips.map((token) => (
          <button
            key={token}
            type="button"
            className="cursor-pointer border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            onClick={() => insert(token)}
          >
            {`{{${token}}}`}
          </button>
        ))}
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted-foreground">
          Preview
        </div>
        <p className="mt-1 text-xs leading-relaxed text-foreground">{preview}</p>
      </div>
    </div>
  );
}
