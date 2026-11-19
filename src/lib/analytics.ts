import { indiaDay, saleInvoices } from "../../functions/src/core/billing";
import { accountDocuments } from "../../functions/src/core/documents";
import type { Workspace } from "../../functions/src/core/model";
export function series(data: Workspace, n: number, offset = 0) {
  const invoices = saleInvoices(data);
  const receipts = accountDocuments(data);
  return Array.from({ length: n }, (_, i) => {
    const date = Date.now() - (n - 1 - i + offset) * 86400000;
    const sales = invoices.filter(
      (b) => indiaDay(b.issuedAt) === indiaDay(date),
    );
    return {
      date,
      sales: sales.reduce((v, b) => v + b.totalPaise, 0),
      paid: receipts
        .filter((b) => indiaDay(b.issuedAt) === indiaDay(date))
        .reduce((v, b) => v + b.paidPaise, 0),
      count: sales.length,
    };
  });
}
export const delta = (n: number, prev: number) =>
  prev ? (100 * (n - prev)) / prev : null;
export function smooth(points: number[][]) {
  if (!points.length) return "";
  let s = `M${points[0].join(",")}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i],
      last = points[i - 1],
      mid = (last[0] + x) / 2;
    s += ` C${mid},${last[1]} ${mid},${y} ${x},${y}`;
  }
  return s;
}
