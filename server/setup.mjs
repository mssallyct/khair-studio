import { ACCOUNT_NAMES } from "../js/access-policy.js";
import { buildServiceCatalog } from "../js/service-catalog.js";
import { hashPassword } from "./credentials.mjs";

// Trusted setup only; not exposed through the web gateway. Passwords enter via a
// secure server-side provisioning process, never command arguments/source files.
export async function initializeBusinessState(pool) {
  const data={profiles:[],appointments:[],sales:[],saleItems:[],stampLedger:[],referrals:[],auditLog:[],stylists:[],assistants:[],catalog:buildServiceCatalog([], {createdAt:new Date().toISOString()}),rewardWallets:{},checkoutRequests:{}};
  return pool.query("INSERT INTO khair_private.business_state(singleton,document) VALUES (true,$1::jsonb) ON CONFLICT (singleton) DO NOTHING",[JSON.stringify(data)]);
}
export async function provisionAdmin(pool,{username,password}) {
  const name=String(username||"").trim().toLowerCase();
  if(!ACCOUNT_NAMES.includes(name))throw new Error("不在已授權管理員名單內。");
  const verifier=await hashPassword(password);
  const display=name.startsWith("admin")?`Admin${name.slice(5)}`:name==="howood"?"Howood":"Sally";
  const result=await pool.query("INSERT INTO khair_private.admin_accounts(id,username,name,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING RETURNING id",[`admin-${name}`,name,display,verifier]);
  if(!result.rows.length)throw new Error("帳戶已存在；沒有更改原有密碼。");
  return {id:result.rows[0].id,username:name};
}
