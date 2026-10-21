// Full Gaz ! — serveur multijoueur : « Chacun pour soi » (bataille à l'arbalète, en manches avec podium)
// ou « Coopération » (tous ensemble contre des vagues de monstres)
// Lancer : npm install && npm start   (port : variable PORT, 8080 par défaut)
"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");
const { W, H, OBS, collide, clamp } = require("./world");

const PORT = +process.env.PORT || 8080;
const MAX_PLAYERS = 10;
const TICK = 1 / 20;                 // 20 mises à jour par seconde

// Règles
const R = {
  hp: 3,
  speed: 265, boost: 1.35, boostTime: 4,
  fireCd: 0.6,
  boltSpeed: 950, boltLife: 0.95, hitR: 30,
  respawn: 3, spawnShield: 2,
  stun: 1.6, cloudR: 190, cloudLife: 3,
  items: 12, cafeMax: 2, poopLife: 20,
};
// Manches : 3 min ou premier à 15 K.O., podium 10 s, compte à rebours 4 s
const ROUND = { time: +process.env.ROUND_TIME || 180, win: +process.env.ROUND_WIN || 15, end: 10, count: 4 };  // ROUND_TIME=30 npm start pour tester vite
// Super-pâtisseries (power-ups) : une seule active à la fois par joueur
const POW = {
  rapid:  { item: "eclair", time: 7, fireCd: 0.22 },   // Éclair foudroyant : tir rapide
  triple: { item: "gelato", time: 7, spread: 0.2 },    // Glace triple boule : 3 carreaux en éventail
  armor:  { item: "donut",  time: 6 },                 // Donut bouclier : invulnérable
};
const POW_KINDS = Object.keys(POW), POW_MAX = 2;
// Pouvoirs des persos : la jauge se remplit avec les K.O. (3 K.O. = pouvoir prêt), il dure 6 s
//  ram   : véhicule (Alex = voiture, Nini = Vespa) — très rapide, renverse au contact, pas de tir, insensible au prout
//  melee : arme blanche (Greg, Arthur, Gargar, Yonarie) — plus rapide, K.O. en un coup au contact, garde l'arbalète
//  guard : bouclier (Mihide) — invulnérable, renvoie les carreaux à l'envoyeur
//  Yonarie crie en plus « QUOIIII » toutes les 1,5 s : étourdit les adversaires proches
const SUPER = { need: 3, time: 6, ramR: 64, meleeR: 60, quoiR: 230, quoiEvery: 1.5,
  speed: { ram: 1.7, melee: 1.3, guard: 1.2 } };
const TEST_SUPER = process.env.TEST_SUPER === "1"; // test : jauge pleine en permanence
const SUPER_KIND = { sucre: "ram", italien: "ram", sale: "melee", arthur: "melee", gargar: "melee", mike: "melee", yonarie: "melee", mihide: "guard" };
const superOf = p => (p.spT > 0 ? SUPER_KIND[p.ch] || "melee" : "");
// Mode Coopération : tous ensemble contre des vagues de monstres
//  - pas de tirs amis : carreaux, prouts, cacas et pouvoirs ne touchent que les monstres
//  - une vague est finie quand tous ses monstres sont éliminés ; pause, les K.O. reviennent, vague suivante
//  - si toute l'équipe est K.O. en même temps, la partie est perdue (podium des chasseurs)
const COOP = { respawn: 6, need: 5, breakT: +process.env.COOP_BREAK || 6, spawnEvery: 0.7, inv: 1.2, stun: 3, hitR: 34, firstWave: +process.env.COOP_WAVE || 1 };
// Monstres (mêmes que le mode solo) : vitesse et points de vie (1 carreau = 1 point)
const MON = { p: { sp: 150, hp: 2 }, g: { sp: 138, hp: 2 }, o: { sp: 120, hp: 3 }, r: { sp: 112, hp: 3 }, a: { sp: 130, hp: 10 } };
const MODES = ["versus", "coop"];
// éclair et donut sont réservés aux super-pâtisseries pour qu'on les reconnaisse
const TREATS = ["croissant", "painchoc", "bonbon", "baguette", "burger", "penne", "spaghetti", "lasagne"];

const rooms = new Map();
const rnd = Math.random;
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);
const r1 = v => Math.round(v * 10) / 10;

