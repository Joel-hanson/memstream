/** Normalize CDC timestamps (ISO or Cockroach HLC decimals). */

const HLC = /^(\d+)(?:\.\d+)?$/;

export function normalizeSourceTs(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const match = HLC.exec(text);
  if (match) {
    const nanos = Number(match[1]);
    const seconds = nanos / 1_000_000_000;
    try {
      return new Date(seconds * 1000).toISOString();
    } catch {
      return null;
    }
  }

  if (text.includes("T") || text.endsWith("Z") || text.slice(10).includes("+")) {
    return text;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text;
  }
  return null;
}
