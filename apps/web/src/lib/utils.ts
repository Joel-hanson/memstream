import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Copy text; falls back when Clipboard API is missing (e.g. non-secure HTTP). */
export async function copyToClipboard(text: string): Promise<void> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    await navigator.clipboard.writeText(text)
    return
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available")
  }

  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.position = "fixed"
  ta.style.left = "-9999px"
  ta.style.top = "0"
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, text.length)
  const ok = document.execCommand("copy")
  document.body.removeChild(ta)
  if (!ok) throw new Error("Could not copy to clipboard")
}

/** Filename-safe profile id from an application label. */
export function suggestProfileId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug || "discovered"
}

/** Short relative time for list rows (e.g. "2m ago"). */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const sec = Math.round((Date.now() - t) / 1000)
  if (sec < 45) return "just now"
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h ago`
  return new Date(iso).toLocaleDateString()
}
