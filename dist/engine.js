export const defaults = () => ({
  name: 'Покер с друзьями', mode: 'tournament', stack: 10000, sb: 25, bb: 50,
  duration: 20, buyin: 1000, seats: 6, prizes: [50, 30, 20],
  breakEvery: 4, breakDuration: 10, ante: false, rebuy: true,
  reentry: true, addonCost: 500, addonStack: 5000,
  bountyMode: 'off', bountyAmount: 200, bountyImmediate: 50,
});

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
  if (!Number.isInteger(c.seats) || c.seats < 2 || c.seats > 10) return 'За одним столом от 2 до 10 игроков';
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
    players: players.map((p, i) => ({ ...p, seat: i + 1, active: true, invested: config.buyin, mainContribution: config.buyin-bounty, bountyPaid: bounty, bounty, earnedBounty: 0, knockouts: 0, rebuys: 0, reentries: 0, addons: 0, entries: 1, cashout: null, place: null })),
    index: 0, remaining: levels[0].duration, elapsed: 0, running: false,
    deadline: null, lastTick: now, finished: false, structureEnded: false,
    eliminationOrder: [], events: [], winnerBounty: null,
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
  } else if(!p.active || game.finished || !['rebuy','addon'].includes(type))throw new Error('Докупка недоступна');
  if(type==='rebuy'&&!game.config.rebuy)throw new Error('Ребаи выключены');
  advanceClock(game,now);
  const amount=type==='addon'?game.config.addonCost:game.config.buyin;
  // Re-entry restores a head from the contribution; add-ons/rebuys stay in prizes.
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
  } else if(type==='addon')p.addons++;
  else {p.rebuys++;p.entries++;}
  recordEvent(game,{type,playerId:id,amount,bounty},now);
}

export function formatTime(seconds, hours = false) {
  const value = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor(value / 60) % 60;
  const s = value % 60;
  return hours || h ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
