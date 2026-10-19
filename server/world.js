// Même carte que le jeu solo (index.html > buildWorld) : mêmes obstacles, même graine.
// Si tu modifies la carte dans index.html, reporte la modification ici.
"use strict";

const W = 2400, H = 1600;
const PW = 100, HP = [380, 800, 1220], VP = [450, 1200, 1950], PLAZA = { x: 1200, y: 800, r: 200 };

function mulberry(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const onPath = (x, y, m = 0) =>
  HP.some(p => Math.abs(y - p) < PW / 2 + m) ||
  VP.some(p => Math.abs(x - p) < PW / 2 + m) ||
  Math.hypot(x - PLAZA.x, y - PLAZA.y) < PLAZA.r + m;

function buildObstacles() {
  const r = mulberry(1234);
  const OBS = [{ x: 1200, y: 800, r: 78, kind: "fountain" }];
  let trees = 0, tries = 0;
  while (trees < 52 && tries++ < 4000) {
    const x = 90 + r() * (W - 180), y = 120 + r() * (H - 210);
    if (onPath(x, y, 60)) continue;
    if (OBS.some(o => Math.hypot(o.x - x, o.y - y) < 125)) continue;
    const s = .6 + r() * .25, q = r(), v = q < .3 ? "pillar" : q < .58 ? "dead" : q < .8 ? "grave" : "brazier";
    r(); // seed (décor uniquement)
    OBS.push({ x, y, r: (v === "brazier" ? 20 : 26) * s, kind: "tree", v });
    trees++;
  }
  const bspots = [[700, HP[0] - PW / 2 - 22], [1600, HP[0] - PW / 2 - 22], [300, HP[1] - PW / 2 - 22], [2150, HP[2] - PW / 2 - 22],
    [850, HP[2] - PW / 2 - 22], [1650, HP[1] - PW / 2 - 22], [1450, HP[2] - PW / 2 - 22], [950, HP[1] - PW / 2 - 22]];
  for (const [x, y] of bspots) {
    if (OBS.some(o => Math.hypot(o.x - x, o.y - y) < 120)) continue;
    OBS.push({ x: x - 38, y, r: 22, kind: "bp" }, { x, y, r: 22, kind: "bp" }, { x: x + 38, y, r: 22, kind: "bp" });
  }
  return OBS;
}

const OBS = buildObstacles();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// Pousse une entité hors des obstacles et la garde dans les remparts (identique au client)
function collide(e) {
  for (const o of OBS) {
    const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), m = e.r + o.r;
    if (d < m && d > 0) { const p = m - d; e.x += dx / d * p; e.y += dy / d * p; }
  }
  e.x = clamp(e.x, 46, W - 46); e.y = clamp(e.y, 56, H - 40);
}

module.exports = { W, H, OBS, collide, clamp };
