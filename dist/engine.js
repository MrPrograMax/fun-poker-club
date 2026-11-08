export const defaults = () => ({
  name: 'Покер с друзьями', mode: 'tournament', stack: 10000, sb: 25, bb: 50,
  duration: 20, buyin: 1000, seats: 6, tableCapacity: 10, prizes: [50, 30, 20],
  breakEvery: 4, breakDuration: 10, ante: false, freezeoutAfterBreak: 0,
  reentry: true, addonCost: 500, addonStack: 5000,
  bountyMode: 'off', bountyAmount: 200, bountyImmediate: 50,
});

export const MAX_PLAYERS = 200;
export const MAX_STRUCTURE_ROWS = 100;

export function wholeNumber(value, min, max, label = 'Значение') {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error(`${label}: введите целое число без знаков и дробной части`);
  const number = Number(text);
  if (number < min || number > max) throw new Error(`${label}: от ${min.toLocaleString('ru-RU')} до ${max.toLocaleString('ru-RU')}`);
  return number;
}

export function validateProfile({ name = '', nick = '' } = {}) {
  name = String(name).trim().replace(/\s+/g, ' '); nick = String(nick).trim();
  if (!name && !nick) return 'Укажите имя или ник игрока';
  if (name.length > 60) return 'Имя: не больше 60 символов';
  if (name && !/^[\p{L}\p{M}]+(?:[ \p{Pd}'’][\p{L}\p{M}]+)*$/u.test(name)) return 'В имени допустимы буквы, пробелы, дефисы и апострофы. Для цифр используйте поле «Ник»';
  if (nick.length > 24) return 'Ник: не больше 24 символов';
  return '';
}

export function filterPlayers(players, { query = '', table = 0, activeOnly = false, excludeId = null, includeLastTable = false } = {}) {
  const words = playerNameKey(query).split(' ').filter(Boolean);
  return players.filter(p => {
    // The roster keeps reentry available after elimination frees the seat.
    const playerTable = p.table ?? (includeLastTable && !p.active ? p.lastTable : null);
    return (!table || (Number(table) === -1 ? !p.active : playerTable === Number(table))) && (!activeOnly || p.active) && p.id !== excludeId && words.every(word => playerNameKey(`${p.name} ${p.nick || ''}`).includes(word));
  });
}

export function seatingDescription(count, capacity) {
  const groups = new Map();
  for (const size of seatingPlan(count, capacity)) groups.set(size, (groups.get(size) || 0) + 1);
  const plural = (n, forms) => forms[n % 100 >= 11 && n % 100 <= 14 ? 2 : n % 10 === 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 ? 1 : 2];
  return [...groups].map(([size, tables]) => `${tables} ${plural(tables, ['стол', 'стола', 'столов'])} по ${size} ${plural(size, ['игроку', 'игрока', 'игроков'])}`).join(', ') || 'Проверьте количество игроков';
}

export function validateStructure(rows, freezeoutAfterBreak = 0) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_STRUCTURE_ROWS) return `Структура: от 1 до ${MAX_STRUCTURE_ROWS} уровней и перерывов`;
  if (rows[0].kind !== 'level' || rows.at(-1).kind !== 'level') return 'Первой и последней строкой структуры должен быть игровой уровень';
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i];
    if (!['level', 'break'].includes(l.kind) || !Number.isInteger(l.duration / 60) || l.duration < 60 || l.duration > 10800) return `Строка ${i + 1}: длительность от 1 до 180 целых минут`;
    if (l.kind === 'level' && (![l.sb, l.bb].every(n => Number.isInteger(n) && n >= 1 && n <= 100000000) || l.sb >= l.bb)) return `Уровень ${l.number}: целые блайнды от 1 до 100 000 000, ББ больше МБ`;
    if (l.kind === 'level' && (!Number.isInteger(l.ante ?? 0) || (l.ante ?? 0) < 0 || (l.ante ?? 0) > 100000000)) return `Уровень ${l.number}: проверьте анте`;
  }
  if (!Number.isInteger(freezeoutAfterBreak) || freezeoutAfterBreak < 0 || freezeoutAfterBreak > rows.filter(l => l.kind === 'break').length) return 'Выбранный перерыв для фризаута отсутствует в структуре';
  return '';
}

export function seatingPlan(playerCount, tableCapacity = 10) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > MAX_PLAYERS ||
      !Number.isInteger(tableCapacity) || tableCapacity < 2 || tableCapacity > 10) return [];
  const tables = Math.ceil(playerCount / tableCapacity);
  const perTable = Math.floor(playerCount / tables);
  return Array.from({ length: tables }, (_, i) => perTable + (i < playerCount % tables ? 1 : 0));
}

export function seatPlayers(players, tableCapacity = 10) {
  let offset = 0;
  return seatingPlan(players.length, tableCapacity).flatMap((count, tableIndex) =>
    Array.from({ length: count }, (_, seatIndex) => ({
      ...players[offset++], table: tableIndex + 1, seat: seatIndex + 1,
    })));
}

