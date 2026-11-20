import { randomUUID } from "node:crypto";
import { validAccountName } from "../js/access-policy.js";
import { hashPassword } from "./credentials.mjs";

export async function newAdmin(input) {
  const username=String(input.username || "").trim().toLowerCase();
  const name=String(input.name || "").trim();
  if(!validAccountName(username))throw invalid("登入名稱須為3–32個英文字母、數字、_ 或 -，並以英文字母開頭。");
  if(["howood","sally"].includes(username))throw invalid("此名稱屬保留管理員帳戶，不能新增或取代。");
  if(!name || name.length>80)throw invalid("請填寫管理員名稱（最多80字）。");
  if(typeof input.password!=="string" || input.password.length<8 || Buffer.byteLength(input.password)>256)throw invalid("密碼須至少8個字元，最多256 bytes。");
  return {id:`admin-${randomUUID()}`,username,name,passwordHash:await hashPassword(input.password)};
}
function invalid(message){const error=new Error(message);error.status=400;return error;}
