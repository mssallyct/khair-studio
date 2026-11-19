import { ACCOUNT_NAMES } from "../js/access-policy.js";
import { hashPassword, verifyPassword, newSessionToken, tokenDigest } from "./credentials.mjs";

// repository must persist accounts, rate limits and sessions centrally.
export function createAuth({repository,clock=()=>new Date(),peer=()=>"unknown"}) {
  const dummy = hashPassword(newSessionToken());
  return {
    async login(request,input) {
      const username=String(input?.username || "").trim().toLowerCase();
      const allowed=await repository.attemptLogin(ACCOUNT_NAMES.includes(username)?username:"__unknown__",peer(request),clock());
      if(!allowed)throw authError(429,"登入嘗試過多，請稍後再試。");
      const account=ACCOUNT_NAMES.includes(username) ? await repository.accountByUsername(username) : null;
      const valid=await verifyPassword(String(input?.password || ""),account?.password_hash || await dummy);
      if(!valid || !account?.active)throw authError(401,"登入名稱或密碼不正確。");
      const token=newSessionToken(),expiresAt=new Date(clock().getTime()+8*3600000).toISOString();
      await repository.putSession({tokenHash:tokenDigest(token),accountId:account.id,expiresAt});
      return {accessToken:token,expiresAt,profile:profile(account)};
    },
    async authenticate(request) {
      const token=bearer(request);if(!token)return null;
      const session=await repository.sessionByHash(tokenDigest(token));
      if(!session || session.revoked_at || new Date(session.expires_at).getTime()<=clock().getTime())return null;
      const account=await repository.accountById(session.account_id);
      return account?.active && ACCOUNT_NAMES.includes(account.username) ? profile(account) : null;
    },
    async logout(request) { const token=bearer(request);if(token)await repository.removeSession(tokenDigest(token)); }
  };
}
function bearer(request){const value=request.headers.get("authorization") || "";return /^Bearer [A-Za-z0-9_-]{43}$/.test(value) ? value.slice(7) : null;}
function profile(account){return {id:account.id,username:account.username,name:account.name,role:"admin",active:account.active};}
function authError(status,message){const error=new Error(message);error.status=status;return error;}
