import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("只快取公開靜態檔案，不攔截API、跨來源、已登入或no-store請求",()=>{
  const handlers={};
  runInNewContext(readFileSync(new URL("../sw.js",import.meta.url),"utf8"),{URL,Response,self:{location:{origin:"https://mssallyct.github.io"},registration:{scope:"https://mssallyct.github.io/khair-studio/"},addEventListener:(name,fn)=>handlers[name]=fn},fetch:async()=>new Response("public"),caches:{open:async()=>({put:async()=>{}})}});
  const cases=[new Request("https://backend.test/api/members"),new Request("https://mssallyct.github.io/api/members"),new Request("https://mssallyct.github.io/khair-studio/index.html",{headers:{Authorization:"Bearer secret-test"}}),new Request("https://mssallyct.github.io/khair-studio/index.html",{cache:"no-store"}),new Request("https://mssallyct.github.io/api/query/members",{method:"POST"})];
  for(const request of cases){let intercepted=false;handlers.fetch({request,respondWith:()=>intercepted=true});assert.equal(intercepted,false);}
  let staticIntercepted=false;handlers.fetch({request:new Request("https://mssallyct.github.io/khair-studio/styles.css"),respondWith:()=>staticIntercepted=true});assert.equal(staticIntercepted,true);
});
