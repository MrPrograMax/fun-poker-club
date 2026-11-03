import { defaults, makeLevels, payouts, validateConfig, poolOf, bountyPoolOf, normalizeGame, addEntry, createGame, advanceClock, toggleClock, jumpLevel, eliminate, formatTime } from './engine.js';

const KEY = 'river-poker-v1';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const money = value => `${number(value)} ₽`;
const nameOf = p => p.nick || p.name;
const initials = p => nameOf(p).split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
const uid = () => crypto.randomUUID();
const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
  shuffle: '<path d="m16 3 4 4-4 4M4 7h3c5 0 5 10 10 10h3M16 13l4 4-4 4M4 17h3c2 0 3-2 4-4m2-2c1-2 2-4 4-4h3"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-3-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trophy: '<path d="M8 3h8v7a4 4 0 0 1-8 0Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 1h8"/>',
  check: '<path d="m5 12 4 4L19 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  sound: '<path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
};
const icon = name => `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.plus}</svg>`;
let state = { version: 1, config: defaults(), seats: [], library: [], game: null, step: 'settings', sound: true };
let server = false, revision = 0, pendingSave = false, saving = false, saveTimer, undo = null, audioContext, recoveryMessage = '';
let localSync = null;
try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved?.version === 1) state = saved; } catch { /* A blocked or cleared browser store should not prevent a new game. */ }
try { localSync = JSON.parse(localStorage.getItem(`${KEY}-sync`)); } catch { /* Optional sync metadata. */ }
try {
  const response = await fetch('/api/state', { signal: AbortSignal.timeout(2000) });
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const saved = await response.json(); server = true; revision = saved.revision;
    if (localSync?.pending && localSync.revision === revision) pendingSave = true;
    else if (saved.state?.version === 1) {
      if (localSync?.pending && JSON.stringify(state) !== JSON.stringify(saved.state)) {
        try { localStorage.setItem(`${KEY}-recovery`, JSON.stringify(state)); } catch {}
        recoveryMessage = 'Загружена последняя серверная версия. Несинхронизированная копия сохранена в браузере.';
      }
      state = saved.state;
    }
  }
} catch { /* Static preview uses the browser store. */ }
state.config = { ...defaults(), ...state.config };
if (state.game) normalizeGame(state.game);

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Не удалось сохранить в браузере. Проверьте свободное место.'); }
  if (server) { pendingSave = true; syncMetadata(true); clearTimeout(saveTimer); flush(); }
}
function syncMetadata(pending) { try { localStorage.setItem(`${KEY}-sync`, JSON.stringify({ revision, pending })); } catch {} }
async function flush() {
  if (saving || !server || !pendingSave) return;
  saving = true; pendingSave = false;
  try {
    const response = await fetch('/api/state', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, state }) });
    if (response.status === 409) {
      server = false;
      toast('Игра изменена в другой вкладке. Обновите страницу, чтобы загрузить её.');
    } else if (!response.ok) throw new Error('Save failed');
    else { revision = (await response.json()).revision; syncMetadata(pendingSave); }
  } catch { server = false; toast('Сервер недоступен. Изменения сохранены только в этом браузере.'); }
  saving = false;
  if (pendingSave && server) flush();
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => $('#toast').classList.remove('visible'), 5500); }
function ensureSeats() { while (state.seats.length < state.config.seats) state.seats.push({ id: uid(), name: '', nick: '' }); state.seats.length = state.config.seats; }
function levels() { return state.levels || makeLevels(state.config); }
function go(step) { state.step = step; store(); render(); window.scrollTo(0, 0); }
function section(title, subtitle, content, extra = '') { return `<section class="panel ${extra}"><div class="section-heading"><h2>${title}</h2>${subtitle ? `<span>${subtitle}</span>` : ''}</div>${content}</section>`; }
function input(label, key, value, unit = '', attrs = '') { return `<label class="field"><span>${label}</span><div class="input-wrap"><input name="${key}" value="${escape(value)}" ${attrs}>${unit ? `<span class="unit">${unit}</span>` : ''}</div></label>`; }
function numeric(label, key, value, unit = '', min = 1, max = 10000000) { return input(label, key, value, unit, `type="number" min="${min}" max="${max}" step="1" required`); }
function toggle(label, note, key, checked) { return `<label class="toggle-row"><span><strong>${label}</strong><small>${note}</small></span><input type="checkbox" name="${key}" ${checked ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`; }
function header() {
  const current = ['settings', 'seating', 'board'].indexOf(state.step);
  return `<header class="topbar"><a href="#" class="brand" data-action="home"><span class="brand-symbol">♠</span>RIVER<span class="brand-dot">.</span><small>POKER CLUB</small></a><nav aria-label="Этапы игры">${['Настройки', 'Рассадка', 'Табло'].map((title, i) => `<button class="nav-step ${current === i ? 'selected' : ''}" data-action="nav" data-step="${['settings', 'seating', 'board'][i]}" ${i === 2 && !state.game ? 'disabled' : ''}><span>${i < current ? icon('check') : `0${i + 1}`}</span>${title}</button>`).join('')}</nav><div class="header-actions">${state.game ? `<button class="button subtle small" data-action="new">${icon('plus')} Новая игра</button>` : `<button class="button subtle small" data-action="demo">Посмотреть демо ${icon('arrow')}</button>`}</div></header>`;
}
function render() {
  ensureSeats();
  document.body.classList.toggle('board-page', state.step === 'board');
  $('#app').innerHTML = `${header()}<main>${state.step === 'settings' ? settingsView() : state.step === 'seating' ? seatingView() : boardView()}</main><footer><span><span class="tiny-spade">♠</span> MADE FOR YOUR HOME GAME</span><span class="save-status"><i></i>${server ? 'Сохранение на Go-сервере' : 'Сохранение в этом браузере'}</span><span>Хороших карт. Хорошего вечера.</span></footer>`;
  tick();
}
function settingsView() {
  const c = state.config;
  return `<div class="page-heading"><div><div class="eyebrow">ВАШ СТОЛ. ВАШИ ПРАВИЛА.</div><h1>Всё начинается<br>с хорошей компании<span class="accent">.</span></h1><p>Соберите друзей. Настройте игру. Остальное — за нами.</p></div><div class="card-art" aria-hidden="true"><div class="playing-card back-card"><b>A</b><span>♣</span><i>♣</i></div><div class="playing-card front-card"><b>A</b><span>♠</span><i>♠</i></div><div class="chip chip-one"></div><div class="chip chip-two"></div></div></div>
  ${state.game ? '<div class="notice">Игра уже создана. Её настройки зафиксированы; для изменения структуры начните новую игру.</div>' : ''}
  <form id="settings-form"><fieldset ${state.game ? 'disabled' : ''}><div class="setup-grid"><div class="setup-main">
    ${section('Формат игры', '01 / ОСНОВНОЕ', `<div class="mode-picker"><button type="button" data-action="mode" data-mode="tournament" class="mode-card ${c.mode === 'tournament' ? 'active' : ''}"><span class="mode-icon">${icon('trophy')}</span><span><strong>Турнир</strong><small>Растущие блайнды и призовые места</small></span><i class="radio"></i></button><button type="button" data-action="mode" data-mode="cash" class="mode-card ${c.mode === 'cash' ? 'active' : ''}"><span class="mode-icon cash-icon">♣</span><span><strong>Кэш-игра</strong><small>Постоянные блайнды, свободный выход</small></span><i class="radio"></i></button></div>${input('Название вечера', 'name', c.name, '', 'type="text" maxlength="60" required placeholder="Например, пятничный покер"')}`)}
    ${section('Стек и блайнды', '02 / СТРУКТУРА', `<div class="fields three">${numeric('Стартовый стек', 'stack', c.stack, 'фишек')}${numeric('Малый блайнд', 'sb', c.sb, 'SB', 1, 1000000)}${numeric('Большой блайнд', 'bb', c.bb, 'BB', 2, 1000000)}</div>${c.mode === 'tournament' ? `<div class="fields two spaced">${numeric('Длительность уровня', 'duration', c.duration, 'мин', 1, 180)}<label class="field"><span>Рост блайндов</span><button type="button" class="input-button" data-action="structure">12 уровней · настроить ${icon('arrow')}</button></label></div><div class="divider"></div>${toggle('Big blind ante', 'Анте оплачивает только большой блайнд', 'ante', c.ante)}<div class="fields two spaced"><label class="field"><span>Перерыв</span><select name="breakEvery">${[0, 3, 4, 6].map(v => `<option value="${v}" ${c.breakEvery === v ? 'selected' : ''}>${v ? `Каждые ${v} уровня` : 'Без перерывов'}</option>`).join('')}</select></label>${numeric('Длительность перерыва', 'breakDuration', c.breakDuration, 'мин', 1, 60)}</div>` : '<p class="field-hint">Блайнды фиксируются на всю сессию. Таймер показывает время игры.</p>'}`)}
    ${section(c.mode === 'tournament' ? 'Взносы и призовые' : 'Вход в игру', '03 / БАНК', `<div class="fields two">${numeric(c.mode === 'tournament' ? 'Бай-ин' : 'Стартовый вход', 'buyin', c.buyin, '₽')}${numeric('Количество игроков', 'seats', c.seats, 'чел.', 2, 10)}</div>${c.mode === 'tournament' ? `<div class="divider"></div><div class="prize-heading"><label for="prize-count">Призовые места</label><select id="prize-count" name="prizeCount">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === c.prizes.length ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="prize-inputs">${c.prizes.map((p, i) => numeric(`${i + 1}-е место`, `prize-${i}`, p, '%', 1, 100)).join('')}</div><div id="prize-total" class="field-hint">Всего ${c.prizes.reduce((a,b) => a+b,0)}% из 100%</div><div class="divider"></div>${toggle('Разрешить ребаи', 'Ещё один стартовый стек за стоимость бай-ина', 'rebuy', c.rebuy)}` : '<p class="field-hint">Докупки и сумма при выходе учитываются отдельно для каждого игрока.</p>'}`)}
    ${c.mode==='tournament'?bountySettings():''}</div><aside class="setup-side"><div id="summary">${summaryView()}</div><div class="side-note">${icon('people')}<div><strong>Свои люди за одним столом</strong><p>Сохраним имена и ники — в следующий раз останется только выбрать друзей.</p></div></div></aside></div></fieldset><div class="form-bottom"><span>Все настройки можно изменить до начала игры</span>${state.game ? '<button type="button" class="button primary" data-action="nav" data-step="board">Вернуться к игре</button>' : `<button type="submit" class="button primary">К рассадке ${icon('arrow')}</button>`}</div></form>`;
}
function bountySettings() {
  const c=state.config;
  return section('Баунти и возвращение в игру','04 / ЕЩЁ ОДИН ШАНС',`<div class="fields two"><label class="field"><span>Награда за выбивание</span><select name="bountyMode"><option value="off" ${c.bountyMode==='off'?'selected':''}>Без баунти</option><option value="fixed" ${c.bountyMode==='fixed'?'selected':''}>Фиксированное</option><option value="progressive" ${c.bountyMode==='progressive'?'selected':''}>Прогрессивное · PKO</option></select></label>${c.bountyMode!=='off'?numeric('Стартовая награда за голову','bountyAmount',c.bountyAmount,'₽',1,1000000):''}</div>${c.bountyMode==='progressive'?`<div class="spaced">${numeric('Доля награды сразу выбившему','bountyImmediate',c.bountyImmediate,'%',1,99)}<p class="field-hint">Остаток увеличивает награду за голову выбившего. Победитель забирает свою оставшуюся награду.</p></div>`:''}${c.bountyMode!=='off'?'<p class="field-hint">Баунти входит в стоимость первого входа и ре-энтри. Эта часть банка не распределяется по призовым местам.</p>':''}<div class="divider"></div>${toggle('Разрешить ре-энтри','Выбывший возвращается со стартовым стеком и новой головой','reentry',c.reentry)}<div class="fields two spaced">${numeric('Стоимость аддона','addonCost',c.addonCost,'₽')}${numeric('Фишки за аддон','addonStack',c.addonStack,'фишек')}</div><p class="field-hint">Аддоны и ребаи полностью увеличивают фонд призовых мест.</p>`);
}
function summaryView() {
  const c = state.config, bounty=c.mode==='tournament'&&c.bountyMode!=='off'?c.bountyAmount:0, pool = Math.max(0,c.buyin-bounty) * c.seats, valid = Math.abs(c.prizes.reduce((a,b)=>a+b,0)-100)<.001;
  const prizes = valid ? payouts(pool, c.prizes) : c.prizes.map(() => 0);
  return `<section class="summary-card"><div class="eyebrow">ВЕЧЕР В ЦИФРАХ</div><h2>${escape(c.name || 'Ваша игра')}</h2><span class="pill">${c.mode === 'tournament' ? 'NO-LIMIT HOLD’EM · ТУРНИР' : 'NO-LIMIT HOLD’EM · КЭШ'}</span><div class="summary-pool"><span>${c.mode === 'tournament' ? 'Стартовый призовой фонд' : 'Стартовая сумма входов'}</span><strong>${money(pool)}</strong><small>${c.seats} игроков × ${money(c.buyin-bounty)}${c.mode==="tournament"?" на места":""}</small>${bounty?`<div class="summary-bounty">Баунти отдельно <b>${money(bounty*c.seats)}</b></div>`:""}</div>${c.mode === 'tournament' ? `<div class="summary-prizes">${prizes.map((p,i) => `<div><span><i class="place-badge p${i}">${i+1}</i>${i === 0 ? 'Победитель' : `${i+1}-е место`}</span><b>${valid ? money(p) : '—'}</b></div>`).join('')}</div>` : '<div class="cash-note">Итог каждого игрока = сумма на выходе − все его входы.</div>'}<div class="summary-footer"><span>Стартовые блайнды<strong>${number(c.sb)} / ${number(c.bb)}</strong></span><span>${c.mode === 'tournament' ? 'Один уровень' : 'Стартовый стек'}<strong>${c.mode === 'tournament' ? `${c.duration} мин` : number(c.stack)}</strong></span></div></section>`;
}
function seatingView() {
  const c = state.config, filled = state.seats.filter(p => p.name.trim()).length;
  return `<div class="page-heading compact"><div><div class="eyebrow">ХОРОШИЕ ЛЮДИ. БОЛЬШИЕ БАНКИ.</div><h1>Кто сегодня за столом<span class="accent">?</span></h1><p>Добавьте имена или выберите знакомых игроков из подсказок.</p></div><span class="pill filled-pill">${filled} / ${c.seats} мест занято</span></div><div class="seating-grid">${section('Состав игроков', `${c.seats} МЕСТ`, `<form id="seating-form"><fieldset ${state.game ? 'disabled' : ''}><div class="players-editor">${state.seats.map((p,i) => `<div class="player-input-row"><span class="seat-number">${String(i+1).padStart(2,'0')}</span><div class="name-field"><label class="sr-only" for="player-${i}">Имя игрока ${i+1}</label><input id="player-${i}" name="player-${i}" data-seat="${i}" autocomplete="off" maxlength="60" placeholder="Имя и фамилия" value="${escape(p.name)}" required><div id="suggest-${i}" class="suggestions"></div></div><label class="sr-only" for="nick-${i}">Ник игрока ${i+1}</label><input class="nick-input" id="nick-${i}" name="nick-${i}" data-nick="${i}" maxlength="24" placeholder="Ник · необязательно" value="${escape(p.nick)}"></div>`).join('')}</div><button type="button" class="button subtle shuffle-button" data-action="shuffle">${icon('shuffle')} Случайная рассадка</button></fieldset><p class="field-hint">Имена сохранятся в вашей компании после создания игры.</p><button class="button primary full" type="submit">${state.game ? 'Вернуться к игре' : 'Всё готово — к игре'} ${icon('arrow')}</button></form>`)}<div class="table-preview"><div class="eyebrow">СТОЛ № 01</div><div id="table-visual">${tableVisual()}</div><p>Рассадка по часовой стрелке · один стол</p><div class="seating-details"><div>Стартовый стек<strong>${number(c.stack)}</strong></div><div>Блайнды<strong>${number(c.sb)} / ${number(c.bb)}</strong></div><div>Бай-ин<strong>${money(c.buyin)}</strong></div></div></div></div>`;
}
function tableVisual() {
  return `<div class="poker-table"><div class="table-felt"><span class="table-brand">RIVER<span>♠</span></span><small>GOOD FRIENDS. GOOD HANDS.</small><div class="table-cards"><i>♠</i><i>♣</i><i>♥</i></div></div>${state.seats.map((p,i) => { const a = -Math.PI/2 + 2*Math.PI*i/state.seats.length; return `<div class="table-seat ${p.name ? 'occupied' : ''}" style="--x:${50+46*Math.cos(a)}%;--y:${50+44*Math.sin(a)}%"><span>${p.name ? escape(initials(p)) : String(i+1).padStart(2,'0')}</span><small>${escape(nameOf(p) || 'Свободно')}</small></div>`; }).join('')}</div>`;
}
function boardView() {
  const g = state.game;
  if (!g) { state.step = 'settings'; return settingsView(); }
  const c = g.config, cash = c.mode === 'cash', level = g.levels[g.index], next = g.levels[g.index+1], alive = g.players.filter(p=>p.active).length;
  const pool = poolOf(g), prizes = payouts(pool, c.prizes);
  return `<div class="board-heading"><div><div class="eyebrow">${cash ? 'CASH GAME' : 'NO-LIMIT HOLD’EM'} <span class="dot-separator">/</span> СТОЛ 01</div><h1>${escape(c.name)}</h1></div><div class="board-tools"><button class="button icon-button ${state.sound ? 'on' : ''}" data-action="sound" title="${state.sound ? 'Выключить' : 'Включить'} звук" aria-label="${state.sound ? 'Выключить' : 'Включить'} звук">${icon('sound')}</button><button class="button subtle small" data-action="fullscreen">${icon('expand')} Полный экран</button></div></div>
  <div class="board-grid"><aside class="structure-panel panel"><div class="section-heading"><h2>${cash ? 'За столом' : 'Структура'}</h2><span>${cash ? `${alive} ИГРОКОВ` : `${g.levels.filter(l=>l.kind==='level').length} УРОВНЕЙ`}</span></div>${cash ? `<div class="cash-side"><span>Фиксированные блайнды</span><strong>${number(c.sb)} / ${number(c.bb)}</strong><p>Добавляйте входы и отмечайте сумму на выходе в списке игроков.</p></div>` : `<div class="structure-scroll"><table class="structure-table"><thead><tr><th>LVL</th><th>SB / BB</th><th>МИН</th></tr></thead><tbody>${g.levels.map((l,i) => `<tr class="${g.index===i?'current':g.index>i?'past':''}"><td>${l.kind==='break'?'☕':String(l.number).padStart(2,'0')}</td><td>${l.kind==='break'?'Перерыв':`${number(l.sb)} / ${number(l.bb)}`}</td><td>${l.duration/60}${g.index===i?'<i class="live-dot"></i>':''}</td></tr>`).join('')}</tbody></table></div>`}<div class="structure-bottom">${icon('clock')} С начала игры <b id="elapsed">00:00:00</b></div></aside>
  <section class="timer-panel"><div class="timer-top"><span class="pill">${cash ? 'ВРЕМЯ СЕССИИ' : level.kind==='break'?'ПЕРЕРЫВ':`УРОВЕНЬ ${String(level.number).padStart(2,'0')}`}</span><span id="timer-status" class="timer-status">На паузе</span></div><div class="timer-display ${cash ? 'cash-timer' : ''} ${level.kind==='break'?'break-timer':''}" id="timer">${cash ? formatTime(g.elapsed/1000,true) : formatTime(g.remaining)}</div><div class="timer-progress"><div id="progress"></div></div><div class="timer-controls">${!cash ? `<button class="button icon-button" data-action="prev" aria-label="Предыдущий уровень" ${g.index===0||g.finished?'disabled':''}>${icon('back')}</button>` : ''}<button class="button primary play-button" data-action="play" ${g.finished||g.structureEnded?'disabled':''}>${icon(g.running?'pause':'play')}<span>${g.running?'Пауза':'Запустить таймер'}</span></button>${!cash ? `<button class="button icon-button" data-action="next" aria-label="Следующий уровень" ${g.index===g.levels.length-1||g.finished?'disabled':''}>${icon('arrow')}</button>` : ''}</div>
  <div class="blind-cards"><div><span>${cash ? 'Малый блайнд' : 'Текущие блайнды'}</span><strong>${cash ? number(c.sb) : level.kind==='break'?'Отдыхаем':`${number(level.sb)}<i>/</i>${number(level.bb)}`}</strong><small>${!cash && level.ante ? `BB ante ${number(level.ante)}` : cash?'SB':'Без анте'}</small></div><div><span>${cash ? 'Большой блайнд' : 'Следующий уровень'}</span><strong>${cash ? number(c.bb) : !next ? '—' : next.kind==='break'?'Перерыв':`${number(next.sb)}<i>/</i>${number(next.bb)}`}</strong><small>${cash?'BB':!next?'Последний уровень':next.kind==='break'?`${next.duration/60} минут` : next.ante ? `BB ante ${number(next.ante)}`:'Без анте'}</small></div></div>
  <div class="board-metrics"><div><span>Игроков в игре</span><strong>${alive}<i> / ${g.players.length}</i></strong></div><div><span>${cash?'Всего входов':'Стартовый стек'}</span><strong>${cash?money(pool):number(c.stack)}</strong></div><div><span>${cash?'Зафиксировано выходов':'Ребаи / ре-энтри / аддоны'}</span><strong>${cash?g.players.filter(p=>!p.active).length:`${g.players.reduce((n,p)=>n+p.rebuys,0)} / ${g.players.reduce((n,p)=>n+p.reentries,0)} / ${g.players.reduce((n,p)=>n+p.addons,0)}`}</strong></div></div>${g.finished?`<div class="winner-banner">${icon('trophy')} ${cash ? 'Сессия завершена' : `Победитель — ${escape(nameOf(g.players.find(p=>p.place===1)))}`}</div>`:''}</section>
  <aside class="prizes-panel panel"><div class="section-heading"><h2>${cash?'Банк игры':'Призовые'}</h2>${icon('trophy')}</div><div class="board-pool"><span>${cash?'Всего внесено':'Призовой фонд'}</span><strong>${money(pool)}</strong></div>${cash?`<div class="cash-note">На выходах<br><strong>${money(g.players.reduce((n,p)=>n+(p.cashout||0),0))}</strong><br>Осталось за столом<br><strong>${money(pool-g.players.reduce((n,p)=>n+(p.cashout||0),0))}</strong></div>`:`<div class="board-prizes">${prizes.map((amount,i)=>{const winner=g.players.find(p=>p.place===i+1);return `<div class="board-prize ${i===0?'first-prize':''}"><span class="place-badge p${i}">${i===0?icon('trophy'):i+1}</span><div><span>${i===0?'Победитель':`${i+1}-е место`}</span><strong>${money(amount)}</strong>${winner?`<small>${escape(nameOf(winner))}</small>`:''}</div><small>${c.prizes[i]}%</small></div>`;}).join('')}</div>`}${!cash&&c.bountyMode!=="off"?`<div class="bounty-bank"><span>Баунти · ${c.bountyMode==="fixed"?"фиксированное":"PKO"}</span><strong>${money(bountyPoolOf(g))}</strong><small>Заработано: ${money(g.players.reduce((n,p)=>n+p.earnedBounty,0))}<br>В игре: ${money(g.players.reduce((n,p)=>n+p.bounty,0))}</small></div>`:""}<p class="prize-note">${cash?'Денежный итог считается по входам и выходам.':c.rebuy?'Ребаи и аддоны целиком идут на места. Ре-энтри пополняет фонд с резервом под новую голову.':'Призовой фонд распределяется полностью, без комиссии.'}</p></aside></div>
  ${rosterView(g)}${eventView(g)}`;
}
function rosterView(g) {
  const c=g.config,cash=c.mode==='cash',bounty=!cash&&c.bountyMode!=='off';
  return section('Игроки за столом',undo?'<button class="text-button" data-action="undo">Отменить последнее действие</button>':'РЕЗУЛЬТАТЫ СОХРАНЯЮТСЯ',`<div class="roster">${g.players.map(p=>`<div class="roster-player ${!p.active?'eliminated':''}"><span class="avatar">${escape(initials(p))}</span><div class="roster-name"><strong>${escape(nameOf(p))}</strong><small>${p.place?`${p.place}-е место`:`Место ${p.seat}`} · вход ${money(p.invested)}</small>${!cash?`<small>Выбил: ${p.knockouts} · Р: ${p.rebuys} · РЭ: ${p.reentries} · А: ${p.addons}</small>`:''}${bounty?`<small class="bounty-line">Голова ${money(p.bounty)} · выиграл ${money(p.earnedBounty)}</small>`:''}${cash&&p.cashout!==null?`<small class="${p.cashout-p.invested>=0?'profit':'loss'}">Итог ${p.cashout-p.invested>0?'+':''}${money(p.cashout-p.invested)}</small>`:''}${g.finished&&!cash?`<small class="profit">К выплате ${money((payouts(poolOf(g),c.prizes)[p.place-1]||0)+p.earnedBounty)}</small>`:''}</div><div class="player-actions">${p.active&&!g.finished?`${cash||c.rebuy?`<button class="mini-button" data-action="rebuy" data-id="${p.id}" aria-label="${cash?'Добавить вход':'Ребай'}: ${escape(nameOf(p))}" title="${cash?'Вход':'Ребай'}">+</button>`:''}${!cash?`<button class="mini-button addon-button" data-action="addon" data-id="${p.id}" aria-label="Аддон: ${escape(nameOf(p))}" title="Аддон">A</button>`:''}<button class="mini-button" data-action="${cash?'cashout':'bust'}" data-id="${p.id}" aria-label="${cash?'Выход':'Выбыл'}: ${escape(nameOf(p))}" title="${cash?'Выход':'Выбыл'}">${cash?'↗':'×'}</button>`:p.place===1?'<span class="winner-crown">♛</span>':!cash&&!p.active&&c.reentry?`<button class="mini-button" data-action="reentry" data-id="${p.id}" aria-label="Ре-энтри: ${escape(nameOf(p))}" title="Ре-энтри">↻</button>`:''}</div></div>`).join('')}</div>${!cash?'<p class="field-hint">Р — ребаи · РЭ — ре-энтри · А — аддоны. Кнопки: + ребай, A аддон, × выбывание, ↻ ре-энтри. При ре-энтри места пересчитываются.</p>':''}`,'roster-panel');
}
function eventView(g) {
  if(!g.events?.length)return '';
  const player=id=>escape(nameOf(g.players.find(p=>p.id===id)||{name:'Игрок'}));
  return `<details class="event-log"><summary>История действий <span>${g.events.length}</span></summary><div>${g.events.slice().reverse().map(e=>`<div class="event-row"><time>${new Date(e.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><span>${e.type==='knockout'?`${e.killerId?`${player(e.killerId)} выбил`: 'Выбыл'} ${player(e.playerId)}${e.amount||e.carried?` · ${money(e.amount)} сразу, ${money(e.carried)} на голову`:''}`:`${player(e.playerId)} · ${{rebuy:'ребай',reentry:'ре-энтри',addon:'аддон'}[e.type]} ${money(e.amount)}${e.bounty?` (из них ${money(e.bounty)} на голову)`:''}`}</span></div>`).join('')}</div></details>`;
}
function tick() {
  const g = state.game; if (!g) return;
  const changed = advanceClock(g);
  if (changed) { store(); if (state.sound) beep(); if (state.step === 'board') render(); return; }
  if (state.step !== 'board') return;
  $('#timer').textContent = g.config.mode === 'cash' ? formatTime(g.elapsed/1000,true) : formatTime(g.remaining);
  $('#elapsed').textContent = formatTime(g.elapsed/1000,true);
  $('#timer-status').textContent = g.finished?'Игра завершена':g.structureEnded?'Структура завершена':g.running?'Игра идёт':'На паузе';
  $('#timer-status').classList.toggle('running',g.running);
  $('#timer').classList.toggle('urgent',g.config.mode==='tournament'&&g.remaining<=60&&!g.structureEnded);
  $('#progress').style.width = `${g.config.mode==='cash'?100:Math.max(0,Math.min(100,g.remaining/g.levels[g.index].duration*100))}%`;
}
function beep() {
  try { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioContext.state==='suspended') audioContext.resume(); const osc = audioContext.createOscillator(), gain = audioContext.createGain(); osc.connect(gain); gain.connect(audioContext.destination); osc.frequency.value=660; gain.gain.setValueAtTime(.12,audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.6); osc.start(); osc.stop(audioContext.currentTime+.6); } catch { /* Audio is optional. */ }
}
function modal(title, content, button, onConfirm) {
  const dialog = $('#modal');
  dialog.innerHTML = `<form id="modal-form"><div class="modal-heading"><h2>${title}</h2><button class="mini-button" type="button" data-action="close" aria-label="Закрыть">×</button></div>${content}<div class="modal-actions"><button type="button" class="button subtle" data-action="close">Отмена</button><button class="button primary" type="submit">${button}</button></div></form>`;
  $('#modal-form').onsubmit = event => { event.preventDefault(); if (onConfirm(new FormData(event.currentTarget)) !== false) dialog.close(); };
  dialog.showModal();
}
function rememberPlayers() {
  state.seats.forEach(p=>{const existing=state.library.find(x=>x.name.toLocaleLowerCase()===p.name.toLocaleLowerCase());if(existing){ existing.nick=p.nick;p.id=existing.id; } else state.library.push({...p});});
}
function begin() {
  state.seats.forEach(p=>{p.name=p.name.trim();p.nick=p.nick.trim();});
  if (state.seats.some(p=>!p.name)) return toast('Заполните имена всех игроков');
  if (new Set(state.seats.map(p=>p.name.toLocaleLowerCase())).size!==state.seats.length) return toast('Один игрок указан дважды. Проверьте имена.');
  const error=validateConfig(state.config); if(error) return toast(error);
  rememberPlayers();
  state.game=createGame(state.config,levels(),state.seats); undo=null; go('board');
}
function saveUndo() { undo=structuredClone(state.game); }
function showStructure() {
  const rows=structuredClone(levels());
  modal('Структура турнира', `<p class="field-hint">Блайнды и длительность можно изменить для каждого уровня.</p><div class="level-editor"><div class="level-editor-row headings"><span>Уровень</span><span>SB</span><span>BB</span><span>Мин.</span></div>${rows.map((l,i)=>`<div class="level-editor-row"><span>${l.kind==='break'?'Перерыв':`# ${l.number}`}</span>${l.kind==='break'?'<span>—</span><span>—</span>':`<input aria-label="SB уровня ${l.number}" name="sb-${i}" type="number" min="1" max="100000000" value="${l.sb}" required><input aria-label="BB уровня ${l.number}" name="bb-${i}" type="number" min="2" max="100000000" value="${l.bb}" required>`}<input aria-label="Минуты ${l.kind==='break'?'перерыва':`уровня ${l.number}`}" name="duration-${i}" type="number" min="1" max="180" value="${l.duration/60}" required></div>`).join('')}</div>`, 'Сохранить', data=>{
    for(let i=0;i<rows.length;i++){const l=rows[i];l.duration=Number(data.get(`duration-${i}`))*60;if(l.kind==='level'){l.sb=Number(data.get(`sb-${i}`));l.bb=Number(data.get(`bb-${i}`));l.ante=state.config.ante?l.bb:0;if(l.sb>=l.bb){toast(`Уровень ${l.number}: BB должен быть больше SB`);return false;}}}
    state.levels=rows; state.config.sb=rows[0].sb;state.config.bb=rows[0].bb;store();render();
  });
}

document.addEventListener('input', event=>{
  const el=event.target;
  if(el.closest('#settings-form') && el.name) {
    const name=el.name;
    if(name==='prizeCount') return;
    if(name.startsWith('prize-')) state.config.prizes[Number(name.split('-')[1])]=Number(el.value);
    else state.config[name]=el.type==='checkbox'?el.checked:el.type==='number'||(el.tagName==='SELECT'&&name!=='bountyMode')?Number(el.value):el.value;
    if(['sb','bb','duration','breakEvery','breakDuration','ante'].includes(name)) delete state.levels;
    $('#summary').innerHTML=summaryView();
    if($('#prize-total')) {const total=state.config.prizes.reduce((a,b)=>a+b,0);$('#prize-total').textContent=`Всего ${total}% из 100%`;$('#prize-total').classList.toggle('error',total!==100);}
    store();
  }
  if(el.dataset.seat!==undefined){const i=Number(el.dataset.seat);state.seats[i].name=el.value;state.seats[i].id=uid();const query=el.value.toLocaleLowerCase().trim();const matches=query?state.library.filter(p=>`${p.name} ${p.nick}`.toLocaleLowerCase().includes(query)).slice(0,5):[];$(`#suggest-${i}`).innerHTML=matches.map(p=>`<button type="button" data-action="suggest" data-id="${p.id}" data-seat="${i}"><strong>${escape(p.name)}</strong><small>${escape(p.nick)}</small></button>`).join('');$('#table-visual').innerHTML=tableVisual();$('.filled-pill').textContent=`${state.seats.filter(p=>p.name.trim()).length} / ${state.config.seats} мест занято`;store();}
  if(el.dataset.nick!==undefined){state.seats[Number(el.dataset.nick)].nick=el.value;$('#table-visual').innerHTML=tableVisual();$('.filled-pill').textContent=`${state.seats.filter(p=>p.name.trim()).length} / ${state.config.seats} мест занято`;store();}
});
document.addEventListener('change',event=>{
  if(event.target.name==='bountyMode') { state.config.bountyMode=event.target.value;store();render(); }
  if(event.target.name==='prizeCount') {const templates={1:[100],2:[65,35],3:[50,30,20],4:[45,25,20,10],5:[40,25,15,12,8]};state.config.prizes=templates[event.target.value];store();render();}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='settings-form'){event.preventDefault();const error=validateConfig(state.config);if(error)return toast(error);go('seating');}
  if(event.target.id==='seating-form'){event.preventDefault();if(state.game)go('board');else begin();}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action,g=state.game;
  if(action==='close')return $('#modal').close();
  if(action==='home'){event.preventDefault();return go(g?'board':'settings');}
  if(action==='nav'){if(button.dataset.step==='seating'&&!g){const error=validateConfig(state.config);if(error)return toast(error);}return go(button.dataset.step);}
  if(action==='mode'){state.config.mode=button.dataset.mode;store();return render();}
  if(action==='structure')return showStructure();
  if(action==='shuffle'){for(let i=state.seats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[state.seats[i],state.seats[j]]=[state.seats[j],state.seats[i]];}store();return render();}
  if(action==='suggest'){const p=state.library.find(p=>p.id===button.dataset.id);state.seats[Number(button.dataset.seat)]={...p};store();return render();}
  if(action==='demo'){state.config=defaults();state.seats=['Александр','Михаил','Анна','Дмитрий','Мария','Артём'].map((name,i)=>({id:uid(),name,nick:['Alex','Misha','Anna','Dima','Mary','Art'][i]}));delete state.levels;state.game=createGame(state.config,levels(),state.seats);state.game.remaining=17*60+42;undo=null;return go('board');}
  if(action==='new')return modal('Новая игра', '<p>Текущая игра будет заменена. Сохранённые имена останутся в вашей компании.</p>', 'Создать игру', ()=>{state.game=null;undo=null;delete state.levels;go('settings');});
  if(action==='sound'){state.sound=!state.sound;store();if(state.sound)beep();return render();}
  if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полноэкранный режим недоступен в этом браузере');}return;}
  if(!g)return;
  if(action==='play'){if(state.sound){try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();}catch{}}toggleClock(g);store();return render();}
  if(action==='next'||action==='prev')return modal(action==='next'?'Следующий уровень?':'Предыдущий уровень?', '<p>Таймер выбранного уровня начнётся с полной длительности.</p>', 'Переключить',()=>{jumpLevel(g,g.index+(action==='next'?1:-1));store();render();});
  if(action==='undo'){if(undo){state.game=undo;undo=null;advanceClock(state.game);store();render();}return;}
  const p=g.players.find(p=>p.id===button.dataset.id);if(!p)return;
  if(action==='reentry'&&!p.active)return modal(`Ре-энтри · ${escape(nameOf(p))}`,`<p>Вход ${money(g.config.buyin)} за ${number(g.config.stack)} фишек.${g.config.bountyMode!=='off'?` Из общего банка резервируется новая голова ${money(g.config.bountyAmount)}. На призовые места добавится ${money(g.config.buyin-g.config.bountyAmount)}.`:' Весь взнос добавится в призовые.'}</p>`,'Вернуть в игру',()=>{saveUndo();addEntry(g,p.id,'reentry');store();render();});
  if(!p.active||g.finished)return;
  if(action==='bust')return modal(`${escape(nameOf(p))} выбывает?`, `<label class="field"><span>Кто выбил игрока?</span><select name="killer" ${g.config.bountyMode!=='off'?'required':''}><option value="">${g.config.bountyMode!=='off'?'Выберите игрока':'Не учитывать выбивание'}</option>${g.players.filter(x=>x.active&&x.id!==p.id).map(x=>`<option value="${x.id}">${escape(nameOf(x))}</option>`).join('')}</select></label><p class="field-hint">${g.config.bountyMode==='progressive'?`Награда ${money(p.bounty)}: ${g.config.bountyImmediate}% сразу выбившему, остаток на его голову.`:g.config.bountyMode==='fixed'?`Выбивший получит ${money(p.bounty)}.`:'Выбивание сохранится в статистике.'} Последнее действие можно отменить.</p>`, 'Подтвердить',data=>{saveUndo();eliminate(g,p.id,Date.now(),data.get('killer')||null);store();render();});
  if(action==='addon')return modal(`Аддон · ${escape(nameOf(p))}`,`<p>Добавить ${number(g.config.addonStack)} фишек за ${money(g.config.addonCost)}. Вся сумма поступит на призовые места, баунти не изменится.</p>`,'Добавить аддон',()=>{saveUndo();addEntry(g,p.id,'addon');store();render();});
  if(action==='rebuy')return modal(g.config.mode==='cash'?'Добавить вход':`Ребай · ${escape(nameOf(p))}`,g.config.mode==='cash'?numeric('Сумма входа','amount',g.config.buyin,'₽',1,10000000):`<p>Добавить ${number(g.config.stack)} фишек за ${money(g.config.buyin)}. Вся сумма увеличит фонд призовых мест.</p>`,'Добавить', data=>{saveUndo();if(g.config.mode==='cash'){p.invested+=Number(data.get('amount'));p.entries++;}else addEntry(g,p.id,'rebuy');store();render();});
  if(action==='cashout')return modal(`Выход · ${escape(nameOf(p))}`,`${numeric('Сумма на выходе','amount',p.invested,'₽',0,100000000)}<p class="field-hint">Всего внесено ${money(p.invested)}. Укажите денежную стоимость оставшихся фишек.</p>`,'Записать выход',data=>{const amount=Number(data.get('amount')),available=poolOf(g)-g.players.reduce((s,p)=>s+(p.cashout||0),0);if(amount>available){toast('Выход превышает сумму, оставшуюся за столом');return false;}if(g.players.filter(p=>p.active).length===1&&amount!==available){toast(`Последний игрок должен вывести оставшиеся ${money(available)}`);return false;}saveUndo();advanceClock(g);p.cashout=amount;p.active=false;if(g.players.every(p=>!p.active)){g.running=false;g.finished=true;}store();render();});
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){tick();store();flush();}});
document.addEventListener('click',event=>{if(!event.target.closest('.name-field'))document.querySelectorAll('.suggestions').forEach(el=>el.innerHTML='');});
setInterval(tick,250);
setInterval(()=>{if(state.game?.running)store();},5000);
if(state.game)advanceClock(state.game);
render();
if (pendingSave) flush();
if (recoveryMessage) toast(recoveryMessage);
