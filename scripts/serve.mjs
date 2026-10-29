import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json", ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml", ".png":"image/png", ".sql":"text/plain; charset=utf-8" };

http.createServer(async (req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,"http://local").pathname);
  let target = normalize(join(root, pathname === "/" ? "index.html" : pathname));
  if (!target.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }
  try { if ((await stat(target)).isDirectory()) target = join(target,"index.html"); const body=await readFile(target); res.writeHead(200,{"Content-Type":types[extname(target)]||"application/octet-stream","Cache-Control":"no-cache"});res.end(body); }
  catch { try { const body=await readFile(join(root,"index.html"));res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(body); } catch { res.writeHead(404);res.end("Not found"); } }
}).listen(port,"127.0.0.1",()=>console.log(`K.Hair Studio running at http://127.0.0.1:${port}`));
