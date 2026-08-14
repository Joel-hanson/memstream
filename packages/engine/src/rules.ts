/** Match profile rules against CDC events. */

import { changedColumns, type ChangeEvent } from "./models.js";
import type { Profile, Rule } from "./profile.js";

function hasRow(row: ChangeEvent["before"]): boolean {
  return row != null && Object.keys(row).length > 0;
}

function eventKind(event: ChangeEvent): "insert" | "update" | "delete" | "" {
  const before = hasRow(event.before);
  const after = hasRow(event.after);
  if (!before && after) return "insert";
  if (before && after) return "update";
  if (before && !after) return "delete";
  return "";
}

export function matchRules(profile: Profile, event: ChangeEvent): Rule[] {
  const changed = changedColumns(event);
  const kind = eventKind(event);
  const matched: Rule[] = [];
  for (const rule of profile.rules) {
    if (rule.table !== event.table) continue;
    const on = rule.when.on;
    if (on && on !== kind) continue;
    const needed = new Set(rule.when.columnsChanged);
    if (needed.size === 0) {
      matched.push(rule);
      continue;
    }
    for (const col of needed) {
      if (changed.has(col)) {
        matched.push(rule);
        break;
      }
    }
  }
  return matched;
}
