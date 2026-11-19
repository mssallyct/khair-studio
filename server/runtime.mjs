import { PostgresRepository } from "./postgres-repository.mjs";
import { createAuth } from "./auth.mjs";
import { createGateway } from "./gateway.mjs";

export function databaseOptions(value,ca) {
  const url=new URL(value);
  if(!["postgres:","postgresql:"].includes(url.protocol) || !url.hostname)throw new Error("資料庫連線設定無效。");
  // URL SSL options can otherwise replace pg's explicit certificate policy.
  for(const key of [...url.searchParams.keys()])if(!["application_name","connect_timeout"].includes(key))url.searchParams.delete(key);
  return {connectionString:url.href,ssl:{rejectUnauthorized:true,...(ca?{ca}:{})},max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000};
}

let runtimePromise;
export async function configuredGateway(env=process.env) {
  if(env.KHAIR_BACKEND_ENABLED!=="true" || !env.DATABASE_URL || !env.KHAIR_ALLOWED_ORIGINS)return createGateway();
  if(!runtimePromise)runtimePromise=(async()=>{
    const origins=env.KHAIR_ALLOWED_ORIGINS.split(",").map(s=>s.trim());
    if(origins.some(origin=>new URL(origin).protocol!=="https:" || new URL(origin).origin!==origin))throw new Error("請設定完整HTTPS前端來源，不能使用萬用字元。");
    const {Pool}=await import("pg");
    const repository=new PostgresRepository(new Pool(databaseOptions(env.DATABASE_URL,env.DATABASE_SSL_CA)));
    const auth=createAuth({repository});
    return createGateway({repository,auth,allowedOrigins:origins});
  })().catch(error=>{runtimePromise=null;throw error;});
  return runtimePromise;
}

// Works with a Node HTTP request/response, including a future Vercel function.
// No server is started or deployed by importing this file.
export async function nodeHandler(req,res) {
  try{
    const gateway=await configuredGateway();
    const method=req.method || "GET",path=req.url || "/";
    const maximum=path.startsWith("/api/migration/import") ? 5*1024*1024 : 65536;
    let body;
    if(!["GET","HEAD"].includes(method)){
      if(req.body!=null)body=typeof req.body==="string"?req.body:JSON.stringify(req.body);
      else{const chunks=[];let size=0;for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>maximum)throw new Error("body-too-large");chunks.push(bytes);}body=Buffer.concat(chunks).toString("utf8");}
      if(Buffer.byteLength(body)>maximum)throw new Error("body-too-large");
    }
    const headers=new Headers();for(const [key,value] of Object.entries(req.headers || {}))if(value!=null)headers.set(key,Array.isArray(value)?value.join(","):String(value));
    const request=new Request(new URL(path,"https://khair-backend.invalid"),{method,headers,...(body!=null?{body}:{})});
    const response=await gateway(request);
    res.statusCode=response.status;for(const [key,value] of response.headers)res.setHeader(key,value);res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){res.statusCode=error.message==="body-too-large"?413:503;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify({error:"後端尚未就緒或請求無法處理；請勿重複收款。"}));}
}