export function gameTableNumbers(game) {
  return [...new Set(game.players.filter(p => (!game.seatingManaged || p.active) && p.table > 0).map(p => p.table))].sort((a,b) => a-b);
}

function vacateSeat(player) {
  if (player.table != null) { player.lastTable = player.table; player.lastSeat = player.seat; }
  player.table = null; player.seat = null;
}

export function planTableBalance(game) {
  if (game.config.mode !== 'tournament' || game.finished) throw new Error('Рассадка доступна только в текущем турнире');
  const active = game.players.filter(p => p.active), capacity = game.config.tableCapacity;
  if (active.length < 2) throw new Error('Для рассадки нужны хотя бы два активных игрока');
  const current = gameTableNumbers(game).map(table => ({ table, players: active.filter(p => p.table === table).sort((a,b) => a.seat-b.seat) }));
  const count = Math.ceil(active.length / capacity), base = Math.floor(active.length / count), extra = active.length % count;
  const targets = current.slice().sort((a,b) => b.players.length-a.players.length || a.table-b.table).slice(0,count);
  let nextTable = Math.max(0,...current.map(t => t.table)) + 1;
  while (targets.length < count) targets.push({ table: nextTable++, players: [] });
  // Keep the fullest tables. Assign spare places where they avoid an extra move;
  // otherwise fill the smaller tables first, leaving full tables untouched.
  const extraTables = new Set(targets.slice().sort((a,b) =>
    Number(b.players.length > base)-Number(a.players.length > base) ||
    (a.players.length > base ? b.players.length-a.players.length : a.players.length-b.players.length) || a.table-b.table
  ).slice(0,extra).map(t => t.table));
  const assignments = new Map(), tables = targets.map(t => ({ table:t.table, count:base+Number(extraTables.has(t.table)) })).sort((a,b) => a.table-b.table);
  for (const table of tables) {
    const occupied = new Set();
    for (const player of active.filter(p => p.table === table.table).sort((a,b) => a.seat-b.seat)) {
      if (occupied.size >= table.count || !Number.isInteger(player.seat) || player.seat < 1 || player.seat > capacity || occupied.has(player.seat)) continue;
      occupied.add(player.seat);
      assignments.set(player.id,{playerId:player.id,fromTable:player.table,fromSeat:player.seat,table:player.table,seat:player.seat});
    }
  }
  const moving = active.filter(p => !assignments.has(p.id)).sort((a,b) => a.table-b.table || a.seat-b.seat);
  for (const table of tables) {
    const occupied = new Set([...assignments.values()].filter(p => p.table === table.table).map(p => p.seat));
    for (let seat = 1; occupied.size < table.count; seat++) {
      if (occupied.has(seat)) continue;
      const player = moving.shift();
      assignments.set(player.id,{playerId:player.id,fromTable:player.table,fromSeat:player.seat,table:table.table,seat});
      occupied.add(seat);
    }
  }
  const seats = [...assignments.values()].sort((a,b) => a.table-b.table || a.seat-b.seat);
  const moves = seats.filter(p => p.fromTable !== p.table || p.fromSeat !== p.seat);
  const closedTables = current.filter(t => !tables.some(next => next.table === t.table)).map(t => t.table);
  return {activeCount:active.length,capacity,current:current.map(t => ({table:t.table,count:t.players.length})),tables,assignments:seats,moves,closedTables,final:tables.length===1,needsChange:moves.length>0||closedTables.length>0};
}

export function rebalanceTables(game, now = Date.now(), expectedPlan = null) {
  const plan = planTableBalance(game);
  if (expectedPlan && JSON.stringify(plan) !== JSON.stringify(expectedPlan)) throw new Error('Состав столов изменился. Откройте рассадку заново');
  if (!plan.needsChange) return null;
  const next = structuredClone(game);
  advanceClock(next,now);
  next.seatingManaged = true;
  for (const player of next.players) {
    if (!player.active) { vacateSeat(player); continue; }
    const seat = plan.assignments.find(p => p.playerId === player.id);
    player.table = seat.table; player.seat = seat.seat;
  }
  recordEvent(next,{type:'tables',tables:plan.tables,closedTables:plan.closedTables,moves:plan.moves},now);
  Object.assign(game,next);
  return plan;
}

export function makeLevels(config) {
  const multipliers = [1, 2, 3, 4, 6, 8, 12, 16, 20, 30, 40, 60];
  const levels = [];
  multipliers.forEach((multiplier, index) => {
    if (index > 0 && config.breakEvery > 0 && index % config.breakEvery === 0) {
      levels.push({ kind: 'break', duration: config.breakDuration * 60 });
    }
    levels.push({ kind: 'level', number: index + 1, sb: config.sb * multiplier, bb: config.bb * multiplier, ante: config.ante ? config.bb * multiplier : 0, duration: config.duration * 60 });
  });
  return levels;
}

