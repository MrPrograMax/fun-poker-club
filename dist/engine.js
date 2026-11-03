export const defaults = () => ({
  name: 'Покер с друзьями', mode: 'tournament', stack: 10000, sb: 25, bb: 50,
  duration: 20, buyin: 1000, seats: 6, tableCapacity: 10, prizes: [50, 30, 20],
  breakEvery: 4, breakDuration: 10, ante: false,
  reentry: true, addonCost: 500, addonStack: 5000,
  bountyMode: 'off', bountyAmount: 200, bountyImmediate: 50,
});

export const MAX_PLAYERS = 200;

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

export function recommendStructure(config, { targetMinutes = 240, extraEntries = 0, addons = 0 } = {}) {
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
    startDepth: stack / bb, finalBB: selected.at(-1), maxIncrease: Math.max(...selected.slice(1).map((value, i) => value / selected[i])) };
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
    if (c.prizes.some(p => !Number.isFinite(p) || p <= 0) || Math.abs(c.prizes.reduce((a, b) => a + b, 0) - 100) > 0.001) return 'Сумма призовых должна быть равна 100%';
    if (c.prizes.length > c.seats) return 'Призовых мест не может быть больше, чем игроков';
    if (!Number.isInteger(c.addonCost) || c.addonCost < 1 || !Number.isInteger(c.addonStack) || c.addonStack < 1) return 'Стоимость и стек аддона должны быть положительными целыми числами';
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
  if (game.players.some(p => !Number.isInteger(p.table) || p.table < 1)) {
    game.players = seatPlayers(game.players, game.config.tableCapacity);
  }
  game.eliminationOrder ||= game.players.filter(p=>p.place>1).sort((a,b)=>b.place-a.place).map(p=>p.id);
  game.events ||= [];
  for (const p of game.players) {
    p.mainContribution ??= p.invested; p.bountyPaid ??= 0; p.bounty ??= 0; p.earnedBounty ??= 0;
    p.knockouts ??= 0; p.rebuys ??= p.entries-1; p.reentries ??= 0; p.addons ??= 0;
  }
  return game;
}

export function createGame(config, levels, players, now = Date.now()) {
  const bounty = config.mode === 'tournament' && config.bountyMode !== 'off' ? config.bountyAmount : 0;
  return {
    config: structuredClone(config), levels: structuredClone(levels),
    players: seatPlayers(players, config.tableCapacity).map(p => ({ ...p, active: true, invested: config.buyin, mainContribution: config.buyin-bounty, bountyPaid: bounty, bounty, earnedBounty: 0, knockouts: 0, rebuys: 0, reentries: 0, addons: 0, entries: 1, cashout: null, place: null })),
    index: 0, remaining: levels[0].duration, elapsed: 0, running: false,
    deadline: null, lastTick: now, finished: false, structureEnded: false,
    eliminationOrder: [], events: [], winnerBounty: null, freezeout: null,
  };
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
      game.index++;
      game.deadline += game.levels[game.index].duration * 1000;
    } else {
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
}

export function restoreAction(game, snapshot, now = Date.now()) {
  if (game.freezeout && !snapshot.freezeout) {
    const restored = normalizeGame(structuredClone(snapshot));
    advanceClock(restored, now);
    return restored;
  }
  advanceClock(game, now);
  const restored = structuredClone(snapshot);
  // Revert the operation, while keeping the clock and level as the host left them.
  for (const key of ['index', 'remaining', 'elapsed', 'running', 'deadline', 'lastTick', 'structureEnded']) restored[key] = game[key];
  if (restored.finished) { restored.running = false; restored.deadline = null; }
  return normalizeGame(restored);
}

export function startFreezeout(game, now = Date.now()) {
  if (game.config.mode !== 'tournament' || game.finished || game.structureEnded || game.freezeout) return false;
  advanceClock(game, now);
  if (game.structureEnded) return false;
  let index = game.index;
  while (index < game.levels.length && game.levels[index].kind !== 'level') index++;
  if (index === game.levels.length) return false;
  game.index = index;
  game.remaining = game.levels[index].duration;
  game.running = true;
  game.lastTick = now;
  game.deadline = now + game.remaining * 1000;
  game.freezeout = { startedAt: now, level: game.levels[index].number };
  recordEvent(game, { type: 'freezeout', level: game.levels[index].number }, now);
  return true;
}

export function eliminate(game, id, now = Date.now(), killerId = null) {
  const player = game.players.find(p => p.id === id);
  if (!player?.active || game.finished) return;
  const killer = game.players.find(p=>p.id===killerId && p.active && p.id!==id);
  if (game.config.bountyMode !== 'off' && !killer) throw new Error('Выберите игрока, который выбил участника');
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
  game.eliminationOrder.push(id);
  updatePlaces(game);
  const alive = game.players.filter(p => p.active);
  if (alive.length === 1) {
    alive[0].place = 1;
    game.finished = true;
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
  if(type==='reentry') {
    if(p.active || !game.config.reentry)throw new Error('Ре-энтри недоступен');
  } else if(!p.active || game.finished || type!=='addon')throw new Error('Докупка недоступна');
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
    game.eliminationOrder=game.eliminationOrder.filter(x=>x!==id);
    game.finished=false;
    updatePlaces(game);
  } else p.addons++;
  recordEvent(game,{type,playerId:id,amount,bounty},now);
}

export function formatTime(seconds, hours = false) {
  const value = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor(value / 60) % 60;
  const s = value % 60;
  return hours || h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
