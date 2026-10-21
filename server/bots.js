// Bots de test : node bots.js [nombre] [salle] [adresse] [mode]
// ex. node bots.js 4 GAZ ws://localhost:8080
//     node bots.js 2 MONSTRES ws://localhost:8080 coop   (coopération : les bots chassent les monstres)
"use strict";
const WebSocket = require("ws");
const { W, H, collide } = require("./world");

const N = +process.argv[2] || 3, ROOM = process.argv[3] || "GAZ", URL = process.argv[4] || "ws://localhost:8080", MODE = process.argv[5] || "versus";
const NAMES = ["Robot Turbo", "Bot Croissant", "Bot Lasagne", "Robo Prout", "Bot Éclair", "Bot Penne", "Robo Donut", "Bot Burger", "Bot Café"];
const stats = { shots: 0, hits: 0, kills: 0, mkills: 0, wave: 0, bites: 0 };

function bot(i) {
  const ws = new WebSocket(URL);
  const me = { id: 0, x: 0, y: 0, vx: 0, vy: 0, r: 22, a: 0, sn: 0, alive: true, tx: 0, ty: 0, cd: 0 };
  let others = [];
  ws.on("open", () => ws.send(JSON.stringify({ t: "join", room: ROOM, mode: MODE, name: NAMES[i % NAMES.length], ch: ["sucre", "sale", "italien", "mihide", "yonarie", "arthur", "gargar", "mike", "tommy"][i % 9] })));
  ws.on("message", raw => {
    const m = JSON.parse(raw);
    if (m.t === "welcome") { me.id = m.id; me.x = m.x; me.y = m.y; pickTarget(); }
    if (m.t === "full") { console.log("salle pleine"); ws.close(); }
    if (m.t === "s") {
      // cibles : les autres joueurs en bataille, les monstres en coopération
      others = m.m ? m.m.filter(o => !(o[4] & 16)).map(o => [o[0], o[2], o[3]]) : m.p.filter(p => p[0] !== me.id && p[6] & 1);
      if (m.g) stats.wave = m.g[3];
      const mine = m.p.find(p => p[0] === me.id); if (mine) { me.alive = !!(mine[6] & 1); if (mine[14] >= 3 && me.alive) ws.send(JSON.stringify({ t: "super" })); }
      for (const e of m.e) {
        if (e.k === "spawn" && e.id === me.id) { me.x = e.x; me.y = e.y; me.sn = e.sn; }
        if (e.k === "hit" && e.id === me.id) { me.vx += e.kx; me.vy += e.ky; }
        if (i === 0) { if (e.k === "shoot") stats.shots++; if (e.k === "hit") stats.hits++; if (e.k === "kill") stats.kills++; if (e.k === "mkill") stats.mkills++; if (e.k === "hit" && e.kind === "mon") stats.bites++; }
        if (i === 0 && ["wave", "wclear", "rend", "boss"].includes(e.k)) console.log(JSON.stringify(e));
      }
    }
  });
  function pickTarget() { me.tx = 100 + Math.random() * (W - 200); me.ty = 120 + Math.random() * (H - 220); }
  const dt = 0.05;
  const iv = setInterval(() => {
    if (ws.readyState !== 1 || !me.id) return;
    if (me.alive) {
      // poursuit le plus proche, sinon erre
      let tgt = null, bd = 1e9;
      for (const o of others) { const d = Math.hypot(o[1] - me.x, o[2] - me.y); if (d < bd) { bd = d; tgt = o; } }
      let gx = me.tx, gy = me.ty;
      if (tgt && bd < 700) { gx = tgt[1] + Math.sin(Date.now() / 700 + i) * 200; gy = tgt[2] + Math.cos(Date.now() / 900 + i) * 200; }
      if (Math.hypot(gx - me.x, gy - me.y) < 40) pickTarget();
      const dx = gx - me.x, dy = gy - me.y, d = Math.hypot(dx, dy) || 1;
      me.vx += (dx / d * 230 - me.vx) * Math.min(1, dt * 8); me.vy += (dy / d * 230 - me.vy) * Math.min(1, dt * 8);
      me.x += me.vx * dt; me.y += me.vy * dt; collide(me);
      me.cd -= dt;
      if (tgt && bd < 650 && me.cd <= 0) {
        me.a = Math.atan2(tgt[2] - me.y, tgt[1] - me.x) + (Math.random() - .5) * .25; me.cd = 0.7 + Math.random() * .6;
        ws.send(JSON.stringify({ t: "fire", a: me.a, cid: Math.floor(Math.random() * 1e6) }));
      } else if (Math.hypot(me.vx, me.vy) > 20 && !tgt) me.a = Math.atan2(me.vy, me.vx);
    }
    ws.send(JSON.stringify({ t: "st", x: me.x, y: me.y, vx: me.vx, vy: me.vy, a: me.a, mv: Math.hypot(me.vx, me.vy) > 30 ? 1 : 0, sn: me.sn }));
  }, dt * 1000);
  ws.on("close", () => clearInterval(iv));
}
for (let i = 0; i < N; i++) setTimeout(() => bot(i), i * 200);
if (process.env.STATS) setInterval(() => console.log(JSON.stringify(stats)), 5000);
