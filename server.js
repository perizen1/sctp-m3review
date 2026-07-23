const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, 'public');
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS || 4 * 60 * 60 * 1000);
const HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS || 25000);
const DISABLE_PRESENTER_TOKEN = process.env.DISABLE_PRESENTER_TOKEN === 'true';

const rooms = new Map();

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function makeToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function getRoom(code) {
  code = String(code || '').toUpperCase().trim();
  return rooms.get(code);
}

function createRoom(code) {
  const st = {
    presenterToken: makeToken(),
    activePoll: null,
    showResults: false,
    votes: new Map(),
    presenters: new Set(),
    audience: new Map(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  rooms.set(code, st);
  return st;
}

function touch(st) {
  if (st) st.updatedAt = Date.now();
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', d => {
      data += d;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

function requirePresenter(body) {
  const code = String(body.room || '').toUpperCase().trim();
  const st = getRoom(code);
  if (!code || !st) return { ok: false, code, st, status: 404, error: 'Room not found.' };
  if (!DISABLE_PRESENTER_TOKEN && body.presenterToken !== st.presenterToken) {
    return { ok: false, code, st, status: 403, error: 'Presenter token invalid.' };
  }
  touch(st);
  return { ok: true, code, st };
}

function counts(st) {
  if (!st.activePoll) return { total: 0, counts: [], answers: [] };
  const answers = [...st.votes.values()].map(v => v.answer);
  if (st.activePoll.type === 'choice') {
    const arr = st.activePoll.options.map(() => 0);
    for (const a of answers) if (arr[a] !== undefined) arr[a]++;
    return { total: answers.length, counts: arr, answers };
  }
  return { total: answers.length, counts: [], answers };
}

function audienceCount(st) {
  return st.audience.size;
}

function emit(st, event, payload, role) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  const sets = role === 'audience' ? [st.audience] : role === 'presenter' ? [st.presenters] : [st.audience, st.presenters];
  for (const set of sets) {
    for (const res of set.values ? set.values() : set) {
      try { res.write(data); } catch {}
    }
  }
}

function broadcast(code) {
  const st = getRoom(code);
  if (!st) return;
  touch(st);
  const payload = { room: code, activePoll: st.activePoll, showResults: st.showResults, participants: audienceCount(st), ...counts(st) };
  emit(st, 'results', payload);
  if (st.activePoll) emit(st, 'active', { room: code, poll: st.activePoll, showResults: st.showResults }, 'audience');
}

function safePath(pathname) {
  if (pathname === '/') pathname = '/presenter.html';
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  return path.join(PUBLIC, normalized);
}

function serveFile(req, res) {
  const pathname = url.parse(req.url).pathname;
  const file = safePath(pathname);
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end('Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('Not found');
    const ext = path.extname(file).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  if (req.method === 'GET' && parsed.pathname === '/healthz') {
    return json(res, 200, { ok: true, rooms: rooms.size, uptime: process.uptime() });
  }

  if (req.method === 'GET' && parsed.pathname === '/events') {
    const code = String(parsed.query.room || '').toUpperCase().trim();
    const role = parsed.query.role === 'presenter' ? 'presenter' : 'audience';
    const clientId = String(parsed.query.clientId || crypto.randomUUID()).slice(0, 80);
    const st = getRoom(code);
    if (!code || !st) return res.writeHead(404).end('room not found');
    if (role === 'presenter' && !DISABLE_PRESENTER_TOKEN && parsed.query.presenterToken !== st.presenterToken) {
      return res.writeHead(403).end('presenter token invalid');
    }
    touch(st);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');
    const heartbeat = setInterval(() => {
      try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch {}
    }, HEARTBEAT_MS);
    if (role === 'presenter') st.presenters.add(res); else st.audience.set(clientId, res);
    req.on('close', () => {
      clearInterval(heartbeat);
      if (role === 'presenter') st.presenters.delete(res); else st.audience.delete(clientId);
      broadcast(code);
    });
    broadcast(code);
    return;
  }

  if (req.method === 'POST' && parsed.pathname === '/api/create-room') {
    let code;
    do { code = makeCode(); } while (rooms.has(code));
    const st = createRoom(code);
    return json(res, 200, { ok: true, room: code, presenterToken: st.presenterToken });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/join-room') {
    const body = await readBody(req);
    const code = String(body.room || '').toUpperCase().trim();
    const st = getRoom(code);
    if (!st) return json(res, 404, { ok: false, error: 'Room not found. Check the code on the screen.' });
    touch(st);
    return json(res, 200, { ok: true, room: code, activePoll: st.activePoll, showResults: st.showResults });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/set-poll') {
    const body = await readBody(req);
    const auth = requirePresenter(body);
    if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
    if (!body.poll) return json(res, 400, { ok: false, error: 'Missing poll.' });
    const { code, st } = auth;
    const changed = !st.activePoll || st.activePoll.id !== body.poll.id;
    st.activePoll = body.poll;
    st.showResults = false;
    if (changed) st.votes = new Map();
    emit(st, 'active', { room: code, poll: st.activePoll, showResults: false }, 'audience');
    broadcast(code);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/clear-poll') {
    const body = await readBody(req);
    const auth = requirePresenter(body);
    if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
    const { code, st } = auth;
    st.activePoll = null;
    st.showResults = false;
    st.votes = new Map();
    emit(st, 'clear', {}, 'audience');
    broadcast(code);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/show-results') {
    const body = await readBody(req);
    const auth = requirePresenter(body);
    if (!auth.ok) return json(res, auth.status, { ok: false, error: auth.error });
    auth.st.showResults = !!body.show;
    broadcast(auth.code);
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && parsed.pathname === '/api/vote') {
    const body = await readBody(req);
    const code = String(body.room || '').toUpperCase().trim();
    const st = getRoom(code);
    if (!st) return json(res, 404, { ok: false, error: 'Room not found.' });
    touch(st);
    if (!st.activePoll || st.activePoll.id !== body.pollId) return json(res, 400, { ok: false, error: 'Poll is not active.' });
    const cid = String(body.clientId || 'anon').slice(0, 80);
    st.votes.set(cid, { answer: body.answer, at: Date.now() });
    broadcast(code);
    return json(res, 200, { ok: true });
  }

  serveFile(req, res);
});

server.keepAliveTimeout = 70_000;
server.headersTimeout = 75_000;

setInterval(() => {
  const now = Date.now();
  for (const [code, st] of rooms) {
    const idle = st.presenters.size === 0 && st.audience.size === 0 && now - st.updatedAt > ROOM_TTL_MS;
    if (idle) rooms.delete(code);
  }
}, 10 * 60 * 1000).unref();

process.on('SIGTERM', () => {
  console.log('SIGTERM received; closing HTTP server.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 9000).unref();
});

server.listen(PORT, () => console.log(`Live poll presentation running on port ${PORT}`));