export function recommendOpeningBlinds(stack, startDepth = 100) {
  if (!Number.isInteger(stack) || stack < 1 || stack > 10000000) throw new Error('Стартовый стек: от 1 до 10 000 000');
  if (!Number.isInteger(startDepth) || startDepth < 20 || startDepth > 500) throw new Error('Глубина стартового стека: от 20 до 500 ББ');
  const target = stack / startDepth / 2;
  let sb = 1;
  for (let magnitude = 1; magnitude <= 100000; magnitude *= 10) {
    for (const factor of [1, 2, 2.5, 5]) {
      const candidate = factor * magnitude;
      if (Number.isInteger(candidate) && Math.abs(Math.log(candidate / target)) < Math.abs(Math.log(sb / target))) sb = candidate;
    }
  }
  return { sb, bb: sb * 2 };
}

export function recommendStructure(config, { targetMinutes = 240, extraEntries = 0, addons = 0, autoBlinds = false, startDepth = 100 } = {}) {
  if (autoBlinds) config = { ...config, ...recommendOpeningBlinds(config.stack, startDepth) };
  const { stack, seats, sb, bb, duration, breakEvery, breakDuration, addonStack } = config;
  if (!Number.isInteger(targetMinutes) || targetMinutes < 30 || targetMinutes > 1440) throw new Error('Длительность турнира: от 30 до 1 440 минут');
  if (![extraEntries, addons].every(n => Number.isInteger(n) && n >= 0 && n <= 1000)) throw new Error('Ожидаемые докупки: от 0 до 1 000');
  if (!Number.isInteger(stack) || stack < 1 || stack > 10000000 || !Number.isInteger(seats) || seats < 2 || seats > MAX_PLAYERS) throw new Error('Проверьте стартовый стек и количество игроков в настройках');
  if (![sb, bb].every(n => Number.isInteger(n) && n > 0 && n <= 1000000) || sb >= bb) throw new Error('Проверьте стартовые блайнды в настройках');
  if (!Number.isInteger(duration) || duration < 1 || duration > 180 || !Number.isInteger(breakEvery) || breakEvery < 0 || breakEvery > 12 || !Number.isInteger(breakDuration) || breakDuration < 1 || breakDuration > 60) throw new Error('Проверьте длительность уровней и перерывов');
  if (addons && (!Number.isInteger(addonStack) || addonStack < 1 || addonStack > 10000000)) throw new Error('Проверьте количество фишек за аддон');
  const chips = stack * (seats + extraEntries) + (addons ? addons * addonStack : 0);
  // A planning heuristic, not a prediction: heads-up becomes shallow near 20 BB in all chips.
  const targetBB = Math.max(bb * 2, chips / 20);
  if (targetBB > 100000000) throw new Error('Слишком много фишек для автоподбора. Уменьшите стек или ожидаемые докупки');
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const unit = gcd(sb, bb), step = unit * 2;
  const candidates = new Set([bb]);
  for (let magnitude = 1; magnitude <= 100000000; magnitude *= 10) {
    for (const factor of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8]) {
      const value = Math.round(factor * magnitude / step) * step;
      if (value > bb && value <= 100000000) candidates.add(value);
    }
  }
  const ladder = [...candidates].sort((a, b) => a - b);
  const last = ladder.findIndex(value => value >= targetBB);
  if (last < 1) throw new Error('Не удалось подобрать финальные блайнды');
  ladder.length = last + 1;
  let best;
  for (let count = 2; count <= Math.min(60, ladder.length); count++) {
    const breaks = breakEvery ? Math.floor((count - 1) / breakEvery) : 0;
    const playingMinutes = targetMinutes - breaks * breakDuration;
    if (playingMinutes < count || playingMinutes > count * 180) continue;
    const score = Math.abs(playingMinutes / count - duration);
    if (!best || score < best.score) best = { count, breaks, playingMinutes, score };
  }
  if (!best) throw new Error('Такое время не помещается в структуру. Измените длительность турнира или перерывов');
  const levels = [], selected = [bb];
  let previous = 0;
  for (let i = 1; i < best.count; i++) {
    const target = bb * (ladder.at(-1) / bb) ** (i / (best.count - 1));
    const limit = ladder.length - (best.count - i);
    let chosen = previous + 1;
    for (let j = chosen; j <= limit; j++) {
      if (Math.abs(Math.log(ladder[j] / target)) < Math.abs(Math.log(ladder[chosen] / target))) chosen = j;
    }
    selected.push(ladder[chosen]);
    previous = chosen;
  }
  selected.forEach((big, i) => {
    if (i && breakEvery && i % breakEvery === 0) levels.push({ kind: 'break', duration: breakDuration * 60 });
    const minutes = Math.floor(best.playingMinutes / best.count) + (i < best.playingMinutes % best.count ? 1 : 0);
    levels.push({ kind: 'level', number: i + 1, sb: i ? big / 2 : sb, bb: big, ante: config.ante ? big : 0, duration: minutes * 60 });
  });
  return { levels, chips, targetMinutes, playingMinutes: best.playingMinutes, breakMinutes: best.breaks * breakDuration,
    startSB: sb, startBB: bb, startDepth: stack / bb, finalBB: selected.at(-1), maxIncrease: Math.max(...selected.slice(1).map((value, i) => value / selected[i])) };
}

