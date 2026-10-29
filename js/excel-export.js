const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const encoder = new TextEncoder();

export function downloadAdminWorkbook(data, exportedAt = new Date()) {
  const bytes = buildAdminWorkbook(data, exportedAt);
  const stamp = hongKongFileStamp(exportedAt);
  const fileName = `KHair_系統資料_${stamp}.xlsx`;
  const blob = new Blob([bytes], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return fileName;
}

export function buildAdminWorkbook(data = {}, exportedAt = new Date()) {
  const sheets = buildSheets(data, exportedAt);
  const files = workbookFiles(sheets, exportedAt);
  return zipStore(files, exportedAt);
}

function buildSheets(data, exportedAt) {
  const profiles = data.profiles || [];
  const members = profiles.filter(item => item.role === "member");
  const admins = profiles.filter(item => item.role === "admin");
  const appointments = data.appointments || [];
  const sales = data.sales || [];
  const saleItems = data.saleItems || [];
  const stamps = data.stamps || [];
  const referrals = data.referrals || [];
  const catalog = data.catalog || [];
  const stylists = data.stylists || [];
  const settings = data.settings || [];
  const auditLog = data.auditLog || [];
  const memberById = new Map(members.map(item => [item.id, item]));
  const catalogById = new Map(catalog.map(item => [item.id, item]));
  const stylistById = new Map(stylists.map(item => [item.id, item]));
  const saleById = new Map(sales.map(item => [item.id, item]));
  const adminById = new Map(admins.map(item => [item.id, item]));
  const balance = memberId => stamps.filter(item => item.member_id === memberId).reduce((sum, item) => sum + Number(item.delta || 0), 0);
  const memberName = id => memberById.get(id)?.name || "";
  const memberPhone = id => memberById.get(id)?.phone || "";
  const serviceName = id => catalogById.get(id)?.name || "";
  const stylistName = id => stylistById.get(id)?.name || "";
  const adminName = id => adminById.get(id)?.username || adminById.get(id)?.name || "";

  return [
    {
      name: "概覽",
      headers: ["項目", "數值"],
      rows: [
        ["匯出時間（香港）", dateTime(exportedAt)],
        ["會員人數", integer(members.length)],
        ["預約總數", integer(appointments.length)],
        ["消費記錄總數", integer(sales.length)],
        ["累計實收金額", currency(sales.reduce((sum, item) => sum + Number(item.final_amount || 0), 0))],
        ["印花變動記錄總數", integer(stamps.length)],
        ["操作記錄總數", integer(auditLog.length)],
        ["資料地區", "香港"],
        ["貨幣", "HKD"],
        ["時區", "Asia/Hong_Kong"]
      ]
    },
    {
      name: "會員",
      headers: ["會員編號", "姓名", "香港電話", "電郵", "生日", "介紹編號", "印花結餘", "狀態", "建立者", "建立時間"],
      rows: members.map(item => [item.id, item.name, item.phone || "", item.email || "", dateOnly(item.birthday), item.referral_code || "", integer(balance(item.id)), item.active === false ? "停用" : "有效", adminName(item.created_by), dateTime(item.created_at)])
    },
    {
      name: "預約",
      headers: ["預約編號", "日期時間", "會員姓名", "香港電話", "服務", "髮型師", "狀態", "備註", "建立者", "最後更新者", "建立時間"],
      rows: appointments.map(item => [item.id, dateTime(item.start_at), memberName(item.member_id), memberPhone(item.member_id), serviceName(item.service_id), stylistName(item.stylist_id), appointmentLabel(item.status), item.note || "", adminName(item.created_by), adminName(item.updated_by), dateTime(item.created_at)])
    },
    {
      name: "消費",
      headers: ["消費編號", "完成時間", "會員姓名", "香港電話", "原價", "折扣", "實收", "優惠", "使用印花", "相關預約", "完成者"],
      rows: sales.map(item => [item.id, dateTime(item.completed_at), memberName(item.member_id), memberPhone(item.member_id), currency(item.subtotal), currency(item.discount), currency(item.final_amount), item.discount_label || "", integer(item.stamp_redeemed || 0), item.appointment_id || "", adminName(item.completed_by)])
    },
    {
      name: "消費項目",
      headers: ["消費編號", "完成時間", "會員姓名", "類型", "項目", "數量", "單價", "小計"],
      rows: saleItems.map(item => {
        const sale = saleById.get(item.sale_id);
        return [item.sale_id, dateTime(sale?.completed_at), memberName(sale?.member_id), item.kind === "product" ? "產品" : "服務", item.name || "", integer(item.quantity), currency(item.unit_price), currency(Number(item.quantity || 0) * Number(item.unit_price || 0))];
      })
    },
    {
      name: "印花",
      headers: ["記錄編號", "時間", "會員姓名", "香港電話", "增減", "類型", "原因", "相關消費", "操作人"],
      rows: stamps.map(item => [item.id, dateTime(item.created_at), memberName(item.member_id), memberPhone(item.member_id), integer(item.delta), stampLabel(item.type), item.reason || "", item.sale_id || "", adminName(item.created_by)])
    },
    {
      name: "介紹記錄",
      headers: ["記錄編號", "介紹人", "新會員", "獎賞時間", "建立時間"],
      rows: referrals.map(item => [item.id, memberName(item.referrer_id), memberName(item.referred_member_id), dateTime(item.awarded_at), dateTime(item.created_at)])
    },
    {
      name: "服務及產品",
      headers: ["項目編號", "類型", "名稱", "價格", "所需分鐘", "狀態", "排序", "建立者"],
      rows: catalog.map(item => [item.id, item.kind === "product" ? "產品" : "服務", item.name, currency(item.price), integer(item.duration_minutes), item.active === false ? "停用" : "有效", integer(item.sort_order || 0), adminName(item.created_by)])
    },
    {
      name: "髮型師",
      headers: ["髮型師編號", "姓名", "狀態", "建立時間"],
      rows: stylists.map(item => [item.id, item.name, item.active === false ? "停用" : "服務中", dateTime(item.created_at)])
    },
    {
      name: "操作記錄",
      headers: ["時間", "登入名稱", "管理員", "操作", "類別", "記錄編號", "內容"],
      rows: auditLog.map(item => [dateTime(item.created_at), item.actor_username || adminById.get(item.actor_id)?.username || "", item.actor_name || adminById.get(item.actor_id)?.name || "", item.action_label || item.action || "", item.target_type || "", item.target_id || "", item.summary || ""])
    },
    {
      name: "系統設定",
      headers: ["設定", "內容"],
      rows: settings.length ? settings.map(item => [item.key, typeof item.value === "string" ? item.value : JSON.stringify(item.value)]) : [
        ["營業時間", "星期一至日 11:00–21:00"],
        ["預約間隔", "30分鐘"],
        ["消費印花", "每張單實收每滿 HK$600 得1個"],
        ["4個印花", "全單9折"],
        ["8個印花", "全單85折"],
        ["產品會員優惠", "95折（不與印花優惠同時使用）"]
      ]
    }
  ];
}

function workbookFiles(sheets, exportedAt) {
  const created = exportedAt.toISOString();
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const sheetNodes = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const sheetRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const styleRelId = sheets.length + 1;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${overrides}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>K.Hair Studio 系統資料</dc:title><dc:creator>K.Hair Studio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`],
    ["docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>K.Hair Studio</Application><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${sheets.map(sheet => `<vt:lpstr>${xml(sheet.name)}</vt:lpstr>`).join("")}</vt:vector></TitlesOfParts></Properties>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetNodes}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${styleRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", stylesXml()]
  ];
  sheets.forEach((sheet, index) => files.push([`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet)]));
  return files;
}

