const express = require('express'), http = require('http'), crypto = require('crypto');
const { Server } = require('socket.io');
const app = express();
const F = f => (q, s) => s.sendFile(__dirname + '/' + f); // flat layout: only these files are public
app.get('/', F('index.html')); app.get('/style.css', F('style.css')); app.get('/client.js', F('client.js'));
app.get('/healthz', (q, s) => s.send('ok'));
const srv = http.createServer(app), io = new Server(srv);
const rooms = new Map(); // in-memory only, no database
const NIGHT = 45, REVEAL = 20, RES = 8, HUNT = 30;
const rnd = n => crypto.randomBytes(n).toString('hex');
const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const newCode = () => { let c; do c = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]).join(''); while (rooms.has(c)); return c; };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const alive = r => r.players.filter(p => p.alive), byId = (r, id) => r.players.find(p => p.id === id);
const isM = p => p.role === 'mafia' || p.role === 'godfather';
const mkPlayer = (r, name) => { const p = { id: rnd(3), tok: rnd(16), name, alive: true, on: false }; r.players.push(p); return p; };

const targets = (r, p) => {
  const al = alive(r);
  if (isM(p)) return al.filter(q => !isM(q)).map(q => q.id);
  if (p.role === 'doctor') return al.map(q => q.id);
  if (p.role === 'detective') return al.filter(q => q.id !== p.id).map(q => q.id);
  if (p.role === 'spy') return al.filter(q => q.id !== p.id && q.id !== p.lastWatch).map(q => q.id);
  return [];
};
const need = r => alive(r).filter(p => isM(p) || ['doctor', 'detective', 'spy'].includes(p.role));

// Each player only ever receives their own personalised view (secrets stay on the server).
function view(r, p) {
  const end = r.phase === 'end', n = r.night || { pick: {}, res: {} };
  const v = {
    code: r.code, phase: r.phase, round: r.round, left: Math.max(0, (r.deadline || 0) - Date.now()),
    host: p.id === r.host, set: r.set, msg: r.msg, res: r.res, win: r.win,
    me: { id: p.id, name: p.name, role: p.role, alive: p.alive },
    players: r.players.map(q => ({
      id: q.id, name: q.name, alive: q.alive, on: q.on, host: q.id === r.host, ready: !!q.ready,
      role: q.role && (end || !q.alive || (isM(p) && isM(q))) ? q.role : undefined
    })),
    chat: r.chat.filter(m => m.ch === 'all' || isM(p))
  };
  if (p.alive && r.phase === 'night') { v.pick = n.pick[p.id]; v.check = n.res[p.id]; v.targets = targets(r, p); }
  if (p.alive && r.phase === 'vote') { v.pick = r.vote.v[p.id]; v.targets = alive(r).filter(q => q.id !== p.id).map(q => q.id); }
  if (p.role === 'doctor' && r.docRes && r.docRes.round === r.round && ['day', 'vote', 'result'].includes(r.phase)) v.docRes = r.docRes.ok;
  if (p.role === 'spy' && r.spyRes && r.spyRes.round === r.round && ['day', 'vote', 'result'].includes(r.phase)) v.spyRes = r.spyRes;
  if (r.phase === 'hunter' && p.id === r.hunter) v.targets = alive(r).map(q => q.id);
  return v;
}
const push = r => { r.touched = Date.now(); r.players.forEach(p => p.sid && io.to(p.sid).emit('state', view(r, p))); };
const timer = (r, sec, fn) => { clearTimeout(r.tm); r.deadline = Date.now() + sec * 1000; r.tm = setTimeout(fn, sec * 1000); };