// Largest-remainder allocation keeps the total exact, even for odd prize pools.
export function payouts(pool, percentages) {
  const raw = percentages.map(p => pool * p / 100);
  const result = raw.map(Math.floor);
  let remainder = pool - result.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, fraction: v - result[i] })).sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder && order.length; i++) result[order[i % order.length].i]++;
  return result;
}

export function validateConfig(c) {
  if (!c.name.trim()) return 'Укажите название игры';
  if (!Number.isInteger(c.stack) || c.stack < 1 || c.stack > 10000000) return 'Стартовый стек: от 1 до 10 000 000';
  if (![c.sb, c.bb].every(v => Number.isInteger(v) && v > 0 && v <= 1000000) || c.sb >= c.bb) return 'Большой блайнд должен быть больше малого';
  if (!Number.isInteger(c.buyin) || c.buyin < 1 || c.buyin > 10000000) return 'Взнос: от 1 до 10 000 000 ₽';
  if (!Number.isInteger(c.seats) || c.seats < 2 || c.seats > MAX_PLAYERS) return `Количество игроков: от 2 до ${MAX_PLAYERS}`;
  if (!Number.isInteger(c.tableCapacity) || c.tableCapacity < 2 || c.tableCapacity > 10) return 'Вместимость одного стола: от 2 до 10 игроков';
  if (c.mode === 'tournament') {
    if (!Number.isInteger(c.duration) || c.duration < 1 || c.duration > 180) return 'Укажите длительность уровня от 1 до 180 минут';
    if (c.prizes.some(p => !Number.isInteger(p) || p <= 0) || c.prizes.reduce((a, b) => a + b, 0) !== 100) return 'Призовые: целые проценты с суммой 100%';
    if (c.prizes.length > c.seats) return 'Призовых мест не может быть больше, чем игроков';
    if (![c.addonCost, c.addonStack].every(n => Number.isInteger(n) && n >= 1 && n <= 10000000)) return 'Стоимость и стек аддона: целые числа от 1 до 10 000 000';
    if (!Number.isInteger(c.freezeoutAfterBreak ?? 0) || (c.freezeoutAfterBreak ?? 0) < 0 || (c.freezeoutAfterBreak ?? 0) > MAX_STRUCTURE_ROWS) return 'Проверьте начало фризаута';
    if (!['off','fixed','progressive'].includes(c.bountyMode)) return 'Выберите режим баунти';
    if (c.bountyMode !== 'off' && (!Number.isInteger(c.bountyAmount) || c.bountyAmount < 1 || c.bountyAmount >= c.buyin)) return 'Баунти должно быть меньше первого взноса';
    if (c.bountyMode === 'progressive' && (!Number.isInteger(c.bountyImmediate) || c.bountyImmediate < 1 || c.bountyImmediate > 99)) return 'Сразу выплачивается от 1 до 99% прогрессивного баунти';
    if (!Number.isInteger(c.breakEvery) || c.breakEvery < 0 || c.breakEvery > 12 || !Number.isInteger(c.breakDuration) || c.breakDuration < 1 || c.breakDuration > 60) return 'Проверьте настройки перерывов';
  }
  return '';
}

export function poolOf(game) { return game.players.reduce((sum, p) => sum + (game.config.mode === 'cash' ? p.invested : p.mainContribution ?? p.invested), 0); }
export function bountyPoolOf(game) { return game.players.reduce((sum,p)=>sum+(p.bountyPaid||0),0); }
export function normalizeGame(game) {
  game.config = { ...defaults(), ...game.config };
  delete game.config.addonLimit;
  game.freezeout ??= null;
  game.finishedAt ??= null;
  game.completionReason ??= game.finished ? 'recorded' : null;
  if (game.players.some(p => (!game.seatingManaged || p.active) && (!Number.isInteger(p.table) || p.table < 1))) {
    game.players = seatPlayers(game.players, game.config.tableCapacity);
  }
  game.eliminationOrder ||= game.players.filter(p=>p.place>1).sort((a,b)=>b.place-a.place).map(p=>p.id);
  game.events ||= [];
  for (const p of game.players) {
    p.mainContribution ??= p.invested; p.bountyPaid ??= 0; p.bounty ??= 0; p.earnedBounty ??= 0;
    p.knockouts ??= 0; p.rebuys ??= p.entries-1; p.reentries ??= 0; p.addons ??= 0;
    if (game.seatingManaged && !p.active) vacateSeat(p);
  }
  return game;
}

function firstEntry(config, player) {
  const bounty = config.mode === 'tournament' && config.bountyMode !== 'off' ? config.bountyAmount : 0;
  return { ...player, active: true, invested: config.buyin, mainContribution: config.buyin-bounty, bountyPaid: bounty, bounty, earnedBounty: 0, knockouts: 0, rebuys: 0, reentries: 0, addons: 0, entries: 1, cashout: null, place: null };
}

