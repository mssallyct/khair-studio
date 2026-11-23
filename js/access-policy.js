// Account names are not credentials. Only a verified server session may supply
// the principal used by the API. Frontend checks are display helpers only.
import { normalizeRemarks } from "./member-remarks.js";
export const ACCOUNT_NAMES = Object.freeze(["howood", "sally", "admin135", "admin268", "admin567", "admin889", "admin233"]);
// Initial accounts only; active accounts are now verified against the database.
export const validAccountName = name => /^[a-z][a-z0-9_-]{2,31}$/.test(name);
const OWNERS = new Set(["howood", "sally"]);
const COMMON = new Set(["dashboard", "members", "appointments", "sales", "catalog.read", "members.create", "members.remarks", "appointments.write", "sales.create"]);
const OWNER_ONLY = new Set(["settings", "audit", "export", "revenue", "catalog.write", "team.write", "stamps.adjust", "members.joined-date", "migration"]);

export function accountName(principal) {
  const name = String(principal?.username || "").toLowerCase();
  return principal?.role === "admin" && principal.active === true && validAccountName(name) ? name : null;
}

export function can(principal, action) {
  const name = accountName(principal);
  if (!name) return false;
  if (action === "phone.search") return true;
  if (["phone.read","migration","admins","admins.manage"].includes(action)) return name === "howood";
  return COMMON.has(action) || OWNER_ONLY.has(action) && OWNERS.has(name);
}

export function requirePermission(principal, action) {
  if (!can(principal, action)) {
    const error = new Error("你沒有此操作權限。");
    error.status = accountName(principal) ? 403 : 401;
    throw error;
  }
}

export function visibleViews(principal) {
  return ["dashboard", "appointments", "members", "sales", "settings", "audit", "admins"].filter(view => can(principal, view));
}

export function homeSections(principal) {
  if (!can(principal, "dashboard")) return [];
  return can(principal, "revenue") ? ["revenue", "pending", "today", "expiry"] : ["pending", "today", "expiry"];
}

const MEMBER_FIELDS = ["id", "role", "active", "name", "email", "birthday", "referral_code", "joined_date", "created_at", "created_by", "remarks", "remarks_version", "import_opening", "import_source"];
export function memberFor(principal, member) {
  requirePermission(principal, "members");
  const fields = can(principal, "phone.read") ? [...MEMBER_FIELDS, "phone"] : MEMBER_FIELDS;
  return Object.fromEntries(fields.filter(key => Object.hasOwn(member, key)).map(key => [key, key==="remarks" ? normalizeRemarks(member[key]).map(line=>privateText(principal,line)) : ["name", "email", "referral_code"].includes(key) ? privateText(principal, member[key]) : member[key]]));
}

// Free-text audit/appointment fields may contain old phone numbers, not just
// the current profile phone. Mask plausible HK numbers before API serialization.
export function privateText(principal, value) {
  const text = String(value ?? "");
  return can(principal, "phone.read") ? text : text.replace(/(?<!\d)(?:\+?852[\s()-]*)?[2-9](?:[\s()-]*\d){7}(?!\d)/g, "[電話已隱藏]");
}

export function auditFor(principal, rows) {
  requirePermission(principal, "audit");
  return rows.map(row => ({ id: row.id, actor_id: row.actor_id, actor_username: row.actor_username, actor_name: row.actor_name, action: row.action, action_label: row.action_label, target_type: row.target_type, target_id: row.target_id, created_at: row.created_at, summary: privateText(principal, row.summary) }));
}

// Defense in depth for rendering/export. This does not secure browser-local
// storage. The same projection MUST run on the server before the response.
export function displayDataFor(principal, data) {
  requirePermission(principal, "dashboard");
  const copy = structuredClone(data);
  if (!can(principal, "audit")) copy.auditLog = [];
  const walk = (value, key = "") => {
    if (Array.isArray(value)) return value.map(item => walk(item, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([k]) => !/(password|credential|verifier|secret|token)/i.test(k) && (can(principal, "phone.read") || !/phone|telephone|mobile/i.test(k))).map(([k,v])=>[k,walk(v,k)]));
    if (typeof value === "string" && !/(?:^id$|_id$|Id$|At$|_at$|_date$|^birthday$|^periodStart$|^periodEnd$|^joinedDate$)/.test(key)) return privateText(principal,value);
    return value;
  };
  return walk(copy);
}
