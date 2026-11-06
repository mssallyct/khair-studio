import { hongKongDateKey } from "./rules.js";

// Keep sales as the source of truth: month changes never reset or remove records.
export function summarizeRevenue(sales = [], now = new Date()) {
  const today = hongKongDateKey(now);
  if (!today) throw new Error("無效的統計日期。");
  const currentMonth = today.slice(0, 7);
  const [year, month] = currentMonth.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const totals = new Map();
  const ensureMonth = key => {
    if (!totals.has(key)) totals.set(key, { month: key, cents: 0, count: 0 });
    return totals.get(key);
  };
  ensureMonth(currentMonth);
  ensureMonth(previousMonth);
  let todayCents = 0;
  let totalCents = 0;
  for (const sale of sales) {
    const day = hongKongDateKey(sale.completed_at);
    const amount = Number(sale.final_amount);
    if (!day || sale.final_amount == null || !Number.isFinite(amount) || amount < 0) continue;
    const cents = Math.round((amount + Number.EPSILON) * 100);
    const row = ensureMonth(day.slice(0, 7));
    row.cents += cents;
    row.count += 1;
    totalCents += cents;
    if (day === today) todayCents += cents;
  }
  return {
    todayRevenue: todayCents / 100,
    currentMonth,
    previousMonth,
    currentRevenue: totals.get(currentMonth).cents / 100,
    previousRevenue: totals.get(previousMonth).cents / 100,
    currentCount: totals.get(currentMonth).count,
    totalRevenue: totalCents / 100,
    months: [...totals.values()].sort((a, b) => b.month.localeCompare(a.month)).map(row => ({ month: row.month, revenue: row.cents / 100, count: row.count }))
  };
}
