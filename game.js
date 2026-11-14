(() => {
'use strict';

/* ---------- constants ---------- */
const LAUNCH_COST = 2200, VOYAGE_H = 24, ORBITS = 16, HOUR_SEC = 8;
const O2_PRICE = 2, FOOD_PRICE = 5, CREW = 4, O2_USE = 1.6, SUN_KW = 80, SHADE_KW = 15, SAVE_KEY = 'halcyon-v01';
const CABINS = 4, UTIL = 5;

const DECKS = [
  { id: 'lounge', name: 'Observation Lounge', draw: 8, cap: [8, 12, 16], fun: 3, spend: 10, up: [3000, 7000],
    blurb: 'Earth through a panoramic window. Guests buy drinks here.' },
  { id: 'zerog', name: 'Zero-G Deck', draw: 14, cap: [6, 9, 12], fun: 4, spend: 18, up: [3500, 8000],
    blurb: 'Free-float sessions. The biggest thrill and the biggest power draw.' },
  { id: 'restaurant', name: 'Restaurant', draw: 12, cap: [8, 12, 16], fun: 1.5, spend: 16, up: [3000, 7000],
    blurb: 'Every meal uses 1 food. Higher levels charge more per meal.' },
  { id: 'gym', name: 'Gym', draw: 8, cap: [6, 9, 12], fun: 2.5, spend: 0, up: [2000, 5000],
    blurb: 'Keeps guests content between meals. No income.' },
  { id: 'cabins', name: 'Cabins', draw: 10, cap: [12, 20, 30], fun: 2, spend: 0, up: [5000, 11000],
    blurb: 'Sets how many guests you can book. Guests sleep here.' },
  { id: 'utilities', name: 'Utilities', draw: 12, cap: [0, 0, 0], fun: 0, spend: 0, up: [4000, 9000],
    blurb: 'Solar arrays, battery, oxygen tanks and the air recycler.' },
];
const UTIL_STATS = { gen: [1, 1.3, 1.6], bat: [100, 150, 200], o2: [400, 550, 700], rec: [0.5, 0.6, 0.7] };
const MEALS = [[0.5, 2], [6.5, 8], [12, 13.5], [21.5, 23]];

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const stars = r => '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r));
const clock = h => { const m = Math.floor(h * 60); return 'T+' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

/* ---------- state ---------- */
let S, dirty = true;

function fresh() {
  return {
    phase: 'port', cash: 5000, rep: 3, cruise: 1, price: 400, o2: 250, food: 20, battery: 100,
    levels: [1, 1, 1, 1, 1, 1], open: [true, true, true, true, true, true],
    guests: [], hour: 0, angle: 180, effects: [], event: null, nextEvent: 0, blackout: false,
    stats: null, log: [], selected: 0, speed: 1, flags: {}, recOn: true,
  };
}
function save() {
  try {
    const { cash, rep, cruise, price, o2, food, levels } = S;
    localStorage.setItem(SAVE_KEY, JSON.stringify({ cash, rep, cruise, price, o2, food, levels }));
  } catch (e) { /* storage unavailable */ }
}
function load() {
  S = fresh();
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (d && Array.isArray(d.levels) && d.levels.length === 6) Object.assign(S, d);
  } catch (e) { /* ignore */ }
  S.battery = batCap();
}

/* ---------- derived ---------- */
const lvl = i => S.levels[i] - 1;
const o2Cap = () => UTIL_STATS.o2[lvl(UTIL)];
const batCap = () => UTIL_STATS.bat[lvl(UTIL)];
const recRate = () => UTIL_STATS.rec[lvl(UTIL)];
const foodCap = () => 150 + 50 * lvl(2);
const cabinCap = () => DECKS[CABINS].cap[lvl(CABINS)];
const deckDraw = i => Math.round(DECKS[i].draw * (1 + 0.2 * lvl(i)));
const deckSpend = i => Math.round(DECKS[i].spend * (1 + 0.4 * lvl(i)));
const funMult = i => 1 + 0.3 * lvl(i);
const hasEffect = (type, deck) => S.effects.some(e => e.type === type && (deck === undefined || e.deck === deck));
const during = () => (S.event && S.event.def.during) || {};
const inShadow = () => { const a = S.angle * Math.PI / 180; return Math.cos(a) > 0 && Math.abs(Math.sin(a)) * 46 < 34; };

function genNow() {
  let g = (inShadow() ? SHADE_KW : SUN_KW) * UTIL_STATS.gen[lvl(UTIL)];
  S.effects.forEach(e => { if (e.type === 'gen') g *= e.mult; });
  return g;
}
function deckState(i) {
  if (i === UTIL || S.phase !== 'voyage') return 'open';
  if (hasEffect('closed', i) || (during().closes && S.event.deck === i)) return 'sealed';
  if (S.blackout) return 'blackout';
  if (!S.open[i]) return 'off';
  return 'open';
}
function demandNow() {
  let d = 0;
  for (let i = 0; i < 6; i++) if (deckState(i) === 'open') d += deckDraw(i);
  return d;
}
function expectedBookings() {
  const f = clamp(0.3 + S.rep / 5 * 0.95 - (S.price - 400) / 700, 0, 1);
  return Math.round(cabinCap() * f);
}
const spendable = () => S.cash - LAUNCH_COST;

/* ---------- log ---------- */
function log(msg, alert) {
  S.log.unshift({ t: S.phase === 'voyage' ? clock(S.hour).slice(2) : 'Port', msg, alert });
  S.log.length = Math.min(S.log.length, 6);
  $('#log').innerHTML = S.log.map(l => `<li class="${l.alert ? 'alert' : ''}"><time>${l.t}</time><span>${l.msg}</span></li>`).join('');
}

/* ---------- emergencies ---------- */
const moodAll = (d, frac = 1) => S.guests.forEach(g => { if (Math.random() < frac) g.mood = clamp(g.mood + d, 0, 100); });
const addEffect = e => { S.effects.push(e); dirty = true; };
const pay = n => { S.cash -= n; S.stats.costs += n; };

const EVENTS = [
  { id: 'meteor', title: 'Micrometeoroid strike', needsDeck: true, during: { leak: 14, closes: true },
    text: d => `A grain of debris punched through the ${d.name}. The deck is venting oxygen until you act.`,
    options: [
      { label: 'Send the repair crew', note: '$600', cost: 600, run() { log('Hull patched. Deck reopened.'); } },
      { label: 'Seal the deck', note: 'closed 6 h', run(d, i) { addEffect({ type: 'closed', deck: i, until: S.hour + 6, msg: `${d.name} reopened.` }); moodAll(-2); log(`${d.name} sealed for 6 hours.`); } },
    ],
    timeout(d, i) { addEffect({ type: 'closed', deck: i, until: 99 }); moodAll(-6); log(`${d.name} sealed itself for the rest of the cruise.`, 1); } },
  { id: 'recycler', title: 'Air recycler fault', during: { recycler: true },
    text: () => 'The CO₂ scrubber has tripped. Until it is back, oxygen drains at the full rate.',
    options: [
      { label: 'Emergency repair', note: '$500', cost: 500, run() { log('Recycler repaired.'); } },
      { label: 'Slow reboot on reserve tanks', note: 'offline 4 h', run() { addEffect({ type: 'recycler', until: S.hour + 4, msg: 'Recycler back online.' }); log('Recycler rebooting — 4 hours on reserves.'); } },
    ],
    timeout() { addEffect({ type: 'recycler', until: S.hour + 8, msg: 'Recycler back online.' }); log('Recycler left to self-repair — 8 hours offline.', 1); } },
  { id: 'flare', title: 'Solar flare warning',
    text: () => 'A burst of solar radiation arrives within the hour.',
    options: [
      { label: 'Shelter everyone in the cabins', note: '3 h, guests grumble', run() { addEffect({ type: 'shelter', until: S.hour + 3, msg: 'All clear. Guests released from cabins.' }); moodAll(-3); S.guests.forEach(g => g.stay = 0); log('Guests sheltering in cabins.'); } },
      { label: 'Ride it out', note: '50% arrays damaged', run() { flareHit(); } },
    ],
    timeout() { flareHit(true); } },
  { id: 'fire', title: 'Galley fire', deck: 2, during: { closes: true },
    text: () => 'A fryer has caught fire in the restaurant. The deck is closed until it is out.',
    options: [
      { label: 'Flood with suppression foam', note: 'lose 35% food', run() { S.food *= 0.65; addEffect({ type: 'closed', deck: 2, until: S.hour + 2, msg: 'Restaurant reopened.' }); log('Fire out. Foam ruined a third of the food.'); } },
      { label: 'Vent the galley to space', note: 'lose 45 oxygen', run() { S.o2 = Math.max(1, S.o2 - 45); addEffect({ type: 'closed', deck: 2, until: S.hour + 1, msg: 'Restaurant reopened.' }); log('Galley vented. Fire out.'); } },
    ],
    timeout() { S.food *= 0.4; moodAll(-5); addEffect({ type: 'closed', deck: 2, until: S.hour + 6, msg: 'Restaurant reopened.' }); log('The fire burned itself out and took most of the pantry.', 1); } },
  { id: 'sick', title: 'Space sickness',
    text: () => 'Half the passenger list has gone green. The ship’s doctor wants a decision.',
    options: [
      { label: 'Free medication for all', note: () => money(25 * S.guests.length), cost: () => 25 * S.guests.length, run() { moodAll(2); log('Medication handed out. Colour returns to faces.'); } },
      { label: 'Ginger tea and sympathy', note: 'guests unhappy', run() { moodAll(-9, 0.5); log('Tea was served. It did not help much.'); } },
    ],
    timeout() { moodAll(-12, 0.5); log('Sick guests were left to fend for themselves.', 1); } },
  { id: 'battery', title: 'Battery cell fault',
    text: () => 'One battery bank is overheating and has to be isolated or cooled.',
    options: [
      { label: 'Engineer overtime', note: '$450', cost: 450, run() { log('Battery bank cooled and back in service.'); } },
      { label: 'Shed load', note: 'Zero-G and Gym closed 4 h', run() { [1, 3].forEach(i => addEffect({ type: 'closed', deck: i, until: S.hour + 4, msg: `${DECKS[i].name} reopened.` })); log('Zero-G Deck and Gym closed to shed load.'); } },
    ],
    timeout() { S.battery *= 0.4; log('The faulty bank dumped its charge.', 1); } },
  { id: 'debris', title: 'Debris on our track',
    text: () => 'Tracking shows a dead satellite crossing the orbit ahead.',
    options: [
      { label: 'Burn thrusters to avoid', note: '$700 fuel', cost: 700, run() { log('Avoidance burn complete.'); } },
      { label: 'Hold course', note: '35% chance of a hit', run() { debrisHit(); } },
    ],
    timeout() { debrisHit(); } },
  { id: 'vip', title: 'A very loud complaint',
    text: () => 'A guest in the best cabin says the view was “smaller than advertised”. Others are listening.',
    options: [
      { label: 'Champagne for the whole deck', note: '$300', cost: 300, run() { moodAll(4); log('Champagne poured. Mood lifts.'); } },
      { label: 'Apologise politely', note: 'guests unimpressed', run() { moodAll(-3); log('An apology was offered and coolly received.'); } },
    ],
    timeout() { moodAll(-5); log('The complaint went unanswered.', 1); } },
];
function flareHit(forced) {
  if (forced || Math.random() < 0.5) {
    addEffect({ type: 'gen', mult: 0.5, until: S.hour + 6, msg: 'Solar arrays recalibrated to full output.' });
    moodAll(-8); log('Flare scorched the arrays — half output for 6 hours.', 1);
  } else { moodAll(2); log('The flare passed harmlessly. Guests enjoyed the aurora.'); }
}
function debrisHit() {
  if (Math.random() < 0.35) { S.o2 = Math.max(1, S.o2 - 70); moodAll(-8); log('Debris clipped a tank. 70 oxygen lost.', 1); }
  else log('The debris passed 400 metres astern.');
}
const optCost = o => typeof o.cost === 'function' ? o.cost() : (o.cost || 0);
const optNote = o => typeof o.note === 'function' ? o.note() : o.note;

function spawnEvent() {
  const def = EVENTS[Math.floor(Math.random() * EVENTS.length)];
  if (S.lastEvent === def.id) return spawnEvent();
  S.lastEvent = def.id;
  let deck = def.deck !== undefined ? def.deck : null;
  if (def.needsDeck) deck = Math.floor(Math.random() * 4);
  S.event = { def, deck, deadline: S.hour + 3 };
  if (S.speed > 1) setSpeed(1);
  log(def.title + '.', 1);
  dirty = true;
}
function resolveEvent(idx) {
  const ev = S.event; if (!ev) return;
  const d = ev.deck !== null ? DECKS[ev.deck] : null;
  if (idx === -1) { S.event = null; ev.def.timeout(d, ev.deck); }
  else {
    const o = ev.def.options[idx], c = optCost(o);
    if (c > S.cash) return;
    S.event = null;
    if (c) pay(c);
    o.run(d, ev.deck);
  }
  S.nextEvent = S.hour + rand(2.5, 5);
  dirty = true;
}

/* ---------- guests ---------- */
function pickDeck(g) {
  if (hasEffect('shelter')) return CABINS;
  const h = S.hour, sleep = h >= 14 && h < 21, meal = MEALS.some(([a, b]) => h >= a && h < b);
  const w = [3, 3, meal ? 12 : 0.8, 2, sleep ? 14 : 0.8];
  const occ = occupancy();
  let upset = false;
  for (let tries = 0; tries < 3; tries++) {
    let r = Math.random() * w.reduce((a, b) => a + b, 0), i = 0;
    while ((r -= w[i]) > 0) i++;
    if (i === CABINS) return i;
    if (deckState(i) !== 'open') { if (!upset) { g.mood -= 2; upset = true; } w[i] = 0; continue; }
    if (occ[i] >= DECKS[i].cap[lvl(i)]) { if (!upset) { g.mood -= 1; upset = true; } w[i] = 0; continue; }
    return i;
  }
  return CABINS;
}
function occupancy() { const o = [0, 0, 0, 0, 0, 0]; S.guests.forEach(g => o[g.deck]++); return o; }
function arrive(g, i) {
  g.deck = i;
  const sleep = S.hour >= 14 && S.hour < 21;
  g.stay = i === CABINS && sleep ? rand(4, 6.5) : rand(1, 2.5);
  g.tx = rand(184, 336);
  if (i === 2) {
    if (S.food >= 1) { S.food -= 1; earn(deckSpend(2), g); g.mood += 3; }
    else { g.mood -= 6; flag('nofood', true, 'The restaurant has run out of food.'); }
  } else if (DECKS[i].spend) earn(deckSpend(i), g);
}
const earn = (n, g) => { S.cash += n; S.stats.onboard += n; if (g) tick(n, g.tx, g.deck); };
function flag(key, on, msg) {
  if (on && !S.flags[key]) { S.flags[key] = true; log(msg, 1); }
  else if (!on) S.flags[key] = false;
}

/* ---------- simulation ---------- */
function step(dh) {
  S.hour += dh;
  S.angle = (S.angle + dh / (VOYAGE_H / ORBITS) * 360) % 360;

  const n = S.effects.length;
  S.effects = S.effects.filter(e => { if (S.hour >= e.until) { if (e.msg) log(e.msg); return false; } return true; });
  if (n !== S.effects.length) dirty = true;

  // power
  const gen = genNow(), dem = demandNow();
  S.battery = clamp(S.battery + (gen - dem) * dh, 0, batCap());
  if (!S.blackout && S.battery <= 0) { S.blackout = true; dirty = true; log('Battery empty — blackout. Guest decks have gone dark.', 1); }
  else if (S.blackout && S.battery >= batCap() * 0.25) { S.blackout = false; dirty = true; log('Power restored.'); }

  // oxygen
  S.recOn = !hasEffect('recycler') && !during().recycler && !(S.blackout && gen < deckDraw(UTIL));
  let use = (S.guests.length + CREW) * O2_USE * dh * (S.recOn ? 1 - recRate() : 1);
  if (during().leak) use += during().leak * dh;
  S.o2 = Math.max(0, S.o2 - use);
  flag('lowo2', S.o2 < o2Cap() * 0.15, 'Oxygen reserves are critically low.');
  if (S.o2 <= 0) return endVoyage(true);

  // guests
  const sleep = S.hour >= 14 && S.hour < 21, shelter = hasEffect('shelter');
  const globalMood = (S.o2 < o2Cap() * 0.15 ? -5 : 0) + (S.food < 1 ? -2 : 0) + (S.blackout ? -4 : 0) + (shelter ? -1 : 0);
  S.guests.forEach(g => {
    const st = deckState(g.deck);
    let d = -2.5 + globalMood;
    if (st === 'open') d += DECKS[g.deck].fun * funMult(g.deck) * (g.deck === CABINS && sleep ? 1.5 : 1);
    g.mood = clamp(g.mood + d * dh, 0, 100);
    g.stay -= dh;
    if (g.deck < CABINS && st !== 'open') g.stay = 0;
    if (shelter && g.deck !== CABINS) g.stay = 0;
    if (g.stay <= 0) arrive(g, pickDeck(g));
  });

  // emergencies
  if (S.event) { if (S.hour >= S.event.deadline) resolveEvent(-1); }
  else if (S.hour >= S.nextEvent && S.hour < VOYAGE_H - 3.5) spawnEvent();

  if (S.hour >= VOYAGE_H) endVoyage(false);
}

function launch() {
  const n = expectedBookings();
  if (n < 1 || S.cash < LAUNCH_COST) return;
  S.cash -= LAUNCH_COST;
  const tickets = n * S.price;
  S.cash += tickets;
  S.stats = { tickets, onboard: 0, costs: LAUNCH_COST, guests: n };
  Object.assign(S, { phase: 'voyage', hour: 0, angle: 180, effects: [], event: null, blackout: false, flags: {},
    battery: batCap(), open: [true, true, true, true, true, true], nextEvent: rand(2, 4), lastEvent: null, log: [] });
  const layer = $('#guests'); layer.innerHTML = '';
  S.guests = [];
  for (let k = 0; k < n; k++) {
    const el = document.createElementNS(SVGNS, 'g');
    el.setAttribute('class', 'guest'); el.innerHTML = '<path d="M0 -7 V-1"/><circle cy="-11" r="3"/>'; layer.appendChild(el);
    const g = { mood: clamp(62 + rand(-8, 8) - (S.price - 400) / 25, 5, 95), deck: CABINS, stay: rand(0, 0.6),
      x: rand(184, 336), y: deckTop(CABINS) + 63, tx: rand(184, 336), ph: rand(0, 6.28), rot: 0, el };
    S.guests.push(g);
  }
  setSpeed(1);
  log(`Lift-off with ${n} guests at ${money(S.price)} a ticket.`);
  dirty = true;
}

function endVoyage(aborted) {
  const st = S.stats, n = S.guests.length;
  const avg = n ? S.guests.reduce((a, g) => a + g.mood, 0) / n : 50;
  let review = clamp(avg / 20, 0.5, 5), refund = 0;
  if (aborted) { review = 1; refund = st.tickets; S.cash -= refund; }
  S.rep = clamp(S.rep * 0.5 + review * 0.5, 0.5, 5);
  const profit = st.tickets + st.onboard - st.costs - refund;
  $('#guests').innerHTML = '';
  Object.assign(S, { phase: 'port', guests: [], effects: [], event: null, blackout: false, battery: batCap(), hour: 0, angle: 180, log: [] });
  const cruiseNo = S.cruise++;
  save();
  const broke = S.cash < LAUNCH_COST;
  modal(`
    <h2>Cruise ${cruiseNo} · ${aborted ? 'Aborted' : 'Complete'}</h2>
    <h3>${aborted ? 'Emergency return' : 'Safely docked'}</h3>
    ${aborted ? '<p class="warn">The ship ran out of oxygen and made an emergency descent. Every ticket was refunded.</p>' : ''}
    <div class="stars">${stars(review)}</div>
    <div class="row"><span>Guest review</span><b>${review.toFixed(1)} / 5</b></div>
    <div class="row"><span>Tickets (${st.guests})</span><b>${money(st.tickets)}</b></div>
    <div class="row"><span>On-board spending</span><b>${money(st.onboard)}</b></div>
    <div class="row"><span>Launch and emergencies</span><b>${money(-st.costs)}</b></div>
    ${refund ? `<div class="row"><span>Refunds</span><b>${money(-refund)}</b></div>` : ''}
    <div class="row total"><span>Cruise profit</span><b>${money(profit)}</b></div>
    <div class="row"><span>Line rating now</span><b>${S.rep.toFixed(1)} ★</b></div>
    ${broke ? `<p class="warn" style="margin-top:12px">You cannot cover the ${money(LAUNCH_COST)} launch cost. The line is bankrupt.</p>
      <button class="primary" data-act="restart">Start a new line</button>`
      : '<button class="primary" data-act="close">Return to port</button>'}`);
  log(aborted ? 'Emergency return. Tickets refunded.' : `Cruise ${cruiseNo} docked. Review ${review.toFixed(1)}.`, aborted);
  dirty = true;
}

/* ---------- port actions ---------- */
function buy(res, amount) {
  const cap = res === 'o2' ? o2Cap() : foodCap(), price = res === 'o2' ? O2_PRICE : FOOD_PRICE;
  let n = Math.min(amount, Math.ceil(cap - S[res]), Math.floor(spendable() / price));
  if (n <= 0) return;
  S[res] = Math.min(cap, S[res] + n); S.cash -= n * price;
  save(); dirty = true;
}
function upgrade(i) {
  const l = S.levels[i]; if (l >= 3) return;
  const cost = DECKS[i].up[l - 1]; if (cost > spendable()) return;
  S.cash -= cost; S.levels[i]++;
  if (i === UTIL) S.battery = batCap();
  log(`${DECKS[i].name} upgraded to level ${S.levels[i]}.`);
  save(); dirty = true;
}
function setSpeed(v) {
  S.speed = v;
  document.querySelectorAll('#speed button').forEach(b => b.classList.toggle('on', +b.dataset.speed === v));
}

/* ---------- rendering ---------- */
const deckTop = i => 110 + i * 70;
const SVGNS = 'http://www.w3.org/2000/svg';

const INTERIOR = [
  y => `<rect x="196" y="${y + 9}" width="128" height="32" rx="16"/><path d="M212 ${y + 38} Q260 ${y + 20} 308 ${y + 38}"/>
        <path d="M186 ${y + 63} v-10 h28 v10 M306 ${y + 63} v-10 h28 v10 M252 ${y + 63} v-7 h16 v7"/>`,
  y => `<rect x="178" y="${y + 7}" width="164" height="56" rx="10" stroke-dasharray="1 6"/>
        <circle cx="186" cy="${y + 15}" r="3"/><circle cx="334" cy="${y + 15}" r="3"/><circle cx="186" cy="${y + 55}" r="3"/><circle cx="334" cy="${y + 55}" r="3"/>`,
  y => [204, 260, 316].map(x => `<path d="M${x - 12} ${y + 51} h24 M${x} ${y + 51} v12 M${x - 18} ${y + 63} v-7 M${x + 18} ${y + 63} v-7"/>`).join('')
        + `<path d="M226 ${y + 12} h68 M236 ${y + 12} v8 M260 ${y + 12} v8 M284 ${y + 12} v8"/>`,
  y => `<path d="M184 ${y + 63} l30 -4 M210 ${y + 59} v-18 h-8"/>
        <path d="M240 ${y + 46} h28 M247 ${y + 63} v-17 M261 ${y + 63} v-17"/><circle cx="238" cy="${y + 46}" r="4.5"/><circle cx="270" cy="${y + 46}" r="4.5"/>
        <circle cx="304" cy="${y + 56}" r="7"/><circle cx="326" cy="${y + 56}" r="7"/><path d="M304 ${y + 56} l8 -14 h10 l4 14 M312 ${y + 42} l-3 -6 h-5"/>`,
  y => [0, 1, 2, 3, 4, 5].map(k => `<rect x="${181 + k * 27}" y="${y + 8}" width="22" height="13" rx="6.5"/><rect x="${181 + k * 27}" y="${y + 26}" width="22" height="13" rx="6.5"/>`).join(''),
  y => `<rect x="184" y="${y + 9}" width="20" height="48" rx="10"/><rect x="210" y="${y + 9}" width="20" height="48" rx="10"/>
        <rect x="246" y="${y + 22}" width="46" height="24" rx="2"/><path d="M292 ${y + 29} h4 v10 h-4"/>
        <circle cx="322" cy="${y + 34}" r="14"/>`,
];

function buildShip() {
  let stars = '';
  for (let k = 0; k < 46; k++) stars += `<circle cx="${rand(6, 514).toFixed(0)}" cy="${rand(6, 540).toFixed(0)}" r="${rand(0.7, 1.5).toFixed(1)}"/>`;
  let streaks = '';
  for (let k = 0; k < 16; k++) { const w = rand(18, 60); streaks += `<line x1="${k * 70 - 300}" x2="${k * 70 - 300 + w}" y1="${556 + (k * 37) % 78}" y2="${556 + (k * 37) % 78}"/>`; }
  let h = `<defs><clipPath id="globeclip"><circle cx="260" cy="1168" r="640"/></clipPath></defs>
    <rect id="sky" width="520" height="640"/><g id="stars">${stars}</g>
    <g id="earth"><circle id="globe" cx="260" cy="1168" r="640"/><g clip-path="url(#globeclip)"><g id="streaks">${streaks}</g></g></g>
    <g id="pad"><path d="M40 583 H480"/><path d="M500 583 V84 M488 583 V84 M488 84 H500 M488 96 H349 M488 104 H352"/>
      <path d="${Array.from({ length: 12 }, (_, k) => `M488 ${124 + k * 40} L500 ${144 + k * 40} L488 ${164 + k * 40}`).join(' ')}"/></g>
    <path class="hull" d="M170 110 C170 52 228 16 260 10 C292 16 350 52 350 110 Z"/>
    <circle class="hull" cx="260" cy="72" r="14"/>
    <path class="hull" d="M170 500 L140 582 L170 550 Z"/><path class="hull" d="M350 500 L380 582 L350 550 Z"/>
    <path class="hull" d="M218 530 L204 572 H316 L302 530 Z"/>
    <g id="array" class="lit"><path d="M350 474 h14"/><rect x="364" y="462" width="84" height="24"/>
      ${[1, 2, 3, 4, 5].map(k => `<rect x="${364 + k * 14}" y="462" width="0.01" height="24"/>`).join('')}</g>
    <text id="solar" x="364" y="454"></text>`;
  DECKS.forEach((d, i) => {
    const y = deckTop(i);
    h += `<g class="deck" data-deck="${i}">
      <rect class="room" x="170" y="${y}" width="180" height="70"/>
      <g class="interior">${INTERIOR[i](y)}</g>
      <text class="name" x="154" y="${y + 33}">${d.name}</text>
      <text class="lv" x="154" y="${y + 48}" id="lv${i}"></text>
      ${i === UTIL ? '' : `<text class="status" x="364" y="${y + 40}" id="st${i}"></text>`}</g>`;
  });
  const uy = deckTop(UTIL);
  h += `<g class="live"><rect class="fill" id="tank1" x="186.5" width="15" rx="7.5"/><rect class="fill" id="tank2" x="212.5" width="15" rx="7.5"/>
    <rect class="fill" id="cell" x="248.5" y="${uy + 24.5}" height="19"/>
    <path id="fan" d="M322 ${uy + 23} V${uy + 45} M311 ${uy + 34} H333"/></g>
    <g id="guests"></g><g id="ticks"></g>
    <g id="vent" style="display:none"><line x1="0" x2="12" y1="0" y2="0"/><line x1="0" x2="12" y1="6" y2="6"/><line x1="0" x2="12" y1="12" y2="12"/></g>`;
  $('#ship').innerHTML = h;
}

function tick(n, x, deck) {
  const layer = $('#ticks');
  if (document.hidden || layer.childElementCount > 24) return;
  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('class', 'tick'); t.setAttribute('x', clamp(x, 190, 330).toFixed(0)); t.setAttribute('y', deckTop(deck) + 26);
  t.textContent = '+$' + n;
  t.addEventListener('animationend', () => t.remove());
  layer.appendChild(t);
}

const STATE_LABEL = { off: 'Powered down', sealed: 'Sealed', blackout: 'No power' };
function renderDecks() {
  const occ = occupancy(), voyage = S.phase === 'voyage';
  DECKS.forEach((d, i) => {
    const st = deckState(i), g = $(`.deck[data-deck="${i}"]`), leak = !!(S.event && during().leak && S.event.deck === i);
    g.classList.toggle('sel', S.selected === i);
    g.classList.toggle('dark', st !== 'open');
    g.classList.toggle('breach', leak);
    g.classList.toggle('alarm', !!(S.event && S.event.deck === i && !leak));
    setText('#lv' + i, 'Level ' + S.levels[i]);
    if (i === UTIL) return;
    const cap = d.cap[lvl(i)];
    let t, warn = false;
    if (st !== 'open') { t = STATE_LABEL[st]; warn = true; }
    else if (voyage) { t = `${occ[i]} / ${cap}`; warn = i < CABINS && occ[i] >= cap; }
    else t = `${cap} ${i === CABINS ? 'berths' : 'places'}`;
    setText('#st' + i, t);
    $('#st' + i).classList.toggle('warn', warn);
  });
}
const cache = {};
function setText(sel, t) { if (cache[sel] !== t) { cache[sel] = t; const el = $(sel); if (el) el.textContent = t; } }
function setBar(sel, frac, low) {
  const el = $(sel); el.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%'; el.classList.toggle('low', !!low);
}
let fanAngle = 0;

function renderLive(dt = 0) {
  const voyage = S.phase === 'voyage', shade = voyage && inShadow();
  setText('#cash', money(S.cash));
  setText('#rep', S.rep.toFixed(1) + ' ★');
  setText('#cruise', String(S.cruise));
  setText('#guestcount', voyage ? String(S.guests.length) : '–');
  setText('#shipstate', voyage ? (shade ? 'In orbit · Earth shadow' : 'In orbit · Sunlight') : 'Docked · Earth Port');

  const o2f = S.o2 / o2Cap(), bf = S.battery / batCap(), lowO2 = o2f < 0.15, lowB = bf < 0.2;
  setText('#o2v', String(Math.round(S.o2))); setText('#o2m', '/ ' + o2Cap());
  setBar('#o2b', o2f, lowO2);
  setText('#foodv', String(Math.round(S.food))); setText('#foodm', '/ ' + foodCap());
  setBar('#foodb', S.food / foodCap(), S.food < 5);
  setText('#batv', String(Math.round(S.battery))); setText('#batm', `/ ${batCap()} kWh`);
  setBar('#batb', bf, lowB);
  $('#o2v').classList.toggle('warn', lowO2); $('#batv').classList.toggle('warn', lowB);
  $('#foodv').classList.toggle('warn', voyage && S.food < 5);

  const o2s = $('#o2s'), pows = $('#pows'), gen = Math.round(genNow());
  if (voyage) {
    const leak = during().leak, dem = demandNow();
    setText('#o2s', leak ? 'Hull breach · venting' : S.recOn ? `Recycler on · ${Math.round(recRate() * 100)}% recovered` : 'Recycler offline');
    o2s.classList.toggle('warn', !!leak || !S.recOn);
    setText('#foods', S.food < 1 ? 'Pantry empty' : '1 per meal');
    setText('#pows', S.blackout ? 'Blackout' : `Solar ${gen} kW · draw ${dem} kW`);
    pows.classList.toggle('warn', S.blackout || gen < dem && lowB);
    setText('#orbitn', `Orbit ${Math.min(ORBITS, Math.floor(S.hour / (VOYAGE_H / ORBITS)) + 1)} of ${ORBITS}`);
    setText('#clock', clock(S.hour));
    setText('#light', shade ? 'Earth shadow' : 'Sunlight');
    setText('#solar', `SOLAR ${gen} kW`);
    if (S.event) {
      const left = Math.max(0, S.event.deadline - S.hour);
      setText('#evtime', left.toFixed(1) + ' h to decide');
      const bar = $('#evbar'); if (bar) bar.style.width = (left / 3 * 100).toFixed(1) + '%';
    }
    const avg = S.guests.reduce((a, g) => a + g.mood, 0) / (S.guests.length || 1);
    setText('#moodv', String(Math.round(avg)));
    setText('#incomev', money(S.stats.onboard));
  } else {
    setText('#o2s', 'Buy at port'); setText('#foods', 'Buy at port'); setText('#pows', 'Charged at port');
    o2s.classList.remove('warn'); pows.classList.remove('warn');
    setText('#orbitn', `${ORBITS} orbits · 24 hours`); setText('#clock', 'Docked'); setText('#light', ''); setText('#solar', '');
  }
  $('#speed').style.display = voyage ? 'flex' : 'none';

  // the ship scene
  const svg = $('#ship');
  svg.classList.toggle('orbit', voyage); svg.classList.toggle('shade', shade);
  $('#array').classList.toggle('lit', !shade);
  $('#streaks').setAttribute('transform', `translate(${(-(S.hour * 180) % 280).toFixed(1)} 0)`);
  const uy = deckTop(UTIL), th = 44 * clamp(o2f, 0.04, 1);
  ['#tank1', '#tank2'].forEach(id => { const t = $(id); t.setAttribute('y', (uy + 11 + 44 - th).toFixed(1)); t.setAttribute('height', th.toFixed(1)); t.classList.toggle('low', lowO2); });
  const cell = $('#cell'); cell.setAttribute('width', (41 * clamp(bf, 0, 1)).toFixed(1)); cell.classList.toggle('low', lowB);
  if (voyage && S.recOn && S.speed > 0) fanAngle = (fanAngle + dt * 240) % 360;
  $('#fan').setAttribute('transform', `rotate(${fanAngle.toFixed(0)} 322 ${uy + 34})`);
  const vent = $('#vent');
  if (voyage && during().leak) { vent.style.display = ''; vent.setAttribute('transform', `translate(353 ${deckTop(S.event.deck) + 8})`); }
  else vent.style.display = 'none';

  const a = S.angle * Math.PI / 180, dot = $('#shipdot');
  dot.setAttribute('cx', (60 + 46 * Math.cos(a)).toFixed(1));
  dot.setAttribute('cy', (60 - 46 * Math.sin(a)).toFixed(1));
  renderDecks();
  if (dirty) { dirty = false; renderContext(); renderDeckCard(); }
}

function renderContext() {
  const el = $('#context'), al = $('#alert');
  ['#evtime', '#moodv', '#incomev'].forEach(k => delete cache[k]);
  if (S.phase === 'voyage' && S.event) {
    const ev = S.event, d = ev.deck !== null ? DECKS[ev.deck] : null;
    al.innerHTML = `<h2>Emergency${d ? ' · ' + d.name : ''} <em id="evtime"></em></h2><div class="bar"><i id="evbar"></i></div>
      <h3>${ev.def.title}</h3><p>${ev.def.text(d)}</p>
      <div class="opts">${ev.def.options.map((o, i) =>
        `<button data-act="opt" data-i="${i}" ${optCost(o) > S.cash ? 'disabled' : ''}><b>${o.label}</b><span>${optNote(o)}</span></button>`).join('')}</div>`;
    al.hidden = false;
  } else al.hidden = true;

  if (S.phase === 'port') {
    const n = expectedBookings(), cap = cabinCap();
    const needO2 = Math.round((n + CREW) * O2_USE * (1 - recRate()) * VOYAGE_H * 1.15), needFood = Math.round(n * 3.5);
    const resRow = (res, label, have, capv, price, need) => `
      <div class="row"><span>${label} <em class="${have < need ? 'warn' : ''}">need about ${need}</em></span>
      <span class="btns"><button data-act="buy" data-res="${res}" data-n="25" ${have >= capv || spendable() < price ? 'disabled' : ''}>+25 · ${money(25 * price)}</button>
      <button data-act="buy" data-res="${res}" data-n="9999" ${have >= capv || spendable() < price ? 'disabled' : ''}>Fill</button></span></div>`;
    el.innerHTML = `<h2>Earth Port</h2>
      <div class="pair"><div><label>Ticket price</label><div class="big" id="pricev">${money(S.price)}</div></div>
        <div><label>Bookings</label><div class="big" id="bookv">${n} / ${cap}</div></div></div>
      <input type="range" id="price" min="150" max="1000" step="25" value="${S.price}" aria-label="Ticket price">
      ${resRow('o2', 'Oxygen', S.o2, o2Cap(), O2_PRICE, needO2)}
      ${resRow('food', 'Food', S.food, foodCap(), FOOD_PRICE, needFood)}
      <button class="primary" data-act="launch" ${n < 1 ? 'disabled' : ''}>Launch · ${money(LAUNCH_COST)}</button>
      <p style="margin:8px 0 0;font-size:12px">The launch cost is held back from upgrade spending.</p>`;
  } else {
    el.innerHTML = `<h2>Under way</h2>
      <div class="pair"><div><label>Guest mood</label><div class="big" id="moodv"></div></div>
        <div><label>On-board income</label><div class="big" id="incomev"></div></div></div>
      <p style="margin:6px 0 0;font-size:12px">Solar output collapses in Earth’s shadow. Power down a deck if the battery runs low.</p>`;
  }
}

function renderDeckCard() {
  const i = S.selected, d = DECKS[i], l = S.levels[i], port = S.phase === 'port';
  let rows = '';
  if (i === UTIL) rows = `
    <div class="row"><span>Oxygen tanks</span><b>${o2Cap()}</b></div>
    <div class="row"><span>Air recycler</span><b>${Math.round(recRate() * 100)}%</b></div>
    <div class="row"><span>Battery</span><b>${batCap()} kWh</b></div>
    <div class="row"><span>Solar arrays</span><b>${Math.round(SUN_KW * UTIL_STATS.gen[l - 1])} kW</b></div>`;
  else rows = `<div class="row"><span>${i === CABINS ? 'Berths' : 'Places'}</span><b>${d.cap[l - 1]}</b></div>
    ${d.spend ? `<div class="row"><span>Income per visit</span><b>${money(deckSpend(i))}</b></div>` : ''}`;
  rows += `<div class="row"><span>Power draw</span><b>${deckDraw(i)} kW</b></div>`;
  let btn = '';
  if (port) {
    if (l >= 3) btn = '<button class="primary" disabled>Fully upgraded</button>';
    else { const c = d.up[l - 1]; btn = `<button class="primary" data-act="upgrade" ${c > spendable() ? 'disabled' : ''}>Upgrade to level ${l + 1} · ${money(c)}</button>`; }
  } else if (i < CABINS) {
    const st = deckState(i);
    btn = st === 'sealed' || st === 'blackout'
      ? `<button class="primary" disabled>${STATE_LABEL[st]}</button>`
      : `<button class="primary" data-act="toggle">${S.open[i] ? 'Power down deck' : 'Power up deck'}</button>`;
  }
  $('#deck').innerHTML = `<h2>${d.name} <em>Level ${l}</em></h2><p>${d.blurb}</p>${rows}${btn}`;
}

function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; }

function animate(dt) {
  const t = performance.now() / 1000, k = 1 - Math.exp(-dt * 3 * Math.max(1, S.speed));
  S.guests.forEach(g => {
    const top = deckTop(g.deck), zg = g.deck === 1;
    const ty = zg ? top + 38 + Math.sin(t * 1.1 + g.ph) * 14 : top + 63;
    const tx = zg ? g.tx + Math.cos(t * 0.7 + g.ph) * 10 : g.tx;
    g.x += (clamp(tx, 182, 338) - g.x) * k; g.y += (ty - g.y) * k;
    const floating = g.y < top + 56 && zg;
    g.rot += ((floating ? Math.sin(t * 0.5 + g.ph) * 70 : 0) - g.rot) * k;
    g.el.setAttribute('transform', `translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) rotate(${g.rot.toFixed(0)} 0 -6)`);
    g.el.classList.toggle('sad', g.mood < 35);
  });
}

/* ---------- input ---------- */
document.addEventListener('click', e => {
  const deck = e.target.closest('.deck');
  if (deck) { S.selected = +deck.dataset.deck; dirty = true; return; }
  const sp = e.target.closest('[data-speed]');
  if (sp) return setSpeed(+sp.dataset.speed);
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  if (act === 'buy') buy(b.dataset.res, +b.dataset.n);
  else if (act === 'launch') launch();
  else if (act === 'upgrade') upgrade(S.selected);
  else if (act === 'toggle') { const i = S.selected; S.open[i] = !S.open[i]; log(`${DECKS[i].name} ${S.open[i] ? 'powered up' : 'powered down'}.`); dirty = true; }
  else if (act === 'opt') resolveEvent(+b.dataset.i);
  else if (act === 'close') { $('#modal').hidden = true; }
  else if (act === 'restart') { restart(); }
});
document.addEventListener('input', e => {
  if (e.target.id !== 'price') return;
  S.price = +e.target.value;
  $('#pricev').textContent = money(S.price);
  $('#bookv').textContent = `${expectedBookings()} / ${cabinCap()}`;
  $('[data-act="launch"]').disabled = expectedBookings() < 1;
});
document.addEventListener('change', e => { if (e.target.id === 'price') { save(); dirty = true; } });
$('#reset').addEventListener('click', () => { if (confirm('Erase your cruise line and start over?')) restart(); });
function restart() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  $('#guests').innerHTML = ''; $('#modal').hidden = true; $('#alert').hidden = true;
  load(); setSpeed(1); log('A new cruise line is born. Welcome aboard, Director.'); dirty = true;
}

/* ---------- boot ---------- */
buildShip();
load();
setSpeed(1);
log(S.cruise > 1 ? 'Welcome back, Director.' : 'Welcome aboard, Director. Stock up and launch.');
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.phase === 'voyage' && S.speed > 0 && $('#modal').hidden) step(dt * S.speed / HOUR_SEC);
  animate(dt);
  renderLive(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.game = { get S() { return S; }, step, renderLive };
})();
