// Full Gaz ! — serveur multijoueur (bataille à l'arbalète)
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
const TREATS = ["croissant", "painchoc", "donut", "eclair", "bonbon", "baguette", "burger", "penne", "spaghetti", "lasagne"];

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
  constructor(code) {
    this.code = code;
    this.players = new Map();
    this.bolts = []; this.items = []; this.poops = []; this.clouds = [];
    this.coffee = null; this.coffeeT = 5;
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
      id, ws, name, ch: ["sucre", "sale", "italien"].includes(ch) ? ch : "sucre",
      x: 0, y: 0, vx: 0, vy: 0, r: 22, a: 0, mv: 0,
      hp: R.hp, alive: true, deadT: 0, shield: R.spawnShield, stun: 0, boost: 0,
      gauge: 0, cafe: 0, cd: 0, kills: 0, deaths: 0, streak: 0, lastMove: Date.now(),
      act: "", actT: 0, hitT: 0, spawnN: 0,
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

  /* messages du joueur */
  onState(p, m) {
    // après une réapparition, on ignore les positions envoyées avant que le client l'ait reçue
    if (!p.alive || (m.sn | 0) !== p.spawnN) return;
    // le client calcule son déplacement ; le serveur vérifie la vitesse et les obstacles
    const now = Date.now(), dt = Math.min(0.5, Math.max(0.016, (now - p.lastMove) / 1000));
    p.lastMove = now;
    const max = R.speed * R.boost * 1.6 * dt + 40 + (p.kbBudget || 0);
    let nx = num(m.x, p.x), ny = num(m.y, p.y);
    const dx = nx - p.x, dy = ny - p.y, d = Math.hypot(dx, dy);
    if (d > max) { nx = p.x + dx / d * max; ny = p.y + dy / d * max; }
    p.kbBudget = 0;
    p.x = nx; p.y = ny; collide(p);
    p.vx = clamp(num(m.vx), -600, 600); p.vy = clamp(num(m.vy), -600, 600);
    p.a = num(m.a, p.a); p.mv = m.mv ? 1 : 0;
  }
  onFire(p, m) {
    if (!p.alive || p.stun > 0 || p.cd > 0) return;
    p.cd = R.fireCd; p.shield = 0; p.act = "aim"; p.actT = 0.35;
    const a = num(m.a, p.a); p.a = a;
    const face = Math.cos(a) >= 0 ? 1 : -1;
    const b = {
      id: this.nextObj++, cid: num(m.cid) | 0, owner: p.id,
      x: p.x + face * 30 + Math.cos(a) * 20, y: p.y + Math.sin(a) * 20,
      vx: Math.cos(a) * R.boltSpeed, vy: Math.sin(a) * R.boltSpeed, life: R.boltLife,
    };
    this.bolts.push(b);
    this.ev({ k: "shoot", id: p.id });
  }
  onProut(p) {
    if (!p.alive || p.gauge < 5) return;
    p.gauge = 0; p.act = "fart"; p.actT = 0.55;
    this.clouds.push({ id: this.nextObj++, owner: p.id, x: p.x - (Math.cos(p.a) >= 0 ? 1 : -1) * 20, y: p.y - 20, t: 0, hit: new Set() });
    this.ev({ k: "prout", id: p.id });
  }
  onCaca(p) {
    if (!p.alive || p.cafe < 1) return;
    p.cafe--; p.act = "poop"; p.actT = 0.5;
    const face = Math.cos(p.a) >= 0 ? 1 : -1;
    this.poops.push({ id: this.nextObj++, owner: p.id, x: clamp(p.x - face * 36, 60, W - 60), y: p.y + 6, t: 0 });
    this.ev({ k: "plop", id: p.id });
  }

  damage(v, by, kind, kx, ky) {
    if (!v.alive || v.shield > 0) return false;
    v.hp--; v.hitT = 0.25;
    this.ev({ k: "hit", id: v.id, by: by ? by.id : 0, kind, kx: r1(kx), ky: r1(ky) });
    v.kbBudget = (v.kbBudget || 0) + 160;
    if (v.hp <= 0) {
      v.alive = false; v.deadT = R.respawn; v.deaths++; v.streak = 0; v.gauge = 0; v.cafe = 0;
      if (by && by !== v) { by.kills++; by.streak++; }
      this.ev({ k: "kill", id: v.id, by: by ? by.id : 0, kind, streak: by ? by.streak : 0 });
    }
    return true;
  }

  update(dt) {
    this.t += dt;
    const P = [...this.players.values()];
    for (const p of P) {
      p.cd = Math.max(0, p.cd - dt); p.shield = Math.max(0, p.shield - dt); p.stun = Math.max(0, p.stun - dt);
      p.boost = Math.max(0, p.boost - dt); p.hitT = Math.max(0, p.hitT - dt);
      if (p.actT > 0) { p.actT -= dt; if (p.actT <= 0) p.act = ""; }
      if (!p.alive) {
        p.deadT -= dt;
        if (p.deadT <= 0) {
          const s = this.freeSpot(500, 140);
          p.spawnN++; p.lastMove = Date.now();
          Object.assign(p, { x: s.x, y: s.y, vx: 0, vy: 0, hp: R.hp, alive: true, shield: R.spawnShield, stun: 0, act: "", kbBudget: 0 });
          this.ev({ k: "spawn", id: p.id, x: r1(p.x), y: r1(p.y), sn: p.spawnN });
        }
        continue;
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
      // café
      if (this.coffee && Math.hypot(this.coffee.x - p.x, this.coffee.y - (p.y - 20)) < 48 && p.cafe < R.cafeMax) {
        this.coffee = null; this.coffeeT = 10 + rnd() * 6; this.itemsDirty = true;
        p.cafe++; p.boost = R.boostTime;
        this.ev({ k: "cafe", id: p.id });
      }
    }
    if (!this.coffee) { this.coffeeT -= dt; if (this.coffeeT <= 0) { const s = this.freeSpot(250); this.coffee = { x: s.x, y: s.y }; this.itemsDirty = true; } }

    // carreaux : test en segment pour ne pas traverser un joueur entre deux images
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const x0 = b.x, y0 = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let dead = b.life <= 0 || b.x < 30 || b.x > W - 30 || b.y < 40 || b.y > H - 30;
      if (!dead) {
        const sx = b.x - x0, sy = b.y - y0, sl = sx * sx + sy * sy || 1;
        let hitT = 2, hitP = null;
        for (const p of P) {
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
        if (hitP && hitT <= obsT) {
          const sh = this.players.get(b.owner);
          const sp = Math.hypot(b.vx, b.vy) || 1;
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
      if (c.t < R.cloudLife - .3) for (const p of P) {
        if (p.id === c.owner || !p.alive || c.hit.has(p.id) || p.shield > 0) continue;
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
      if (!gone) for (const p of P) {
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
      pl.push([p.id, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy), Math.round(p.a * 100) / 100, f, p.hp, p.gauge, p.cafe, p.act, Math.ceil(p.deadT * 10) / 10]);
    }
    return {
      t: "s", tm: Math.round(this.t * 1000),
      p: pl,
      b: this.bolts.map(b => [b.id, b.owner, b.cid, r1(b.x), r1(b.y), Math.round(b.vx), Math.round(b.vy)]),
      i: sendItems ? this.items.map(it => [it.id, Math.round(it.x), Math.round(it.y), it.k]) : undefined,
      c: sendItems ? (this.coffee ? [Math.round(this.coffee.x), Math.round(this.coffee.y)] : 0) : undefined,
      pp: this.poops.map(p => [p.id, p.owner, Math.round(p.x), Math.round(p.y), r1(p.t)]),
      cl: this.clouds.map(c => [c.id, c.owner, Math.round(c.x), Math.round(c.y), r1(c.t)]),
      e: this.events,
    };
  }
  roster() {
    return { t: "roster", r: [...this.players.values()].map(p => [p.id, p.name, p.ch, p.kills, p.deaths]) };
  }
  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.players.values()) if (p.ws.readyState === 1 && p.ws.bufferedAmount < 256e3) p.ws.send(s);
  }
  tick(dt) {
    this.update(dt);
    const evs = this.events;
    this.broadcast(this.snapshot());
    if (evs.some(e => e.k === "kill" || e.k === "join" || e.k === "leave") || !this.rosterT || this.t - this.rosterT > 2) {
      this.rosterT = this.t; this.broadcast(this.roster());
    }
    this.events = [];
  }
}

/* ---------- HTTP (santé + liste des salles) ---------- */
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url.startsWith("/rooms")) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify([...rooms.values()].map(r => ({ code: r.code, n: r.players.size, max: MAX_PLAYERS }))));
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
      if (!room) { room = new Room(code); rooms.set(code, room); }
      if (room.players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: "full", room: code, max: MAX_PLAYERS }));
        if (!room.players.size) rooms.delete(code);
        room = null; return;
      }
      me = room.addPlayer(ws, name, m.ch);
      ws.send(JSON.stringify({ t: "welcome", id: me.id, room: code, x: me.x, y: me.y, max: MAX_PLAYERS, rules: { hp: R.hp, fireCd: R.fireCd, boltSpeed: R.boltSpeed, boltLife: R.boltLife, speed: R.speed, boost: R.boost, cloudR: R.cloudR, cloudLife: R.cloudLife, poopLife: R.poopLife, respawn: R.respawn } }));
      room.broadcast(room.roster());
      return;
    }
    if (!me || !room) return;
    if (m.t === "st") room.onState(me, m);
    else if (m.t === "fire") room.onFire(me, m);
    else if (m.t === "prout") room.onProut(me);
    else if (m.t === "caca") room.onCaca(me);
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