function cleanName(s) {
  s = String(s || "").trim().replace(/\s+/g, " ").slice(0, 16);
  if (s.length < 2 || /[<>"\\/]/.test(s)) return null;
  return s;
}
function cleanRoom(s) {
  s = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s || "GAZ";
}

/* ---------- salle ---------- */
class Room {
  constructor(code, mode, priv) {
    this.code = code;
    this.priv = !!priv;          // salle privée : absente de la liste, on la rejoint avec le code ou un lien
    this.mode = MODES.includes(mode) ? mode : "versus";
    this.coop = this.mode === "coop";
    this.mons = []; this.queue = []; this.wave = 0; this.spawnT = 0; this.monSpeed = 1;
    this.players = new Map();
    this.bolts = []; this.items = []; this.poops = []; this.clouds = [];
    this.coffee = null; this.coffeeT = 5;
    this.powers = []; this.powT = 8;
    this.phase = "wait"; this.phaseT = 0; this.round = 0; this.podium = null;
    this.nextId = 1; this.nextObj = 1;
    this.events = [];
    this.t = 0;
    for (let i = 0; i < R.items; i++) this.spawnItem();
  }

  freeSpot(minDist = 0, margin = 0) {
    let bestSpot = null, bestD = -1;
    for (let k = 0; k < 120; k++) {
      const x = 80 + margin + rnd() * (W - 160 - margin * 2), y = 90 + margin + rnd() * (H - 170 - margin * 2);
      if (OBS.some(o => Math.hypot(o.x - x, o.y - y) < o.r + 34)) continue;
      let d = 1e9;
      for (const p of this.players.values()) if (p.alive) d = Math.min(d, Math.hypot(p.x - x, p.y - y));
      if (d >= minDist) return { x, y };
      if (d > bestD) { bestD = d; bestSpot = { x, y }; }
    }
    return bestSpot || { x: 300, y: 300 };
  }
  spawnItem() { this.itemsDirty = true; const p = this.freeSpot(0); this.items.push({ id: this.nextObj++, x: p.x, y: p.y, k: TREATS[Math.floor(rnd() * TREATS.length)] }); }
  ev(e) { this.events.push(e); }

  addPlayer(ws, name, ch) {
    const id = this.nextId++;
    const p = {
      id, ws, name, ch: ["sucre", "sale", "italien", "mihide", "yonarie", "arthur", "gargar", "mike"].includes(ch) ? ch : "sucre",
      x: 0, y: 0, vx: 0, vy: 0, r: 22, a: 0, mv: 0,
      hp: R.hp, alive: true, deadT: 0, shield: R.spawnShield, stun: 0, boost: 0,
      gauge: 0, cafe: 0, cd: 0, kills: 0, deaths: 0, streak: 0, lastMove: Date.now(),
      act: "", actT: 0, hitT: 0, spawnN: 0, pw: "", pwT: 0, pk: 0, spT: 0, quoiT: 0,
    };
    const s = this.freeSpot(450, 140); p.x = s.x; p.y = s.y;
    this.players.set(id, p);
    this.itemsDirty = true;
    this.ev({ k: "join", id, name });
    return p;
  }
  removePlayer(p) {
    this.players.delete(p.id);
    this.ev({ k: "leave", id: p.id, name: p.name });
    if (!this.players.size) rooms.delete(this.code);
  }

  /* ---------- manches ---------- */
  setPhase(ph, t) { this.phase = ph; this.phaseT = t; this.rosterDirty = true; }
  ranking() {
    return [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
  }
  // remet tout le monde à zéro, chacun à un endroit différent, avant une nouvelle manche
  resetRound() {
    this.bolts = []; this.poops = []; this.clouds = []; this.powers = []; this.powT = 6;
    this.mons = []; this.queue = []; this.wave = 0;
    this.items = []; for (let i = 0; i < R.items; i++) this.spawnItem();
    this.coffee = null; this.coffeeT = 8;
    const P = [...this.players.values()];
    for (const p of P) p.alive = false; // pour que freeSpot les répartisse un par un
    for (const p of P) {
      const s = this.freeSpot(500, 140);
      p.spawnN++; p.lastMove = Date.now();
      Object.assign(p, { x: s.x, y: s.y, vx: 0, vy: 0, hp: R.hp, alive: true, deadT: 0, shield: ROUND.count + R.spawnShield, stun: 0, boost: 0,
        gauge: 0, cafe: 0, cd: 0, kills: 0, deaths: 0, streak: 0, act: "", actT: 0, kbBudget: 0, pw: "", pwT: 0, pk: 0, spT: 0 });
      this.ev({ k: "spawn", id: p.id, x: r1(p.x), y: r1(p.y), sn: p.spawnN });
    }
    this.itemsDirty = true; this.podium = null;
  }
  endRound(why) {
    const rk = this.ranking();
    this.podium = rk.map(p => [p.id, p.name, p.ch, p.kills, p.deaths]);
    this.bolts = [];
    this.setPhase("end", ROUND.end);
    this.ev({ k: "rend", why, win: rk[0] ? rk[0].id : 0, wave: this.wave });
  }
  supNeed() { return this.coop ? COOP.need : SUPER.need; }
  respawn(p) {
    const s = this.freeSpot(this.coop ? 0 : 500, 140);
    p.spawnN++; p.lastMove = Date.now(); p.pw = ""; p.pwT = 0; p.spT = 0;
    Object.assign(p, { x: s.x, y: s.y, vx: 0, vy: 0, hp: R.hp, alive: true, deadT: 0, shield: R.spawnShield, stun: 0, act: "", kbBudget: 0, inv: 0 });
    this.ev({ k: "spawn", id: p.id, x: r1(p.x), y: r1(p.y), sn: p.spawnN });
  }

  /* ---------- coopération : vagues de monstres ---------- */
  startRun() {
    this.resetRound(); this.round++;
    this.setPhase("count", ROUND.count); this.ev({ k: "rcount", n: this.round });
  }
  startWave(n) {
    this.wave = n;
    const np = Math.max(1, this.players.size);
    const total = Math.min(70, Math.round((3 + n * 2.5) * (1 + 0.45 * (np - 1))));
    const q = []; for (let i = 0; i < total; i++) q.push("pgor"[(i + n) % 4]);
    // le croqueur de pomme (boss) arrive toutes les 3 vagues
    const boss = n % 3 === 0 ? Math.min(3, n / 3) : 0;
    for (let k = 1; k <= boss; k++) q.splice(Math.floor(q.length * k / (boss + 1)), 0, "a");
    this.queue = q; this.spawnT = 1;
    this.monSpeed = Math.min(1.4, 1 + 0.035 * (n - 1));
    this.setPhase("play", 0);
    this.ev({ k: "wave", n, tot: q.length, boss });
  }
  monsLeft() { return this.queue.length + this.mons.filter(m => m.st !== "dead").length; }
  spawnMon(type) {
    const s = this.freeSpot(600);
    const np = Math.max(1, this.players.size), T = MON[type];
    const hp = type === "a" ? T.hp + 4 * (np - 1) : T.hp + (this.wave >= 8 ? 1 : 0);
    this.mons.push({ id: this.nextObj++, type, x: s.x, y: s.y, vx: 0, vy: 0, r: 24, hp, max: hp, st: "chase", t: 0,
      ph: rnd() * 6, cyc: rnd() * 3, mode: "", face: 1, kbx: 0, kby: 0, hitT: 0, jump: 0, burst: false, meleeT: 0, wt: null });
    if (type === "a") this.ev({ k: "boss" });
  }
  hurtMon(m, by, dmg, kind, kx, ky) {
    if (m.st === "dead") return;
    m.hp -= dmg; m.hitT = 0.2; m.kbx += kx; m.kby += ky;
    if (m.hp <= 0) {
      m.hp = 0; m.st = "dead"; m.t = 0; m.vx = m.vy = 0;
      if (by) {
        by.kills++; by.streak++;
        if (!(by.spT > 0) && by.pk < this.supNeed()) { by.pk++; if (by.pk === this.supNeed()) this.ev({ k: "superok", id: by.id }); }
      }
      this.ev({ k: "mkill", id: m.id, by: by ? by.id : 0, kind, ty: m.type, x: r1(m.x), y: r1(m.y), streak: by ? by.streak : 0 });
    } else this.ev({ k: "mhit", id: m.id, by: by ? by.id : 0, x: r1(m.x), y: r1(m.y) });
  }
  stunMon(m, kx, ky, t = COOP.stun) {
    if (m.st === "dead") return;
    m.st = "stun"; m.t = COOP.stun - t; m.kbx = kx; m.kby = ky; m.jump = 0; m.burst = false;
    this.ev({ k: "mstun", id: m.id });
  }
  updateMons(dt, P) {
    const alive = P.filter(p => p.alive);
    // apparition progressive des monstres de la vague
    if (this.phase === "play" && this.queue.length) {
      this.spawnT -= dt;
      const cap = Math.min(24, 6 + 2 * alive.length + this.wave);
      if (this.spawnT <= 0 && this.mons.filter(m => m.st !== "dead").length < cap) { this.spawnMon(this.queue.shift()); this.spawnT = COOP.spawnEvery; }
    }
    for (let i = this.mons.length - 1; i >= 0; i--) {
      const m = this.mons[i], T = MON[m.type];
      m.t += dt; m.ph += dt * 9; m.hitT = Math.max(0, m.hitT - dt); m.meleeT = Math.max(0, m.meleeT - dt);
      const kd = Math.pow(0.02, dt); m.kbx *= kd; m.kby *= kd;
      if (m.st === "dead") { if (m.t > (m.type === "a" ? 2.4 : 0.9)) this.mons.splice(i, 1); continue; }  // le boss reste étendu au sol un moment
      if (m.st === "stun") {
        if (m.t > COOP.stun) { m.st = "chase"; m.t = 0; }
        const vd = Math.pow(0.05, dt); m.vx *= vd; m.vy *= vd;
        m.x += (m.vx + m.kbx) * dt; m.y += (m.vy + m.kby) * dt; collide(m);
        continue;
      }
      let tgt = null, d = 1e9;
      for (const p of alive) { const dd = Math.hypot(p.x - m.x, p.y - m.y); if (dd < d) { d = dd; tgt = p; } }
      let spd = T.sp * this.monSpeed, tx, ty;
      m.burst = false;
      const wander = () => {
        if (!m.wt || Math.hypot(m.wt.x - m.x, m.wt.y - m.y) < 40) m.wt = this.freeSpot(0);
        tx = m.wt.x; ty = m.wt.y;
      };
      if (!tgt) { wander(); spd *= 0.5; }
      else {
        tx = tgt.x; ty = tgt.y;
        if (m.type === "p") {
          m.cyc -= dt; if (m.cyc <= 0) { m.jump = 0.6; m.cyc = 2.5 + rnd() * 2; }
          if (m.jump > 0) { m.jump -= dt; spd *= 1.7; m.burst = true; }
          tx += Math.sin(m.t * 2) * 70; ty += Math.cos(m.t * 1.6) * 70;
        } else if (m.type === "g") {
          const look = Math.min(1, d / 300); tx += tgt.vx * look; ty += tgt.vy * look; if (d < 240) spd *= 1.15;
        } else if (m.type === "o") {
          if (!m.mode) m.mode = "run";
          m.cyc -= dt; if (m.cyc <= 0) { m.mode = m.mode === "run" ? "tired" : "run"; m.cyc = m.mode === "run" ? 2.6 : 1.8; }
          if (m.mode === "tired") spd = 0; else spd *= 1.75;
        } else if (m.type === "r") {
          m.burst = d < 260; if (m.burst) spd *= 1.8;
        } else if (m.type === "a") {
          if (!m.mode) m.mode = "walk";
          if (m.mode === "walk") { wander(); spd = 70; if (d < 320) { m.mode = "laugh"; m.cyc = 0.9; this.ev({ k: "laugh", id: m.id }); } }
          else if (m.mode === "laugh") { m.cyc -= dt; spd = 0; m.face = tgt.x > m.x ? 1 : -1; if (m.cyc <= 0) m.mode = "chase"; }
          else { spd *= d < 170 ? 1.3 : 1.15; m.burst = d < 170; if (d > 1000) { m.mode = "walk"; m.wt = null; } }
        }
      }
      // cacas : ralentissent les monstres autour, celui qui marche dedans y passe (le boss perd 4 points)
      for (let k = this.poops.length - 1; k >= 0; k--) {
        const pp = this.poops[k], dp = Math.hypot(pp.x - m.x, pp.y - m.y);
        if (dp < 170) spd *= 0.5;
        if (dp < m.r + 30) {
          const dx = m.x - pp.x, dy = m.y - pp.y, dl = Math.hypot(dx, dy) || 1;
          this.poops.splice(k, 1);
          this.ev({ k: "squish", x: r1(pp.x), y: r1(pp.y) });
          this.hurtMon(m, this.players.get(pp.owner) || null, m.type === "a" ? 4 : 99, "poop", dx / dl * 300, dy / dl * 300);
          break;
        }
      }
      if (m.st !== "chase") continue;
      let dx = tx - m.x, dy = ty - m.y, dl = Math.hypot(dx, dy) || 1, ax = dx / dl, ay = dy / dl;
      if (m.hitObs) {
        const o = m.hitObs, ox = m.x - o.x, oy = m.y - o.y, cr = ax * oy - ay * ox > 0 ? 1 : -1, ol = Math.hypot(ox, oy) || 1;
        ax += -oy / ol * cr * 0.9; ay += ox / ol * cr * 0.9; m.hitObs = null;
      }
      for (const n of this.mons) {
        if (n === m || n.st === "dead") continue;
        const sx = m.x - n.x, sy = m.y - n.y, sd = Math.hypot(sx, sy);
        if (sd < 56 && sd > 0) { ax += sx / sd * 0.8; ay += sy / sd * 0.8; }
      }
      const al = Math.hypot(ax, ay) || 1, k5 = Math.min(1, dt * 5);
      m.vx += (ax / al * spd - m.vx) * k5; m.vy += (ay / al * spd - m.vy) * k5;
      m.x += (m.vx + m.kbx) * dt; m.y += (m.vy + m.kby) * dt; collide(m);
      if (Math.abs(m.vx) > 10 && m.mode !== "laugh") m.face = m.vx > 0 ? 1 : -1;
      // morsure : 1 cœur, puis le joueur est intouchable un court instant
      if (!tgt || (m.type === "o" && m.mode === "tired") || (m.type === "a" && m.mode !== "chase")) continue;
      for (const p of alive) {
        if (p.inv > 0 || !p.alive) continue;
        const bx = p.x - m.x, by = p.y - m.y, bd = Math.hypot(bx, by) || 1;
        if (bd > m.r + p.r - 4) continue;
        p.inv = COOP.inv;
        this.damage(p, null, "mon", bx / bd * 600, by / bd * 600);
        m.kbx = -bx / bd * 300; m.kby = -by / bd * 300;
      }
    }
  }
  updatePhaseCoop(dt) {
    const n = this.players.size;
    if (this.phase === "wait") { if (n >= 1) this.startRun(); return; }
    this.phaseT -= dt;
    const allDead = n > 0 && [...this.players.values()].every(p => !p.alive);
    if (this.phase === "count") {
      if (this.phaseT <= 0) this.startWave(COOP.firstWave);
    } else if (this.phase === "play") {
      if (allDead) { this.endRound("lose"); return; }
      if (!this.monsLeft()) {
        this.setPhase("break", COOP.breakT);
        for (const p of this.players.values()) if (!p.alive) this.respawn(p);
        this.ev({ k: "wclear", n: this.wave });
      }
    } else if (this.phase === "break") {
      if (allDead) { this.endRound("lose"); return; }
      if (this.phaseT <= 0) this.startWave(this.wave + 1);
    } else if (this.phase === "end") {
      if (this.phaseT <= 0) {
        if (n >= 1) this.startRun();
        else { this.podium = null; this.setPhase("wait", 0); }
      }
    }
  }
  updatePhase(dt) {
    if (this.coop) { this.updatePhaseCoop(dt); return; }
    const n = this.players.size;
    if (this.phase === "wait") {
      if (n >= 2) { this.resetRound(); this.round++; this.setPhase("count", ROUND.count); this.ev({ k: "rcount", n: this.round }); }
      return;
    }
    this.phaseT -= dt;
    if (this.phase === "count") {
      if (n < 2) { this.setPhase("wait", 0); return; }
      if (this.phaseT <= 0) { this.setPhase("play", ROUND.time); this.ev({ k: "rgo", n: this.round }); }
    } else if (this.phase === "play") {
      if (n < 2) { this.endRound("alone"); return; }
      const top = this.ranking()[0];
      if (top && top.kills >= ROUND.win) this.endRound("win");
      else if (this.phaseT <= 0) this.endRound("time");
    } else if (this.phase === "end") {
      if (this.phaseT <= 0) {
        if (n >= 2) { this.resetRound(); this.round++; this.setPhase("count", ROUND.count); this.ev({ k: "rcount", n: this.round }); }
        else { this.podium = null; this.setPhase("wait", 0); }
      }
    }
  }
  // pendant le compte à rebours et le podium, on ne peut pas attaquer
  canFight() { return this.phase === "play" || this.phase === "wait" || this.phase === "break"; }

  spawnPower() {
    const s = this.freeSpot(260);
    const k = POW_KINDS[Math.floor(rnd() * POW_KINDS.length)];
    this.powers.push({ id: this.nextObj++, x: s.x, y: s.y, k });
    this.itemsDirty = true;
    this.ev({ k: "pwspawn", x: Math.round(s.x), y: Math.round(s.y), p: k });
  }

  /* messages du joueur */
  onState(p, m) {
    // après une réapparition, on ignore les positions envoyées avant que le client l'ait reçue
    if (!p.alive || (m.sn | 0) !== p.spawnN) return;
    // le client calcule son déplacement ; le serveur vérifie la vitesse et les obstacles
    const now = Date.now(), dt = Math.min(0.5, Math.max(0.016, (now - p.lastMove) / 1000));
    p.lastMove = now;
    const sk = superOf(p), sm = sk ? SUPER.speed[sk] : 1;
    const max = R.speed * R.boost * sm * 1.6 * dt + 40 + (p.kbBudget || 0);
    let nx = num(m.x, p.x), ny = num(m.y, p.y);
    const dx = nx - p.x, dy = ny - p.y, d = Math.hypot(dx, dy);
    if (d > max) { nx = p.x + dx / d * max; ny = p.y + dy / d * max; }
    p.kbBudget = 0;
    p.x = nx; p.y = ny; collide(p);
    p.vx = clamp(num(m.vx), -600, 600); p.vy = clamp(num(m.vy), -600, 600);
    p.a = num(m.a, p.a); p.mv = m.mv ? 1 : 0;
  }
  onFire(p, m) {
    if (!p.alive || p.stun > 0 || p.cd > 0 || !this.canFight() || superOf(p) === "ram") return;
    // petite marge : le client compte son propre délai et peut tirer quelques ms en avance
    p.cd = (p.pw === "rapid" ? POW.rapid.fireCd : R.fireCd) - 0.04; p.shield = 0; p.act = "aim"; p.actT = 0.35;
    const a = num(m.a, p.a); p.a = a;
    const face = Math.cos(a) >= 0 ? 1 : -1;
    const angs = p.pw === "triple" ? [a - POW.triple.spread, a, a + POW.triple.spread] : [a];
    for (const aa of angs) this.bolts.push({
      id: this.nextObj++, cid: num(m.cid) | 0, owner: p.id,
      x: p.x + face * 30 + Math.cos(a) * 20, y: p.y + Math.sin(a) * 20,
      vx: Math.cos(aa) * R.boltSpeed, vy: Math.sin(aa) * R.boltSpeed, life: R.boltLife,
    });
    this.ev({ k: "shoot", id: p.id });
  }
  onProut(p) {
    if (!p.alive || p.gauge < 5 || !this.canFight()) return;
    p.gauge = 0; p.act = "fart"; p.actT = 0.55;
    this.clouds.push({ id: this.nextObj++, owner: p.id, x: p.x - (Math.cos(p.a) >= 0 ? 1 : -1) * 20, y: p.y - 20, t: 0, hit: new Set() });
    this.ev({ k: "prout", id: p.id });
  }
  onSuper(p) {
    if (!p.alive || p.pk < this.supNeed() || p.spT > 0 || this.phase === "count" || this.phase === "end") return;
    p.pk = 0; p.spT = SUPER.time; p.quoiT = 0.2; p.stun = 0; p.shield = 0;
    this.ev({ k: "super", id: p.id, s: SUPER_KIND[p.ch] || "melee" });
  }
  onCaca(p) {
    if (!p.alive || p.cafe < 1 || !this.canFight()) return;
    p.cafe--; p.act = "poop"; p.actT = 0.5;
    const face = Math.cos(p.a) >= 0 ? 1 : -1;
    this.poops.push({ id: this.nextObj++, owner: p.id, x: clamp(p.x - face * 36, 60, W - 60), y: p.y + 6, t: 0 });
    this.ev({ k: "plop", id: p.id });
  }

  damage(v, by, kind, kx, ky) {
    if (!v.alive || v.shield > 0 || !this.canFight()) return false;
    if (v.pw === "armor" || superOf(v) === "guard") { this.ev({ k: "block", id: v.id, x: r1(v.x), y: r1(v.y) }); return false; }
    v.hp--; v.hitT = 0.25;
    this.ev({ k: "hit", id: v.id, by: by ? by.id : 0, kind, kx: r1(kx), ky: r1(ky) });
    v.kbBudget = (v.kbBudget || 0) + 160;
    if (v.hp <= 0) {
      v.alive = false; v.deadT = this.coop ? COOP.respawn : R.respawn; v.deaths++; v.streak = 0; v.gauge = 0; v.cafe = 0; v.pw = ""; v.pwT = 0; v.spT = 0;
      if (by && by !== v) { by.kills++; by.streak++; if (!(by.spT > 0) && by.pk < this.supNeed()) { by.pk++; if (by.pk === this.supNeed()) this.ev({ k: "superok", id: by.id }); } }
      this.ev({ k: "kill", id: v.id, by: by ? by.id : 0, kind, streak: by ? by.streak : 0 });
    }
    return true;
  }

  update(dt) {
    this.t += dt;
    this.updatePhase(dt);
    const P = [...this.players.values()];
    for (const p of P) {
      if (p.pwT > 0) { p.pwT -= dt; if (p.pwT <= 0) { p.pw = ""; p.pwT = 0; } }
      p.cd = Math.max(0, p.cd - dt); p.shield = Math.max(0, p.shield - dt); p.stun = Math.max(0, p.stun - dt);
      p.boost = Math.max(0, p.boost - dt); p.hitT = Math.max(0, p.hitT - dt); p.inv = Math.max(0, (p.inv || 0) - dt);
      if (p.actT > 0) { p.actT -= dt; if (p.actT <= 0) p.act = ""; }
      if (!p.alive) {
        p.deadT -= dt;
        // en coopération, pas de retour pendant que l'équipe est déjà perdue
        if (p.deadT <= 0 && this.phase !== "end") this.respawn(p);
        continue;
      }
      // pouvoir du perso
      if (TEST_SUPER && !(p.spT > 0)) p.pk = this.supNeed();
      if (p.spT > 0) {
        p.spT -= dt;
        const sk = superOf(p);
        if (p.spT <= 0) { p.spT = 0; this.ev({ k: "superend", id: p.id }); }
        // en coopération, Mihide (bouclier) frappe aussi les monstres au contact : sinon son pouvoir ne servait à rien contre eux
        else if (sk === "ram" || sk === "melee" || (sk === "guard" && this.coop)) {
          const rad = sk === "ram" ? SUPER.ramR : SUPER.meleeR;
          if (this.coop) for (const m of this.mons) {
            if (m.st === "dead" || m.meleeT > 0 || Math.hypot(m.x - p.x, m.y - p.y) > rad + 4) continue;
            const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy) || 1;
            m.meleeT = 0.35; this.hurtMon(m, p, m.type === "a" ? 3 : 99, sk, dx / d * 520, dy / d * 520);
          }
          if (!this.coop && sk !== "guard") for (const v of P) {
            if (v === p || !v.alive || v.shield > 0) continue;
            if (Math.hypot(v.x - p.x, v.y - p.y) > rad) continue;
            if (v.pw === "armor" || superOf(v) === "guard") continue;
            const dx = v.x - p.x, dy = v.y - p.y, d = Math.hypot(dx, dy) || 1;
            v.hp = 1; this.damage(v, p, sk, dx / d * 520, dy / d * 520);
          }
          if (p.ch === "yonarie") {
            p.quoiT -= dt;
            if (p.quoiT <= 0) {
              p.quoiT = SUPER.quoiEvery;
              this.ev({ k: "quoi", id: p.id });
              if (this.coop) for (const m of this.mons) {
                const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy) || 1;
                if (m.st === "chase" && d < SUPER.quoiR) this.stunMon(m, dx / d * 360, dy / d * 360, 1.3);
              }
              if (!this.coop) for (const v of P) {
                if (v === p || !v.alive || v.shield > 0 || superOf(v) === "ram" || superOf(v) === "guard") continue;
                const dx = v.x - p.x, dy = v.y - p.y, d = Math.hypot(dx, dy) || 1;
                if (d > SUPER.quoiR) continue;
                v.stun = Math.max(v.stun, 1.1); v.kbBudget = (v.kbBudget || 0) + 260;
                this.ev({ k: "stun", id: v.id, by: p.id, kx: r1(dx / d * 360), ky: r1(dy / d * 360) });
              }
            }
          }
        }
      }
      // friandises
      for (let i = this.items.length - 1; i >= 0; i--) {
        const it = this.items[i];
        if (Math.hypot(it.x - p.x, it.y - (p.y - 20)) < 46) {
          this.items.splice(i, 1);
          p.gauge = Math.min(5, p.gauge + 1);
          const heal = p.hp < R.hp; if (heal) p.hp++;
          p.act = "eat"; p.actT = 0.3;
          this.ev({ k: "eat", id: p.id, x: r1(it.x), y: r1(it.y), heal: heal ? 1 : 0, full: p.gauge === 5 ? 1 : 0 });
          this.spawnItem();
        }
      }
      // super-pâtisseries
      for (let i = this.powers.length - 1; i >= 0; i--) {
        const w = this.powers[i];
        if (Math.hypot(w.x - p.x, w.y - (p.y - 20)) < 50) {
          this.powers.splice(i, 1); this.itemsDirty = true;
          p.pw = w.k; p.pwT = POW[w.k].time; p.act = "eat"; p.actT = 0.3;
          this.ev({ k: "power", id: p.id, p: w.k, x: r1(w.x), y: r1(w.y) });
        }
      }
      // café
      if (this.coffee && Math.hypot(this.coffee.x - p.x, this.coffee.y - (p.y - 20)) < 48 && p.cafe < R.cafeMax) {
        this.coffee = null; this.coffeeT = 10 + rnd() * 6; this.itemsDirty = true;
        p.cafe++; p.boost = R.boostTime;
        this.ev({ k: "cafe", id: p.id });
      }
    }
    if (this.coop) this.updateMons(dt, P);
    if (this.powers.length < POW_MAX && this.phase !== "end") { this.powT -= dt; if (this.powT <= 0) { this.powT = 9 + rnd() * 6; this.spawnPower(); } }
    if (!this.coffee) { this.coffeeT -= dt; if (this.coffeeT <= 0) { const s = this.freeSpot(250); this.coffee = { x: s.x, y: s.y }; this.itemsDirty = true; } }

    // carreaux : test en segment pour ne pas traverser un joueur entre deux images
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const x0 = b.x, y0 = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 30 || b.x > W - 30 || b.y < 40 || b.y > H - 30;
      if (!dead) {
        const sx = b.x - x0, sy = b.y - y0, sl = sx * sx + sy * sy || 1;
        let hitT = 2, hitP = null, hitM = null;
        // coopération : les carreaux traversent les coéquipiers et touchent les monstres
        if (this.coop) for (const m of this.mons) {
          if (m.st === "dead") continue;
          let t = ((m.x - x0) * sx + (m.y - y0) * sy) / sl; t = clamp(t, 0, 1);
          if (Math.hypot(x0 + sx * t - m.x, y0 + sy * t - m.y) < COOP.hitR && t < hitT) { hitT = t; hitM = m; }
        }
        if (!this.coop) for (const p of P) {
          if (p.id === b.owner || !p.alive) continue;
          let t = ((p.x - x0) * sx + (p.y - y0) * sy) / sl; t = clamp(t, 0, 1);
          const d = Math.hypot(x0 + sx * t - p.x, y0 + sy * t - p.y);
          if (d < R.hitR && t < hitT) { hitT = t; hitP = p; }
        }
        let obsT = 2;
        for (const o of OBS) {
          if (o.kind !== "tree") continue; // on tire par-dessus les bancs et le puits de lave
          let t = ((o.x - x0) * sx + (o.y - y0) * sy) / sl; t = clamp(t, 0, 1);
          if (Math.hypot(x0 + sx * t - o.x, y0 + sy * t - o.y) < o.r + 4 && t < obsT) obsT = t;
        }
        if (hitM && hitT <= obsT) {
          const sp = Math.hypot(b.vx, b.vy) || 1;
          this.hurtMon(hitM, this.players.get(b.owner) || null, 1, "bolt", b.vx / sp * 220, b.vy / sp * 220);
          dead = true;
        } else if (hitP && hitT <= obsT) {
          const sh = this.players.get(b.owner);
          const sp = Math.hypot(b.vx, b.vy) || 1;
          if (superOf(hitP) === "guard") {
            // Mihide renvoie le carreau à l'envoyeur
            b.owner = hitP.id; b.vx = -b.vx; b.vy = -b.vy; b.life = R.boltLife; b.x = x0; b.y = y0;
            this.ev({ k: "reflect", id: hitP.id, x: r1(hitP.x), y: r1(hitP.y) });
            continue;
          }
          if (hitP.shield > 0) this.ev({ k: "block", id: hitP.id, x: r1(hitP.x), y: r1(hitP.y) });
          else this.damage(hitP, sh, "bolt", b.vx / sp * 320, b.vy / sp * 320);
          dead = true;
        } else if (obsT <= 1) {
          b.x = x0 + sx * obsT; b.y = y0 + sy * obsT;
          this.ev({ k: "thunk", x: r1(b.x), y: r1(b.y), a: r1(Math.atan2(b.vy, b.vx)) });
          dead = true;
        }
      }
      if (dead) this.bolts.splice(i, 1);
    }

    // nuages de prout : étourdissent les adversaires
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i]; c.t += dt;
      const rad = Math.min(1, c.t / .35) * R.cloudR;
      if (this.coop && c.t < R.cloudLife - .3) for (const m of this.mons) {
        if (m.st !== "chase" || c.hit.has("m" + m.id) || Math.hypot(c.x - m.x, c.y - m.y) > rad + 10) continue;
        c.hit.add("m" + m.id);
        const dx = m.x - c.x, dy = m.y - c.y, d = Math.hypot(dx, dy) || 1;
        this.stunMon(m, dx / d * 420, dy / d * 420);
      }
      if (!this.coop && c.t < R.cloudLife - .3) for (const p of P) {
        if (p.id === c.owner || !p.alive || c.hit.has(p.id) || p.shield > 0 || superOf(p) === "ram" || superOf(p) === "guard") continue;
        if (Math.hypot(c.x - p.x, c.y - p.y) < rad + 10) {
          c.hit.add(p.id); p.stun = R.stun; p.kbBudget = (p.kbBudget || 0) + 300;
          const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1;
          this.ev({ k: "stun", id: p.id, by: c.owner, kx: r1(dx / d * 420), ky: r1(dy / d * 420) });
        }
      }
      if (c.t > R.cloudLife) this.clouds.splice(i, 1);
    }

    // cacas : le premier adversaire qui marche dedans perd un cœur
    for (let i = this.poops.length - 1; i >= 0; i--) {
      const pp = this.poops[i]; pp.t += dt;
      let gone = pp.t > R.poopLife;
      if (!gone && !this.coop) for (const p of P) {
        if (p.id === pp.owner || !p.alive || p.shield > 0) continue;
        if (Math.hypot(pp.x - p.x, pp.y - p.y) < p.r + 26) {
          const dx = p.x - pp.x, dy = p.y - pp.y, d = Math.hypot(dx, dy) || 1;
          this.damage(p, this.players.get(pp.owner), "poop", dx / d * 300, dy / d * 300);
          this.ev({ k: "squish", x: r1(pp.x), y: r1(pp.y) });
          gone = true; break;
        }
      }
      if (gone) this.poops.splice(i, 1);
    }
  }

  snapshot() {
    // friandises et café : envoyés seulement quand ils changent (et toutes les 2 s par sécurité)
    const sendItems = this.itemsDirty || !this.itemsT || this.t - this.itemsT > 2;
    if (sendItems) { this.itemsDirty = false; this.itemsT = this.t; }
    // joueurs : [id, x, y, vx, vy, angle, état, pv, jauge, café, bouclier/étourdi/boost...]
    const pl = [];
    for (const p of this.players.values()) {
      let f = 0;
      if (p.alive) f |= 1; if (p.mv) f |= 2; if (p.shield > 0) f |= 4; if (p.stun > 0) f |= 8; if (p.boost > 0) f |= 16; if (p.hitT > 0) f |= 32;
      pl.push([p.id, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy), Math.round(p.a * 100) / 100, f, p.hp, p.gauge, p.cafe, p.act, Math.ceil(p.deadT * 10) / 10, p.pw, r1(p.pwT), p.pk, r1(p.spT)]);
    }
    return {
      t: "s", tm: Math.round(this.t * 1000),
      p: pl,
      b: this.bolts.map(b => [b.id, b.owner, b.cid, r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy)]),
      i: sendItems ? this.items.map(it => [it.id, Math.round(it.x), Math.round(it.y), it.k]) : undefined,
      c: sendItems ? (this.coffee ? [Math.round(this.coffee.x), Math.round(this.coffee.y)] : 0) : undefined,
      w: sendItems ? this.powers.map(w => [w.id, Math.round(w.x), Math.round(w.y), w.k]) : undefined,
      g: [this.phase, Math.max(0, Math.ceil(this.phaseT * 10) / 10), this.round, this.wave, this.coop ? this.monsLeft() : 0],
      // monstres : [id, type, x, y, drapeaux, pv, pv max]
      m: this.coop ? this.mons.map(m => {
        let f = 0;
        if (m.st === "stun") f |= 1; if (m.mode === "tired") f |= 2; if (m.burst) f |= 4; if (m.mode === "laugh") f |= 8;
        if (m.st === "dead") f |= 16; if (m.face < 0) f |= 32; if (m.hitT > 0) f |= 64; if (m.mode === "walk") f |= 128;
        return [m.id, m.type, r1(m.x), r1(m.y), f, m.hp, m.max];
      }) : undefined,
      pp: this.poops.map(p => [p.id, p.owner, Math.round(p.x), Math.round(p.y), r1(p.t)]),
      cl: this.clouds.map(c => [c.id, c.owner, Math.round(c.x), Math.round(c.y), r1(c.t)]),
      e: this.events,
    };
  }
  roster() {
    return { t: "roster", mode: this.mode, wv: this.wave, r: [...this.players.values()].map(p => [p.id, p.name, p.ch, p.kills, p.deaths]), pod: this.phase === "end" ? this.podium : null };
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws.readyState === 1 && p.ws.bufferedAmount < 256e3) p.ws.send(s);
  }
  tick(dt) {
    this.update(dt);
    const evs = this.events;
    this.broadcast(this.snapshot());
    if (this.rosterDirty || evs.some(e => e.k === "kill" || e.k === "mkill" || e.k === "join" || e.k === "leave") || !this.rosterT || this.t - this.rosterT > 2) {
      this.rosterT = this.t; this.rosterDirty = false; this.broadcast(this.roster());
    }
    this.events = [];
  }
}

