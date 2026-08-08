/** Match profile rules against CDC events. */

import { changedColumns, type ChangeEvent } from "./models.js";
import type { Profile, Rule } from "./profile.js";

export function matchRules(profile: Profile, event: ChangeEvent): Rule[] {
  const changed = changedColumns(event);
  const matched: Rule[] = [];
  for (const rule of profile.rules) {
    if (rule.table !== event.table) continue;
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
