import type { Rate } from "../../functions/src/core/model";
export const rupee = (paise: number, decimals = 0) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(paise / 100);
export const cash = (rupees: number, decimals = 0) =>
  rupee(rupees * 100, decimals);
export const compact = (p: number) =>
  p >= 1000000000
    ? "₹" + (p / 1000000000).toFixed(2) + " Cr"
    : p >= 10000000
      ? "₹" + (p / 10000000).toFixed(2) + " L"
      : p >= 100000
        ? "₹" + (p / 100000).toFixed(1) + "k"
        : rupee(p);
export const day = (
  iso: string | number,
  opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    ...opts,
  }).format(new Date(iso));
export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
export const key = () => crypto.randomUUID();
export const err = (e: unknown) => {
  if (e && typeof e === "object" && "issues" in e && Array.isArray(e.issues))
    return e.issues
      .map(
        (i: { path: unknown[]; message: string }) =>
          `${i.path.join(".")}: ${i.message}`,
      )
      .join("; ");
  return e instanceof Error
    ? e.message
    : "Something went wrong. Please try again.";
};
export const priorRate = (rate: Rate, rates: Rate[]) =>
  [...rates]
    .filter(
      (r) =>
        r.metal === rate.metal &&
        r.purity === rate.purity &&
        r.effectiveAt < rate.effectiveAt,
    )
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))[0];
export const utcLocalInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