export function createGame(config, levels, players, now = Date.now()) {
  if (config.mode === 'tournament') {
    const error = validateStructure(levels, config.freezeoutAfterBreak ?? 0);
    if (error) throw new Error(error);
  }
  return {
    config: structuredClone(config), levels: structuredClone(levels),
    players: seatPlayers(players, config.tableCapacity).map(p => firstEntry(config, p)),
    index: 0, remaining: levels[0].duration, elapsed: 0, running: false,
    deadline: null, lastTick: now, finished: false, structureEnded: false,
    eliminationOrder: [], events: [], winnerBounty: null, freezeout: null, finishedAt: null, completionReason: null,
  };
}

export const playerNameKey = name => String(name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

export function registrationTables(game) {
  const capacity = game.config.tableCapacity;
  const numbers = gameTableNumbers(game);
  const next = Math.max(0, ...numbers) + 1;
  return [...numbers, next].map(table => ({
    table, isNew: table === next,
    // Before the first redistribution, preserve the original re-entry seats.
    seats: Array.from({length:capacity}, (_,i) => i+1).filter(seat => !game.players.some(p => (!game.seatingManaged || p.active) && p.table === table && p.seat === seat)),
  }));
}

export function registerPlayer(game, profile, placement = null, now = Date.now()) {
  if (game.finished) throw new Error('Игра уже завершена');
  if (game.players.length >= MAX_PLAYERS) throw new Error(`В игре уже ${MAX_PLAYERS} игроков`);
  const name = String(profile?.name ?? '').trim().replace(/\s+/g, ' ');
  const nick = String(profile?.nick ?? '').trim();
  const profileError = validateProfile({ name, nick });
  if (profileError) throw new Error(profileError);
  if (typeof profile?.id !== 'string' || !profile.id.trim()) throw new Error('Не указан идентификатор игрока');
  if (game.players.some(p => p.id === profile.id || playerNameKey(p.name || p.nick) === playerNameKey(name || nick))) {
    throw new Error(game.config.mode === 'cash' ? 'Этот игрок уже зарегистрирован. Добавьте вход в его карточке.' : 'Этот игрок уже зарегистрирован. Для возвращения используйте ре-энтри в его карточке.');
  }
  const tables = registrationTables(game);
  const suggested = tables.filter(t => t.seats.length && !t.isNew).sort((a,b) => b.seats.length-a.seats.length || a.table-b.table)[0] || tables.at(-1);
  const { table, seat } = placement ?? { table:suggested.table, seat:suggested.seats[0] };
  if (!Number.isInteger(table) || !Number.isInteger(seat) || !tables.some(t => t.table === table && t.seats.includes(seat))) {
    throw new Error('Выберите свободное место за столом');
  }
  advanceClock(game, now);
  const player = firstEntry(game.config, { id:profile.id, name, nick, table, seat });
  game.players.push(player);
  game.config.seats = game.players.length;
  if (game.config.mode === 'tournament') updatePlaces(game);
  recordEvent(game, { type:'registration', playerId:player.id, amount:player.invested, bounty:player.bountyPaid, chips:game.config.stack, table, seat }, now);
  return player;
}

// Use wall-clock deadlines so throttled tabs and page reloads do not stretch levels.
export function advanceClock(game, now = Date.now()) {
  if (!game.running) return false;
  game.elapsed += Math.max(0, now - game.lastTick);
  game.lastTick = now;
  if (game.config.mode === 'cash') return false;
  let changed = false;
  while (now >= game.deadline && game.running) {
    if (game.index + 1 < game.levels.length) {
      const transitionAt = game.deadline;
      game.index++;
      game.deadline += game.levels[game.index].duration * 1000;
      applyScheduledFreezeout(game, transitionAt);
    } else {
      game.elapsed -= Math.max(0, now - game.deadline);
      game.running = false;
      game.structureEnded = true;
      game.remaining = 0;
    }
    changed = true;
  }
  if (game.running) game.remaining = Math.max(0, (game.deadline - now) / 1000);
  return changed;
}

export function toggleClock(game, now = Date.now()) {
  if (game.finished || game.structureEnded) return;
  advanceClock(game, now);
  if (game.structureEnded) return;
  game.running = !game.running;
  game.lastTick = now;
  game.deadline = game.running && game.config.mode === 'tournament' ? now + game.remaining * 1000 : null;
}

export function jumpLevel(game, index, now = Date.now()) {
  if (index < 0 || index >= game.levels.length || game.finished) return;
  advanceClock(game, now);
  game.index = index;
  game.structureEnded = false;
  game.remaining = game.levels[index].duration;
  game.lastTick = now;
  game.deadline = game.running ? now + game.remaining * 1000 : null;
  applyScheduledFreezeout(game, now);
}

export function restoreAction(game, snapshot, now = Date.now(), kind = 'operation') {
  if (kind === 'clock' || (game.freezeout && !game.freezeout.automatic && !snapshot.freezeout)) {
    const restored = normalizeGame(structuredClone(snapshot));
    advanceClock(restored, now);
    return restored;
  }
  advanceClock(game, now);
  const restored = structuredClone(snapshot);
  restored.levels = structuredClone(game.levels);
  if (game.freezeout?.automatic && !restored.freezeout) {
    restored.freezeout = structuredClone(game.freezeout);
    const phaseEvent = game.events.find(e => e.type === 'freezeout' && e.automatic);
    if (phaseEvent) restored.events.push(structuredClone(phaseEvent));
  }
  // Revert the operation, while keeping the clock and level as the host left them.
  for (const key of ['index', 'remaining', 'elapsed', 'running', 'deadline', 'lastTick', 'structureEnded']) restored[key] = game[key];
  if (restored.finished) { restored.running = false; restored.deadline = null; }
  return normalizeGame(restored);
}

export const MAX_UNDO_STEPS = 50;
const HISTORY_STATE_BYTES = 900 * 1024;

export function actionHistory(state) {
  if (!Array.isArray(state.undoHistory)) {
    state.undoHistory = state.undo ? [{ game: state.undo, kind: state.undoKind || 'operation' }] : [];
  }
  delete state.undo; delete state.undoKind;
  return state.undoHistory;
}

export function rememberAction(state, snapshot = state.game, kind = 'operation') {
  const history = actionHistory(state);
  history.push({ game: structuredClone(snapshot), kind });
  if (history.length > MAX_UNDO_STEPS) history.splice(0, history.length - MAX_UNDO_STEPS);
  // Leave room below the server's 1 MiB limit, including large player libraries.
  while (history.length && new TextEncoder().encode(JSON.stringify(state)).byteLength > HISTORY_STATE_BYTES) history.shift();
}

export function undoAction(state, now = Date.now()) {
  const history = actionHistory(state), previous = history.at(-1);
  if (!previous || !state.game) return false;
  const restored = restoreAction(state.game, previous.game, now, previous.kind);
  history.pop(); state.game = restored;
  return true;
}

export function clearActionHistory(state) {
  state.undoHistory = [];
  delete state.undo; delete state.undoKind;
}

export function startFreezeout(game, now = Date.now(), { addonCost = game.config.addonCost, addonStack = game.config.addonStack } = {}) {
  if (game.config.mode !== 'tournament' || game.finished || game.structureEnded || game.freezeout) return false;
  if (![addonCost, addonStack].every(value => Number.isInteger(value) && value >= 1 && value <= 10000000)) throw new Error('Стоимость и фишки аддона: целые числа от 1 до 10 000 000');
  advanceClock(game, now);
  if (game.structureEnded || game.freezeout) return false;
  let index = game.index;
  while (index < game.levels.length && game.levels[index].kind !== 'level') index++;
  if (index === game.levels.length) return false;
  game.index = index;
  game.remaining = game.levels[index].duration;
  game.running = true;
  game.lastTick = now;
  game.deadline = now + game.remaining * 1000;
  game.config.addonCost = addonCost;
  game.config.addonStack = addonStack;
  game.freezeout = { startedAt: now, level: game.levels[index].number };
  recordEvent(game, { type: 'freezeout', level: game.levels[index].number, addonCost, addonStack }, now);
  return true;
}

export function eliminate(game, id, now = Date.now(), killerId = null, { allowOtherTable = false } = {}) {
  const player = game.players.find(p => p.id === id);
  if (!player?.active || game.finished) return;
  const killer = game.config.bountyMode === 'off' ? null : game.players.find(p=>p.id===killerId && p.active && p.id!==id);
  if (game.config.bountyMode !== 'off' && !killer) throw new Error('Выберите игрока, который выбил участника');
  if (killer && killer.table !== player.table && !allowOtherTable) throw new Error('Игрок за другим столом. Уточните стол выбившего');
  advanceClock(game, now);
  if (killer) {
    killer.knockouts++;
    const immediate = game.config.bountyMode === 'progressive' ? Math.floor(player.bounty*game.config.bountyImmediate/100) : player.bounty;
    killer.earnedBounty += immediate;
    killer.bounty += player.bounty-immediate;
    recordEvent(game, {type:'knockout',playerId:id,killerId,amount:immediate,carried:player.bounty-immediate},now);
    player.bounty=0;
  } else recordEvent(game,{type:'knockout',playerId:id,killerId:null,amount:0,carried:0},now);
  player.active = false;
  if (game.seatingManaged) vacateSeat(player);
  game.eliminationOrder.push(id);
  updatePlaces(game);
  const alive = game.players.filter(p => p.active);
  if (alive.length === 1) {
    alive[0].place = 1;
    game.finished = true;
    game.finishedAt = now;
    game.completionReason = 'elimination';
    game.running = false;
    game.deadline = null;
    const winner=alive[0];
    game.winnerBounty={playerId:winner.id,amount:winner.bounty};
    winner.earnedBounty+=winner.bounty;
    winner.bounty=0;
  }
}

function updatePlaces(game) {
  game.players.forEach(p=>p.place=null);
  game.eliminationOrder.forEach((id,i)=>{ const p=game.players.find(p=>p.id===id); if(p)p.place=game.players.length-i; });
}
function recordEvent(game,event,now=Date.now()) {
  game.events.push({...event,at:now});
  if(game.events.length>200)game.events.shift();
}
export function addEntry(game,id,type,now=Date.now()) {
  const p=game.players.find(p=>p.id===id);
  if(!p || game.config.mode!=='tournament')throw new Error('Игрок не найден');
  if(game.finished && game.completionReason === 'manual') throw new Error('Сначала отмените завершение турнира');
  if(type==='reentry') {
    if(p.active || !game.config.reentry)throw new Error('Ре-энтри недоступен');
  } else if(!p.active || game.finished || type!=='addon')throw new Error('Докупка недоступна');
  let placement;
  if (type === 'reentry' && game.seatingManaged) {
    const tables = registrationTables(game);
    const table = tables.filter(t => t.seats.length && !t.isNew).sort((a,b) => b.seats.length-a.seats.length || a.table-b.table)[0] || tables.at(-1);
    placement = {table:table.table,seat:table.seats[0]};
  }
  advanceClock(game,now);
  const amount=type==='addon'?game.config.addonCost:game.config.buyin;
  // Re-entry restores a head from the contribution; add-ons stay in prizes.
  const bounty=type==='reentry'&&game.config.bountyMode!=='off'?game.config.bountyAmount:0;
  p.invested+=amount;
  p.mainContribution+=amount-bounty;
  p.bountyPaid+=bounty;
  p.bounty+=bounty;
  if(type==='reentry') {
    if(game.winnerBounty) {
      const winner=game.players.find(x=>x.id===game.winnerBounty.playerId);
      winner.earnedBounty-=game.winnerBounty.amount;
      winner.bounty+=game.winnerBounty.amount;
      game.winnerBounty=null;
    }
    p.active=true;p.reentries++;p.entries++;
    if (placement) Object.assign(p,placement);
    game.eliminationOrder=game.eliminationOrder.filter(x=>x!==id);
    game.finished=false;
    game.finishedAt=null;game.completionReason=null;
    updatePlaces(game);
  } else p.addons++;
  recordEvent(game,{type,playerId:id,amount,bounty,chips:type==='addon'?game.config.addonStack:game.config.stack},now);
}

export function formatTime(seconds, hours = false) {
  const value = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor(value / 60) % 60;
  const s = value % 60;
  return hours || h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function applyScheduledFreezeout(game, now) {
  if (game.config.mode !== 'tournament' || game.finished || game.freezeout || !game.config.freezeoutAfterBreak) return;
  let breaks = 0;
  const boundary = game.levels.findIndex(l => l.kind === 'break' && ++breaks === game.config.freezeoutAfterBreak);
  const next = game.levels.findIndex((l, i) => i > boundary && l.kind === 'level');
  if (boundary < 0 || next < 0 || game.index < next) return;
  game.freezeout = { startedAt: now, level: game.levels[next].number, automatic: true };
  recordEvent(game, { type: 'freezeout', level: game.freezeout.level, automatic: true, addonCost: game.config.addonCost, addonStack: game.config.addonStack }, now);
}

export function setAddonTerms(game, addonCost, addonStack, now = Date.now()) {
  if (game.finished || game.config.mode !== 'tournament') throw new Error('Условия аддона сейчас недоступны');
  if (![addonCost, addonStack].every(n => Number.isInteger(n) && n >= 1 && n <= 10000000)) throw new Error('Стоимость и фишки аддона: целые числа от 1 до 10 000 000');
  advanceClock(game, now);
  Object.assign(game.config, { addonCost, addonStack });
  recordEvent(game, { type: 'addon-terms', addonCost, addonStack }, now);
}

export function extendLevel(game, minutes, now = Date.now(), expectedIndex = game.index) {
  if (game.config.mode !== 'tournament' || game.finished) throw new Error('Продление уровня недоступно');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) throw new Error('Продление: от 1 до 180 целых минут');
  const next = structuredClone(game);
  advanceClock(next, now);
  if (next.index !== expectedIndex) throw new Error('Уровень уже сменился. Откройте продление ещё раз');
  const level = next.levels[next.index], seconds = minutes * 60;
  if (level.duration + seconds > 10800) throw new Error('Общая длительность уровня не должна превышать 180 минут');
  level.duration += seconds;
  next.remaining += seconds;
  next.structureEnded = false;
  next.lastTick = now;
  next.deadline = next.running ? now + next.remaining * 1000 : null;
  recordEvent(next, { type: 'extend', index: next.index, level: level.number, minutes }, now);
  Object.assign(game, next);
}

export function moveStructureRow(rows, from, to, freezeoutAfterBreak = 0, lockedThrough = -1) {
  if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < rows.length)) throw new Error('Строку нельзя переместить за пределы структуры');
  if (rows[from].kind !== 'break') throw new Error('Перемещать можно только перерывы');
  if (from <= lockedThrough || to <= lockedThrough) throw new Error('Перемещать можно только будущие перерывы, не затрагивая текущие и прошедшие строки');
  const scheduledBreak = rows.filter(l => l.kind === 'break')[freezeoutAfterBreak - 1];
  const reordered = rows.slice();
  reordered.splice(to, 0, reordered.splice(from, 1)[0]);
  let number = 0;
  return {
    rows: reordered.map(l => ({ ...l, ...(l.kind === 'level' ? { number: ++number } : {}) })),
    freezeoutAfterBreak: scheduledBreak ? reordered.filter(l => l.kind === 'break').indexOf(scheduledBreak) + 1 : freezeoutAfterBreak,
  };
}