function worksheetXml(sheet) {
  const matrix = [sheet.headers, ...sheet.rows];
  const widths = sheet.headers.map((header, column) => Math.min(42, Math.max(10, ...matrix.map(row => displayWidth(cellDisplay(row[column])) + 2))));
  const cols = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  const rows = matrix.map((row, rowIndex) => `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="22" customHeight="1"' : ""}>${row.map((value, columnIndex) => cellXml(value, rowIndex + 1, columnIndex + 1, rowIndex === 0)).join("")}</row>`).join("");
  const lastCell = `${columnName(sheet.headers.length)}${Math.max(1, matrix.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${lastCell}"/><pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

function cellXml(value, row, column, header) {
  const ref = `${columnName(column)}${row}`;
  if (header) return inlineCell(ref, value, 1);
  if (value && typeof value === "object" && "kind" in value) {
    if (value.value === null || value.value === undefined || value.value === "") return inlineCell(ref, "", 0);
    if (value.kind === "date") return numericCell(ref, excelDate(value.value), 2);
    if (value.kind === "datetime") return numericCell(ref, excelHongKongDateTime(value.value), 3);
    if (value.kind === "currency") return numericCell(ref, Number(value.value || 0), 4);
    if (value.kind === "integer") return numericCell(ref, Number(value.value || 0), 5);
  }
  if (typeof value === "number") return numericCell(ref, value, 0);
  return inlineCell(ref, value ?? "", 0);
}

function inlineCell(ref, value, style) {
  const text = cleanText(String(value));
  const preserve = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xml(text)}</t></is></c>`;
}

function numericCell(ref, value, style) {
  return `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="&quot;HK$&quot;#,##0.00"/></numFmts><fonts count="2"><font><sz val="10"/><name val="Arial"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2925"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

function zipStore(files, date) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosDate, dosTime } = dosDateTime(date);
  for (const [name, content] of files) {
    const nameBytes = encoder.encode(name);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true); lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    localParts.push(local, nameBytes, data);

    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return concatBytes([...localParts, ...centralParts, end]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    dosDate: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    dosTime: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2)
  };
}

function excelDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000 + 25569 : 0;
}

function excelHongKongDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) / 86400000 + 25569;
}

function hongKongFileStamp(date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

function dateOnly(value) { return { kind: "date", value: value || null }; }
function dateTime(value) { return { kind: "datetime", value: value || null }; }
function currency(value) { return { kind: "currency", value: Number(value || 0) }; }
function integer(value) { return { kind: "integer", value: Number(value || 0) }; }
function cellDisplay(value) { return value && typeof value === "object" && "kind" in value ? String(value.value ?? "") : String(value ?? ""); }
function displayWidth(value) { return [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0); }
function columnName(number) { let result = ""; for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(((n - 1) % 26) + 65) + result; return result; }
function cleanText(value) { return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); }
function xml(value) { return cleanText(String(value ?? "")).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
function appointmentLabel(value) { return ({ pending: "待確認", confirmed: "已確認", completed: "已完成", cancelled: "已取消", no_show: "沒有出席" })[value] || value || ""; }
function stampLabel(value) { return ({ spending: "消費印花", birthday: "生日獎賞", referral: "介紹朋友", redemption: "兌換優惠", admin_adjustment: "管理員調整" })[value] || value || ""; }
