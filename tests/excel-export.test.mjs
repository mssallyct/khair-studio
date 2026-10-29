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
  assert.match(files.get("xl/workbook.xml"), /name="會員"/);
  assert.match(files.get("xl/workbook.xml"), /name="髮型助理"/);
  assert.match(files.get("xl/workbook.xml"), /name="操作記錄"/);
  assert.match(files.get("xl/worksheets/sheet2.xml"), /示範會員/);
  assert.match(files.get("xl/worksheets/sheet4.xml"), /髮型師 A/);
  assert.match(files.get("xl/worksheets/sheet4.xml"), /助理 B/);
  assert.match(files.get("xl/worksheets/sheet8.xml"), /洗剪吹/);
  assert.match(files.get("xl/worksheets/sheet10.xml"), /助理 B/);
  assert.match(files.get("xl/worksheets/sheet11.xml"), /tester/);
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
