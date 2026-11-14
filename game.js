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
  S.log.length = Math.min(S.log.length, 9);
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
    if (S.food >= 1) { S.food -= 1; earn(deckSpend(2)); g.mood += 3; }
    else { g.mood -= 6; flag('nofood', true, 'The restaurant has run out of food.'); }
  } else if (DECKS[i].spend) earn(deckSpend(i));
}
const earn = n => { S.cash += n; S.stats.onboard += n; };
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
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('r', 4); el.setAttribute('class', 'guest'); layer.appendChild(el);
    const g = { mood: clamp(62 + rand(-8, 8) - (S.price - 400) / 25, 5, 95), deck: CABINS, stay: rand(0, 0.6),
      x: rand(184, 336), y: 560, tx: rand(184, 336), ph: rand(0, 6.28), el };
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

function buildShip() {
  let h = `<path class="hull" d="M170 110 C170 52 228 16 260 10 C292 16 350 52 350 110 Z"/>
    <circle class="hull" cx="260" cy="72" r="14"/>
    <path class="hull" d="M170 500 L140 582 L170 550 Z"/><path class="hull" d="M350 500 L380 582 L350 550 Z"/>
    <path class="hull" d="M218 530 L204 572 H316 L302 530 Z"/>`;
  DECKS.forEach((d, i) => {
    const y = deckTop(i);
    h += `<g class="deck" data-deck="${i}">
      <rect x="170" y="${y}" width="180" height="70"/>
      <line class="floor" x1="178" x2="342" y1="${y + 63}" y2="${y + 63}"/>
      <text class="name" x="154" y="${y + 32}">${d.name}</text>
      <text class="status" x="154" y="${y + 47}" id="st${i}"></text></g>`;
  });
  $('#ship').innerHTML = h + '<g id="guests"></g>';
}

const STATE_LABEL = { off: 'Powered down', sealed: 'Sealed', blackout: 'No power' };
function renderDecks() {
  const occ = occupancy();
  DECKS.forEach((d, i) => {
    const st = deckState(i), g = $(`.deck[data-deck="${i}"]`);
    g.classList.toggle('sel', S.selected === i);
    g.classList.toggle('dark', st !== 'open');
    g.classList.toggle('breach', !!(S.event && during().leak && S.event.deck === i));
    let t = 'L' + S.levels[i];
    if (st !== 'open') t = STATE_LABEL[st];
    else if (i === UTIL) t += S.phase === 'voyage' && !S.recOn ? ' · recycler off' : '';
    else if (S.phase === 'voyage') t += ` · ${occ[i]}/${d.cap[lvl(i)]}`;
    else t += ` · ${d.cap[lvl(i)]} ${i === CABINS ? 'berths' : 'places'}`;
    setText('#st' + i, t);
  });
}
const cache = {};
function setText(sel, t) { if (cache[sel] !== t) { cache[sel] = t; const el = $(sel); if (el) el.textContent = t; } }
function setBar(sel, frac, low) {
  const el = $(sel); el.style.width = (clamp(frac, 0, 1) * 100).toFixed(1) + '%'; el.classList.toggle('low', !!low);
}

function renderLive() {
  const voyage = S.phase === 'voyage';
  setText('#cash', money(S.cash));
  setText('#rep', S.rep.toFixed(1) + ' ★');
  setText('#cruise', String(S.cruise));
  setText('#guestcount', voyage ? String(S.guests.length) : '–');
  setText('#shipstate', voyage ? 'In orbit · 400 km' : 'Docked · Earth Port');

  setText('#o2v', `${Math.round(S.o2)} / ${o2Cap()}`);
  setBar('#o2b', S.o2 / o2Cap(), S.o2 < o2Cap() * 0.15);
  setText('#foodv', `${Math.round(S.food)} / ${foodCap()}`);
  setBar('#foodb', S.food / foodCap(), S.food < 5);
  setText('#batv', `${Math.round(S.battery)} / ${batCap()} kWh`);
  setBar('#batb', S.battery / batCap(), S.battery < batCap() * 0.2);

  const o2s = $('#o2s'), pows = $('#pows');
  if (voyage) {
    const leak = during().leak;
    setText('#o2s', leak ? 'Hull breach — venting' : S.recOn ? `Recycler on · ${Math.round(recRate() * 100)}% recovered` : 'Recycler offline');
    o2s.classList.toggle('warn', !!leak || !S.recOn);
    const gen = Math.round(genNow()), dem = demandNow();
    setText('#pows', `Solar ${gen} kW · Draw ${dem} kW`);
    pows.classList.toggle('warn', S.blackout);
    setText('#orbitn', `${Math.min(ORBITS, Math.floor(S.hour / (VOYAGE_H / ORBITS)) + 1)} of ${ORBITS}`);
    setText('#clock', clock(S.hour));
    setText('#light', inShadow() ? 'Earth shadow' : 'Sunlight');
    if (S.event) setText('#evtime', Math.max(0, S.event.deadline - S.hour).toFixed(1) + ' h to decide');
    const avg = S.guests.reduce((a, g) => a + g.mood, 0) / (S.guests.length || 1);
    setText('#moodv', Math.round(avg) + ' / 100');
    setText('#incomev', money(S.stats.onboard));
  } else {
    setText('#o2s', ''); setText('#pows', 'Charged at port'); o2s.classList.remove('warn'); pows.classList.remove('warn');
    setText('#orbitn', `– of ${ORBITS}`); setText('#clock', 'Docked'); setText('#light', '–');
  }
  $('#speed').style.visibility = voyage ? 'visible' : 'hidden';

  const a = S.angle * Math.PI / 180, dot = $('#shipdot');
  dot.setAttribute('cx', (60 + 46 * Math.cos(a)).toFixed(1));
  dot.setAttribute('cy', (60 - 46 * Math.sin(a)).toFixed(1));
  renderDecks();
  if (dirty) { dirty = false; renderContext(); renderDeckCard(); }
}

