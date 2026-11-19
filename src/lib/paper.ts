import type { Profile } from "../../functions/src/core/model";
// Rolls use finite, pageable sheets; the width is media width, not content width.
export const papers = {
  A4: [210, 297, 9],
  A5: [148, 210, 6],
  "80mm": [80, 200, 3],
  "58mm": [58, 200, 2],
} as const;
export function pageRule(format: Profile["format"]) {
  const [w, h, m] = papers[format];
  return `@media print { @page { size: ${w}mm ${h}mm; margin: ${m}mm; } }`;
}
const units =
  "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split(
    " ",
  );
const tens =
  "Zero Ten Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split(" ");
function numberWords(n: number): string {
  for (const [size, name] of [
    [1e7, "Crore"],
    [1e5, "Lakh"],
    [1000, "Thousand"],
    [100, "Hundred"],
  ] as const)
    if (n >= size)
      return `${numberWords(Math.floor(n / size))} ${name}${n % size ? " " + numberWords(n % size) : ""}`;
  return n < 20
    ? units[n]
    : tens[Math.floor(n / 10)] + (n % 10 ? " " + units[n % 10] : "");
}
export function amountInWords(paise: number) {
  if (!Number.isSafeInteger(paise) || paise < 0)
    throw Error("Expected non-negative integer paise.");
  return `Rupees ${numberWords(Math.floor(paise / 100))}${paise % 100 ? " and " + numberWords(paise % 100) + " Paise" : ""} Only`;
}