export function editFutureStructure(game, rows, now = Date.now(), { freezeoutAfterBreak = game.config.freezeoutAfterBreak ?? 0 } = {}) {
  if (game.config.mode !== 'tournament' || game.finished) throw new Error('Изменение структуры недоступно');
  const error = validateStructure(rows, freezeoutAfterBreak);
  if (error) throw new Error(error);
  const next = structuredClone(game);
  advanceClock(next, now);
  if (rows.length <= next.index || next.levels.slice(0, next.index + 1).some((l, i) => JSON.stringify(l) !== JSON.stringify(rows[i]))) throw new Error('Прошедшие и текущий уровни менять нельзя. Если таймер перешёл дальше, откройте структуру заново');
  const oldLength = next.levels.length;
  next.levels = structuredClone(rows);
  next.config.freezeoutAfterBreak = freezeoutAfterBreak;
  if (next.structureEnded && rows.length > oldLength) {
    next.index = oldLength;
    next.remaining = rows[next.index].duration;
    next.structureEnded = false;
    next.deadline = null;
    next.lastTick = now;
    applyScheduledFreezeout(next, now);
  }
  recordEvent(next, { type: 'structure', count: rows.filter(l => l.kind === 'level').length }, now);
  Object.assign(game, next);
}

export function finishGame(game, now = Date.now()) {
  if (game.finished) return false;
  if (game.config.mode === 'cash' && game.players.some(p => p.cashout === null)) throw new Error('Сначала запишите сумму выхода каждого игрока');
  advanceClock(game, now);
  game.finished = true;
  game.running = false;
  game.deadline = null;
  game.finishedAt = now;
  game.completionReason = game.config.mode === 'cash' ? 'cashout' : 'manual';
  // Ending a schedule or an evening does not establish finishing places or award live bounties.
  recordEvent(game, { type: 'finish', unresolved: game.players.filter(p => p.place == null).length }, now);
  return true;
}

