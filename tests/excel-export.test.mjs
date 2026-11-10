import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminWorkbook } from "../js/excel-export.js";

test("管理員匯出多工作表 XLSX", () => {
  const bytes = buildAdminWorkbook({
    profiles: [
      { id: "admin-1", role: "admin", username: "tester", name: "測試管理員", email: null, active: true },
      { id: "member-1", role: "member", name: "示範會員", phone: "", email: null, birthday: null, referral_code: "DEMO", active: true, created_at: "2026-10-28T08:00:00Z" }
    ],
    appointments: [],
    sales: [{ id: "sale-1", member_id: "member-1", appointment_id: null, stylist_id: "sty-1", assistant_id: "assistant-1", subtotal: 280, discount: 0, final_amount: 280, discount_label: "沒有折扣", stamp_redeemed: 0, completed_by: "admin-1", completed_at: "2026-10-28T09:30:00Z" }],
    saleItems: [{ id: "line-1", sale_id: "sale-1", kind: "service", name: "洗剪吹", quantity: 1, unit_price: 280 }],
    stamps: [], referrals: [],
    auditLog: [{ id: "audit-1", actor_id: "admin-1", actor_username: "tester", actor_name: "測試管理員", action: "member.created", action_label: "新增會員", target_type: "會員", target_id: "member-1", summary: "測試會員", created_at: "2026-10-28T09:00:00Z" }],
    catalog: [{ id: "svc-1", kind: "service", name: "洗剪吹", price: 280, duration_minutes: 60, active: true }],
    stylists: [{ id: "sty-1", name: "髮型師 A", active: true }],
    assistants: [{ id: "assistant-1", name: "助理 B", active: true }],
    settings: []
  }, new Date("2026-10-28T10:00:00Z"));

  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), 0x04034b50);
  const files = unzipStoredFiles(bytes);
  assert.ok(files.has("[Content_Types].xml"));
  assert.ok(files.has("xl/workbook.xml"));
  assert.ok(files.has("xl/worksheets/sheet12.xml"));
  assert.ok(files.has("xl/worksheets/sheet14.xml"));
  assert.match(files.get("xl/workbook.xml"), /name="會員"/);
  assert.match(files.get("xl/workbook.xml"), /name="髮型助理"/);
  assert.match(files.get("xl/workbook.xml"), /name="操作記錄"/);
  assert.match(files.get("xl/workbook.xml"), /name="歷月營業額"/);
  assert.match(files.get("xl/workbook.xml"), /name="營業額明細"/);
  assert.match(files.get("xl/worksheets/sheet2.xml"), /示範會員/);
  assert.match(files.get("xl/worksheets/sheet4.xml"), /髮型師 A/);
  assert.match(files.get("xl/worksheets/sheet4.xml"), /助理 B/);
  assert.match(files.get("xl/worksheets/sheet8.xml"), /洗剪吹/);
  assert.match(files.get("xl/worksheets/sheet10.xml"), /助理 B/);
  assert.match(files.get("xl/worksheets/sheet11.xml"), /tester/);
  assert.match(files.get("xl/worksheets/sheet13.xml"), /2026-10/);
  assert.match(files.get("xl/worksheets/sheet14.xml"), /累計營業額/);
});

test("Excel 包含由第一宗至今的所有營業額、歷月及累計實收", () => {
  const sales = Array.from({length:1505},(_,i)=>({id:`sale-history-${i}`,member_id:"m1",completed_at:new Date(Date.UTC(2020,0,1+i)).toISOString(),subtotal:100,discount:4.75,final_amount:95.25}));
  const files = unzipStoredFiles(buildAdminWorkbook({sales:[...sales].reverse()},new Date("2026-11-06T00:00:00Z")));
  const detail = files.get("xl/worksheets/sheet14.xml");
  assert.equal((detail.match(/<row r=/g)||[]).length,1506);
  assert.ok(detail.indexOf("sale-history-0<") < detail.indexOf("sale-history-1504<"));
  assert.match(detail, /r="H1506" s="4"><v>143351.25<\/v>/);
  assert.match(files.get("xl/worksheets/sheet13.xml"),/2020-01/);
  assert.match(files.get("xl/worksheets/sheet13.xml"),/2026-11/);
  assert.match(files.get("xl/worksheets/sheet4.xml"),/sale-history-0</);
});

test("會員Excel顯示生日月日、入會年份和匯出當日年資，不估算缺失日期", () => {
  const data = { profiles: [
    { id: "old", role: "member", name: "舊會員", birthday: "1990-11-10", created_at: "2023-11-09T16:00:00Z" },
    { id: "new", role: "member", name: "閏日會員", birthday: "02-29" }
  ] };
  const before = JSON.stringify(data);
  const files = unzipStoredFiles(buildAdminWorkbook(data, new Date("2026-11-09T16:00:00Z")));
  const members = files.get("xl/worksheets/sheet2.xml");
  for (const label of ["生日（月日）", "11月10日", "2月29日", "入會年份", "會員年資（截至匯出日）", "2023", "3年0個月", "未記錄"]) assert.ok(members.includes(label));
  assert.doesNotMatch(members, /1990/);
  assert.equal(JSON.stringify(data), before);
});

function unzipStoredFiles(bytes) {
  const files = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files.set(name, decoder.decode(bytes.slice(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}
