import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRevenue } from "../js/revenue.js";

test("營業額按香港月份與年份分組，使用實收而非原價", () => {
  const sales = [
    {completed_at:"2026-10-31T15:59:59Z",final_amount:600,subtotal:800},
    {completed_at:"2026-10-31T16:00:00Z",final_amount:720,subtotal:800},
    {completed_at:"2025-11-01T04:00:00Z",final_amount:1000},
    {completed_at:"2026-11-06T05:00:00Z",final_amount:"95.25"}
  ];
  const before = JSON.stringify(sales);
  const result = summarizeRevenue(sales,new Date("2026-11-06T08:00:00Z"));
  assert.equal(result.currentRevenue,815.25);
  assert.equal(result.previousRevenue,600);
  assert.equal(result.todayRevenue,95.25);
  assert.equal(result.currentCount,2);
  assert.equal(result.totalRevenue,2415.25);
  assert.ok(result.months.some(row => row.month === "2025-11" && row.revenue === 1000));
  assert.equal(JSON.stringify(sales),before);
});

test("一月上月為上一年十二月，跨月後歷史仍在", () => {
  const sales = [{completed_at:"2026-12-31T15:59:59Z",final_amount:100},{completed_at:"2026-12-31T16:00:00Z",final_amount:200}];
  const january = summarizeRevenue(sales,new Date("2026-12-31T16:30:00Z"));
  assert.equal(january.currentMonth,"2027-01");
  assert.equal(january.previousMonth,"2026-12");
  assert.equal(january.currentRevenue,200);
  assert.equal(january.previousRevenue,100);
  const february = summarizeRevenue(sales,new Date("2027-02-10T00:00:00Z"));
  assert.equal(february.currentRevenue,0);
  assert.equal(february.previousRevenue,200);
  assert.equal(february.totalRevenue,300);
  assert.equal(february.months.find(row=>row.month==="2026-12").revenue,100);
});

test("無消費月份顯示零，小數不產生累積誤差", () => {
  const now = new Date("2026-11-06T00:00:00Z");
  const empty = summarizeRevenue([],now);
  assert.equal(empty.currentRevenue,0);
  assert.equal(empty.previousRevenue,0);
  const result = summarizeRevenue([{completed_at:now,final_amount:.1},{completed_at:now,final_amount:.2},{completed_at:"bad-date",final_amount:100}],now);
  assert.equal(result.totalRevenue,.3);
});
