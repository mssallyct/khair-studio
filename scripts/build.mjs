import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root,"dist");
const required = ["index.html","styles.css","config.example.js","manifest.webmanifest","sw.js","assets","js"];

await rm(dist,{recursive:true,force:true});
await mkdir(dist,{recursive:true});
for (const item of required) await cp(join(root,item),join(dist,item),{recursive:true});
await cp(join(root,"config.example.js"),join(dist,"config.js"));
if(process.env.KHAIR_BACKEND_URL){
  const backendUrl=process.env.KHAIR_BACKEND_URL;
  if(backendUrl!=="/api" && !backendUrl.startsWith("https://"))throw new Error("KHAIR_BACKEND_URL must use HTTPS or /api.");
  await writeFile(join(dist,"config.js"),`window.KHAIR_CONFIG = ${JSON.stringify({backendUrl,requiresBackend:true,demoMode:false})};\n`);
}
const html=await readFile(join(dist,"index.html"),"utf8");
if (!html.includes("K.Hair Studio") || !html.includes("js/app.js")) throw new Error("Build validation failed: invalid index.html");
console.log(`Build complete: ${required.length + 1} app resources copied to dist/`);