export function gameResults(game) {
  const cash = game.config.mode === 'cash', pool = poolOf(game), prizes = cash ? [] : payouts(pool, game.config.prizes);
  const rows = game.players.map(p => {
    const prize = cash ? p.cashout : p.place == null ? null : (prizes[p.place - 1] || 0);
    const bounty = cash ? 0 : p.earnedBounty;
    const total = prize === null ? null : prize + bounty;
    return { ...p, prize, bountyWon: bounty, total, net: total === null ? null : total - p.invested };
  }).sort((a, b) => cash ? (b.net ?? -Infinity) - (a.net ?? -Infinity) : (a.place ?? Infinity) - (b.place ?? Infinity));
  return { rows, invested: game.players.reduce((sum, p) => sum + p.invested, 0), pool,
    unassignedPrize: pool - rows.reduce((sum, p) => sum + (p.prize ?? 0), 0),
    liveBounties: cash ? 0 : game.players.reduce((sum, p) => sum + p.bounty, 0) };
}

export function exportGameResults(game) {
  if (!game.finished) throw new Error('Выгрузка доступна после завершения игры');
  const result = gameResults(game), cash = game.config.mode === 'cash';
  // Export an explicit set of fields: profiles and event history stay in the app.
  return {
    schemaVersion: 1, mode: game.config.mode, currency: 'RUB',
    bountyMode: cash ? 'off' : game.config.bountyMode,
    finishedAt: game.finishedAt == null ? null : new Date(game.finishedAt).toISOString(),
    durationSeconds: Math.floor(game.elapsed / 1000),
    summary: {
      playerCount: result.rows.length, invested: result.invested,
      totalWinnings: result.rows.some(p => p.total === null) ? null : result.rows.reduce((sum, p) => sum + p.total, 0),
      unassignedPrize: result.unassignedPrize, unclaimedBounties: result.liveBounties,
    },
    players: result.rows.map(p => ({
      nick: p.nick?.trim() || `Игрок ${game.players.findIndex(player => player.id === p.id) + 1}`,
      place: p.place ?? null, invested: p.invested, entries: p.entries,
      reentries: p.reentries, addons: p.addons,
      extraBuyins: cash ? Math.max(0, p.entries - 1) : (p.rebuys || 0),
      knockouts: cash || game.config.bountyMode === 'off' ? null : p.knockouts,
      prize: cash ? null : p.prize, cashout: cash ? p.prize : null,
      bountyWon: p.bountyWon, totalWinnings: p.total, netResult: p.net,
    })),
  };
}
