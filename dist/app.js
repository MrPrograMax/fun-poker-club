import { MAX_PLAYERS, seatingPlan, seatPlayers, defaults, makeLevels, recommendOpeningBlinds, recommendStructure, payouts, validateConfig, poolOf, bountyPoolOf, normalizeGame, addEntry, registerPlayer, registrationTables, playerNameKey, createGame, advanceClock, toggleClock, jumpLevel, startFreezeout, restoreAction, eliminate, formatTime } from './engine.js';

const KEY = 'river-poker-v1';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const money = value => `${number(value)} ₽`;
const nameOf = p => p.nick || p.name;
const initials = p => nameOf(p).split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
const uid = () => crypto.randomUUID();
const tableLabel = count => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? 'столов' : count % 10 === 1 ? 'стол' : count % 10 >= 2 && count % 10 <= 4 ? 'стола' : 'столов'}`;
let selectedTable = 1;
let playersVisible = false;
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
  settings: '<path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  flag: '<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  chips: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 4 16 4 16 0V6M4 12v6c0 4 16 4 16 0v-6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
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
delete state.config.addonLimit;
try { syncOpeningBlinds(); } catch { /* Incomplete setup remains editable. */ }
if (state.game) normalizeGame(state.game);
undo = state.undo || null;

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Не удалось сохранить в браузере. Проверьте свободное место.'); }
  if (server) { pendingSave = true; syncMetadata(true); clearTimeout(saveTimer); flush(); }
}
function syncMetadata(pending) { try { localStorage.setItem(`${KEY}-sync`, JSON.stringify({ revision, pending })); } catch {} }
async function flush() {
  if (saving || !server || !pendingSave) return;
  saving = true; pendingSave = false;
  try {
    const payload = JSON.stringify({ revision, state });
    const response = await fetch('/api/state', { method: 'PUT', keepalive: new TextEncoder().encode(payload).byteLength < 60000, headers: { 'Content-Type': 'application/json' }, body: payload });
    if (response.status === 409) {
      server = false;
      toast('Игра изменена в другой вкладке. Обновите страницу, чтобы загрузить её.');
    } else if (!response.ok) throw new Error('Save failed');
    else { revision = (await response.json()).revision; syncMetadata(pendingSave); }
  } catch { server = false; toast('Сервер недоступен. Изменения сохранены только в этом браузере.'); }
  saving = false;
  if (pendingSave && server) flush();
}
function toast(message, canUndo = false) { $('#toast').innerHTML = `<span>${escape(message)}</span>${canUndo?'<button type="button" data-action="undo">Отменить</button>':''}`; $('#toast').classList.add('visible'); clearTimeout(toast.timeout); toast.timeout = setTimeout(() => $('#toast').classList.remove('visible'), canUndo ? 10000 : 5500); }
function ensureSeats() { if (!Number.isInteger(state.config.seats) || state.config.seats < 2 || state.config.seats > MAX_PLAYERS) return; while (state.seats.length < state.config.seats) state.seats.push({ id: uid(), name: '', nick: '' }); state.seats.length = state.config.seats; }
function levels() { return state.config.mode === 'cash' ? makeLevels(state.config) : state.autoStructure ? recommendStructure(state.config, state.autoStructure).levels : state.levels || makeLevels(state.config); }
function syncOpeningBlinds() {
  if (!state.game && state.config.mode === 'tournament' && state.autoStructure?.autoBlinds) {
    Object.assign(state.config, recommendOpeningBlinds(state.config.stack, state.autoStructure.startDepth));
  }
}
function setupError() {
  try { syncOpeningBlinds(); } catch (error) { return error.message; }
  const error = validateConfig(state.config);
  if (error) return error;
  if (state.config.mode === 'tournament') { try { levels(); } catch (error) { return error.message; } }
  return '';
}
function structureLabel() {
  try { return `${levels().filter(l=>l.kind==='level').length} уровней · ${state.autoStructure?'автоподбор':'посмотреть'}`; }
  catch { return 'Проверьте параметры'; }
}
function structureHint() {
  if (!state.autoStructure) return 'Рассчитайте структуру под длительность вечера или отредактируйте уровни вручную.';
  try { const plan=recommendStructure(state.config,state.autoStructure);return `Автоподбор на ${plan.targetMinutes} мин с перерывами. ${state.autoStructure.autoBlinds?'Стартовые МБ / ББ подбираются от стека. Ручной ввод блайндов отключает их автоподбор.':'Стартовые блайнды заданы вручную.'}`; }
  catch (error) { return error.message; }
}
function go(step) { state.step = step; store(); render(); window.scrollTo(0, 0); }
function section(title, subtitle, content, extra = '') { return `<section class="panel ${extra}"><div class="section-heading"><h2>${title}</h2>${subtitle ? `<span>${subtitle}</span>` : ''}</div>${content}</section>`; }
function input(label, key, value, unit = '', attrs = '') { return `<label class="field"><span>${label}</span><div class="input-wrap"><input name="${key}" value="${escape(value)}" ${attrs}>${unit ? `<span class="unit">${unit}</span>` : ''}</div></label>`; }
function numeric(label, key, value, unit = '', min = 1, max = 10000000) { return input(label, key, value, unit, `type="number" min="${min}" max="${max}" step="1" required`); }
function toggle(label, note, key, checked) { return `<label class="toggle-row"><span><strong>${label}</strong><small>${note}</small></span><input type="checkbox" name="${key}" ${checked ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`; }
function brandContent() {
  return '<span class="brand-symbol" aria-hidden="true">♠</span><span class="brand-wordmark"><span class="brand-name">UNTIL MORNING</span><small>POKER WITH FRIENDS</small></span>';
}
function header() {
  if (state.step === 'board') return '';
  const current = ['settings', 'seating', 'board'].indexOf(state.step);
  return `<header class="topbar"><a href="#" class="brand" data-action="home" aria-label="Until Morning — главная">${brandContent()}</a><nav aria-label="Этапы игры">${['Настройки', 'Рассадка', 'Табло'].map((title, i) => `<button class="nav-step ${current === i ? 'selected' : ''}" data-action="nav" data-step="${['settings', 'seating', 'board'][i]}" ${i === 2 && !state.game ? 'disabled' : ''}><span>${i < current ? icon('check') : `0${i + 1}`}</span>${title}</button>`).join('')}</nav><div class="header-actions">${state.game ? `<button class="button subtle small" data-action="new">${icon('plus')} Новая игра</button>` : `<button class="button subtle small" data-action="demo">Посмотреть демо ${icon('arrow')}</button>`}</div></header>`;
}
function render() {
  ensureSeats();
  document.body.classList.toggle('board-page', state.step === 'board');
  $('#app').innerHTML = `${header()}<main>${state.step === 'settings' ? settingsView() : state.step === 'seating' ? seatingView() : boardView()}</main><footer><span><span class="tiny-spade">♠</span> UNTIL MORNING · POKER WITH FRIENDS</span><span class="save-status"><i></i>${server ? 'Сохранение на Go-сервере' : 'Сохранение в этом браузере'}</span><span>Хороших карт. Хорошего вечера.</span></footer>`;
  tick();
}
function stackAndBlinds(c) {
  const stack=numeric('Стартовый стек','stack',c.stack,'фишек');
  const blinds=numeric('Малый блайнд','sb',c.sb,'SB',1,1000000)+numeric('Большой блайнд','bb',c.bb,'BB',2,1000000);
  if(c.mode!=='tournament') return `<div class="fields three">${stack}${blinds}</div>`;
  return `<div class="stack-setup-row">${stack}<button type="button" class="button structure-calculate-button" data-action="structure-planner">${icon('clock')}<span>Рассчитать структуру</span></button></div><div class="fields two spaced">${blinds}</div>`;
}
function settingsView() {
  const c = state.config;
  return `<div class="page-heading"><div><div class="eyebrow">ВАШ СТОЛ. ВАШИ ПРАВИЛА.</div><p>Соберите друзей. Настройте игру. Остальное — за нами.</p></div><div class="card-art" aria-hidden="true"><div class="playing-card back-card"><b>A</b><span>♣</span><i>♣</i></div><div class="playing-card front-card"><b>A</b><span>♠</span><i>♠</i></div><div class="chip chip-one"></div><div class="chip chip-two"></div></div></div>
  ${state.game ? '<div class="notice">Игра уже создана. Её настройки зафиксированы; для изменения структуры начните новую игру.</div>' : ''}
  <form id="settings-form"><fieldset ${state.game ? 'disabled' : ''}><div class="setup-grid"><div class="setup-main">
    ${section('Формат игры', '01 / ОСНОВНОЕ', `<div class="mode-picker"><button type="button" data-action="mode" data-mode="tournament" class="mode-card ${c.mode === 'tournament' ? 'active' : ''}"><span class="mode-icon">${icon('trophy')}</span><span><strong>Турнир</strong><small>Растущие блайнды и призовые места</small></span><i class="radio"></i></button><button type="button" data-action="mode" data-mode="cash" class="mode-card ${c.mode === 'cash' ? 'active' : ''}"><span class="mode-icon cash-icon">♣</span><span><strong>Кэш-игра</strong><small>Постоянные блайнды, свободный выход</small></span><i class="radio"></i></button></div>${input('Название вечера', 'name', c.name, '', 'type="text" maxlength="60" required placeholder="Например, пятничный покер"')}`)}
    ${section('Стек и блайнды', '02 / СТРУКТУРА', `${stackAndBlinds(c)}${c.mode === 'tournament' ? `<div class="fields two spaced">${numeric('Длительность уровня', 'duration', c.duration, 'мин', 1, 180)}<label class="field"><span>Структура турнира</span><button type="button" class="input-button" data-action="structure"><span id="structure-label">${structureLabel()}</span> ${icon('arrow')}</button></label></div><p class="field-hint" id="structure-hint">${escape(structureHint())}</p><div class="divider"></div>${toggle('Big blind ante', 'Анте оплачивает только большой блайнд', 'ante', c.ante)}<div class="fields two spaced"><label class="field"><span>Перерыв</span><select name="breakEvery">${[0, 3, 4, 6].map(v => `<option value="${v}" ${c.breakEvery === v ? 'selected' : ''}>${v ? `Каждые ${v} уровня` : 'Без перерывов'}</option>`).join('')}</select></label>${numeric('Длительность перерыва', 'breakDuration', c.breakDuration, 'мин', 1, 60)}</div>` : '<p class="field-hint">Блайнды фиксируются на всю сессию. Таймер показывает время игры.</p>'}`)}
    ${section(c.mode === 'tournament' ? 'Взносы и призовые' : 'Вход в игру', '03 / БАНК', `<div class="fields two">${numeric(c.mode === 'tournament' ? 'Бай-ин' : 'Стартовый вход', 'buyin', c.buyin, '₽')}${numeric('Количество игроков', 'seats', c.seats, 'чел.', 2, MAX_PLAYERS)}</div><div class="fields two spaced"><label class="field"><span>Максимум игроков за столом</span><select name="tableCapacity">${Array.from({length:9},(_,i)=>i+2).map(n=>`<option value="${n}" ${c.tableCapacity===n?'selected':''}>${n}</option>`).join('')}</select></label><div class="table-plan"><span>Рассадка</span><strong id="table-plan">${planDescription()}</strong></div></div>${c.mode === 'tournament' ? `<div class="divider"></div><div class="prize-heading"><label for="prize-count">Призовые места</label><select id="prize-count" name="prizeCount">${[1,2,3,4,5].map(n => `<option value="${n}" ${n === c.prizes.length ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div class="prize-inputs">${c.prizes.map((p, i) => numeric(`${i + 1}-е место`, `prize-${i}`, p, '%', 1, 100)).join('')}</div><div id="prize-total" class="field-hint">Всего ${c.prizes.reduce((a,b) => a+b,0)}% из 100%</div>` : '<p class="field-hint">Докупки и сумма при выходе учитываются отдельно для каждого игрока.</p>'}`)}
    ${c.mode==='tournament'?bountySettings():''}</div><aside class="setup-side"><div id="summary">${summaryView()}</div><div class="side-note">${icon('people')}<div><strong>Свои люди за одним столом</strong><p>Сохраним имена и ники — в следующий раз останется только выбрать друзей.</p></div></div></aside></div></fieldset><div class="form-bottom"><span>Все настройки можно изменить до начала игры</span>${state.game ? '<button type="button" class="button primary" data-action="nav" data-step="board">Вернуться к игре</button>' : `<button type="submit" class="button primary">К рассадке ${icon('arrow')}</button>`}</div></form>`;
}
function bountySettings() {
  const c=state.config;
  return section('Баунти и возвращение в игру','04 / ЕЩЁ ОДИН ШАНС',`<div class="fields two"><label class="field"><span>Награда за выбивание</span><select name="bountyMode"><option value="off" ${c.bountyMode==='off'?'selected':''}>Без баунти</option><option value="fixed" ${c.bountyMode==='fixed'?'selected':''}>Фиксированное</option><option value="progressive" ${c.bountyMode==='progressive'?'selected':''}>Прогрессивное · PKO</option></select></label>${c.bountyMode!=='off'?numeric('Стартовая награда за голову','bountyAmount',c.bountyAmount,'₽',1,1000000):''}</div>${c.bountyMode==='progressive'?`<div class="spaced">${numeric('Доля награды сразу выбившему','bountyImmediate',c.bountyImmediate,'%',1,99)}<p class="field-hint">Остаток увеличивает награду за голову выбившего. Победитель забирает свою оставшуюся награду.</p></div>`:''}${c.bountyMode!=='off'?'<p class="field-hint">Баунти входит в стоимость первого входа и ре-энтри. Эта часть банка не распределяется по призовым местам.</p>':''}<div class="divider"></div>${toggle('Разрешить ре-энтри','Выбывший возвращается со стартовым стеком и новой головой','reentry',c.reentry)}<div class="fields two spaced">${numeric('Стоимость аддона','addonCost',c.addonCost,'₽')}${numeric('Фишки за аддон','addonStack',c.addonStack,'фишек')}</div><p class="field-hint">Аддон доступен через меню активного игрока и полностью увеличивает призовой фонд. Количество аддонов не ограничено. Фишки нужны для расчёта структуры; цену и количество можно уточнить при запуске фризаута.</p>`);
}
function summaryView() {
  const c = state.config, bounty=c.mode==='tournament'&&c.bountyMode!=='off'?c.bountyAmount:0, pool = Math.max(0,c.buyin-bounty) * c.seats, valid = Math.abs(c.prizes.reduce((a,b)=>a+b,0)-100)<.001;
  const prizes = valid ? payouts(pool, c.prizes) : c.prizes.map(() => 0);
  return `<section class="summary-card"><div class="eyebrow">ВЕЧЕР В ЦИФРАХ</div><h2>${escape(c.name || 'Ваша игра')}</h2><span class="pill">${c.mode === 'tournament' ? 'NO-LIMIT HOLD’EM · ТУРНИР' : 'NO-LIMIT HOLD’EM · КЭШ'}</span><div class="summary-pool"><span>${c.mode === 'tournament' ? 'Стартовый призовой фонд' : 'Стартовая сумма входов'}</span><strong>${money(pool)}</strong><small>${c.seats} игроков × ${money(c.buyin-bounty)}${c.mode==="tournament"?" на места":""}</small>${bounty?`<div class="summary-bounty">Баунти отдельно <b>${money(bounty*c.seats)}</b></div>`:""}</div>${c.mode === 'tournament' ? `<div class="summary-prizes">${prizes.map((p,i) => `<div><span><i class="place-badge p${i}">${i+1}</i>${i === 0 ? 'Победитель' : `${i+1}-е место`}</span><b>${valid ? money(p) : '—'}</b></div>`).join('')}</div>` : '<div class="cash-note">Итог каждого игрока = сумма на выходе − все его входы.</div>'}<div class="summary-footer"><span>Стартовые блайнды<strong>${number(c.sb)} / ${number(c.bb)}</strong></span><span>${c.mode === 'tournament' ? 'Один уровень' : 'Стартовый стек'}<strong>${c.mode === 'tournament' ? `${c.duration} мин` : number(c.stack)}</strong></span></div></section>`;
}
function planDescription() {
  const plan = seatingPlan(state.config.seats, state.config.tableCapacity);
  return plan.length ? `${tableLabel(plan.length)} · ${plan.join(' + ')} игроков` : 'Проверьте количество игроков';
}
function groupedTables(players) {
  return [...new Set(players.map(p => p.table))].sort((a,b) => a-b).map(table => ({
    number: table, players: players.filter(p => p.table === table),
  }));
}
function draftTables() {
  if (state.game) return groupedTables(state.game.players.map((p, index) => ({ ...p, index })));
  return groupedTables(seatPlayers(state.seats.map((p, index) => ({ ...p, index })), state.config.tableCapacity));
}
function playerInput(p) {
  const i = p.index;
  return `<div class="player-input-row"><span class="seat-number" title="Место ${p.seat}">${String(p.seat).padStart(2,'0')}</span><div class="name-field"><label class="sr-only" for="player-${i}">Имя игрока ${i+1}</label><input id="player-${i}" name="player-${i}" data-seat="${i}" data-table="${p.table}" autocomplete="off" maxlength="60" placeholder="Имя и фамилия" value="${escape(p.name)}" required><div id="suggest-${i}" class="suggestions"></div></div><label class="sr-only" for="nick-${i}">Ник игрока ${i+1}</label><input class="nick-input" id="nick-${i}" name="nick-${i}" data-nick="${i}" data-table="${p.table}" maxlength="24" placeholder="Ник · необязательно" value="${escape(p.nick)}"></div>`;
}
function seatingView() {
  const c = state.config, filled = state.seats.filter(p => p.name.trim()).length;
  const tables = draftTables();
  return `<div class="page-heading compact"><div><div class="eyebrow">ХОРОШИЕ ЛЮДИ. БОЛЬШИЕ БАНКИ.</div><h1>Кто сегодня за столом<span class="accent">?</span></h1><p>Добавьте имена или выберите знакомых игроков из подсказок.</p></div><span class="pill filled-pill">${filled} / ${c.seats} мест занято</span></div><div class="seating-grid">${section('Состав игроков', `${tableLabel(tables.length).toUpperCase()} · ${c.seats} МЕСТ`, `<form id="seating-form"><fieldset ${state.game ? 'disabled' : ''}><div class="players-editor">${tables.map(t => `<div class="player-table-group"><h3>Стол ${t.number}<span>${t.players.length} игроков</span></h3>${t.players.map(playerInput).join('')}</div>`).join('')}</div><button type="button" class="button subtle shuffle-button" data-action="shuffle">${icon('shuffle')} Случайная рассадка</button></fieldset><p class="field-hint">Имена сохранятся в вашей компании после создания игры. Игроки распределяются между столами равномерно.</p><button class="button primary full" type="submit">${state.game ? 'Вернуться к игре' : 'Всё готово — к игре'} ${icon('arrow')}</button></form>`)}<div class="table-preview"><div id="table-visual">${tableVisual()}</div><p>Места по часовой стрелке · ${tableLabel(tables.length)}</p><div class="seating-details"><div>Стартовый стек<strong>${number(c.stack)}</strong></div><div>Блайнды<strong>${number(c.sb)} / ${number(c.bb)}</strong></div><div>Бай-ин<strong>${money(c.buyin)}</strong></div></div></div></div>`;
}
function tableVisual() {
  const tables = draftTables();
  const current = tables.find(t => t.number === selectedTable) || tables[0];
  if (!current) return '';
  selectedTable = current.number;
  return `${tables.length > 1 ? `<div class="table-tabs" role="group" aria-label="Выбор стола">${tables.map(t => `<button type="button" data-action="select-table" data-table="${t.number}" aria-pressed="${t.number===selectedTable}" class="${t.number===selectedTable?'selected':''}">Стол ${t.number}<small>${t.players.length}</small></button>`).join('')}</div>` : ''}<div class="eyebrow table-caption">СТОЛ № ${String(current.number).padStart(2,'0')} · ${current.players.length} МЕСТ</div><div class="poker-table"><div class="table-felt"><span class="table-brand">UNTIL<br>MORNING</span><small>POKER WITH FRIENDS</small><div class="table-cards"><i>♠</i><i>♣</i><i>♥</i></div></div>${current.players.map((p,i) => { const a = -Math.PI/2 + 2*Math.PI*i/current.players.length; return `<div class="table-seat ${p.name ? 'occupied' : ''}" data-seat-number="${p.seat}" style="--x:${50+38*Math.cos(a)}%;--y:${50+40*Math.sin(a)}%"><span>${p.name ? escape(initials(p)) : String(p.seat).padStart(2,'0')}</span><small title="${escape(nameOf(p) || 'Свободно')}">${escape(nameOf(p) || 'Свободно')}</small></div>`; }).join('')}</div>`;
}
function gameMenu(g) {
  return `<details class="game-menu"><summary class="button icon-button" aria-label="Меню игры" title="Меню игры">${icon('settings')}</summary><div class="game-menu-content"><span class="eyebrow">ИГРА ПОДГОТОВЛЕНА</span><p>${g.players.length} игроков · ${tableLabel(new Set(g.players.map(p=>p.table)).size)}</p><button type="button" data-action="nav" data-step="settings">${icon('check')} Настройки игры</button><button type="button" data-action="nav" data-step="seating">${icon('people')} Рассадка по столам</button><button type="button" data-action="register-player" ${g.finished||g.players.length>=MAX_PLAYERS?'disabled':''}>${icon('plus')} Добавить игрока</button><div class="menu-elapsed">С начала игры <b id="elapsed">${formatTime(g.elapsed/1000,true)}</b></div>${g.config.mode==='tournament'?`<button type="button" data-action="prev" ${g.index===0||g.finished?'disabled':''}>${icon('back')} Предыдущий уровень</button>`:''}<div class="divider"></div><button type="button" data-action="new">${icon('plus')} Новая игра</button></div></details>`;
}
function boardView() {
  const g = state.game;
  if (!g) { state.step = 'settings'; return settingsView(); }
  const c = g.config, cash = c.mode === 'cash', level = g.levels[g.index], next = g.levels[g.index+1];
  const alive = g.players.filter(p=>p.active).length;
  const caption = g.finished ? 'Игра завершена' : cash ? 'Время сессии' : g.structureEnded ? 'Структура завершена' : level.kind==='break' ? 'До конца перерыва' : 'До повышения блайндов';
  return `<div class="board-heading">
    <div class="board-title"><a href="#" class="brand" data-action="home" aria-label="Until Morning — табло">${brandContent()}</a><div class="board-title-name"><h1>${escape(c.name)}</h1><small>${tableLabel(new Set(g.players.map(p=>p.table)).size)} · ${cash?'Кэш':'Турнир'}</small></div></div>
    <div class="board-tools"><span id="timer-status" class="timer-status">На паузе</span><button class="button icon-button ${state.sound ? 'on' : ''}" data-action="sound" title="${state.sound ? 'Выключить' : 'Включить'} звук" aria-label="${state.sound ? 'Выключить' : 'Включить'} звук">${icon('sound')}</button><button class="button icon-button" data-action="fullscreen" aria-label="Полный экран" title="Полный экран">${icon('expand')}</button>${gameMenu(g)}</div>
  </div>
  <div class="board-grid"><section class="timer-panel">
    <div class="timer-top"><span class="pill">${cash ? 'КЭШ' : level.kind==='break'?'ПЕРЕРЫВ':`УРОВЕНЬ ${level.number}`}</span><span class="timer-caption">${caption}</span></div>
    <div class="timer-display ${cash?'cash-timer':''} ${level.kind==='break'?'break-timer':''}" id="timer">${cash?formatTime(g.elapsed/1000,true):formatTime(g.remaining)}</div>
    <div class="timer-progress"><div id="progress"></div></div>
    <div class="blind-cards"><div><span>${cash?'Малый блайнд':'Текущие блайнды'}</span><small>${cash?'SB':'МБ / ББ'}</small><strong>${cash?number(c.sb):level.kind==='break'?'Перерыв':`${number(level.sb)}<i>/</i>${number(level.bb)}`}</strong>${!cash&&level.ante?`<small>BB ante ${number(level.ante)}</small>`:''}</div><div><span>${cash?'Большой блайнд':'Следующие блайнды'}</span><small>${cash?'BB':next?.kind==='break'?`${next.duration/60} минут`:'МБ / ББ'}</small><strong>${cash?number(c.bb):!next?'—':next.kind==='break'?'Перерыв':`${number(next.sb)}<i>/</i>${number(next.bb)}`}</strong>${!cash&&next?.ante?`<small>BB ante ${number(next.ante)}</small>`:''}</div></div>
    ${g.finished?`<div class="winner-banner">${icon('trophy')} ${cash?'Сессия завершена':`Победитель — ${escape(nameOf(g.players.find(p=>p.place===1)))}`}</div>`:''}
  </section>${prizesView(g)}</div>
  <div class="board-controlbar"><button class="button primary play-button" data-action="play" ${g.finished||g.structureEnded?'disabled':''}>${icon(g.running?'pause':'play')}<span>${g.running?'Пауза':'Запустить'}</span></button><button class="button subtle players-button" data-action="players" aria-expanded="${playersVisible}" aria-controls="players-panel">${icon('people')}${cash?'Игроки и расчёты':'Игроки и баунти'}</button>${!cash?`<button class="button subtle next-button" data-action="next" ${g.index===g.levels.length-1||g.finished?'disabled':''}>${icon('arrow')} Следующий уровень</button>`:''}${!cash?(g.freezeout?`<span class="freezeout-status">${icon('flag')}<span>Фризаут<small>${c.reentry?'Ре-энтри вручную':'Ре-энтри выключены'}</small></span></span>`:`<button class="button subtle freezeout-button" data-action="freezeout" ${g.finished||g.structureEnded?'disabled':''} title="Начать фризаут и запустить уровень заново">${icon('flag')} Фризаут</button>`):''}<span class="board-player-count">В игре <b>${alive}</b> из ${g.players.length}</span></div>
  <div id="players-panel" ${playersVisible?'':'hidden'}>${playersVisible?`${rosterView(g)}${eventView(g)}`:''}</div>`;
}
function prizesView(g) {
  const c=g.config,cash=c.mode==='cash',pool=poolOf(g),prizes=payouts(pool,c.prizes);
  return `<aside class="prizes-panel panel"><div class="section-heading"><h2>${cash?'Банк игры':'Призовые'}</h2>${icon('trophy')}</div><div class="board-pool"><span>${cash?'Всего внесено':'Фонд за места'}</span><strong>${money(pool)}</strong></div>
  ${cash?`<div class="cash-note">На выходах<br><strong>${money(g.players.reduce((n,p)=>n+(p.cashout||0),0))}</strong><br>Осталось за столом<br><strong>${money(pool-g.players.reduce((n,p)=>n+(p.cashout||0),0))}</strong></div>`:`<div class="board-prizes">${prizes.map((amount,i)=>{const winner=g.players.find(p=>p.place===i+1);return `<div class="board-prize ${i===0?'first-prize':''}"><span class="place-badge p${i}">${i===0?icon('trophy'):i+1}</span><div><span>${i+1} место</span><strong>${money(amount)}</strong>${winner?`<small>${escape(nameOf(winner))}</small>`:''}</div><small>${c.prizes[i]}%</small></div>`;}).join('')}</div>`}
  ${!cash&&c.bountyMode==='fixed'?`<div class="bounty-bank"><span>Баунти за выбивание</span><strong>${money(c.bountyAmount)}</strong></div>`:!cash&&c.bountyMode==='progressive'?`<div class="bounty-bank progressive-bounty"><span>Прогрессивное баунти</span><strong>За каждого — своё</strong><small>Текущая награда за голову указана в списке игроков.</small><button type="button" class="text-button" data-action="players">Посмотреть награды ${icon('arrow')}</button></div>`:''}</aside>`;
}
function playerActions(g, p) {
  const cash=g.config.mode==='cash', name=escape(nameOf(p));
  if(p.active&&!g.finished) {
    if(cash) return `<button class="mini-button" data-action="cashin" data-id="${p.id}" aria-label="Добавить вход: ${name}"><span aria-hidden="true">+</span> Вход</button><button class="mini-button" data-action="cashout" data-id="${p.id}" aria-label="Выход: ${name}"><span aria-hidden="true">↗</span> Выход</button>`;
    return `<button class="mini-button" data-action="bust" data-id="${p.id}" aria-label="Выбыл: ${name}"><span aria-hidden="true">×</span> Выбыл</button><details class="player-menu"><summary class="mini-button" aria-label="Ещё действия: ${name}" title="Ещё действия">${icon('more')}</summary><div class="player-menu-content"><div class="addon-heading"><span class="addon-icon">${icon('chips')}</span><div><strong>Добавить фишки</strong><small>Аддон · ${name}</small></div></div><div class="addon-offer"><div><small>Взнос</small><strong>${money(g.config.addonCost)}</strong></div><div><small>Фишки</small><strong>+${number(g.config.addonStack)}</strong></div></div><button type="button" class="mini-button" data-action="addon" data-id="${p.id}" aria-label="Аддон: ${name}">${icon('plus')} Добавить аддон</button><div class="addon-footnote">Уже взято: ${p.addons}<span>Без ограничений</span></div></div></details>`;
  }
  if(p.place===1)return '<span class="winner-crown">♛</span>';
  if(!cash&&!p.active&&g.config.reentry)return `<button class="mini-button" data-action="reentry" data-id="${p.id}" aria-label="Ре-энтри: ${name}"><span aria-hidden="true">↻</span> Ре-энтри</button>`;
  return '';
}
function playerCard(g, p) {
  const c=g.config, cash=c.mode==='cash', bounty=!cash&&c.bountyMode!=='off';
  const seat=p.place?`${p.place}-е место`:`Стол ${p.table} · место ${p.seat}`;
  const stat=(label,value)=>`<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const result=cash&&p.cashout!==null?p.cashout-p.invested:null;
  const payout=g.finished&&!cash?(payouts(poolOf(g),c.prizes)[p.place-1]||0)+p.earnedBounty:null;
  return `<article class="roster-player ${!p.active?'eliminated':''}" aria-label="Игрок ${escape(nameOf(p))}">
    <div class="player-card-header"><div class="player-identity"><span class="avatar">${escape(initials(p))}</span><div class="roster-name"><strong>${escape(nameOf(p))}</strong><small>${seat}</small></div></div><div class="player-investment"><span>Внесено</span><strong>${money(p.invested)}</strong></div></div>
    ${bounty?`<dl class="player-bounty">${stat('За голову',money(p.bounty))}${stat('За выбивания',money(p.earnedBounty))}</dl>`:''}
    ${result!==null?`<dl class="player-cash-result">${stat('На выходе',money(p.cashout))}${stat('Итог',`<span class="${result>=0?'profit':'loss'}">${result>0?'+':''}${money(result)}</span>`)}</dl>`:''}
    <div class="player-card-footer">${!cash?`<dl class="player-stats">${bounty?stat('Выбил',p.knockouts):''}${stat('Ре-энтри',p.reentries)}${stat('Аддоны',p.addons)}</dl>`:'<span class="player-cash-status">'+(p.active?'За столом':'Расчёт записан')+'</span>'}<div class="player-actions ${cash?'cash-actions':'tournament-actions'}">${playerActions(g,p)}</div></div>
    ${p.rebuys&&!cash?`<div class="player-legacy">Докупки ранее <b>${p.rebuys}</b></div>`:''}
    ${payout!==null?`<div class="player-payout"><span>К выплате</span><strong>${money(payout)}</strong></div>`:''}
  </article>`;
}
function rosterView(g) {
  return section('Участники игры',`<span class="roster-tools"><button type="button" class="button small register-player-button" data-action="register-player" ${g.finished||g.players.length>=MAX_PLAYERS?'disabled':''}>${icon('plus')} Добавить игрока</button>${undo?'<button class="text-button" data-action="undo">Отменить последнее действие</button>':''}</span>`,`<div class="roster">${g.players.map(p=>playerCard(g,p)).join('')}</div>${g.config.mode==='tournament'?'<p class="field-hint">Ре-энтри доступен после выбывания. Аддон — в меню «⋯» у активного игрока.</p>':''}`,'roster-panel');
}

function eventView(g) {
  if(!g.events?.length)return '';
  const player=id=>escape(nameOf(g.players.find(p=>p.id===id)||{name:'Игрок'}));
  return `<details class="event-log"><summary>История действий <span>${g.events.length}</span></summary><div>${g.events.slice().reverse().map((e,i)=>`<div class="event-row"><time>${new Date(e.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><span>${e.type==='freezeout'?`Начат фризаут · уровень ${e.level}${e.addonCost!==undefined?` · аддон ${money(e.addonCost)} за ${number(e.addonStack)} фишек`:''}`:e.type==='knockout'?`${e.killerId?`${player(e.killerId)} выбил`: 'Выбыл'} ${player(e.playerId)}${e.amount||e.carried?` · ${money(e.amount)} сразу, ${money(e.carried)} на голову`:''}`:`${player(e.playerId)} · ${{registration:'первый вход',rebuy:'докупка (ранее)',reentry:'ре-энтри',addon:'аддон'}[e.type]} ${money(e.amount)}${e.bounty?` (из них ${money(e.bounty)} на голову)`:''}${['registration','addon'].includes(e.type)&&e.chips!==undefined?` · +${number(e.chips)} фишек`:''}${e.type==='registration'?` · стол ${e.table}, место ${e.seat}`:''}`}</span>${i===0&&undo?'<button type="button" class="text-button event-undo" data-action="undo">Отменить</button>':''}</div>`).join('')}</div></details>`;
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
  if (dialog.open) dialog.close();
  dialog.classList.remove('structure-modal','planner-modal','registration-modal');
  dialog.innerHTML = `<form id="modal-form"><div class="modal-heading"><h2>${title}</h2><button class="mini-button" type="button" data-action="close" aria-label="Закрыть">×</button></div>${content}<div class="modal-actions"><button type="button" class="button subtle" data-action="close">Отмена</button><button class="button primary" type="submit">${button}</button></div></form>`;
  $('#modal-form').onsubmit = event => { event.preventDefault(); if (onConfirm(new FormData(event.currentTarget)) !== false) dialog.close(); };
  dialog.showModal();
  dialog.scrollTop=0;
}
function rememberPlayer(p) {
  const existing=state.library.find(x=>playerNameKey(x.name)===playerNameKey(p.name));
  if(existing) { existing.nick=p.nick;p.id=existing.id; }
  else state.library.push({id:p.id,name:p.name,nick:p.nick});
}
function rememberPlayers() { state.seats.forEach(rememberPlayer); }
function syncGameSetup() {
  state.config={...state.game.config};
  state.seats=state.game.players.map(({id,name,nick})=>({id,name,nick:nick||''}));
}

function begin() {
  state.seats.forEach(p=>{p.name=p.name.trim().replace(/\s+/g,' ');p.nick=p.nick.trim();});
  if (state.seats.some(p=>!p.name)) return toast('Заполните имена всех игроков');
  if (new Set(state.seats.map(p=>playerNameKey(p.name))).size!==state.seats.length) return toast('Один игрок указан дважды. Проверьте имена.');
  const error=setupError(); if(error) return toast(error);
  rememberPlayers();
  state.game=createGame(state.config,levels(),state.seats); clearUndo();playersVisible=false; go('board');
}
function saveUndo(snapshot = state.game) { undo=structuredClone(snapshot);state.undo=undo; }
function clearUndo() { undo=null;delete state.undo; }
function showRegistration() {
  const g=state.game;
  if(g.finished || g.players.length>=MAX_PLAYERS) return toast(g.finished?'Игра уже завершена':`В игре уже ${MAX_PLAYERS} игроков`);
  const c=g.config, tables=registrationTables(g), cash=c.mode==='cash';
  const suggested=tables.filter(t=>t.seats.length&&!t.isNew).sort((a,b)=>b.seats.length-a.seats.length||a.table-b.table)[0]||tables.at(-1);
  const bounty=cash||c.bountyMode==='off'?0:c.bountyAmount;
  const candidates=state.library.filter(p=>!g.players.some(x=>x.id===p.id||playerNameKey(x.name)===playerNameKey(p.name)));
  modal('Добавить игрока', `<p>${cash?'Новый участник кэш-игры.':'Поздняя регистрация · первый вход в турнир.'}</p><div class="name-field spaced">${input('Имя и фамилия','lateName','','','id="late-name" autocomplete="off" maxlength="60" required')}<div id="late-suggestions" class="registration-suggestions" hidden></div></div><div class="spaced">${input('Ник · необязательно','lateNick','','','maxlength="24" autocomplete="off"')}</div><div class="fields two spaced"><label class="field"><span>Стол</span><select name="registrationTable">${tables.map(t=>`<option value="${t.table}" ${t.table===suggested.table?'selected':''} ${!t.seats.length?'disabled':''}>${t.isNew?'Новый стол':'Стол'} ${t.table}${!t.seats.length?' · занят':''}</option>`).join('')}</select></label><label class="field"><span>Место</span><select name="registrationSeat"></select></label></div><p class="field-hint">Места зарегистрированных игроков сохраняются для ре-энтри. Можно выбрать свободное место или открыть новый стол.</p><div class="registration-terms"><div><span>Первый взнос</span><strong>${money(c.buyin)}</strong></div><div><span>Стартовый стек</span><strong>${number(c.stack)}</strong></div>${bounty?`<div><span>За голову</span><strong>${money(bounty)}</strong></div>`:''}</div><p class="field-hint">${cash?'В банк игры': 'В призовой фонд'} поступит ${money(c.buyin-bounty)}.${g.freezeout?' Фризаут уже начат — вход по вашей договорённости.':''}</p><p id="registration-error" class="field-hint error" role="alert" hidden></p>`, 'Добавить игрока', data=>{
    const name=String(data.get('lateName')).trim();
    const known=state.library.find(p=>playerNameKey(p.name)===playerNameKey(name));
    const profile={id:known?.id||uid(),name,nick:String(data.get('lateNick')).trim()};
    const previous=structuredClone(g);
    let player;
    try { player=registerPlayer(g,profile,{table:Number(data.get('registrationTable')),seat:Number(data.get('registrationSeat'))}); }
    catch(error) { $('#registration-error').textContent=error.message;$('#registration-error').hidden=false;return false; }
    saveUndo(previous);
    rememberPlayer(player);syncGameSetup();selectedTable=player.table;playersVisible=true;
    store();render();toast(`${nameOf(player)} · первый вход +${money(player.invested)}`,true);
  });
  $('#modal').classList.add('registration-modal');
  const form=$('#modal-form'), nameInput=form.elements.lateName, suggestions=$('#late-suggestions');
  const updateSeats=()=>{
    const table=tables.find(t=>t.table===Number(form.elements.registrationTable.value));
    form.elements.registrationSeat.innerHTML=table.seats.map(seat=>`<option value="${seat}">${seat}</option>`).join('');
  };
  const showSuggestions=()=>{
    const query=playerNameKey(nameInput.value);
    const matches=candidates.filter(p=>!query||playerNameKey(`${p.name} ${p.nick||''}`).includes(query)).slice(0,5);
    suggestions.innerHTML=matches.map(p=>`<button type="button" data-registration-suggestion="${escape(p.id)}"><strong>${escape(p.name)}</strong>${p.nick?`<small>${escape(p.nick)}</small>`:''}</button>`).join('');
    suggestions.hidden=!matches.length;
  };
  updateSeats();
  nameInput.addEventListener('focus',showSuggestions);
  form.addEventListener('input',event=>{
    $('#registration-error').hidden=true;
    if(event.target===nameInput) showSuggestions();
  });
  form.elements.registrationTable.addEventListener('change',updateSeats);
  suggestions.addEventListener('click',event=>{
    const button=event.target.closest('[data-registration-suggestion]');
    const player=candidates.find(p=>p.id===button?.dataset.registrationSuggestion);
    if(!player)return;
    nameInput.value=player.name;form.elements.lateNick.value=player.nick||'';
    suggestions.hidden=true;$('#registration-error').hidden=true;
  });
  nameInput.focus();showSuggestions();
}
function editorRows(rows) {
  return `<div class="level-editor-row headings"><span>Уровень</span><span>SB</span><span>BB</span><span>Мин.</span></div>${rows.map((l,i)=>`<div class="level-editor-row"><span>${l.kind==='break'?'Перерыв':`# ${l.number}`}</span>${l.kind==='break'?'<span>—</span><span>—</span>':`<input aria-label="SB уровня ${l.number}" name="sb-${i}" type="number" min="1" max="100000000" value="${l.sb}" required><input aria-label="BB уровня ${l.number}" name="bb-${i}" type="number" min="2" max="100000000" value="${l.bb}" required>`}<input aria-label="Минуты ${l.kind==='break'?'перерыва':`уровня ${l.number}`}" name="duration-${i}" type="number" min="1" max="180" value="${l.duration/60}" required></div>`).join('')}`;
}
function showStructurePlanner(draftOptions = null) {
  const options={targetMinutes:240,extraEntries:0,addons:0,autoBlinds:true,startDepth:100,...state.plannerOptions,...state.autoStructure,...draftOptions};
  if (!draftOptions && state.autoStructure && state.autoStructure.autoBlinds === undefined) options.autoBlinds=false;
  const c=state.config;
  modal('Рассчитать структуру', `<p class="planner-context">Стек ${number(c.stack)} · ${c.seats} игроков · уровни около ${c.duration} мин${c.breakEvery?`. Перерывы по ${c.breakDuration} мин каждые ${c.breakEvery} уровня.`:'. Без перерывов.'}</p>${numeric('Желаемая длительность турнира','targetMinutes',options.targetMinutes,'мин',30,1440)}<div class="planner-blinds">${toggle('Подобрать стартовые МБ / ББ','Рассчитать от стартового стека, округлив номиналы','autoBlinds',options.autoBlinds)}<div class="planner-depth">${numeric('Глубина стартового стека','startDepth',options.startDepth,'ББ',20,500)}<p class="field-hint">Обычно 100 ББ. При выключенном автоподборе старт — ${number(c.sb)} / ${number(c.bb)}.</p></div></div><details class="planner-extras"><summary>Планируемые ре-энтри и аддоны</summary><p class="field-hint">Необязательно. Укажите суммарное количество за весь турнир.</p><div class="fields two">${numeric('Ре-энтри','extraEntries',options.extraEntries,'шт.',0,1000)}${numeric('Аддоны','addons',options.addons,'шт.',0,1000)}</div></details><p class="field-hint planner-note">Время ориентировочное: темп игры и докупки могут его изменить. На следующем шаге вы увидите уровни и сможете их поправить.</p><p id="planner-error" class="planner-error" role="alert" hidden></p>`, 'Рассчитать', data=>{
    const nextOptions={...Object.fromEntries(['targetMinutes','extraEntries','addons'].map(key=>[key,Number(data.get(key))])),startDepth:Number($('#modal [name="startDepth"]').value)||options.startDepth,autoBlinds:data.has('autoBlinds')};
    let plan;
    try { plan=recommendStructure(c,nextOptions); }
    catch(error) { $('#planner-error').textContent=error.message;$('#planner-error').hidden=false;return false; }
    showStructure({plan,options:nextOptions});
    return false; // Keep the replacement dialog open.
  });
  $('#modal').classList.add('planner-modal');
  const updateDepth=()=>{ $('#modal [name="startDepth"]').disabled=!$('#modal [name="autoBlinds"]').checked; };
  updateDepth();
  $('#modal-form').oninput=event=>{
    if(event.target.name==='autoBlinds') updateDepth();
    $('#planner-error').hidden=true;
  };
}
function showStructure(draft = null) {
  let rows;
  try { rows=structuredClone(draft ? draft.plan.levels : levels()); } catch { rows=makeLevels(state.config); }
  let autoOptions=draft ? {...draft.options} : state.autoStructure ? {...state.autoStructure} : null;
  const c=state.config;
  const overview=()=>`${rows.filter(l=>l.kind==='level').length} уровней · ${number(rows.reduce((sum,l)=>sum+l.duration,0)/60)} мин с перерывами`;
  const note=autoOptions?'Уровни рассчитаны автоматически. Любое значение можно изменить.':'Блайнды и длительность можно изменить для каждого уровня.';
  const warnings=draft ? `${draft.plan.maxIncrease>2?'<p class="structure-warning">Блайнды местами растут больше чем вдвое. Для более плавной игры увеличьте время турнира или сократите длительность уровней.</p>':''}${draft.plan.startDepth<30?'<p class="structure-warning">На старте меньше 30 ББ. Для более глубокой игры уменьшите стартовые блайнды.</p>':''}` : '';
  modal('Структура турнира', `<div class="structure-overview"><strong id="structure-total">${overview()}</strong>${draft?`<button type="button" class="text-button" id="revise-structure">${icon('back')} Параметры расчёта</button>`:''}</div><p id="structure-editor-note" class="field-hint">${note}</p>${warnings}<div class="level-editor">${editorRows(rows)}</div>`, 'Сохранить', data=>{
    const edited=structuredClone(rows);
    for(let i=0;i<edited.length;i++) {
      const l=edited[i];l.duration=Number(data.get(`duration-${i}`))*60;
      if(l.kind==='level') { l.sb=Number(data.get(`sb-${i}`));l.bb=Number(data.get(`bb-${i}`));l.ante=c.ante?l.bb:0;
        if(l.sb>=l.bb){toast(`Уровень ${l.number}: BB должен быть больше SB`);return false;}
      }
    }
    if(draft) state.plannerOptions={...draft.options};
    state.config.sb=edited[0].sb;state.config.bb=edited[0].bb;
    if(autoOptions) { state.autoStructure=autoOptions;delete state.levels; }
    else { delete state.autoStructure;state.levels=edited; }
    store();render();
  });
  $('#modal').classList.add('structure-modal');
  if(draft) $('#revise-structure').onclick=()=>showStructurePlanner(draft.options);
  $('#modal-form').oninput=event=>{
    if(!event.target.closest('.level-editor')) return;
    autoOptions=null;
    document.querySelectorAll('.structure-warning').forEach(el=>el.remove());
    $('#structure-editor-note').textContent='Ручная структура: ваши изменения применятся после сохранения.';
    if(event.target.name.startsWith('duration-')) {
      rows[Number(event.target.name.split('-')[1])].duration=Number(event.target.value)*60;
      $('#structure-total').textContent=overview();
    }
  };
}

document.addEventListener('input', event=>{
  const el=event.target;
  if(el.closest('#settings-form') && el.name) {
    const name=el.name;
    if(name==='prizeCount') return;
    if(name.startsWith('prize-')) state.config.prizes[Number(name.split('-')[1])]=Number(el.value);
    else state.config[name]=el.type==='checkbox'?el.checked:el.type==='number'||(el.tagName==='SELECT'&&name!=='bountyMode')?Number(el.value):el.value;
    if(['sb','bb'].includes(name) && state.autoStructure) state.autoStructure.autoBlinds=false;
    if(name==='stack') {
      try { syncOpeningBlinds(); } catch { /* Validate when the input is complete. */ }
      for(const key of ['sb','bb']) $(`#settings-form [name="${key}"]`).value=state.config[key];
    }
    if(['sb','bb','duration','breakEvery','breakDuration','ante'].includes(name)) delete state.levels;
    $('#summary').innerHTML=summaryView();
    if($('#structure-label')) $('#structure-label').textContent=structureLabel();
    if($('#structure-hint')) $('#structure-hint').textContent=structureHint();
    if ($('#table-plan')) $('#table-plan').textContent=planDescription();
    if($('#prize-total')) {const total=state.config.prizes.reduce((a,b)=>a+b,0);$('#prize-total').textContent=`Всего ${total}% из 100%`;$('#prize-total').classList.toggle('error',total!==100);}
    store();
  }
  if(el.dataset.seat!==undefined){const i=Number(el.dataset.seat);state.seats[i].name=el.value;state.seats[i].id=uid();const query=el.value.toLocaleLowerCase().trim();const matches=query?state.library.filter(p=>`${p.name} ${p.nick}`.toLocaleLowerCase().includes(query)).slice(0,5):[];$(`#suggest-${i}`).innerHTML=matches.map(p=>`<button type="button" data-action="suggest" data-id="${p.id}" data-seat="${i}"><strong>${escape(p.name)}</strong><small>${escape(p.nick)}</small></button>`).join('');$('#table-visual').innerHTML=tableVisual();$('.filled-pill').textContent=`${state.seats.filter(p=>p.name.trim()).length} / ${state.config.seats} мест занято`;store();}
  if(el.dataset.nick!==undefined){state.seats[Number(el.dataset.nick)].nick=el.value;$('#table-visual').innerHTML=tableVisual();$('.filled-pill').textContent=`${state.seats.filter(p=>p.name.trim()).length} / ${state.config.seats} мест занято`;store();}
});
document.addEventListener('focusin',event=>{
  if(event.target.dataset.table && event.target.matches('input')) {
    const table=Number(event.target.dataset.table);
    if(table!==selectedTable){selectedTable=table;$('#table-visual').innerHTML=tableVisual();}
  }
});
document.addEventListener('change',event=>{
  if(event.target.name==='bountyMode') { state.config.bountyMode=event.target.value;store();render(); }
  if(event.target.name==='prizeCount') {const templates={1:[100],2:[65,35],3:[50,30,20],4:[45,25,20,10],5:[40,25,15,12,8]};state.config.prizes=templates[event.target.value];store();render();}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='settings-form'){event.preventDefault();const error=setupError();if(error)return toast(error);go('seating');}
  if(event.target.id==='seating-form'){event.preventDefault();if(state.game)go('board');else begin();}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const action=button.dataset.action,g=state.game;
  if(action==='close')return $('#modal').close();
  if(action==='home'){event.preventDefault();return go(g?'board':'settings');}
  if(action==='nav'){if(button.dataset.step==='seating'&&!g){const error=setupError();if(error)return toast(error);}return go(button.dataset.step);}
  if(action==='mode'){state.config.mode=button.dataset.mode;try{syncOpeningBlinds();}catch{/* Keep incomplete settings editable. */}store();return render();}
  if(action==='structure-planner')return showStructurePlanner();
  if(action==='structure')return showStructure();
  if(action==='players'){playersVisible=!playersVisible;render();if(playersVisible)$('#players-panel').scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(action==='select-table'){selectedTable=Number(button.dataset.table);$('#table-visual').innerHTML=tableVisual();return;}
  if(action==='shuffle'){for(let i=state.seats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[state.seats[i],state.seats[j]]=[state.seats[j],state.seats[i]];}store();return render();}
  if(action==='suggest'){const p=state.library.find(p=>p.id===button.dataset.id);state.seats[Number(button.dataset.seat)]={...p};store();return render();}
  if(action==='demo'){state.config=defaults();state.seats=['Александр','Михаил','Анна','Дмитрий','Мария','Артём'].map((name,i)=>({id:uid(),name,nick:['Alex','Misha','Anna','Dima','Mary','Art'][i]}));delete state.levels;delete state.autoStructure;state.game=createGame(state.config,levels(),state.seats);state.game.remaining=17*60+42;clearUndo();return go('board');}
  if(action==='new')return modal('Новая игра', '<p>Текущая игра будет заменена. Сохранённые имена останутся в вашей компании.</p>', 'Создать игру', ()=>{state.game=null;clearUndo();playersVisible=false;delete state.levels;delete state.autoStructure;go('settings');});
  if(action==='sound'){state.sound=!state.sound;store();if(state.sound)beep();return render();}
  if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полноэкранный режим недоступен в этом браузере');}return;}
  if(!g)return;
  if(action==='register-player')return showRegistration();
  if(action==='play'){if(state.sound){try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();}catch{}}toggleClock(g);store();return render();}
  if(action==='freezeout') {
    return modal('Аддон на фризауте', `<p>Уточните условия аддона на этот этап.</p><div class="fields two spaced">${numeric('Стоимость аддона','addonCost',g.config.addonCost,'₽',1,10000000)}${numeric('Фишки за аддон','addonStack',g.config.addonStack,'фишек',1,10000000)}</div><p class="field-hint">Новые условия действуют на следующие аддоны. Уже внесённые суммы сохранятся. Текущий игровой уровень начнётся заново${g.config.reentry?', ре-энтри останутся доступны вручную':''}.</p>`, 'Начать фризаут', data=>{
      const before=structuredClone(g);
      try {
        if(!startFreezeout(g,Date.now(),{addonCost:Number(data.get('addonCost')),addonStack:Number(data.get('addonStack'))})) { store();render();toast('Фризаут уже начат или игра завершена');return; }
      } catch(error) { toast(error.message);return false; }
      undo=before;state.undo=undo;
      state.config.addonCost=g.config.addonCost;state.config.addonStack=g.config.addonStack;
      store();render();toast(`Фризаут начат. Аддон ${money(g.config.addonCost)} за ${number(g.config.addonStack)} фишек.`,true);
    });
  }
  if(action==='next'||action==='prev')return modal(action==='next'?'Следующий уровень?':'Предыдущий уровень?', '<p>Таймер выбранного уровня начнётся с полной длительности.</p>', 'Переключить',()=>{jumpLevel(g,g.index+(action==='next'?1:-1));store();render();});
  if(action==='undo'){if(undo){state.game=restoreAction(g,undo);syncGameSetup();clearUndo();store();render();toast('Последнее действие отменено');}return;}
  const p=g.players.find(p=>p.id===button.dataset.id);if(!p)return;
  if(action==='reentry'&&!p.active&&g.config.reentry) { saveUndo();addEntry(g,p.id,'reentry');store();render();toast(`${nameOf(p)} · ре-энтри +${money(g.config.buyin)}`,true);return; }
  if(!p.active||g.finished)return;
  if(action==='bust'&&g.config.bountyMode==='off') { saveUndo();eliminate(g,p.id);store();render();toast(`${nameOf(p)} · выбыл`,true);return; }
  if(action==='bust')return modal(`${escape(nameOf(p))} выбывает?`, `<label class="field"><span>Кто выбил игрока?</span><select name="killer" required><option value="">Выберите игрока</option>${g.players.filter(x=>x.active&&x.id!==p.id).map(x=>`<option value="${x.id}">${escape(nameOf(x))}</option>`).join('')}</select></label><p class="field-hint">${g.config.bountyMode==='progressive'?`Награда ${money(p.bounty)}: ${g.config.bountyImmediate}% сразу выбившему, остаток на его голову.`:g.config.bountyMode==='fixed'?`Выбивший получит ${money(p.bounty)}.`:'Выбивание сохранится в статистике.'} Последнее действие можно отменить.</p>`, 'Подтвердить',data=>{saveUndo();eliminate(g,p.id,Date.now(),data.get('killer')||null);store();render();});
  if(action==='addon'&&g.config.mode==='tournament') {
    saveUndo();addEntry(g,p.id,'addon');store();render();toast(`${nameOf(p)} · аддон +${money(g.config.addonCost)}`,true);return;
  }
  if(action==='cashin'&&g.config.mode==='cash')return modal('Добавить вход',numeric('Сумма входа','amount',g.config.buyin,'₽',1,10000000),'Добавить', data=>{saveUndo();p.invested+=Number(data.get('amount'));p.entries++;store();render();toast(`${nameOf(p)} · вход +${money(Number(data.get('amount')))}`,true);});
  if(action==='cashout')return modal(`Выход · ${escape(nameOf(p))}`,`${numeric('Сумма на выходе','amount',p.invested,'₽',0,100000000)}<p class="field-hint">Всего внесено ${money(p.invested)}. Укажите денежную стоимость оставшихся фишек.</p>`,'Записать выход',data=>{const amount=Number(data.get('amount')),available=poolOf(g)-g.players.reduce((s,p)=>s+(p.cashout||0),0);if(amount>available){toast('Выход превышает сумму, оставшуюся за столом');return false;}if(g.players.filter(p=>p.active).length===1&&amount!==available){toast(`Последний игрок должен вывести оставшиеся ${money(available)}`);return false;}saveUndo();advanceClock(g);p.cashout=amount;p.active=false;if(g.players.every(p=>!p.active)){g.running=false;g.finished=true;}store();render();});
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){tick();store();flush();}});
document.addEventListener('click',event=>{document.querySelectorAll('.player-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.removeAttribute('open');});if(!event.target.closest('.game-menu'))document.querySelector('.game-menu')?.removeAttribute('open');if(!event.target.closest('.name-field'))document.querySelectorAll('.suggestions').forEach(el=>el.innerHTML='');});
setInterval(tick,250);
setInterval(()=>{if(state.game?.running)store();},5000);
if(state.game)advanceClock(state.game);
render();
if (pendingSave) flush();
if (recoveryMessage) toast(recoveryMessage);
