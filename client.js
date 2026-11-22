const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
const ROLES = { mafia: { n: 'مافيا', i: '🔪', d: 'اقتل مع فريقك كل ليلة دون أن تنكشف.' }, godfather: { n: 'العرّاب', i: '🎩', d: 'زعيم المافيا: تعرف فريقك وتشارك في اختيار الضحية، ويظهر للمحقق كمواطن بريء.' }, doctor: { n: 'طبيب', i: '⚕️', d: 'احمِ لاعباً كل ليلة من القتل، وستعرف سراً إن نجحت الحماية.' }, detective: { n: 'محقق', i: '🕵️', d: 'افحص لاعباً كل ليلة لتعرف إن كان مافيا.' }, hunter: { n: 'الصياد', i: '🏹', d: 'إذا قتلتك المافيا ليلاً تختار لاعباً يخرج معك (مرة واحدة). إذا خرجت بالتصويت تضيع قدرتك.' }, spy: { n: 'الجاسوس', i: '👁️', d: 'تراقب لاعباً كل ليلة وتعرف إن كان قام بنشاط ليلي، دون أن تعرف دوره. لا تراقب نفس اللاعب ليلتين متتاليتين.' }, citizen: { n: 'مواطن', i: '🏙️', d: 'اكشف المافيا بالنقاش والتصويت.' } };
const socket = io(); const qs = new URLSearchParams(location.search);
let V = null, until = 0, last = '', cfg = { m: 0, doc: true, det: true, god: false, hun: false, spy: false, time: 180, vtime: 60 }, ses = null;
try { ses = JSON.parse(localStorage.getItem('mafiaSes')); } catch (e) { }
const store = o => { ses = o; try { o ? localStorage.setItem('mafiaSes', JSON.stringify(o)) : localStorage.removeItem('mafiaSes'); } catch (e) { } };

socket.on('connect', () => { if (ses) socket.emit('resume', ses, r => { if (r.err) { store(null); V = null; render(); } }); });
socket.on('disconnect', () => { $('#cn').hidden = false; });
socket.on('state', v => { V = v; until = Date.now() + v.left; render(); });
setInterval(() => { const t = $('#t'); if (t) { const s = Math.max(0, Math.ceil((until - Date.now()) / 1000)); t.textContent = fmt(s); t.classList.toggle('end', s <= 10); } }, 400);