function win(r) {
  const a = alive(r), m = a.filter(isM).length;
  return m === 0 ? 'citizens' : m >= a.length - m ? 'mafia' : null;
}
function startGame(r) {
  const s = r.set, n = r.players.length, c = n - s.m - (s.doc ? 1 : 0) - (s.det ? 1 : 0) - (s.hun ? 1 : 0) - (s.spy ? 1 : 0);
  const roles = shuf([...Array(s.m - (s.god ? 1 : 0)).fill('mafia'), ...(s.god ? ['godfather'] : []), ...(s.doc ? ['doctor'] : []), ...(s.det ? ['detective'] : []), ...(s.hun ? ['hunter'] : []), ...(s.spy ? ['spy'] : []), ...Array(c).fill('citizen')]);
  r.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; p.ready = false; p.lastWatch = null; });
  r.round = 0; r.chat = []; r.docRes = r.spyRes = r.hunter = null; r.msg = null; r.res = null; r.win = null;
  r.phase = 'reveal'; timer(r, REVEAL, () => night(r)); push(r);
}
function night(r) {
  r.phase = 'night'; r.round++; r.night = { pick: {}, res: {} };
  timer(r, NIGHT, () => endNight(r)); push(r);
}
function endNight(r) {
  clearTimeout(r.tm);
  const n = r.night, cnt = {};
  alive(r).filter(p => isM(p) && n.pick[p.id]).forEach(p => { const t = n.pick[p.id]; cnt[t] = (cnt[t] || 0) + 1; });
  const mx = Math.max(0, ...Object.values(cnt)), top = Object.keys(cnt).filter(k => cnt[k] === mx);
  const doc = alive(r).find(p => p.role === 'doctor'), save = doc && n.pick[doc.id];
  let dead = null;
  const tg = top.length ? byId(r, shuf(top)[0]) : null;
  r.docRes = doc && save ? { round: r.round, ok: !!tg && tg.id === save } : null; // private to the doctor
  const spy = alive(r).find(p => p.role === 'spy'), sw = spy && n.pick[spy.id];
  r.spyRes = sw ? { round: r.round, name: byId(r, sw).name, did: !!n.pick[sw] } : null; // private to the spy
  if (spy) spy.lastWatch = sw || null;
  if (tg && tg.id !== save) { tg.alive = false; dead = { name: tg.name, role: tg.role }; }
  r.msg = { dead, dead2: null }; r.night = null;
  if (dead && dead.role === 'hunter') return hunterPhase(r, tg);
  afterNight(r);
}
const afterNight = r => { const w = win(r); w ? finish(r, w) : day(r); };
function hunterPhase(r, h) { r.phase = 'hunter'; r.hunter = h.id; timer(r, HUNT, () => afterHunter(r)); push(r); }
function afterHunter(r) { clearTimeout(r.tm); r.hunter = null; afterNight(r); }
function day(r) { r.phase = 'day'; timer(r, r.set.time, () => voting(r)); push(r); }
function voting(r) { r.phase = 'vote'; r.vote = { v: {} }; timer(r, r.set.vtime, () => tally(r)); push(r); }
function tally(r) {
  clearTimeout(r.tm);
  const cnt = {}; Object.values(r.vote.v).forEach(t => cnt[t] = (cnt[t] || 0) + 1);
  const e = Object.entries(cnt).sort((a, b) => b[1] - a[1]), tie = e.length > 1 && e[0][1] === e[1][1];
  let out = null;
  if (e.length && !tie) { const t = byId(r, e[0][0]); t.alive = false; out = { name: t.name, role: t.role }; }
  r.res = { counts: e.map(([id, c]) => ({ name: byId(r, id).name, c })), out, tie };
  r.phase = 'result'; const w = win(r);
  timer(r, RES, () => w ? finish(r, w) : night(r)); push(r);
}
function finish(r, w) { clearTimeout(r.tm); r.phase = 'end'; r.win = w; r.deadline = 0; push(r); }
function drop(r, p) {
  r.players = r.players.filter(q => q !== p);
  if (!r.players.length) { clearTimeout(r.tm); return rooms.delete(r.code); }
  if (r.host === p.id) r.host = r.players[0].id;
  push(r);
}

