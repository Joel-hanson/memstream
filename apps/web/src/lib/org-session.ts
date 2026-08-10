/** Browser org context for thin multi-tenant SaaS entry. */

export const ORG_STORAGE_KEY = "memstream.orgId";

export function readStoredOrgId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(ORG_STORAGE_KEY)?.trim() || "";
    return v || null;
  } catch {
    return null;
  }
}

export function storeOrgId(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(ORG_STORAGE_KEY, id);
    else localStorage.removeItem(ORG_STORAGE_KEY);
  } catch {
    /* private mode */
  }
}
