// Minimal static server for local play: `npm start`, then open http://localhost:8080.
// index.html is written as a page body (no doctype/head), so wrap it here.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(root, path || 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (file.endsWith('index.html')) {
      body = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        + '<style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Credit Chess running at http://localhost:${port}`));