/* ---------- HTTP (santé + liste des salles) ---------- */
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url.startsWith("/rooms")) {
    res.setHeader("Content-Type", "application/json");
    // salles publiques seulement, avec l'état de la partie et les pseudos des joueurs
    res.end(JSON.stringify([...rooms.values()].filter(r => !r.priv).map(r => ({ code: r.code, n: r.players.size, max: MAX_PLAYERS, phase: r.phase, mode: r.mode, wave: r.wave, round: r.round,
      names: [...r.players.values()].map(p => p.name) }))));
    return;
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Full Gaz ! serveur multijoueur OK — " + [...rooms.values()].reduce((a, r) => a + r.players.size, 0) + " joueur(s) connecté(s)\n");
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });

wss.on("connection", ws => {
  let room = null, me = null, msgs = 0, msgsT = Date.now();
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", raw => {
    // anti-flood : 80 messages/s max
    const now = Date.now(); if (now - msgsT > 1000) { msgs = 0; msgsT = now; }
    if (++msgs > 80) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "join") {
      if (me) return;
      const name = cleanName(m.name);
      if (!name) { ws.send(JSON.stringify({ t: "error", msg: "Pseudo invalide." })); return; }
      const code = cleanRoom(m.room);
      room = rooms.get(code);
      // la salle garde le mode choisi par celui qui l'a créée
      if (!room) { room = new Room(code, m.mode, m.priv); rooms.set(code, room); }
      if (room.players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: "full", room: code, max: MAX_PLAYERS }));
        if (!room.players.size) rooms.delete(code);
        room = null; return;
      }
      me = room.addPlayer(ws, name, m.ch);
      ws.send(JSON.stringify({ t: "welcome", id: me.id, room: code, x: me.x, y: me.y, max: MAX_PLAYERS, mode: room.mode, priv: room.priv, rules: { mode: room.mode, coop: room.coop ? COOP : null, round: ROUND, pow: POW, sup: Object.assign({}, SUPER, { need: room.supNeed() }), hp: R.hp, fireCd: R.fireCd, boltSpeed: R.boltSpeed, boltLife: R.boltLife, speed: R.speed, boost: R.boost, cloudR: R.cloudR, cloudLife: R.cloudLife, poopLife: R.poopLife, respawn: room.coop ? COOP.respawn : R.respawn } }));
      room.broadcast(room.roster());
      return;
    }
    if (!me || !room) return;
    if (m.t === "st") room.onState(me, m);
    else if (m.t === "fire") room.onFire(me, m);
    else if (m.t === "prout") room.onProut(me);
    else if (m.t === "caca") room.onCaca(me);
    else if (m.t === "super") room.onSuper(me);
    else if (m.t === "ping") ws.send(JSON.stringify({ t: "pong", c: m.c }));
  });

  ws.on("close", () => { if (me && room) room.removePlayer(me); me = null; room = null; });
  ws.on("error", () => {});
});

// boucle de jeu
let last = Date.now();
setInterval(() => {
  const now = Date.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  for (const r of rooms.values()) r.tick(dt);
}, TICK * 1000);

// coupe les connexions mortes
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; try { ws.ping(); } catch (e) {}
  }
}, 10000);

server.listen(PORT, () => console.log("Full Gaz ! multijoueur sur le port " + PORT));