const go = h => {
  const ci = $('#ci'), val = ci ? ci.value : '', foc = ci && document.activeElement === ci;
  app.innerHTML = '<div class="wrap fade">' + h + '</div>';
  const n = $('#ci'); if (n) { n.value = val; if (foc) n.focus(); }
};
const mf = r => r === 'mafia' || r === 'godfather';
const docH = v => typeof v.docRes === 'boolean' ? `<div class="card"><b>${v.docRes ? 'نجحت عملية الإنقاذ 🩺' : 'لم تنجح عملية الإنقاذ هذه الليلة'}</b><p class="mut">نتيجة سرية: لا يراها غيرك</p></div>` : '';
const spyH = v => v.spyRes ? `<div class="card"><b>👁️ ${esc(v.spyRes.name)}: ${v.spyRes.did ? 'قام بنشاط ليلي 👣' : 'لم يقم بأي نشاط ليلي'}</b><p class="mut">نتيجة سرية: لا يراها غيرك</p></div>` : '';
const nm = (v, id) => v.players.find(p => p.id === id).name;
const tag = (v, t) => `<div class="tag">${t}</div> <span class="chip">${ROLES[v.me.role].i} ${ROLES[v.me.role].n}</span>`;
const timerH = v => `<div class="timer" id="t">${fmt(Math.ceil(v.left / 1000))}</div>`;
const plist = v => '<div>' + v.players.map(p => `<span class="chip ${p.alive ? '' : 'd'}">${p.alive ? (p.on ? '🟢' : '⚪') : '💀'} ${esc(p.name)}${p.host ? ' 👑' : ''}${p.role ? ' ' + ROLES[p.role].i : ''}</span>`).join('') + '</div>';
const chatBox = (v, on) => `<div class="card chat"><div class="msgs" id="ms">${v.chat.slice(-30).map(m => `<div class="${m.ch === 'mafia' ? 'gold' : ''}"><b>${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('') || '<span class="mut">لا رسائل بعد</span>'}</div>${on ? `<div class="row"><input id="ci" placeholder="${v.phase === 'night' ? 'محادثة المافيا السرية' : 'اكتب رسالة'}" maxlength="200" onkeydown="if(event.key==='Enter')snd()"><button class="x" style="width:50px" onclick="snd()">➤</button></div>` : ''}</div>`;
const opts = (v, fn) => `<div class="opts">${v.targets.map(id => `<button class="opt ${v.pick === id ? 'on' : ''}" onclick="${fn}('${id}')">${esc(nm(v, id))}</button>`).join('')}</div>`;
const snd = () => { const i = $('#ci'); if (i && i.value.trim()) { socket.emit('chat', i.value); i.value = ''; } };
const act = id => socket.emit('act', id), vt = id => socket.emit('vote', id), skip = () => socket.emit('skip');

function render() {
  $('#cn').hidden = true;
  if (!V) return home();
  const v = V, key = v.phase + v.round; const fresh = key !== last; last = key;
  ({ lobby, reveal, night, day, vote, result, hunter, end: fin })[v.phase](v);
  if (!fresh && app.firstChild) app.firstChild.classList.remove('fade');
  const m = $('#ms'); if (m) m.scrollTop = m.scrollHeight;
}

function home() {
  const r = qs.get('r') || '';
  go(`<div class="logo">🎭</div><h1>المافيا أونلاين</h1><p class="mut">كل لاعب من هاتفه، بدون تسجيل.</p>
  <div class="card"><input id="nm" placeholder="اسمك" maxlength="14" value="${esc(localStorage.getItem('mafiaName') || '')}">
  ${r ? '' : '<button class="btn" onclick="mk()">إنشاء غرفة جديدة</button>'}
  <input id="cd" placeholder="كود الغرفة" maxlength="5" value="${esc(r)}" style="text-transform:uppercase;margin-top:10px">
  <button class="btn ${r ? '' : 'ghost'}" onclick="jn()">انضمام</button></div><div id="err" class="err"></div>`);
}
const myName = () => { const n = $('#nm').value.trim(); try { localStorage.setItem('mafiaName', n); } catch (e) { } return n; };
const done = r => { if (r.err) return $('#err').textContent = r.err; store({ code: r.code, tok: r.tok }); history.replaceState(null, '', '/'); };
const mk = () => socket.emit('create', { name: myName() }, done);
const jn = () => socket.emit('join', { name: myName(), code: $('#cd').value }, done);

function lobby(v) {
  const link = location.origin + '/?r=' + v.code, n = v.players.length, m = cfg.m || Math.max(1, n / 3 | 0);
  go(`<div class="logo">🎭</div><h1>غرفة الانتظار</h1>
  <div class="card"><p class="mut">كود الغرفة</p><h1 style="letter-spacing:6px">${v.code}</h1>
  <button class="btn ghost" onclick="navigator.clipboard&&navigator.clipboard.writeText('${link}');this.textContent='تم النسخ ✅'">📋 نسخ رابط الدعوة</button>
  <a class="btn" href="https://wa.me/?text=${encodeURIComponent('تعال العب المافيا معي! ' + link)}" target="_blank" rel="noopener">📲 مشاركة عبر واتساب</a></div>
  <div class="card"><h3>اللاعبون (${n}/15)</h3>${plist(v)}</div>
  ${v.host ? `<div class="card"><h3>الإعدادات</h3>
  <div class="row sp"><span>🔪 فريق المافيا <small class="mut">(يشمل العرّاب)</small></span><span><button class="st" onclick="cm(-1)">−</button> <b>${m}</b> <button class="st" onclick="cm(1)">+</button></span></div>
  <label class="row sp"><span>⚕️ طبيب</span><input type="checkbox" ${cfg.doc ? 'checked' : ''} onchange="cfg.doc=this.checked"></label>
  <label class="row sp"><span>🕵️ محقق</span><input type="checkbox" ${cfg.det ? 'checked' : ''} onchange="cfg.det=this.checked"></label>
  <label class="row sp"><span>🎩 العرّاب <small class="mut">(يلزم مافيا 2+)</small></span><input type="checkbox" ${cfg.god ? 'checked' : ''} onchange="cfg.god=this.checked"></label>
  <label class="row sp"><span>🏹 الصياد</span><input type="checkbox" ${cfg.hun ? 'checked' : ''} onchange="cfg.hun=this.checked"></label>
  <label class="row sp"><span>👁️ الجاسوس</span><input type="checkbox" ${cfg.spy ? 'checked' : ''} onchange="cfg.spy=this.checked"></label>
  <div class="row sp"><span>🗳️ مدة التصويت</span><select style="flex:0 0 120px" onchange="cfg.vtime=+this.value">${[30, 60, 90, 120, 180].map(t => `<option value="${t}" ${cfg.vtime == t ? 'selected' : ''}>${t} ث</option>`).join('')}</select></div>
  <div class="row sp"><span>⏱️ مدة النقاش</span><select style="flex:0 0 120px" onchange="cfg.time=+this.value">${[60, 120, 180, 300, 600].map(t => `<option value="${t}" ${cfg.time == t ? 'selected' : ''}>${t / 60} د</option>`).join('')}</select></div></div>
  <button class="btn" onclick="start()">ابدأ اللعبة</button><div id="err" class="err"></div>` : '<p class="mut">بانتظار المضيف ليبدأ اللعبة…</p>'}`);
}
const cm = d => { cfg.m = Math.max(1, (cfg.m || Math.max(1, V.players.length / 3 | 0)) + d); render(); };
const start = () => socket.emit('start', cfg, r => { if (r.err) $('#err').textContent = r.err; });

function reveal(v) {
  const R = ROLES[v.me.role], mates = v.players.filter(p => mf(p.role) && p.id !== v.me.id).map(p => esc(p.name) + (p.role === 'godfather' ? ' 🎩' : ''));
  const me = v.players.find(p => p.id === v.me.id), rc = v.players.filter(p => p.ready).length;
  go(`<div class="tag">دورك السري</div><div class="role ${v.me.role}"><div class="ri">${R.i}</div><h1>${R.n}</h1><p>${R.d}</p>
  ${mf(v.me.role) ? `<p class="gold">فريقك: ${mates.length ? mates.join('، ') : 'أنت وحدك'}</p>` : ''}</div>
  ${timerH(v)}<button class="btn red" ${me.ready ? 'disabled' : ''} onclick="socket.emit('ready')">${me.ready ? 'بانتظار البقية…' : 'فهمت، أنا جاهز'}</button>
  <p class="mut">${rc}/${v.players.length} جاهز</p>`);
}
const TT = { mafia: '🔪 اختر ضحيتك', godfather: '🎩 اختر ضحيتك', spy: '👁️ من تراقب الليلة؟', doctor: '⚕️ من تحمي الليلة؟', detective: '🕵️ من تفحص؟' };
function night(v) {
  const m = v.me, al = m.alive; let body;
  if (!al) body = '<h2>💀 خرجت من اللعبة، تابع بصمت</h2>';
  else if (v.check) body = `<div class="role ${v.check.m ? 'mafia' : ''}"><div class="ri">${v.check.m ? '🔪' : '✅'}</div><h1>${esc(nm(v, v.check.id))}</h1><p>${v.check.m ? 'من المافيا!' : 'ليس من المافيا'}</p></div>`;
  else if (v.targets && v.targets.length) body = `<h2>${TT[m.role]}</h2>${opts(v, 'act')}`;
  else body = '<div class="logo">😴</div><h2>المدينة نائمة…</h2><p class="mut">انتظر حتى الصباح</p>';
  go(`${tag(v, '🌙 الليلة ' + v.round)}${body}${timerH(v)}${plist(v)}${al && mf(m.role) ? chatBox(v, 1) : ''}`);
}
function day(v) {
  const d = v.msg && v.msg.dead;
  go(`${tag(v, '☀️ النهار ' + v.round)}<h1>${d ? `قُتل ${esc(d.name)} هذه الليلة 💀` : 'مرّت الليلة بسلام، لم يُقتل أحد 🌅'}</h1>
  ${d ? `<p class="mut">كان دوره: ${ROLES[d.role].i} ${ROLES[d.role].n}</p>` : ''}${v.msg && v.msg.dead2 ? `<p class="mut">🏹 وأخذ الصياد معه ${esc(v.msg.dead2.name)} (${ROLES[v.msg.dead2.role].i} ${ROLES[v.msg.dead2.role].n})</p>` : ''}${docH(v)}${spyH(v)}${plist(v)}${timerH(v)}
  ${v.host ? '<button class="btn ghost" onclick="skip()">⏭ انتقال للتصويت</button>' : ''}${chatBox(v, v.me.alive)}`);
}
function vote(v) {
  const al = v.me.alive;
  go(`${tag(v, '🗳️ التصويت')}${!al ? '<h2>💀 لا يحق لك التصويت</h2>' : v.pick ? '<h2>تم تسجيل صوتك ✅</h2><p class="mut">بانتظار البقية…</p>' : '<h2>من تشتبه به؟</h2>' + opts(v, 'vt')}${docH(v)}${spyH(v)}${timerH(v)}${plist(v)}${chatBox(v, al)}`);
}
function result(v) {
  const r = v.res;
  go(`<div class="tag">نتيجة التصويت</div><div class="card">${r.counts.map(c => `<div class="row sp"><span>${esc(c.name)}</span><b class="gold">${c.c} 🗳️</b></div>`).join('') || '<p class="mut">لا أصوات</p>'}</div>
  <h1>${r.out ? `خرج ${esc(r.out.name)} 🚪` : 'تعادل! لا أحد يخرج اليوم ⚖️'}</h1>${r.out ? `<p class="mut">كان دوره: ${ROLES[r.out.role].i} ${ROLES[r.out.role].n}</p>` : ''}
  <p class="mut">…الليل يقترب 🌙</p>`);
}
function fin(v) {
  const mf = v.win === 'mafia';
  go(`<div class="logo">${mf ? '🔪' : '🏙️'}</div><h1>${mf ? 'فازت المافيا!' : 'فاز المواطنون!'}</h1>
  <div class="card">${v.players.map(p => `<div class="row sp" style="${p.alive ? '' : 'opacity:.55'}"><span>${p.alive ? '🟢' : '💀'} ${esc(p.name)}</span><span class="${mf(p.role) ? '' : 'gold'}">${ROLES[p.role].i} ${ROLES[p.role].n}</span></div>`).join('')}</div>
  ${v.host ? '<button class="btn" onclick="socket.emit(\'again\')">🔁 إعادة اللعب بنفس المجموعة</button>' : '<p class="mut">بانتظار المضيف لإعادة اللعب…</p>'}`);
}
const shoot = id => socket.emit('shoot', id);
function hunter(v) {
  go(`${tag(v, '🏹 الصياد')}<h1>سقط الصياد 💀</h1>${v.targets ? '<h2>اختر من يخرج معك</h2>' + opts(v, 'shoot') : '<p class="mut">الصياد يختار هدفه الأخير…</p>'}${timerH(v)}${plist(v)}`);
}
render();
