// Local server: serves the game and hosts online games.
// `npm start`, then open http://localhost:8080 (PORT overrides the port).
// Games live in memory and are lost when the server stops.
import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame, playMove, resign } from '../src/game.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_GAMES = 500;

const games = new Map(); // code -> { house, game, seats: { w, b }, listeners: Set<res> }

const send = (res, status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) { reject(new Error('Request too large.')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON.')); } });
  });
}

const snapshot = (g) => ({ house: g.house, actions: g.game.actions, players: { w: true, b: Boolean(g.seats.b) } });
function broadcast(g) {
  const data = `data: ${JSON.stringify(snapshot(g))}\n\n`;
  for (const res of g.listeners) res.write(data);
}

async function api(req, res, parts) {
  if (parts[0] === 'health') return send(res, 200, { ok: true });
  if (parts[0] !== 'games') return send(res, 404, { error: 'Not found.' });

  if (parts.length === 1 && req.method === 'POST') {
    if (games.size >= MAX_GAMES) games.delete(games.keys().next().value);
    const body = await readJSON(req);
    const house = { properties: Boolean(body.house?.properties), bonuses: Boolean(body.house?.bonuses) };
    let code;
    do code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    while (games.has(code));
    const token = randomBytes(16).toString('hex');
    games.set(code, { house, game: createGame({ house }), seats: { w: token, b: null }, listeners: new Set() });
    return send(res, 200, { code, color: 'w', token });
  }

  const g = games.get(parts[1]);
  if (!g) return send(res, 404, { error: `No game found with code ${parts[1]}.` });

  if (parts[2] === 'join' && req.method === 'POST') {
    const { token } = await readJSON(req);
    if (token && token === g.seats.w) return send(res, 200, { color: 'w', token });
    if (token && token === g.seats.b) return send(res, 200, { color: 'b', token });
    if (!g.seats.b) {
      g.seats.b = randomBytes(16).toString('hex');
      broadcast(g);
      return send(res, 200, { color: 'b', token: g.seats.b });
    }
    return send(res, 200, { color: null, token: null });
  }

  if (parts[2] === 'events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(snapshot(g))}\n\n`);
    g.listeners.add(res);
    req.on('close', () => g.listeners.delete(res));
    return undefined;
  }

  if (parts[2] === 'actions' && req.method === 'POST') {
    const { token, index, action } = await readJSON(req);
    const color = token && (token === g.seats.w ? 'w' : token === g.seats.b ? 'b' : null);
    if (!color) return send(res, 403, { error: 'You are not playing in this game.' });
    if (index !== g.game.actions.length) return send(res, 409, { error: 'The game moved on. Refresh to catch up.' });
    try {
      if (action?.resign) {
        if (action.resign !== color) throw new Error('You can only resign for yourself.');
        g.game = resign(g.game, color);
      } else {
        if (g.game.state.turn !== color) throw new Error('It is not your turn.');
        g.game = playMove(g.game, { from: action.from, to: action.to, promotion: action.promotion, buy: action.buy });
      }
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
    broadcast(g);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Not found.' });
}

// index.html is written as a page body (no doctype/head), so wrap it here.
async function serveFile(req, res, path) {
  const file = join(root, path || 'index.html');
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    let body = await readFile(file);
    if (file.endsWith('index.html')) {
      body = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
        + '<style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
    }
    return res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    return res.writeHead(404).end('Not found');
  }
}

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    if (path.startsWith('api/')) await api(req, res, path.split('/').slice(1));
    else await serveFile(req, res, path);
  } catch (err) {
    if (!res.headersSent) send(res, 400, { error: err.message });
  }
}).listen(port, () => console.log(`Credit Chess running at http://localhost:${port}`));
