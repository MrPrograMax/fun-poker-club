import { MAX_PLAYERS, seatingPlan, seatPlayers, defaults, makeLevels, recommendOpeningBlinds, recommendStructure, payouts, validateConfig, poolOf, bountyPoolOf, normalizeGame, addEntry, registerPlayer, registrationTables, playerNameKey, createGame, advanceClock, toggleClock, jumpLevel, startFreezeout, eliminate, formatTime } from './engine.js';
import { MAX_STRUCTURE_ROWS, wholeNumber, validateProfile, validateStructure, seatingDescription, filterPlayers, extendLevel, editFutureStructure, moveStructureRow, finishGame, gameResults, exportGameResults, setAddonTerms, gameTableNumbers, planTableBalance, rebalanceTables } from './engine.js';
import { actionHistory, rememberAction, undoAction, clearActionHistory, registeredPlayer, tableViewSeats, addCashEntry, cashOut } from './engine.js';

const KEY = 'river-poker-v1';
const $ = selector => document.querySelector(selector);
const seatingPreviewObserver = new ResizeObserver(entries => {
  for (const { target } of entries) target.style.setProperty('--preview-height', `${target.getBoundingClientRect().height}px`);
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => new Intl.NumberFormat('ru-RU').format(value);
const money = value => `${number(value)} ₽`;
const nameOf = p => p?.nick || p?.name || 'Игрок';
const initials = p => nameOf(p).split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
const uid = () => crypto.randomUUID();
const tableLabel = count => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? 'столов' : count % 10 === 1 ? 'стол' : count % 10 >= 2 && count % 10 <= 4 ? 'стола' : 'столов'}`;
const levelLabel = count => `${count} ${count % 100 >= 11 && count % 100 <= 14 ? 'уровней' : count % 10 === 1 ? 'уровень' : count % 10 >= 2 && count % 10 <= 4 ? 'уровня' : 'уровней'}`;
let selectedTable = 1;
let playersVisible = false;
let rosterQuery = '', rosterTable = 0, reviewBoard = false, resultDetails = 'payouts';
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
  undo: '<path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  archive: '<path d="M4 4h16v4H4zM5 8v12h14V8M9 12h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
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
undo = actionHistory(state).at(-1)?.game || null;

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
function previewLevels() {
  try { return levels(); } catch { return []; }
}
function syncOpeningBlinds() {
  if (!state.game && state.config.mode === 'tournament' && state.autoStructure?.autoBlinds) {
    Object.assign(state.config, recommendOpeningBlinds(state.config.stack, state.autoStructure.startDepth));
  }
}
function setupError() {
  try { syncOpeningBlinds(); } catch (error) { return error.message; }
  const error = validateConfig(state.config);
  if (error) return error;
  if (state.config.mode === 'tournament') { try { return validateStructure(levels(), state.config.freezeoutAfterBreak); } catch (error) { return error.message; } }
  return '';
}
function structureLabel() {
  try { return `${levelLabel(levels().filter(l=>l.kind==='level').length)} · ${state.autoStructure?'автоподбор':'посмотреть'}`; }
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
function numericAttrs(label, min, max) { return `type="text" inputmode="numeric" data-number data-label="${escape(label)}" data-min="${min}" data-max="${max}" required`; }
function numeric(label, key, value, unit = '', min = 1, max = 10000000) { return input(label, key, value, unit, numericAttrs(label, min, max)); }
function checkNumber(el) {
  let error = '';
  try { wholeNumber(el.value, Number(el.dataset.min), Number(el.dataset.max), el.dataset.label); }
  catch (e) { error = e.message; }
  el.setCustomValidity(error);el.setAttribute('aria-invalid', String(Boolean(error)));
  const container = el.closest('.number-control, .field') || el.parentElement;
  let message = container.querySelector('.input-error');
  if (!message) { message = document.createElement('small');message.className = 'input-error';message.id = `error-${el.name}`;container.append(message);el.setAttribute('aria-describedby',message.id); }
  message.textContent = error;message.hidden = !error;
  return !error;
}
function checkForm(form) {
  if (!form) return true;
  const numbers = [...form.querySelectorAll('[data-number]:not(:disabled)')];
  const invalid = numbers.filter(el => !checkNumber(el));
  if (invalid.length) { invalid[0].focus();return false; }
  return form.reportValidity();
}
function toggle(label, note, key, checked) { return `<label class="toggle-row"><span><strong>${label}</strong><small>${note}</small></span><input type="checkbox" name="${key}" ${checked ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label>`; }
function brandContent() {
  return '<span class="brand-symbol" aria-hidden="true">♠</span><span class="brand-wordmark"><span class="brand-name">UNTIL MORNING</span><small>POKER WITH FRIENDS</small></span>';
}
function header() {
  if (state.step === 'board') return '';
  const current = ['settings', 'seating', 'board'].indexOf(state.step);
  return `<header class="topbar"><a href="#" class="brand" data-action="home" aria-label="Until Morning — главная">${brandContent()}</a><nav aria-label="Этапы игры">${['Настройки', 'Рассадка', 'Табло'].map((title, i) => `<button class="nav-step ${current === i ? 'selected' : ''}" data-action="nav" data-step="${['settings', 'seating', 'board'][i]}" ${i === 2 && !state.game ? 'disabled' : ''}><span>${i < current ? icon('check') : `0${i + 1}`}</span>${title}</button>`).join('')}</nav><div class="header-actions"><button class="button subtle small" data-action="archives" aria-label="Архив игр">${icon('archive')} Архив игр</button>${state.game ? `<button class="button subtle small" data-action="new">${icon('plus')} Новая игра</button>` : `<button class="button subtle small" data-action="demo">Посмотреть демо ${icon('arrow')}</button>`}</div></header>`;
}
function render() {
  const openingResults = state.step === 'board' && state.game?.finished && !reviewBoard && !$('.results-hero');
  seatingPreviewObserver.disconnect();
  ensureSeats();
  if (state.game && rosterTable > 0 && !gameTableNumbers(state.game).includes(rosterTable)) rosterTable = 0;
  document.body.classList.toggle('board-page', state.step === 'board');
  $('#app').innerHTML = `${header()}<main>${state.step === 'settings' ? settingsView() : state.step === 'seating' ? seatingView() : boardView()}</main><footer><span><span class="tiny-spade">♠</span> UNTIL MORNING · POKER WITH FRIENDS</span><span class="save-status"><i></i>${server ? 'Сохранение на Go-сервере' : 'Сохранение в этом браузере'}</span><span>Хороших карт. Хорошего вечера.</span></footer>`;
  document.querySelectorAll('#app form').forEach(form => { form.noValidate = true; });
  const preview = $('.table-preview');
  if (preview) {
    preview.style.setProperty('--preview-height', `${preview.getBoundingClientRect().height}px`);
    seatingPreviewObserver.observe(preview);
  }
  if (openingResults) window.scrollTo(0, 0);
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
  ${state.game ? '<div class="notice">Игра уже создана. Основные настройки зафиксированы. Будущие уровни можно изменить в меню табло.</div>' : ''}
  <form id="settings-form"><fieldset ${state.game ? 'disabled' : ''}><div class="setup-grid"><div class="setup-main">
    ${section('Формат игры', '01 / ОСНОВНОЕ', `<div class="mode-picker"><button type="button" data-action="mode" data-mode="tournament" class="mode-card ${c.mode === 'tournament' ? 'active' : ''}"><span class="mode-icon">${icon('trophy')}</span><span><strong>Турнир</strong><small>Растущие блайнды и призовые места</small></span><i class="radio"></i></button><button type="button" data-action="mode" data-mode="cash" class="mode-card ${c.mode === 'cash' ? 'active' : ''}"><span class="mode-icon cash-icon">♣</span><span><strong>Кэш-игра</strong><small>Постоянные блайнды, свободный выход</small></span><i class="radio"></i></button></div>${input('Название вечера', 'name', c.name, '', 'type="text" maxlength="60" required placeholder="Например, пятничный покер"')}`)}
    ${section('Стек и блайнды', '02 / СТРУКТУРА', `${stackAndBlinds(c)}${c.mode === 'tournament' ? `<div class="fields two spaced">${state.levels?'<div class="table-plan"><span>Длительность уровней</span><strong>Задана в таблице</strong></div>':numeric('Длительность уровня', 'duration', c.duration, 'мин', 1, 180)}<label class="field"><span>Структура турнира</span><button type="button" class="input-button" data-action="structure"><span id="structure-label">${structureLabel()}</span> ${icon('arrow')}</button></label></div><p class="field-hint" id="structure-hint">${escape(structureHint())}</p><div class="divider"></div>${toggle('Big blind ante', 'Анте оплачивает только большой блайнд', 'ante', c.ante)}<p class="field-hint">Длительность каждого перерыва задаётся в таблице структуры.</p>${freezeoutSelect(previewLevels(), c.freezeoutAfterBreak)}` : '<p class="field-hint">Блайнды фиксируются на всю сессию. Таймер показывает время игры.</p>'}`)}
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
  return `<section class="summary-card"><div class="eyebrow">ВЕЧЕР В ЦИФРАХ</div><h2>${escape(c.name || 'Ваша игра')}</h2><span class="pill">${c.mode === 'tournament' ? 'NO-LIMIT HOLD’EM · ТУРНИР' : 'NO-LIMIT HOLD’EM · КЭШ'}</span><div class="summary-pool"><span>${c.mode === 'tournament' ? 'Стартовый призовой фонд' : 'Стартовая сумма входов'}</span><strong>${money(pool)}</strong><small>${c.seats} игроков × ${money(c.buyin-bounty)}${c.mode==="tournament"?" на места":""}</small>${bounty?`<div class="summary-bounty">Баунти отдельно <b>${money(bounty*c.seats)}</b></div>`:""}</div>${c.mode === 'tournament' ? `<div class="summary-prizes">${prizes.map((p,i) => `<div><span><i class="place-badge p${i}">${i+1}</i>${i === 0 ? 'Победитель' : `${i+1}-е место`}</span><b>${valid ? money(p) : '—'}</b></div>`).join('')}</div>` : '<div class="cash-note">Итог каждого игрока = сумма на выходе − все его входы.</div>'}<div class="summary-footer"><span>Стартовые блайнды<strong>${number(c.sb)} / ${number(c.bb)}</strong></span><span>${c.mode === 'tournament' ? 'Длительность структуры' : 'Стартовый стек'}<strong>${c.mode === 'tournament' ? `${number(previewLevels().reduce((sum,l)=>sum+l.duration,0)/60)} мин` : number(c.stack)}</strong></span></div></section>`;
}
function planDescription() {
  return seatingDescription(state.config.seats, state.config.tableCapacity);
}
function groupedTables(players) {
  return [...new Set(players.map(p => p.table))].sort((a,b) => a-b).map(table => ({
    number: table, players: players.filter(p => p.table === table).sort((a,b) => a.seat-b.seat),
  }));
}
function draftTables() {
  if (state.game) return gameTableNumbers(state.game).map(number => ({number, players:state.game.players.map((p,index) => ({...p,index})).filter(p => p.table === number && (state.game.config.mode === 'cash' || p.active)).sort((a,b) => a.seat-b.seat)}));
  return groupedTables(seatPlayers(state.seats.map((p, index) => ({ ...p, index })), state.config.tableCapacity));
}
function playerInput(p) {
  const i = p.index;
  return `<div class="player-input-row"><span class="seat-number" title="Место ${p.seat}">${String(p.seat).padStart(2,'0')}</span><div class="name-field"><label class="sr-only" for="player-${i}">Имя игрока ${i+1}</label><input id="player-${i}" name="player-${i}" data-seat="${i}" data-table="${p.table}" autocomplete="off" maxlength="60" placeholder="Имя и фамилия" value="${escape(p.name)}"><div id="suggest-${i}" class="suggestions"></div></div><label class="sr-only" for="nick-${i}">Ник игрока ${i+1}</label><input class="nick-input" id="nick-${i}" name="nick-${i}" data-nick="${i}" data-table="${p.table}" maxlength="24" placeholder="Ник · можно вместо имени" value="${escape(p.nick)}"></div>`;
}
function seatingView() {
  const c = state.config, filled = state.seats.filter(p => p.name.trim() || p.nick?.trim()).length;
  const tables = draftTables(), seatedCount=tables.reduce((sum,t)=>sum+t.players.length,0);
  return `<div class="page-heading compact"><div><div class="eyebrow">ХОРОШИЕ ЛЮДИ. БОЛЬШИЕ БАНКИ.</div><h1>Кто сегодня за столом<span class="accent">?</span></h1><p>Добавьте имена или выберите знакомых игроков из подсказок.</p></div><span class="pill filled-pill">${state.game?`${seatedCount} игроков за столами`:`${filled} / ${c.seats} мест занято`}</span></div><div class="seating-grid">${section('Состав игроков', `${tableLabel(tables.length).toUpperCase()} · ${seatedCount} МЕСТ`, `<form id="seating-form"><fieldset ${state.game ? 'disabled' : ''}><div class="players-editor">${tables.map(t => `<div class="player-table-group"><h3>Стол ${t.number}<span>${t.players.length} игроков</span></h3>${t.players.map(playerInput).join('')}</div>`).join('')}</div><button type="button" class="button subtle shuffle-button" data-action="shuffle">${icon('shuffle')} Случайная рассадка</button></fieldset><p class="field-hint">Укажите имя буквами или только ник — в нём можно использовать цифры. Сохраним игроков для следующей игры. Игроки распределяются между столами равномерно.</p><button class="button primary full" type="submit">${state.game ? 'Вернуться к игре' : 'Всё готово — к игре'} ${icon('arrow')}</button></form>`)}<div class="table-preview"><div id="table-visual">${tableVisual()}</div><p>Места по часовой стрелке · ${tableLabel(tables.length)}</p><div class="seating-details"><div>Стартовый стек<strong>${number(c.stack)}</strong></div><div>Блайнды<strong>${number(c.sb)} / ${number(c.bb)}</strong></div><div>Бай-ин<strong>${money(c.buyin)}</strong></div></div></div></div>`;
}
function tableVisual() {
  const tables = draftTables();
  const current = tables.find(t => t.number === selectedTable) || tables[0];
  if (!current) return '';
  selectedTable = current.number;
  const capacity = (state.game?.config || state.config).tableCapacity;
  const seats = tableViewSeats(current.players, capacity, state.tableRotations?.[selectedTable]);
  return `${tables.length > 1 ? `<div class="table-tabs" role="group" aria-label="Выбор стола">${tables.map(t => `<button type="button" data-action="select-table" data-table="${t.number}" aria-pressed="${t.number===selectedTable}" class="${t.number===selectedTable?'selected':''}">Стол ${t.number}<small>${t.players.length}</small></button>`).join('')}</div>` : ''}<div class="eyebrow table-caption">СТОЛ № ${String(current.number).padStart(2,'0')} · ${capacity} МЕСТ</div><div class="poker-table"><div class="table-felt"><span class="table-brand">UNTIL<br>MORNING</span><small>POKER WITH FRIENDS</small><div class="table-cards"><i>♠</i><i>♣</i><i>♥</i></div></div>${seats.map(({seat,player:p,x,y}) => {
    const occupied = Boolean(p?.name || p?.nick), label = occupied ? nameOf(p) : 'Свободно';
    return `<div class="table-seat ${occupied?'occupied':''}" data-seat-number="${seat}" style="--x:${x}%;--y:${y}%" aria-label="Место ${seat}: ${escape(label)}"><span>${occupied?escape(initials(p)):String(seat).padStart(2,'0')}${occupied?`<b class="table-seat-badge">${seat}</b>`:''}</span><small title="${escape(label)}">${escape(label)}</small></div>`;
  }).join('')}</div><div class="table-view-controls" role="group" aria-label="Ракурс стола"><button type="button" class="button subtle icon-button" data-action="rotate-table" data-direction="-1" aria-label="Повернуть ракурс влево" title="Повернуть ракурс влево">${icon('back')}</button><span>Ракурс стола<small>Номера мест сохраняются</small></span><button type="button" class="button subtle icon-button" data-action="rotate-table" data-direction="1" aria-label="Повернуть ракурс вправо" title="Повернуть ракурс вправо">${icon('arrow')}</button></div>`;
}
function gameMenu(g) {
  return `<details class="game-menu"><summary class="button icon-button" aria-label="Меню игры" title="Меню игры">${icon('settings')}</summary><div class="game-menu-content"><span class="eyebrow">ИГРА ПОДГОТОВЛЕНА</span><button type="button" data-action="archives">${icon('archive')} Архив игр</button><p>${g.players.length} игроков · ${tableLabel(gameTableNumbers(g).length)}</p><button type="button" data-action="nav" data-step="settings">${icon('check')} Настройки игры</button><button type="button" data-action="nav" data-step="seating">${icon('people')} Рассадка по столам</button><button type="button" data-action="register-player" ${g.finished||g.players.length>=MAX_PLAYERS?'disabled':''}>${icon('plus')} Добавить игрока</button><div class="menu-elapsed">С начала игры <b id="elapsed">${formatTime(g.elapsed/1000,true)}</b></div>${g.config.mode==='tournament'?`<button type="button" data-action="prev" ${g.index===0||g.finished?'disabled':''}>${icon('back')} Предыдущий уровень</button>`:''}<div class="divider"></div><button type="button" data-action="new">${icon('plus')} Новая игра</button></div></details>`;
}
function boardActionsMenu(g) {
  return `<details class="board-actions-menu"><summary class="button subtle icon-button" aria-label="Дополнительные действия турнира" title="Дополнительные действия турнира">${icon('more')}</summary><div class="board-actions-content"><span class="eyebrow">УПРАВЛЕНИЕ ТУРНИРОМ</span><button type="button" data-action="extend-level">${icon('clock')} Добавить время</button><button type="button" data-action="structure">${icon('settings')} Структура турнира</button>${g.freezeout?`<button type="button" data-action="freezeout">${icon('chips')} Условия аддона</button>`:''}</div></details>`;
}
function boardView() {
  const g = state.game;
  if (!g) { state.step = 'settings'; return settingsView(); }
  if (g.finished && !reviewBoard) return resultView(g);
  const c = g.config, cash = c.mode === 'cash', level = g.levels[g.index], next = g.levels[g.index+1];
  const alive = g.players.filter(p=>p.active).length;
  const caption = g.finished ? 'Игра завершена' : cash ? 'Время сессии' : g.structureEnded ? 'Структура завершена' : level.kind==='break' ? 'До конца перерыва' : 'До повышения блайндов';
  return `<div class="board-heading">
    <div class="board-title"><a href="#" class="brand" data-action="home" aria-label="Until Morning — табло">${brandContent()}</a><div class="board-title-name"><h1>${escape(c.name)}</h1><small>${g.seatingManaged&&gameTableNumbers(g).length===1?'Финальный стол':tableLabel(gameTableNumbers(g).length)} · ${cash?'Кэш':'Турнир'}</small></div></div>
    <div class="board-tools"><span id="timer-status" class="timer-status">На паузе</span><button class="button icon-button ${state.sound ? 'on' : ''}" data-action="sound" title="${state.sound ? 'Выключить' : 'Включить'} звук" aria-label="${state.sound ? 'Выключить' : 'Включить'} звук">${icon('sound')}</button><button class="button icon-button" data-action="fullscreen" aria-label="Полный экран" title="Полный экран">${icon('expand')}</button>${gameMenu(g)}</div>
  </div>
  <div class="board-grid"><section class="timer-panel">
    <div class="timer-top"><span class="pill">${cash ? 'КЭШ' : level.kind==='break'?'ПЕРЕРЫВ':`УРОВЕНЬ ${level.number}`}</span><span class="timer-caption">${caption}</span></div>
    <div class="timer-display ${cash?'cash-timer':''} ${level.kind==='break'?'break-timer':''}" id="timer">${cash?formatTime(g.elapsed/1000,true):formatTime(g.remaining)}</div>
    <div class="timer-progress"><div id="progress"></div></div>
    <div class="blind-cards"><div><span>${cash?'Малый блайнд':'Текущие блайнды'}</span><small>${cash?'SB':'МБ / ББ'}</small><strong>${cash?number(c.sb):level.kind==='break'?'Перерыв':`${number(level.sb)}<i>/</i>${number(level.bb)}`}</strong>${!cash&&level.ante?`<small>BB ante ${number(level.ante)}</small>`:''}</div><div><span>${cash?'Большой блайнд':'Следующие блайнды'}</span><small>${cash?'BB':next?.kind==='break'?`${next.duration/60} минут`:'МБ / ББ'}</small><strong>${cash?number(c.bb):!next?'—':next.kind==='break'?'Перерыв':`${number(next.sb)}<i>/</i>${number(next.bb)}`}</strong>${!cash&&next?.ante?`<small>BB ante ${number(next.ante)}</small>`:''}</div></div>
    ${g.finished?`<div class="winner-banner">${icon('trophy')} ${cash?'Сессия завершена':g.players.some(p=>p.place===1)?`Победитель — ${escape(nameOf(g.players.find(p=>p.place===1)))}`:'Турнир завершён без определения победителя'}</div>`:''}
  </section>${prizesView(g)}</div>
  <div class="board-controlbar"><button class="button primary play-button" data-action="play" ${g.finished||g.structureEnded?'disabled':''}>${icon(g.running?'pause':'play')}<span>${g.running?'Пауза':'Запустить'}</span></button><button class="button subtle players-button" data-action="players" aria-expanded="${playersVisible}" aria-controls="players-panel">${icon('people')}${cash?'Игроки и расчёты':'Игроки и баунти'}</button>${!cash?`<button class="button subtle next-button" data-action="${g.index===g.levels.length-1?'structure':'next'}" ${g.finished?'disabled':''}>${icon('arrow')} ${g.index===g.levels.length-1?'Добавить уровни':'Следующий уровень'}</button>`:''}${!cash?(g.freezeout?`<span class="freezeout-status">${icon('flag')}<span>Фризаут<small>${c.reentry?'Ре-энтри с подтверждением':'Ре-энтри выключены'}</small></span></span>`:`<button class="button subtle freezeout-button" data-action="freezeout" ${g.finished||g.structureEnded?'disabled':''} title="Начать фризаут и запустить уровень заново">${icon('flag')} Фризаут</button>`):''}<span class="board-player-count">В игре <b>${alive}</b> из ${g.players.length}</span>${!cash&&!g.finished?boardActionsMenu(g):''}</div>
  ${!cash&&!g.finished?`<div class="board-secondary-controls"><button class="button small finish-button" data-action="finish">${icon('flag')} Окончить турнир</button></div>${g.structureEnded?'<div class="notice"><strong>Расписание уровней закончилось</strong><p>Победитель ещё не определён. Добавьте время или уровни, чтобы продолжить, либо завершите турнир с текущими результатами.</p></div>':''}`:g.finished?'<div class="board-secondary-controls"><button class="button primary" data-action="results">Посмотреть итоги</button></div>':''}
  ${tableBalanceNotice(g)}
  <div id="players-panel" ${playersVisible?'':'hidden'}>${playersVisible?`${rosterView(g)}${eventView(g)}`:''}</div>`;
}
function resultView(g) {
  const cash=g.config.mode==='cash', result=gameResults(g), winner=g.players.find(p=>p.place===1);
  const title=cash?'Итоги кэш-сессии':winner?`${escape(nameOf(winner))} — победитель`:'Турнир завершён';
  const unknown=result.rows.filter(p=>p.total===null).length;
  const totalKnown=result.rows.reduce((sum,p)=>sum+(p.total??p.bountyWon),0);
  const stat=(label,value)=>`<div><span>${label}</span><strong>${value}</strong></div>`;
  return `<div class="results-heading"><a href="#" class="brand" data-action="home">${brandContent()}</a><span class="pill">ИГРА ЗАВЕРШЕНА</span></div><section class="results-hero"><span class="results-trophy">${icon('trophy')}</span><div class="eyebrow">${escape(g.config.name)}</div><h1>${title}</h1><p>${g.players.length} участников · ${formatTime(g.elapsed/1000,true)} игрового времени${g.finishedAt?` · ${new Date(g.finishedAt).toLocaleDateString('ru-RU')}`:''}</p></section><div class="results-stats">${stat('Всего внесено',money(result.invested))}${stat(cash?'Записано на выходах':'Рассчитано к выплате',money(totalKnown))}${stat(cash?'Всего входов':'Ре-энтри / аддоны',cash?number(g.players.reduce((sum,p)=>sum+p.entries,0)):`${g.players.reduce((sum,p)=>sum+p.reentries,0)} / ${g.players.reduce((sum,p)=>sum+p.addons,0)}`)}</div>${unknown||result.unassignedPrize||result.liveBounties?`<div class="notice result-notice"><strong>Не все результаты определены</strong><p>${unknown?`У ${unknown} игроков ${cash?'не записан выход':'не определено место'}. `:''}Нераспределённый фонд: ${money(result.unassignedPrize)}.${result.liveBounties?` Награды за оставшиеся головы: ${money(result.liveBounties)}.`:''} Они никому не назначены автоматически. ${undo?'Можно отменить завершение и продолжить запись результатов.':''}</p></div>`:''}<section class="panel results-panel"><div class="section-heading"><h2>Результаты игроков</h2><span>ЗА ЭТУ ИГРУ</span></div><div class="result-switch" role="group" aria-label="Данные об игроках"><button type="button" data-action="result-detail" data-view="payouts" aria-controls="result-detail" aria-pressed="${resultDetails==='payouts'}">Выплаты</button><button type="button" data-action="result-detail" data-view="statistics" aria-controls="result-detail" aria-pressed="${resultDetails==='statistics'}">Статистика</button></div><div id="result-detail">${resultDetails==='statistics'?resultStatistics(g,result):resultPayments(g,result)}</div></section><div class="results-actions"><button class="button subtle" data-action="archives">${icon('archive')} Архив игр</button><button class="button primary" data-action="new">Новая игра</button><button class="button subtle" data-action="review-board">Вернуться к табло</button><button class="button subtle" data-action="export-results">${icon('download')} Выгрузить результат</button>${undo?`<button class="button subtle result-undo" data-action="undo">${icon('undo')} Отменить последнее действие</button>`:''}</div>${eventView(g)}`;
}
function resultPlayerCell(g,p) {
  const cash=g.config.mode==='cash';
  return `<div class="result-player">${!cash?`<span class="place-badge">${p.place||'—'}</span>`:''}<div><strong>${escape(nameOf(p))}</strong><small>${!cash&&p.place===null?'Место не записано':p.nick&&p.name?escape(p.name):`Стол ${p.table??p.lastTable??'—'}`}</small></div></div>`;
}
function resultPayments(g, result) {
  const cash=g.config.mode==='cash';
  return `<div class="results-table-wrap"><table class="results-table"><thead><tr><th>${cash?'Игрок':'Место / игрок'}</th><th>Внесено</th><th>${cash?'На выходе':'За место'}</th>${cash?'':'<th>Баунти</th>'}<th>Итого</th><th>Результат</th></tr></thead><tbody>${result.rows.map(p=>`<tr><td>${resultPlayerCell(g,p)}</td><td>${money(p.invested)}</td><td>${p.prize===null?'—':money(p.prize)}</td>${cash?'':`<td>${money(p.bountyWon)}</td>`}<td>${p.total===null?'Не определено':money(p.total)}</td><td class="${p.net===null?'':p.net>=0?'profit':'loss'}">${p.net===null?'—':`${p.net>0?'+':''}${money(p.net)}`}</td></tr>`).join('')}</tbody></table></div><p class="field-hint">Результат — выплаты минус все взносы. Таблица не подтверждает фактическую передачу денег.</p>`;
}
function resultStatistics(g, result) {
  const cash=g.config.mode==='cash', bounty=!cash&&g.config.bountyMode!=='off';
  const columns=cash
    ? [{label:'Входы',value:p=>p.entries},{label:'Докупки',value:p=>Math.max(0,p.entries-1)}]
    : [...(bounty?[{label:'Нокауты',value:p=>p.knockouts}]:[]),{label:'Ре-энтри',value:p=>p.reentries},{label:'Аддоны',value:p=>p.addons}];
  const formatValue=value=>value==null?'—':number(value);
  const totalValue=column=>result.rows.some(p=>column.value(p)==null)?null:result.rows.reduce((sum,p)=>sum+column.value(p),0);
  const mostKnockouts=bounty?Math.max(0,...g.players.map(p=>p.knockouts)):0;
  const leaders=mostKnockouts?g.players.filter(p=>p.knockouts===mostKnockouts):[];
  return `${leaders.length?`<div class="result-highlight"><span class="result-highlight-icon">${icon('people')}</span><div><span>Больше всего нокаутов</span><strong>${leaders.map(p=>escape(nameOf(p))).join(' · ')}</strong></div><b>${number(mostKnockouts)}<small>${leaders.length>1?'у каждого':'за турнир'}</small></b></div>`:''}<div class="results-table-wrap"><table class="results-table"><caption class="sr-only">Статистика игроков за текущую игру</caption><thead><tr><th scope="col">${cash?'Игрок':'Место / игрок'}</th>${columns.map(c=>`<th scope="col">${c.label}</th>`).join('')}</tr></thead><tbody>${result.rows.map(p=>`<tr><td>${resultPlayerCell(g,p)}</td>${columns.map(c=>`<td>${formatValue(c.value(p))}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Всего</th>${columns.map(c=>`<td>${formatValue(totalValue(c))}</td>`).join('')}</tr></tfoot></table></div><p class="field-hint">${cash?'Входы включают первый взнос и все докупки.':'Статистика за текущий турнир, включая все ре-энтри.'}${!cash&&!bounty?' В формате без баунти выбивания не учитываются.':''}</p>`;
}
function playerFilterBar(g, query, table, prefix) {
  return `<div class="player-filters"><label class="field"><span>Поиск по имени или нику</span><input type="search" id="${prefix}-query" name="${prefix}Query" value="${escape(query)}" placeholder="Начните вводить имя или ник" autocomplete="off"></label><label class="field"><span>Стол</span><select id="${prefix}-table" name="${prefix}Table"><option value="0" ${!table?'selected':''}>${prefix==='roster'?'Все участники':'Все столы'}</option>${g.config.mode==='tournament'&&prefix==='roster'?`<option value="-1" ${table===-1?'selected':''}>Выбывшие</option>`:''}${gameTableNumbers(g).map(n=>`<option value="${n}" ${n===table?'selected':''}>Стол ${n}</option>`).join('')}</select></label></div>`;
}
function rosterPlayers(g) {
  return filterPlayers(g.players,{query:rosterQuery,table:rosterTable,includeLastTable:true});
}
function rosterSummary(g) {
  const out=g.players.filter(p=>!p.active).length;
  return `<p class="field-hint" id="roster-count">Показано ${rosterPlayers(g).length} из ${g.players.length}</p>${g.config.mode==='tournament'&&out?`<button type="button" class="button small subtle" data-action="${rosterTable===-1?'roster-all':'roster-eliminated'}">${rosterTable===-1?'Все участники':`Выбывшие · ${out}`}</button>`:''}`;
}
function rosterItems(g) {
  const players=rosterPlayers(g);
  return players.length?players.map(p=>playerCard(g,p)).join(''):'<p class="empty-players" role="status">Игроки не найдены. Измените запрос или выберите другой стол.</p>';
}
function showKnockout(g, player) {
  modal(`${escape(nameOf(player))} выбывает?`,`${playerFilterBar(g,'',player.table,'killer')}<p id="killer-context" class="field-hint">По умолчанию показан стол выбывшего. Если рассадка менялась, выберите другой стол вручную.</p><div id="killer-options" class="killer-options"></div><p class="field-hint">${g.config.bountyMode==='progressive'?`Награда ${money(player.bounty)}: ${g.config.bountyImmediate}% сразу, остаток на голову выбившего.`:`Награда за выбивание: ${money(player.bounty)}.`} Действие можно отменить.</p>`,'Записать выбывание',data=>{
    if(!data.get('killer')) {toast('Выберите, кто выбил игрока');return false;}
    const before=structuredClone(g);
    eliminate(g,player.id,Date.now(),data.get('killer'),{allowOtherTable:Number(data.get('killerTable'))!==player.table});
    saveUndo(before);reviewBoard=false;store();render();toast(`${nameOf(player)} · выбыл`,true);
  });
  $('#modal').classList.add('knockout-modal');
  const refresh=()=>{
    const table=Number($('#killer-table').value), selected=$('#modal [name="killer"]:checked')?.value;
    const candidates=filterPlayers(g.players,{query:$('#killer-query').value,table,activeOnly:true,excludeId:player.id});
    $('#killer-options').innerHTML=candidates.length?candidates.map(p=>`<label class="killer-choice"><input type="radio" name="killer" value="${escape(p.id)}" ${p.id===selected?'checked':''} required><span class="avatar">${escape(initials(p))}</span><span><strong>${escape(nameOf(p))}</strong><small>${p.name&&p.nick?escape(p.name)+' · ':''}Стол ${p.table} · место ${p.seat}</small></span></label>`).join(''):'<p class="empty-players" role="status">Подходящих игроков нет. Проверьте поиск или стол.</p>';
    $('#killer-context').textContent=table===player.table?'Показан стол выбывшего. Другой стол можно выбрать вручную.':'Выбран другой стол или все столы. Убедитесь, что выбивший действительно играл с участником.';
  };
  $('#killer-query').oninput=refresh;$('#killer-table').onchange=refresh;refresh();
}
function showFreezeout(g) {
  const already=Boolean(g.freezeout);
  modal(already?'Условия аддона':'Аддон на фризауте',`<p>Уточните условия аддона на этот этап.</p><div class="fields two spaced">${numeric('Стоимость аддона','addonCost',g.config.addonCost,'₽')}${numeric('Фишки за аддон','addonStack',g.config.addonStack,'фишек')}</div><p class="field-hint">Новые условия действуют только на последующие аддоны. ${already?'Таймер продолжит работу.':'Текущий игровой уровень начнётся заново.'} Ре-энтри останется доступен с подтверждением.</p>`,already?'Сохранить условия':'Начать фризаут',data=>{
    const before=structuredClone(g), addonCost=Number(data.get('addonCost')),addonStack=Number(data.get('addonStack'));
    if(already) setAddonTerms(g,addonCost,addonStack);
    else if(!startFreezeout(g,Date.now(),{addonCost,addonStack})) {toast('Фризаут уже начат или расписание завершено');return false;}
    saveUndo(before,already?'operation':'clock');syncGameSetup();store();render();toast(already?'Условия аддона обновлены':'Фризаут начат',true);
  });
}

function prizesView(g) {
  const c=g.config,cash=c.mode==='cash',pool=poolOf(g),prizes=payouts(pool,c.prizes);
  return `<aside class="prizes-panel panel"><div class="section-heading"><h2>${cash?'Банк игры':'Призовые'}</h2>${icon('trophy')}</div><div class="board-pool"><span>${cash?'Всего внесено':'Фонд за места'}</span><strong>${money(pool)}</strong></div>
  ${cash?`<div class="cash-note">На выходах<br><strong>${money(g.players.reduce((n,p)=>n+(p.cashout||0),0))}</strong><br>Осталось за столом<br><strong>${money(pool-g.players.reduce((n,p)=>n+(p.cashout||0),0))}</strong></div>`:`<div class="board-prizes">${prizes.map((amount,i)=>{const winner=g.players.find(p=>p.place===i+1);return `<div class="board-prize ${i===0?'first-prize':''}"><span class="place-badge p${i}">${i===0?icon('trophy'):i+1}</span><div><span>${i+1} место</span><strong>${money(amount)}</strong>${winner?`<small>${escape(nameOf(winner))}</small>`:''}</div><small>${c.prizes[i]}%</small></div>`;}).join('')}</div>`}
  ${!cash&&c.bountyMode==='fixed'?`<div class="bounty-bank"><span>Баунти за выбивание</span><strong>${money(c.bountyAmount)}</strong></div>`:!cash&&c.bountyMode==='progressive'?`<div class="bounty-bank progressive-bounty"><span>Прогрессивное баунти</span><strong>За каждого — своё</strong><small>Текущая награда за голову указана в списке игроков.</small><button type="button" class="text-button" data-action="players">Посмотреть награды ${icon('arrow')}</button></div>`:''}</aside>`;
}
function playerActions(g, p) {
  if(g.finished&&g.completionReason==='manual')return '';
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
  const seat=p.place?`${p.place}-е место${!p.active&&p.lastTable?` · был за столом ${p.lastTable}`:''}`:`Стол ${p.table} · место ${p.seat}`;
  const stat=(label,value)=>`<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const result=cash&&p.cashout!==null?p.cashout-p.invested:null;
  const payout=g.finished&&!cash&&p.place!=null?(payouts(poolOf(g),c.prizes)[p.place-1]||0)+p.earnedBounty:null;
  return `<article class="roster-player ${!p.active?'eliminated':''}" aria-label="Игрок ${escape(nameOf(p))}">
    <div class="player-card-header"><div class="player-identity"><span class="avatar">${escape(initials(p))}</span><div class="roster-name"><strong>${escape(nameOf(p))}</strong><small>${seat}</small></div></div><div class="player-investment"><span>Внесено</span><strong>${money(p.invested)}</strong></div></div>
    ${bounty?`<dl class="player-bounty">${stat('За голову',money(p.bounty))}${stat('За выбивания',money(p.earnedBounty))}</dl>`:''}
    ${result!==null?`<dl class="player-cash-result">${stat('На выходе',money(p.cashout))}${stat('Итог',`<span class="${result>=0?'profit':'loss'}">${result>0?'+':''}${money(result)}</span>`)}</dl>`:''}
    <div class="player-card-footer">${!cash?`<dl class="player-stats">${bounty?stat('Выбил',p.knockouts):''}${stat('Ре-энтри',p.reentries)}${stat('Аддоны',p.addons)}</dl>`:'<span class="player-cash-status">'+(p.active?'За столом':'Расчёт записан')+'</span>'}<div class="player-actions ${cash?'cash-actions':'tournament-actions'}">${playerActions(g,p)}</div></div>
    ${p.rebuys&&!cash?`<div class="player-legacy">Докупки ранее <b>${p.rebuys}</b></div>`:''}
    ${payout!==null?`<div class="player-payout"><span>К выплате</span><strong>${money(payout)}</strong></div>`:''}
  </article>`;
}
function tableBalanceNotice(g) {
  if(g.config.mode!=='tournament'||g.finished||g.players.filter(p=>p.active).length<2)return '';
  const plan=planTableBalance(g);
  if(!plan.needsChange)return '';
  return `<div class="table-balance-notice"><div><strong>${plan.final?'Можно собрать финальный стол':plan.closedTables.length?'Можно объединить столы':'Можно выровнять состав столов'}</strong><p>${plan.activeCount} игроков в игре · после рассадки: ${plan.tables.map(t=>`стол ${t.table} — ${t.count}`).join(', ')}.</p></div><button class="button small subtle" data-action="manage-tables">${icon('people')} Посмотреть рассадку</button></div>`;
}
function showTableManagement() {
  const g=state.game;
  let plan;
  try {plan=planTableBalance(g);} catch(error){return toast(error.message);}
  const player=id=>g.players.find(p=>p.id===id);
  modal('Управление столами',`<div class="seating-plan-summary"><strong>${plan.final?'Один стол для оставшихся игроков':`${tableLabel(plan.current.length)} → ${tableLabel(plan.tables.length)}`}</strong><span>${plan.activeCount} игроков · до ${plan.capacity} за столом · пересадок: ${plan.moves.length}</span></div><p class="field-hint">${plan.needsChange?'Рассадка рассчитана автоматически. Примените её между раздачами; таймер продолжит работать.':'Столы уже сбалансированы. Пересадка не требуется.'}${plan.closedTables.length?` Закрываются столы: ${plan.closedTables.join(', ')}.`:''} Выбывшие не занимают места.</p><div class="seating-plan-list">${plan.tables.map(t=>`<section class="seating-plan-table"><h3>${plan.final?'Финальный стол · ':''}Стол ${t.table}<span>${t.count} игроков</span></h3>${plan.assignments.filter(p=>p.table===t.table).map(p=>{const moved=p.fromTable!==p.table||p.fromSeat!==p.seat;return `<div class="seating-plan-player ${moved?'moving':''}"><span class="seat-number">${String(p.seat).padStart(2,'0')}</span><strong>${escape(nameOf(player(p.playerId)))}</strong>${moved?`<small>Со стола ${p.fromTable}, место ${p.fromSeat} ${icon('arrow')}</small>`:'<small>На своём месте</small>'}</div>`;}).join('')}</section>`).join('')}</div>` ,plan.needsChange?'Применить рассадку':'Закрыть',()=>{
    if(!plan.needsChange)return;
    const before=structuredClone(g), applied=rebalanceTables(g,Date.now(),plan);
    if(!applied)return;
    saveUndo(before);syncGameSetup();rosterQuery='';rosterTable=applied.final?applied.tables[0].table:0;selectedTable=applied.tables[0].table;playersVisible=true;
    store();render();toast(applied.final?'Финальный стол собран':'Рассадка обновлена',true);
  });
  $('#modal').classList.add('table-management-modal');
}
function rosterView(g) {
  return section('Участники игры',`<span class="roster-tools">${g.config.mode==='tournament'?`<button type="button" class="button small subtle" data-action="manage-tables" ${g.finished?'disabled':''}>${icon('people')} Управление столами</button>`:''}<button type="button" class="button small register-player-button" data-action="register-player" ${g.finished||g.players.length>=MAX_PLAYERS?'disabled':''}>${icon('plus')} Добавить игрока</button>${undo?'<button class="text-button" data-action="undo">Отменить последнее действие</button>':''}</span>`,`${playerFilterBar(g,rosterQuery,rosterTable,'roster')}<div class="roster-summary" id="roster-summary">${rosterSummary(g)}</div><div class="roster" id="roster-list">${rosterItems(g)}</div>${g.config.mode==='tournament'?'<p class="field-hint">Ре-энтри доступен после выбывания. Аддон — в меню «⋯» у активного игрока.</p>':''}`,'roster-panel');
}

function eventView(g, readOnly = false) {
  if(!g.events?.length)return '';
  const player=id=>escape(nameOf(g.players.find(p=>p.id===id)||{name:'Игрок'}));
  return `<details class="event-log"><summary>История действий <span>${g.events.length}</span></summary>${!readOnly&&undo?`<p class="field-hint">Доступно отмен: ${state.undoHistory.length}. Отменяйте по очереди, начиная с последнего действия.</p>`:''}<div>${g.events.slice().reverse().map((e,i)=>`<div class="event-row"><time>${new Date(e.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</time><span>${e.type==='correction'?escape(e.description):e.type==='tables'?`Рассадка обновлена · ${tableLabel(e.tables.length)} · пересадок: ${e.moves.length}${e.closedTables.length?` · закрыты столы: ${e.closedTables.join(', ')}`:''}`:['extend','structure','finish','addon-terms'].includes(e.type)?escape(e.type==='extend'?`Продление ${e.level?'уровня '+e.level:'перерыва'} на ${e.minutes} мин`:e.type==='structure'?`Структура обновлена · ${e.count} уровней`:e.type==='finish'?'Игра завершена':`Условия аддона: ${money(e.addonCost)} за ${number(e.addonStack)} фишек`):e.type==='freezeout'?`Начат фризаут · уровень ${e.level}${e.addonCost!==undefined?` · аддон ${money(e.addonCost)} за ${number(e.addonStack)} фишек`:''}`:e.type==='knockout'?`${e.killerId?`${player(e.killerId)} выбил`: 'Выбыл'} ${player(e.playerId)}${e.amount||e.carried?` · ${money(e.amount)} сразу, ${money(e.carried)} на голову`:''}`:`${player(e.playerId)} · ${{registration:'первый вход',rebuy:'докупка (ранее)',reentry:'ре-энтри',addon:'аддон',cashin:'дополнительный вход',cashout:'выход'}[e.type]} ${money(e.amount)}${e.bounty?` (из них ${money(e.bounty)} на голову)`:''}${['registration','addon'].includes(e.type)&&e.chips!==undefined?` · +${number(e.chips)} фишек`:''}${e.type==='registration'?` · стол ${e.table}, место ${e.seat}`:''}`}</span>${!readOnly&&i===0&&undo?'<button type="button" class="text-button event-undo" data-action="undo">Отменить</button>':''}</div>`).join('')}</div></details>`;
}
function tick() {
  const g = state.game; if (!g) return;
  const changed = advanceClock(g);
  if (changed) { store(); if (state.sound) beep(); if (state.step === 'board') render(); return; }
  if (state.step !== 'board' || (g.finished && !reviewBoard)) return;
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
  dialog.classList.remove('structure-modal','planner-modal','registration-modal','knockout-modal','table-management-modal','archive-modal');
  dialog.innerHTML = `<form id="modal-form" novalidate><div class="modal-heading"><h2>${title}</h2><button class="mini-button" type="button" data-action="close" aria-label="Закрыть">×</button></div>${content}<div class="modal-actions"><button type="button" class="button subtle" data-action="close">Отмена</button><button class="button primary" type="submit">${button}</button></div></form>`;
  $('#modal-form').onsubmit = event => { event.preventDefault(); if (!checkForm(event.currentTarget)) return;try { if (onConfirm(new FormData(event.currentTarget)) !== false) dialog.close(); } catch(error) { toast(error.message); } };
  dialog.showModal();
  dialog.scrollTop=0;
}
async function showArchives() {
  modal('Архив игр','<p class="field-hint">Загружаю сохранённые игры…</p>','Закрыть',()=>{});
  const form=$('#modal-form');$('#modal').classList.add('archive-modal');
  try {
    const response=await fetch('/api/archives',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Архив доступен при запуске актуальной версии Go-сервера.');
    const {games}=await response.json();
    if($('#modal-form')!==form||!$('#modal').open)return;
    const date=value=>new Date(value).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'});
    modal('Архив игр',`<p class="field-hint">Завершённые игры сохраняются автоматически. При создании новой игры предыдущая тоже останется здесь. Просмотр архива не меняет текущую игру.</p><div class="archive-list">${games.length?games.map(g=>`<button type="button" class="archive-item" data-archive-id="${escape(g.id)}"><span class="archive-item-icon">${icon(g.finished?'trophy':'archive')}</span><span><strong>${escape(g.name||'Покер с друзьями')}</strong><small>${date(g.startedAt||g.savedAt)} · ${g.mode==='cash'?'Кэш':'Турнир'} · ${g.playerCount} участников · ${formatTime(g.elapsed/1000,true)}</small></span><span class="archive-state">${g.finished?'Завершена':'Не завершена'} ${icon('arrow')}</span></button>`).join(''):'<p class="empty-players">Пока здесь нет игр. После завершения первая игра появится автоматически.</p>'}</div>`,'Закрыть',()=>{});
    $('#modal').classList.add('archive-modal');
    document.querySelectorAll('[data-archive-id]').forEach(button=>button.addEventListener('click',()=>showArchivedGame(button.dataset.archiveId)));
  } catch(error){if($('#modal-form')===form){form.querySelector('.field-hint').textContent=error.message;}}
}
async function showArchivedGame(id) {
  const form=$('#modal-form');
  try {
    const response=await fetch(`/api/archives/${encodeURIComponent(id)}`,{cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Не удалось открыть сохранённую игру');
    const entry=await response.json();
    if($('#modal-form')!==form||!$('#modal').open)return;
    const g=normalizeGame(structuredClone(entry.game)),result=gameResults(g);
    modal(escape(g.config.name||'Сохранённая игра'),`<div class="archive-detail-heading"><button type="button" class="text-button" id="archive-back">${icon('back')} Все игры</button><span class="pill">АРХИВ · ТОЛЬКО ПРОСМОТР</span></div><p class="field-hint">${g.finished?'Игра завершена':'Снимок незавершённой игры'} · ${g.players.length} участников · ${formatTime(g.elapsed/1000,true)}</p><h3 class="archive-section-title">Выплаты</h3>${resultPayments(g,result)}<details class="archive-section"><summary>Статистика игроков</summary>${resultStatistics(g,result)}</details><details class="archive-section"><summary>Структура и условия игры</summary><p class="field-hint">Вход ${money(g.config.buyin)} · стек ${number(g.config.stack)} · баунти: ${{off:'без баунти',fixed:'фиксированное',progressive:'прогрессивное'}[g.config.bountyMode]}${g.config.bountyMode!=='off'?` · базовая голова ${money(g.config.bountyAmount)}`:''}</p><div class="results-table-wrap"><table class="results-table"><thead><tr><th>Уровень</th><th>МБ / ББ</th><th>Минуты</th></tr></thead><tbody>${g.levels.map(l=>`<tr><td>${l.kind==='break'?'Перерыв':l.number}</td><td>${l.kind==='break'?'—':`${number(l.sb)} / ${number(l.bb)}`}</td><td>${number(l.duration/60)}</td></tr>`).join('')}</tbody></table></div></details>${eventView(g,true)}`,'Закрыть',()=>{});
    $('#modal').classList.add('archive-modal');$('#archive-back').addEventListener('click',showArchives);
  } catch(error){toast(error.message);}
}
function rememberPlayer(p) {
  const existing=state.library.find(x=>playerNameKey(x.name||x.nick)===playerNameKey(p.name||p.nick));
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
  for (const [index, player] of state.seats.entries()) { const error = validateProfile(player);if (error) return toast(`Игрок ${index + 1}: ${error}`); }
  if (new Set(state.seats.map(p=>playerNameKey(p.name||p.nick))).size!==state.seats.length) return toast('Один игрок указан дважды. Проверьте имена и ники.');
  const error=setupError(); if(error) return toast(error);
  rememberPlayers();
  state.game=createGame(state.config,levels(),state.seats); resultDetails='payouts';clearUndo();playersVisible=false;reviewBoard=false;rosterQuery='';rosterTable=0; go('board');
}
function saveUndo(snapshot = state.game, kind = 'operation') { rememberAction(state,snapshot,kind);undo=actionHistory(state).at(-1)?.game||null; }
function clearUndo() { clearActionHistory(state);undo=null; }
function reenterPlayer(g,p) {
  advanceClock(g);
  const apply=()=>{
    const before=structuredClone(g);
    addEntry(g,p.id,'reentry');saveUndo(before);reviewBoard=false;
    rosterTable=p.table;selectedTable=p.table;rosterQuery='';playersVisible=true;
    store();render();toast(`${nameOf(p)} · ре-энтри +${money(g.config.buyin)} · стол ${p.table}, место ${p.seat}`,true);
  };
  if(g.freezeout)return modal('Ре-энтри после фризаута?',`<p>Фризаут уже начат. Разрешить ре-энтри игроку <strong>${escape(nameOf(p))}</strong> за ${money(g.config.buyin)}?</p><p class="field-hint">Решение за ведущим. Приложение не отсчитывает дополнительные раздачи и не блокирует вход.</p>`,'Разрешить ре-энтри',apply);
  try {apply();} catch(error){toast(error.message);}
}
function showRegistration() {
  const g=state.game;
  if(g.finished || g.players.length>=MAX_PLAYERS) return toast(g.finished?'Игра уже завершена':`В игре уже ${MAX_PLAYERS} игроков`);
  const c=g.config, tables=registrationTables(g), cash=c.mode==='cash';
  const suggested=tables.filter(t=>t.seats.length&&!t.isNew).sort((a,b)=>b.seats.length-a.seats.length||a.table-b.table)[0]||tables.at(-1);
  const bounty=cash||c.bountyMode==='off'?0:c.bountyAmount;
  const candidates=[...g.players, ...state.library.filter(p=>!registeredPlayer(g,p))];
  modal('Добавить игрока', `<p>${cash?'Новый участник кэш-игры.':'Поздняя регистрация · первый вход в турнир.'} Укажите имя буквами или только ник; цифры допустимы в нике.</p><div class="name-field spaced">${input('Имя и фамилия','lateName','','','id="late-name" autocomplete="off" maxlength="60"')}<div id="late-suggestions" class="registration-suggestions" hidden></div></div><div class="spaced">${input('Ник · можно вместо имени','lateNick','','','maxlength="24" autocomplete="off"')}</div><div id="registered-player" class="registered-player" hidden></div><div class="registration-placement spaced"><div class="registration-placement-heading"><span id="registration-placement-status" class="placement-status automatic" role="status"><span aria-hidden="true">✓</span> <span id="placement-mode-label">Выбрано автоматически</span></span><button type="button" id="reset-placement" class="text-button" hidden>Подобрать автоматически</button></div><div class="fields two"><label class="field"><span>Стол</span><select name="registrationTable" aria-describedby="registration-placement-status">${tables.map(t=>`<option value="${t.table}" ${t.table===suggested.table?'selected':''} ${!t.seats.length?'disabled':''}>${t.isNew?'Новый стол':'Стол'} ${t.table}${!t.seats.length?' · занят':''}</option>`).join('')}</select></label><label class="field"><span>Место</span><select name="registrationSeat" aria-describedby="registration-placement-status"></select></label></div></div><p class="field-hint">${cash?'':'Выбывший освобождает место, а его история остаётся в турнире.'} Можно выбрать свободное место или открыть новый стол.</p><div class="registration-terms"><div><span>Первый взнос</span><strong>${money(c.buyin)}</strong></div><div><span>Стартовый стек</span><strong>${number(c.stack)}</strong></div>${bounty?`<div><span>За голову</span><strong>${money(bounty)}</strong></div>`:''}</div><p class="field-hint">${cash?'В банк игры': 'В призовой фонд'} поступит ${money(c.buyin-bounty)}.${g.freezeout?' Фризаут уже начат — вход по вашей договорённости.':''}</p><p id="registration-error" class="field-hint error" role="alert" hidden></p>`, 'Добавить игрока', data=>{
    const name=String(data.get('lateName')).trim();
    const known=state.library.find(p=>playerNameKey(p.name||p.nick)===playerNameKey(name||String(data.get('lateNick')).trim()));
    const profile={id:known?.id||uid(),name,nick:String(data.get('lateNick')).trim()};
    if(registeredPlayer(g,profile)){updateExisting();return false;}
    const previous=structuredClone(g);
    let player;
    try { player=registerPlayer(g,profile,{table:Number(data.get('registrationTable')),seat:Number(data.get('registrationSeat'))}); }
    catch(error) { $('#registration-error').textContent=error.message;$('#registration-error').hidden=false;return false; }
    saveUndo(previous);
    rememberPlayer(player);syncGameSetup();selectedTable=player.table;rosterTable=player.table;rosterQuery='';playersVisible=true;
    store();render();toast(`${nameOf(player)} · первый вход +${money(player.invested)}`,true);
  });
  $('#modal').classList.add('registration-modal');
  const form=$('#modal-form'), nameInput=form.elements.lateName, suggestions=$('#late-suggestions');
  const matchingPlayer=()=>registeredPlayer(g,{name:nameInput.value,nick:form.elements.lateNick.value});
  const updateExisting=()=>{
    const player=matchingPlayer(), banner=$('#registered-player');
    banner.hidden=!player;
    form.querySelector('[type="submit"]').disabled=Boolean(player);
    if(!player){banner.innerHTML='';return;}
    const returning=!cash&&!player.active&&c.reentry;
    banner.innerHTML=`<strong>${escape(nameOf(player))} уже зарегистрирован</strong><p>${player.active?`Играет за столом ${player.table}, место ${player.seat}.`:returning?'Можно вернуться через ре-энтри. Взносы и статистика сохранятся, свободное место подберём автоматически.':'Участник уже зарегистрирован. Его история сохранена в карточке.'}</p>${returning?`<button type="button" class="button small" id="registration-reentry">${icon('plus')} Ре-энтри · ${money(c.buyin)}</button>`:''}`;
    $('#registration-reentry')?.addEventListener('click',()=>{$('#modal').close();reenterPlayer(g,player);});
  };
  const updateSeats=()=>{
    const table=tables.find(t=>t.table===Number(form.elements.registrationTable.value));
    form.elements.registrationSeat.innerHTML=table.seats.map(seat=>`<option value="${seat}">${seat}</option>`).join('');
  };
  const showSuggestions=()=>{
    const query=playerNameKey(nameInput.value);
    const matches=candidates.filter(p=>!query||playerNameKey(`${p.name} ${p.nick||''}`).includes(query)).slice(0,5);
    suggestions.innerHTML=matches.map(p=>`<button type="button" data-registration-suggestion="${escape(p.id)}"><strong>${escape(p.name||p.nick)}</strong><small>${registeredPlayer(g,p)?p.active?'Уже играет':'Уже зарегистрирован · выбыл':p.nick?escape(p.nick):'Из вашей компании'}</small></button>`).join('');
    suggestions.hidden=!matches.length;
  };
  updateSeats();
  nameInput.addEventListener('focus',showSuggestions);
  form.addEventListener('input',event=>{
    $('#registration-error').hidden=true;
    if(event.target===nameInput) showSuggestions();
    updateExisting();
  });
  const setPlacementMode=automatic=>{
    $('#placement-mode-label').textContent=automatic?'Выбрано автоматически':'Выбрано вручную';
    $('#registration-placement-status').classList.toggle('automatic',automatic);
    $('#reset-placement').hidden=automatic;
  };
  form.elements.registrationTable.addEventListener('change',()=>{updateSeats();setPlacementMode(false);});
  form.elements.registrationSeat.addEventListener('change',()=>setPlacementMode(false));
  $('#reset-placement').addEventListener('click',()=>{
    form.elements.registrationTable.value=String(suggested.table);
    updateSeats();setPlacementMode(true);
  });
  suggestions.addEventListener('click',event=>{
    const button=event.target.closest('[data-registration-suggestion]');
    const player=candidates.find(p=>p.id===button?.dataset.registrationSuggestion);
    if(!player)return;
    nameInput.value=player.name;form.elements.lateNick.value=player.nick||'';
    suggestions.hidden=true;$('#registration-error').hidden=true;updateExisting();
  });
  nameInput.focus();showSuggestions();
}
function freezeoutSelect(rows, selected, name = 'freezeoutAfterBreak', disabled = false) {
  let count = 0;
  const options = rows.flatMap((l, i) => l.kind === 'break' && rows.slice(i + 1).some(x => x.kind === 'level') ? [{ value: ++count, label: `После ${count}-го перерыва` }] : []);
  return `<label class="field spaced"><span>Начало фризаута</span><select name="${name}" ${disabled?'disabled':''}><option value="0" ${!selected?'selected':''}>Вручную по кнопке</option>${options.map(o=>`<option value="${o.value}" ${selected===o.value?'selected':''}>${o.label}</option>`).join('')}${selected>count?`<option value="${selected}" selected>Перерыв ${selected} отсутствует — выберите другой</option>`:''}</select><small class="field-hint">По расписанию этап начнётся автоматически. Ре-энтри останется доступен с подтверждением.</small></label>`;
}
function editorRows(rows, lockedThrough = -1) {
  const control=(name,value,label,min,max,disabled)=>`<div class="number-control"><input name="${name}" value="${value}" aria-label="${label}" ${numericAttrs(label,min,max)} ${disabled?'disabled':''}></div>`;
  return `<div class="level-editor-row headings"><span>Уровень</span><span>МБ</span><span>ББ</span><span>Мин.</span><span></span></div>${rows.map((l,i)=>`<div class="level-editor-row ${i<=lockedThrough?'locked-level':''}"><span>${l.kind==='break'?`Перерыв<small>строка ${i+1}</small>`:`# ${l.number}`}${i===lockedThrough?'<small>текущий</small>':''}</span>${l.kind==='break'?'<span>—</span><span>—</span>':control(`sb-${i}`,l.sb,`МБ уровня ${l.number}`,1,i===0?1000000:100000000,i<=lockedThrough)+control(`bb-${i}`,l.bb,`ББ уровня ${l.number}`,2,i===0?1000000:100000000,i<=lockedThrough)}${control(`duration-${i}`,l.duration/60,`Минуты строки ${i+1}`,1,180,i<=lockedThrough)}<div class="level-row-actions" role="group" aria-label="Действия со строкой ${i+1}">${l.kind==='break'?`<button type="button" class="mini-button" data-move-level="${i}" data-direction="-1" aria-label="Поднять строку ${i+1}" title="Выше" ${i<=lockedThrough+1?'disabled':''}>↑</button><button type="button" class="mini-button" data-move-level="${i}" data-direction="1" aria-label="Опустить строку ${i+1}" title="Ниже" ${i<=lockedThrough||i===rows.length-1?'disabled':''}>↓</button>`:''}<button type="button" class="mini-button" data-remove-level="${i}" aria-label="Удалить строку ${i+1}" ${i<=lockedThrough||rows.length===1?'disabled':''}>×</button></div></div>`).join('')}`;
}
function showStructurePlanner(draftOptions = null) {
  const options={targetMinutes:240,extraEntries:0,addons:0,autoBlinds:true,startDepth:100,...state.plannerOptions,...state.autoStructure,...draftOptions};
  if (!draftOptions && state.autoStructure && state.autoStructure.autoBlinds === undefined) options.autoBlinds=false;
  const c=state.config;
  modal('Рассчитать структуру', `<p class="planner-context">Стек ${number(c.stack)} · ${c.seats} игроков · уровни около ${c.duration} мин${c.breakEvery?`. Перерывы по ${c.breakDuration} мин каждые ${c.breakEvery} уровня.`:'. Без перерывов.'}</p>${numeric('Желаемая длительность турнира','targetMinutes',options.targetMinutes,'мин',30,1440)}<div class="fields two spaced"><label class="field"><span>Перерывы в новой структуре</span><select name="planBreakEvery">${[0,3,4,6].map(n=>`<option value="${n}" ${n===(options.breakEvery??c.breakEvery)?'selected':''}>${n?`Каждые ${n} уровня`:'Без перерывов'}</option>`).join('')}</select></label>${numeric('Перерыв при расчёте','planBreakDuration',options.breakDuration??c.breakDuration,'мин',1,60)}</div><p class="field-hint">Это параметры новой структуры. После расчёта время каждого перерыва можно изменить в таблице.</p><div class="planner-blinds">${toggle('Подобрать стартовые МБ / ББ','Рассчитать от стартового стека, округлив номиналы','autoBlinds',options.autoBlinds)}<div class="planner-depth">${numeric('Глубина стартового стека','startDepth',options.startDepth,'ББ',20,500)}<p class="field-hint">Обычно 100 ББ. При выключенном автоподборе старт — ${number(c.sb)} / ${number(c.bb)}.</p></div></div><details class="planner-extras"><summary>Планируемые ре-энтри и аддоны</summary><p class="field-hint">Необязательно. Укажите суммарное количество за весь турнир.</p><div class="fields two">${numeric('Ре-энтри','extraEntries',options.extraEntries,'шт.',0,1000)}${numeric('Аддоны','addons',options.addons,'шт.',0,1000)}</div></details><p class="field-hint planner-note">Время ориентировочное: темп игры и докупки могут его изменить. На следующем шаге вы увидите уровни и сможете их поправить.</p><p id="planner-error" class="planner-error" role="alert" hidden></p>`, 'Рассчитать', data=>{
    const nextOptions={...Object.fromEntries(['targetMinutes','extraEntries','addons'].map(key=>[key,Number(data.get(key))])),startDepth:Number($('#modal [name="startDepth"]').value)||options.startDepth,autoBlinds:data.has('autoBlinds')};
    let plan;
    const configPatch={breakEvery:Number(data.get('planBreakEvery')),breakDuration:Number(data.get('planBreakDuration'))};
    try { plan=recommendStructure({...c,...configPatch},nextOptions); }
    catch(error) { $('#planner-error').textContent=error.message;$('#planner-error').hidden=false;return false; }
    showStructure({plan,options:nextOptions,configPatch});
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
  const g=state.game, c=g?.config||state.config;
  if (g?.finished) return toast('Игра уже завершена');
  if (g) advanceClock(g);
  let rows;
  try { rows=structuredClone(g?g.levels:draft?draft.plan.levels:levels()); } catch { rows=makeLevels(c); }
  let autoOptions=g?null:draft?{...draft.options}:state.autoStructure?{...state.autoStructure}:null;
  let freezeoutAt=c.freezeoutAfterBreak||0;
  const lockedThrough=g?g.index:-1;
  const renumber=()=>{let number=0;rows.forEach(l=>{if(l.kind==='level')l.number=++number;});};
  const overview=()=>`${levelLabel(rows.filter(l=>l.kind==='level').length)} · ${number(rows.reduce((sum,l)=>sum+l.duration,0)/60)} мин с перерывами`;
  const readRows=()=>{
    if(!checkForm($('#modal-form'))) return false;
    rows.forEach((l,i)=>{
      if(i<=lockedThrough)return;
      l.duration=Number($(`#modal [name="duration-${i}"]`).value)*60;
      if(l.kind==='level') {l.sb=Number($(`#modal [name="sb-${i}"]`).value);l.bb=Number($(`#modal [name="bb-${i}"]`).value);l.ante=c.ante?l.bb:0;}
    });
    if(!g)freezeoutAt=Number($('#modal [name="editorFreezeout"]').value);
    return true;
  };
  const drawRows=()=>{
    renumber();$('.level-editor').innerHTML=editorRows(rows,lockedThrough);$('#structure-total').textContent=overview();
    if(!g)$('#structure-freezeout').innerHTML=freezeoutSelect(rows,freezeoutAt,'editorFreezeout');
  };
  modal(g?'Продолжение структуры':'Структура турнира', `<div class="structure-overview"><strong id="structure-total">${overview()}</strong>${draft?`<button type="button" class="text-button" id="revise-structure">${icon('back')} Параметры расчёта</button>`:''}</div><p id="structure-editor-note" class="field-hint">${g?'Стрелками ↑ ↓ можно перемещать только будущие перерывы. Для продления текущего уровня используйте «Добавить время».':'Блайнды и время редактируются здесь. Стрелками ↑ ↓ можно перемещать только перерывы — порядок игровых уровней сохраняется.'}</p><div class="level-editor">${editorRows(rows,lockedThrough)}</div><p id="structure-move-status" class="sr-only" role="status"></p><div class="structure-add-actions"><button type="button" class="button small" data-add-level="level">${icon('plus')} Уровень</button><button type="button" class="button small subtle" data-add-level="break">${icon('plus')} Перерыв</button></div><div id="structure-freezeout">${g?'':freezeoutSelect(rows,freezeoutAt,'editorFreezeout')}</div><p id="structure-error" class="field-hint error" role="alert" hidden></p>`, 'Сохранить',()=>{
    if(!readRows())return false;
    const error=validateStructure(rows,freezeoutAt);
    if(error){$('#structure-error').textContent=error;$('#structure-error').hidden=false;return false;}
    if(g) {
      const before=structuredClone(g);
      editFutureStructure(g,rows,Date.now(),{freezeoutAfterBreak:freezeoutAt});saveUndo(before,'clock');
      store();render();toast('Структура обновлена. Новый уровень можно запустить кнопкой таймера.',true);
      return;
    }
    if(draft) {state.plannerOptions={...draft.options};Object.assign(state.config,draft.configPatch||{});}
    Object.assign(state.config,{sb:rows[0].sb,bb:rows[0].bb,freezeoutAfterBreak:freezeoutAt});
    if(autoOptions) { state.autoStructure=autoOptions;delete state.levels; }
    else { delete state.autoStructure;state.levels=structuredClone(rows); }
    store();render();
  });
  $('#modal').classList.add('structure-modal');
  if(draft) $('#revise-structure').onclick=()=>showStructurePlanner({...draft.options,...draft.configPatch});
  $('#modal-form').addEventListener('click',event=>{
    const button=event.target.closest('[data-add-level], [data-remove-level], [data-move-level]');if(!button||button.disabled)return;
    if(!readRows())return;
    const scheduledBreak=rows.filter(l=>l.kind==='break')[freezeoutAt-1];
    let movedTo=null, message='';
    if(button.dataset.moveLevel!==undefined) {
      const from=Number(button.dataset.moveLevel), to=from+Number(button.dataset.direction);
      try {const moved=moveStructureRow(rows,from,to,freezeoutAt,lockedThrough);rows=moved.rows;freezeoutAt=moved.freezeoutAfterBreak;}
      catch(error) {$('#structure-error').textContent=error.message;$('#structure-error').hidden=false;return;}
      movedTo=to;message=`Перерыв перемещён на строку ${to+1}`;
    } else if(button.dataset.removeLevel!==undefined) {
      const index=Number(button.dataset.removeLevel);
      if(index<=lockedThrough||rows.length===1)return;
      rows.splice(index,1);
      if(scheduledBreak) {
        freezeoutAt=rows.filter(l=>l.kind==='break').indexOf(scheduledBreak)+1;
        if(!freezeoutAt)message='Перерыв для фризаута удалён. Начало фризаута — вручную.';
      }
    } else {
      if(rows.length>=MAX_STRUCTURE_ROWS)return toast(`Максимум ${MAX_STRUCTURE_ROWS} строк в структуре`);
      const last=rows.findLast(l=>l.kind==='level');
      rows.push(button.dataset.addLevel==='break'?{kind:'break',duration:c.breakDuration*60}:{kind:'level',number:0,sb:Math.min(last.sb*2,50000000),bb:Math.min(last.bb*2,100000000),ante:c.ante?Math.min(last.bb*2,100000000):0,duration:last.duration});
    }
    autoOptions=null;drawRows();$('#structure-error').hidden=true;
    $('#structure-editor-note').textContent=message.includes('удалён')?message:'Ручная структура: изменения применятся после сохранения. Стрелки ↑ ↓ перемещают только перерывы.';
    $('#structure-move-status').textContent=message;
    if(movedTo!==null) {
      const movedButton=$(`[data-move-level="${movedTo}"][data-direction="${button.dataset.direction}"]`);
      movedButton.focus({preventScroll:true});movedButton.closest('.level-editor-row').scrollIntoView({block:'nearest'});
    }
  });
  $('#modal-form').oninput=event=>{
    if(event.target.closest('.level-editor')) {autoOptions=null;$('#structure-editor-note').textContent='Ручная структура: изменения применятся после сохранения.';}
    $('#structure-error').hidden=true;
  };
}

document.addEventListener('input', event=>{
  const el=event.target;
  if(el.hasAttribute('data-number') && !checkNumber(el)) return;
  if(el.id==='roster-query'||el.id==='roster-table') {
    rosterQuery=$('#roster-query').value;rosterTable=Number($('#roster-table').value);
    $('#roster-list').innerHTML=rosterItems(state.game);$('#roster-summary').innerHTML=rosterSummary(state.game);return;
  }
  if(el.closest('#settings-form') && el.name) {
    const name=el.name;
    if(name==='prizeCount') return;
    if(name.startsWith('prize-')) state.config.prizes[Number(name.split('-')[1])]=Number(el.value);
    else state.config[name]=el.type==='checkbox'?el.checked:el.hasAttribute('data-number')||(el.tagName==='SELECT'&&name!=='bountyMode')?Number(el.value):el.value;
    if(['sb','bb'].includes(name) && state.autoStructure) state.autoStructure.autoBlinds=false;
    if(name==='stack') {
      try { syncOpeningBlinds(); } catch { /* Validate when the input is complete. */ }
      for(const key of ['sb','bb']) $(`#settings-form [name="${key}"]`).value=state.config[key];
    }
    if(state.levels) {
      if(['sb','bb'].includes(name)) state.levels[0][name]=state.config[name];
      if(name==='ante') state.levels.forEach(l=>{if(l.kind==='level')l.ante=state.config.ante?l.bb:0;});
    }
    $('#summary').innerHTML=summaryView();
    if($('#structure-label')) $('#structure-label').textContent=structureLabel();
    if($('#structure-hint')) $('#structure-hint').textContent=structureHint();
    if ($('#table-plan')) $('#table-plan').textContent=planDescription();
    if($('#prize-total')) {const total=state.config.prizes.reduce((a,b)=>a+b,0);$('#prize-total').textContent=`Всего ${total}% из 100%`;$('#prize-total').classList.toggle('error',total!==100);}
    store();
  }
  if(el.dataset.seat!==undefined){const i=Number(el.dataset.seat);state.seats[i].name=el.value;state.seats[i].id=uid();const query=el.value.toLocaleLowerCase().trim();const matches=query?state.library.filter(p=>`${p.name} ${p.nick}`.toLocaleLowerCase().includes(query)).slice(0,5):[];$(`#suggest-${i}`).innerHTML=matches.map(p=>`<button type="button" data-action="suggest" data-id="${p.id}" data-seat="${i}"><strong>${escape(p.name)}</strong><small>${escape(p.nick)}</small></button>`).join('');$('#table-visual').innerHTML=tableVisual();$('.filled-pill').textContent=`${state.seats.filter(p=>p.name.trim()||p.nick?.trim()).length} / ${state.config.seats} мест занято`;store();}
  if(el.dataset.nick!==undefined){state.seats[Number(el.dataset.nick)].nick=el.value;$('#table-visual').innerHTML=tableVisual();$('.filled-pill').textContent=`${state.seats.filter(p=>p.name.trim()||p.nick?.trim()).length} / ${state.config.seats} мест занято`;store();}
});
document.addEventListener('beforeinput',event=>{
  if(event.target.matches('[data-number]')&&event.data&&/[^0-9]/.test(event.data)) {event.preventDefault();toast('В этом поле допустимы только целые числа без знаков и дробей');}
});
document.addEventListener('paste',event=>{
  const el=event.target;if(!el.matches('[data-number]'))return;
  const text=event.clipboardData.getData('text').replace(/\s/g,'');
  event.preventDefault();
  if(!/^\d+$/.test(text))return toast('Вставьте целое число без знаков и дробной части');
  el.setRangeText(text,el.selectionStart,el.selectionEnd,'end');el.dispatchEvent(new Event('input',{bubbles:true}));
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
  if(event.target.id==='settings-form'){event.preventDefault();if(!checkForm(event.target))return;const error=setupError();if(error)return toast(error);go('seating');}
  if(event.target.id==='seating-form'){event.preventDefault();if(!checkForm(event.target))return;if(state.game)go('board');else begin();}
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button||button.disabled)return;
  const boardMenu=button.closest('.board-actions-menu');
  if(boardMenu){boardMenu.removeAttribute('open');boardMenu.querySelector('summary').focus();}
  const action=button.dataset.action,g=state.game;
  if(!g&&['structure','structure-planner','nav'].includes(action)&&!checkForm($('#settings-form')))return;
  if(action==='close')return $('#modal').close();
  if(action==='archives')return showArchives();
  if(action==='home'){event.preventDefault();return go(g?'board':'settings');}
  if(action==='nav'){if(button.dataset.step==='seating'&&!g){const error=setupError();if(error)return toast(error);}return go(button.dataset.step);}
  if(action==='mode'){state.config.mode=button.dataset.mode;try{syncOpeningBlinds();}catch{/* Keep incomplete settings editable. */}store();return render();}
  if(action==='structure-planner')return showStructurePlanner();
  if(action==='structure')return showStructure();
  if(action==='players'){playersVisible=!playersVisible;render();if(playersVisible)$('#players-panel').scrollIntoView({behavior:'smooth',block:'start'});return;}
  if(action==='select-table'){selectedTable=Number(button.dataset.table);$('#table-visual').innerHTML=tableVisual();return;}
  if(action==='rotate-table'){const capacity=(g?.config||state.config).tableCapacity;state.tableRotations||={};state.tableRotations[selectedTable]=((state.tableRotations[selectedTable]||0)+Number(button.dataset.direction)+capacity)%capacity;store();$('#table-visual').innerHTML=tableVisual();document.querySelector(`[data-action="rotate-table"][data-direction="${button.dataset.direction}"]`).focus({preventScroll:true});return;}
  if(action==='shuffle'){for(let i=state.seats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[state.seats[i],state.seats[j]]=[state.seats[j],state.seats[i]];}store();return render();}
  if(action==='suggest'){const p=state.library.find(p=>p.id===button.dataset.id);state.seats[Number(button.dataset.seat)]={...p};store();return render();}
  if(action==='demo'){state.tableRotations={};state.config=defaults();state.seats=['Александр','Михаил','Анна','Дмитрий','Мария','Артём'].map((name,i)=>({id:uid(),name,nick:['Alex','Misha','Anna','Dima','Mary','Art'][i]}));delete state.levels;delete state.autoStructure;state.game=createGame(state.config,levels(),state.seats);state.game.remaining=17*60+42;clearUndo();reviewBoard=false;rosterQuery='';rosterTable=0;return go('board');}
  if(action==='new')return modal('Новая игра', '<p>Текущая игра сохранится в архиве. Сохранённые имена останутся в вашей компании.</p>', 'Создать игру', ()=>{state.tableRotations={};state.game=null;resultDetails='payouts';clearUndo();playersVisible=false;reviewBoard=false;rosterQuery='';rosterTable=0;delete state.levels;delete state.autoStructure;go('settings');});
  if(action==='sound'){state.sound=!state.sound;store();if(state.sound)beep();return render();}
  if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полноэкранный режим недоступен в этом браузере');}return;}
  if(!g)return;
  if(action==='roster-eliminated'||action==='roster-all') {
    rosterTable=action==='roster-eliminated'?-1:0;rosterQuery='';render();
    $('#roster-table').focus({preventScroll:true});return;
  }
  if(action==='result-detail'&&g.finished) {
    resultDetails=button.dataset.view==='statistics'?'statistics':'payouts';
    document.querySelectorAll('[data-action="result-detail"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.view===resultDetails)));
    const result=gameResults(g);$('#result-detail').innerHTML=resultDetails==='statistics'?resultStatistics(g,result):resultPayments(g,result);return;
  }
  if(action==='export-results') {
    try {
      const result=exportGameResults(g);
      const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\n'],{type:'application/json;charset=utf-8'}));
      const link=document.createElement('a');
      link.href=url;link.download=`until-morning-results-${(result.finishedAt||new Date().toISOString()).slice(0,10)}.json`;
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    } catch(error) {toast(error.message);}
    return;
  }
  if(action==='results'){reviewBoard=false;return render();}
  if(action==='review-board'){reviewBoard=true;return render();}
  if(action==='manage-tables')return showTableManagement();
  if(action==='register-player')return showRegistration();
  if(action==='play'){if(state.sound){try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();}catch{}}toggleClock(g);store();return render();}
  if(action==='freezeout')return showFreezeout(g);
  if(action==='extend-level') {
    advanceClock(g);const index=g.index;
    return modal('Добавить время',`${numeric('Продлить текущий уровень на','minutes',5,'мин',1,180)}<p class="field-hint">Блайнды сохранятся. Если таймер на паузе или расписание закончилось, запустите его после продления.</p>`,'Добавить время',data=>{
      const before=structuredClone(g);extendLevel(g,Number(data.get('minutes')),Date.now(),index);saveUndo(before,'clock');store();render();toast('Время добавлено',true);
    });
  }
  if(action==='finish')return modal('Окончить турнир?',`<p>Таймер остановится и откроется экран итогов.</p><p class="field-hint">В игре ${g.players.filter(p=>p.active).length} участников. Незанятые места и награды за оставшиеся головы не будут назначены автоматически. Завершение можно отменить.</p>`,'Окончить турнир',()=>{const before=structuredClone(g);if(finishGame(g)){saveUndo(before);reviewBoard=false;store();render();}});
  if(action==='next'||action==='prev')return modal(action==='next'?'Следующий уровень?':'Предыдущий уровень?', '<p>Таймер выбранного уровня начнётся с полной длительности.</p>', 'Переключить',()=>{jumpLevel(g,g.index+(action==='next'?1:-1));store();render();});
  if(action==='undo'){if(undoAction(state)){reviewBoard=false;syncGameSetup();undo=actionHistory(state).at(-1)?.game||null;store();render();toast(`Действие отменено${undo?` · ещё доступно: ${state.undoHistory.length}`:''}`,Boolean(undo));}return;}
  const p=g.players.find(p=>p.id===button.dataset.id);if(!p)return;
  if(action==='reentry'&&!p.active&&g.config.reentry) return reenterPlayer(g,p);
  if(!p.active||g.finished)return;
  if(action==='bust'&&g.config.bountyMode==='off') { saveUndo();eliminate(g,p.id);store();render();toast(`${nameOf(p)} · выбыл`,true);return; }
  if(action==='bust')return showKnockout(g,p);
  if(action==='addon'&&g.config.mode==='tournament') {
    saveUndo();addEntry(g,p.id,'addon');store();render();toast(`${nameOf(p)} · аддон +${money(g.config.addonCost)}`,true);return;
  }
  if(action==='cashin'&&g.config.mode==='cash')return modal('Добавить вход',numeric('Сумма входа','amount',g.config.buyin,'₽',1,10000000),'Добавить', data=>{
    const amount=Number(data.get('amount')),before=structuredClone(g);
    addCashEntry(g,p.id,amount);saveUndo(before);store();render();toast(`${nameOf(p)} · вход +${money(amount)}`,true);
  });
  if(action==='cashout') {
    const available=poolOf(g)-g.players.reduce((sum,p)=>sum+(p.cashout??0),0);
    const initial=g.players.filter(p=>p.active).length===1?available:Math.min(p.invested,available);
    return modal(`Выход · ${escape(nameOf(p))}`,`${numeric('Сумма на выходе','amount',initial,'₽',0,available)}<p class="field-hint">Всего внесено ${money(p.invested)}. Укажите денежную стоимость оставшихся фишек.</p>`,'Записать выход',data=>{
      const before=structuredClone(g);cashOut(g,p.id,Number(data.get('amount')));saveUndo(before);if(g.finished)reviewBoard=false;store();render();
    });
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){tick();store();flush();}});
document.addEventListener('keydown',event=>{
  const menu=$('.board-actions-menu[open]');
  if(event.key==='Escape'&&menu){event.preventDefault();menu.removeAttribute('open');menu.querySelector('summary').focus();}
});
document.addEventListener('focusin',event=>{
  const menu=$('.board-actions-menu[open]');
  if(menu&&!menu.contains(event.target))menu.removeAttribute('open');
});
document.addEventListener('click',event=>{
  const menu=$('.board-actions-menu[open]');
  if(menu&&!menu.contains(event.target))menu.removeAttribute('open');
});
document.addEventListener('click',event=>{document.querySelectorAll('.player-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.removeAttribute('open');});if(!event.target.closest('.game-menu'))document.querySelector('.game-menu')?.removeAttribute('open');if(!event.target.closest('.name-field'))document.querySelectorAll('.suggestions').forEach(el=>el.innerHTML='');});
setInterval(tick,250);
setInterval(()=>{if(state.game?.running)store();},5000);
if(state.game)advanceClock(state.game);
render();
if (pendingSave) flush();
if (recoveryMessage) toast(recoveryMessage);
