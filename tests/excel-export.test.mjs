import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminWorkbook } from "../js/excel-export.js";

test("管理員匯出多工作表 XLSX", () => {
  const bytes = buildAdminWorkbook({
    profiles: [
      { id: "admin-1", role: "admin", name: "管理員", email: "mssallyct@gmail.com", active: true },
      { id: "member-1", role: "member", name: "香港會員", phone: "9123 4567", email: null, birthday: "1990-05-20", referral_code: "HK1234", active: true, created_at: "2026-10-28T08:00:00Z" }
    ],
    appointments: [], sales: [], saleItems: [], stamps: [], referrals: [],
    catalog: [{ id: "svc-1", kind: "service", name: "洗剪吹", price: 280, duration_minutes: 60, active: true }],
    stylists: [{ id: "sty-1", name: "髮型師 A", active: true }], settings: []
  }, new Date("2026-10-28T10:00:00Z"));

  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), 0x04034b50);
  const files = unzipStoredFiles(bytes);
  assert.ok(files.has("[Content_Types].xml"));
  assert.ok(files.has("xl/workbook.xml"));
  assert.ok(files.has("xl/worksheets/sheet10.xml"));
  assert.match(files.get("xl/workbook.xml"), /name="會員"/);
  assert.match(files.get("xl/worksheets/sheet2.xml"), /香港會員/);
  assert.match(files.get("xl/worksheets/sheet8.xml"), /洗剪吹/);
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