io.on('connection', s => {
  const get = () => { const r = rooms.get(s.data.room); return r ? { r, p: byId(r, s.data.pid) } : {}; };
  const attach = (r, p) => { p.sid = s.id; p.on = true; clearTimeout(p.off); s.data = { room: r.code, pid: p.id }; push(r); };

  s.on('create', (d, ack) => {
    const name = clean(d && d.name, 14); if (!name) return ack({ err: 'اكتب اسمك' });
    const r = { code: newCode(), players: [], phase: 'lobby', round: 0, chat: [], set: { m: 0, doc: true, det: true, god: false, hun: false, spy: false, time: 180, vtime: 60 }, touched: Date.now() };
    const p = mkPlayer(r, name); r.host = p.id; rooms.set(r.code, r);
    ack({ ok: 1, code: r.code, tok: p.tok }); attach(r, p);
  });
  s.on('join', (d, ack) => {
    const r = rooms.get(clean(d && d.code, 5).toUpperCase()), name = clean(d && d.name, 14);
    if (!r) return ack({ err: 'الغرفة غير موجودة' });
    if (r.phase !== 'lobby') return ack({ err: 'اللعبة بدأت بالفعل' });
    if (!name) return ack({ err: 'اكتب اسمك' });
    if (r.players.length >= 15) return ack({ err: 'الغرفة ممتلئة' });
    if (r.players.some(p => p.name === name)) return ack({ err: 'الاسم مستخدم، اختر اسماً آخر' });
    const p = mkPlayer(r, name); ack({ ok: 1, code: r.code, tok: p.tok }); attach(r, p);
  });
  s.on('resume', (d, ack) => {
    const r = rooms.get(String(d && d.code)), p = r && r.players.find(q => q.tok === d.tok);
    if (!p) return ack({ err: 1 }); ack({ ok: 1 }); attach(r, p);
  });
  s.on('start', (d, ack) => {
    const { r, p } = get(); if (!p || r.host !== p.id || r.phase !== 'lobby') return;
    const n = r.players.length, m = +d.m || Math.max(1, n / 3 | 0), doc = !!d.doc, det = !!d.det, god = !!d.god, hun = !!d.hun, spy = !!d.spy;
    const time = [60, 120, 180, 300, 600].includes(+d.time) ? +d.time : 180, vtime = [30, 60, 90, 120, 180].includes(+d.vtime) ? +d.vtime : 60, c = n - m - doc - det - hun - spy;
    if (n < 4) return ack({ err: 'أقل عدد 4 لاعبين' });
    if (m * 2 >= n) return ack({ err: 'عدد المافيا كبير بالنسبة لعدد اللاعبين، قلّله' });
    if (c < 1) return ack({ err: 'الشخصيات الخاصة أكثر من اللازم لهذا العدد، عطّل بعضها' });
    if (god && m < 2) return ack({ err: 'العرّاب يحتاج فريق مافيا من 2 على الأقل' });
    r.set = { m, doc, det, god, hun, spy, time, vtime }; startGame(r); ack({ ok: 1 });
  });
  s.on('ready', () => {
    const { r, p } = get(); if (!p || r.phase !== 'reveal') return;
    p.ready = true; r.players.every(q => q.ready) ? night(r) : push(r);
  });
  s.on('act', t => {
    const { r, p } = get(); if (!p || r.phase !== 'night' || !p.alive || !targets(r, p).includes(t)) return;
    if (p.role === 'detective' && r.night.pick[p.id]) return;
    r.night.pick[p.id] = t;
    if (p.role === 'detective') r.night.res[p.id] = { id: t, m: byId(r, t).role === 'mafia' };
    need(r).every(q => r.night.pick[q.id]) ? endNight(r) : push(r);
  });
  s.on('vote', t => {
    const { r, p } = get(); if (!p || r.phase !== 'vote' || !p.alive || r.vote.v[p.id]) return;
    const q = byId(r, t); if (!q || !q.alive || q === p) return;
    r.vote.v[p.id] = t; alive(r).every(x => r.vote.v[x.id]) ? tally(r) : push(r);
  });
  s.on('shoot', t => {
    const { r, p } = get(); if (!p || r.phase !== 'hunter' || r.hunter !== p.id) return;
    const q = byId(r, t); if (!q || !q.alive) return;
    q.alive = false; r.msg.dead2 = { name: q.name, role: q.role }; afterHunter(r);
  });
  s.on('skip', () => { const { r, p } = get(); if (p && r.host === p.id && r.phase === 'day') voting(r); });
  s.on('chat', t => {
    const { r, p } = get(); t = clean(t, 200);
    if (!p || !t || !p.alive || !['day', 'vote', 'night'].includes(r.phase)) return;
    const ch = r.phase === 'night' ? 'mafia' : 'all'; if (ch === 'mafia' && !isM(p)) return;
    r.chat.push({ ch, name: p.name, text: t }); if (r.chat.length > 100) r.chat.shift(); push(r);
  });
  s.on('again', () => {
    const { r, p } = get(); if (!p || r.host !== p.id || r.phase !== 'end') return;
    r.players.forEach(q => { q.role = null; q.alive = true; q.ready = false; });
    r.phase = 'lobby'; r.chat = []; r.msg = r.res = r.win = null; push(r);
  });
  s.on('disconnect', () => {
    const { r, p } = get(); if (!p || p.sid !== s.id) return;
    p.on = false; p.sid = null;
    if (r.phase === 'lobby') p.off = setTimeout(() => drop(r, p), 90000);
    push(r);
  });
});
setInterval(() => rooms.forEach((r, c) => {
  if (Date.now() - r.touched > 3 * 3600e3) { clearTimeout(r.tm); rooms.delete(c); }
}), 600e3);
srv.listen(process.env.PORT || 3000, () => console.log('Mafia server up'));