function renderContext() {
  const el = $('#context');
  Object.keys(cache).forEach(k => { if (k === '#evtime' || k === '#moodv' || k === '#incomev') delete cache[k]; });
  if (S.phase === 'port') {
    const n = expectedBookings(), cap = cabinCap();
    const needO2 = Math.round((n + CREW) * O2_USE * (1 - recRate()) * VOYAGE_H * 1.15), needFood = Math.round(n * 3.5);
    const resRow = (res, label, have, capv, price, need) => `
      <div class="row"><span>${label} <em class="${have < need ? 'warn' : ''}">need ~${need}</em></span>
      <span class="btns"><button data-act="buy" data-res="${res}" data-n="25" ${have >= capv || spendable() < price ? 'disabled' : ''}>+25 · ${money(25 * price)}</button>
      <button data-act="buy" data-res="${res}" data-n="9999" ${have >= capv || spendable() < price ? 'disabled' : ''}>Fill</button></span></div>`;
    el.innerHTML = `<h2>Earth Port</h2>
      <p>Set a fare, stock the ship, then fly a 24-hour loop of ${ORBITS} orbits. Click a deck to upgrade it.</p>
      <div class="row"><span>Ticket price</span><b id="pricev">${money(S.price)}</b></div>
      <input type="range" id="price" min="150" max="1000" step="25" value="${S.price}" aria-label="Ticket price">
      <div class="row"><span>Expected bookings</span><b id="bookv">${n} / ${cap}</b></div>
      <div style="height:8px"></div>
      ${resRow('o2', 'Oxygen', S.o2, o2Cap(), O2_PRICE, needO2)}
      ${resRow('food', 'Food', S.food, foodCap(), FOOD_PRICE, needFood)}
      <button class="primary" data-act="launch" ${n < 1 ? 'disabled' : ''}>Launch cruise ${S.cruise} · ${money(LAUNCH_COST)}</button>
      <div class="sub" style="margin-top:6px">The launch cost is held in reserve and cannot be spent on upgrades.</div>`;
  } else if (S.event) {
    const ev = S.event, d = ev.deck !== null ? DECKS[ev.deck] : null;
    el.innerHTML = `<div class="event"><h2>Emergency <em id="evtime"></em></h2>
      <h3>${ev.def.title}</h3><p>${ev.def.text(d)}</p>
      <div class="opts">${ev.def.options.map((o, i) =>
        `<button data-act="opt" data-i="${i}" ${optCost(o) > S.cash ? 'disabled' : ''}><b>${o.label}</b><span>${optNote(o)}</span></button>`).join('')}</div></div>`;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    el.innerHTML = `<h2>Under way</h2>
      <div class="row"><span>Guest mood</span><b id="moodv"></b></div>
      <div class="row"><span>On-board income</span><b id="incomev"></b></div>
      <div class="sub">Solar output collapses in Earth’s shadow. Power down decks if the battery runs low.</div>`;
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
    const top = deckTop(g.deck);
    const ty = g.deck === 1 ? top + 34 + Math.sin(t * 1.1 + g.ph) * 16 : top + 58;
    const tx = g.deck === 1 ? g.tx + Math.cos(t * 0.7 + g.ph) * 10 : g.tx;
    g.x += (clamp(tx, 180, 340) - g.x) * k; g.y += (ty - g.y) * k;
    g.el.setAttribute('cx', g.x.toFixed(1)); g.el.setAttribute('cy', g.y.toFixed(1));
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
  $('#guests').innerHTML = ''; $('#modal').hidden = true;
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
  renderLive();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.game = { get S() { return S; }, step, renderLive };
})();
