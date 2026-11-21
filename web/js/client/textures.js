// Procedural textures (no image files): colour + normal maps for skin, cloth, leather,
// hair, rock, grass and snow. Generated once, shared by every fighter and stage.
import * as THREE from '../../vendor/three/three.module.js';
import { mulberry32 } from '../sim/rng.js';

export function cvs(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// tangent-space normal map from a grey height canvas (Sobel)
export function normalMap(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = cvs(w, h), og = out.getContext('2d'), img = og.createImageData(w, h), d = img.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}

export function tex(c, rx = 1, ry = 1, color = true) {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  return t;
}

// tileable value noise (fractal) painted into a canvas
export function noiseCanvas(size, { octaves = 5, base = 4, seed = 1, contrast = 1 } = {}) {
  const R = mulberry32(seed);
  const c = cvs(size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  const acc = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = base << o, grid = new Float32Array(n * n);
    for (let i = 0; i < grid.length; i++) grid[i] = R();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * n, fy = (y / size) * n, ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const G = (a, b) => grid[((b % n) * n) + (a % n)];
      const v = G(ix, iy) * (1 - tx) * (1 - ty) + G(ix + 1, iy) * tx * (1 - ty) + G(ix, iy + 1) * (1 - tx) * ty + G(ix + 1, iy + 1) * tx * ty;
      acc[y * size + x] += v * amp;
    }
    total += amp; amp *= 0.5;
  }
  for (let i = 0; i < acc.length; i++) { const v = Math.max(0, Math.min(1, (acc[i] / total - 0.5) * contrast + 0.5)) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  return c;
}

let TX = null;
export function textures() {
  if (TX) return TX;
  const r = mulberry32(91);
  const make = (size, drawColor, drawHeight, strength = 2) => {
    const c = cvs(size), g = c.getContext('2d'); drawColor(g, size);
    const hgt = cvs(size), hg = hgt.getContext('2d'); drawHeight(hg, size);
    return { c, n: normalMap(hgt, strength) };
  };
  const skin = make(256, (g, s) => {
    g.fillStyle = '#f4ece8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${200 + r() * 40},${120 + r() * 40},${120 + r() * 30},0.05)`; g.beginPath(); g.arc(r() * s, r() * s, 6 + r() * 20, 0, 7); g.fill(); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(40,40,40,${0.25 + r() * 0.3})`; g.fillRect(r() * s, r() * s, 1, 1); }
  });
  const cotton = make(128, (g, s) => {
    g.fillStyle = '#ececec'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.05})`; g.fillRect(r() * s, r() * s, 2, 1); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) { g.fillStyle = y % 4 ? '#8a8a8a' : '#767676'; g.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 2) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, s); }
  });
  // heavy canvas weave for gi / training wear
  const canvasW = make(128, (g, s) => {
    g.fillStyle = '#eeeeee'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.07})`; g.fillRect(r() * s, r() * s, 3, 2); }
  }, (g, s) => {
    for (let y = 0; y < s; y += 4) for (let x = 0; x < s; x += 4) { const v = ((x + y) / 4) % 2 ? 150 : 95; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 4, 4); }
  }, 1.5);
  const leather = make(128, (g, s) => {
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.08})`; g.beginPath(); g.arc(r() * s, r() * s, 1 + r() * 5, 0, 7); g.fill(); }
  }, (g, s) => { g.drawImage(noiseCanvas(s, { base: 16, octaves: 3, seed: 5, contrast: 1.6 }), 0, 0); }, 3);
  const hair = make(256, (g, s) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) { const x = r() * s; const v = r() < 0.5 ? 0 : 255; g.strokeStyle = `rgba(${v},${v},${v},${0.06 + r() * 0.12})`; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, s); g.stroke(); }
  }, (g, s) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 700; i++) { const x = r() * s; g.strokeStyle = r() < 0.5 ? '#b0b0b0' : '#505050'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (r() - 0.5) * 6, s); g.stroke(); }
  });
  const iris = cvs(64), ig = iris.getContext('2d');
  ig.fillStyle = '#ffffff'; ig.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 160; i++) { const a = r() * 6.283; ig.strokeStyle = `rgba(0,0,0,${0.1 + r() * 0.25})`; ig.beginPath(); ig.moveTo(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9); ig.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); ig.stroke(); }
  ig.strokeStyle = 'rgba(0,0,0,0.65)'; ig.lineWidth = 3; ig.beginPath(); ig.arc(32, 32, 30, 0, 7); ig.stroke();
  ig.fillStyle = '#060606'; ig.beginPath(); ig.arc(32, 32, 10, 0, 7); ig.fill();
  ig.fillStyle = 'rgba(255,255,255,0.95)'; ig.beginPath(); ig.arc(24, 24, 4, 0, 7); ig.fill();
  TX = {
    skin: [tex(skin.c, 3, 3), tex(skin.n, 3, 3, false)],
    cotton: [tex(cotton.c, 4, 4), tex(cotton.n, 4, 4, false)],
    canvas: [tex(canvasW.c, 5, 5), tex(canvasW.n, 5, 5, false)],
    leather: [tex(leather.c, 2, 2), tex(leather.n, 2, 2, false)],
    hair: [tex(hair.c, 3, 1), tex(hair.n, 3, 1, false)],
    iris: tex(iris),
  };
  TX.iris.wrapS = TX.iris.wrapT = THREE.ClampToEdgeWrapping;
  return TX;
}

// ---------------------------------------------------------------- terrain textures
let TT = null;
export function terrainTextures() {
  if (TT) return TT;
  const r = mulberry32(7);
  const S = 512;
  // grass: blade-ish speckle over soft noise
  const grassC = cvs(S), gg = grassC.getContext('2d');
  gg.drawImage(noiseCanvas(S, { base: 8, octaves: 5, seed: 11, contrast: 1.3 }), 0, 0);
  const gimg = gg.getImageData(0, 0, S, S), gd = gimg.data;
  for (let i = 0; i < gd.length; i += 4) { const v = gd[i] / 255; gd[i] = 70 + v * 60; gd[i + 1] = 120 + v * 70; gd[i + 2] = 40 + v * 30; }
  gg.putImageData(gimg, 0, 0);
  for (let i = 0; i < 9000; i++) { const x = r() * S, y = r() * S, l = 3 + r() * 6; gg.strokeStyle = `rgba(${r() < 0.5 ? '40,80,20' : '170,210,110'},${0.15 + r() * 0.25})`; gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + (r() - 0.5) * 2, y - l); gg.stroke(); }
  const grassH = noiseCanvas(256, { base: 32, octaves: 3, seed: 12, contrast: 1.5 });
  // dirt / sand
  const dirtC = cvs(S), dg = dirtC.getContext('2d');
  dg.drawImage(noiseCanvas(S, { base: 8, octaves: 6, seed: 21, contrast: 1.2 }), 0, 0);
  const dimg = dg.getImageData(0, 0, S, S), dd = dimg.data;
  for (let i = 0; i < dd.length; i += 4) { const v = dd[i] / 255; dd[i] = 150 + v * 70; dd[i + 1] = 115 + v * 60; dd[i + 2] = 80 + v * 45; }
  dg.putImageData(dimg, 0, 0);
  for (let i = 0; i < 3000; i++) { dg.fillStyle = `rgba(${r() < 0.5 ? '60,40,25' : '240,220,190'},${0.2 + r() * 0.3})`; dg.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2); }
  const dirtH = noiseCanvas(256, { base: 16, octaves: 5, seed: 22, contrast: 1.4 });
  // snow
  const snowC = cvs(256), sg = snowC.getContext('2d');
  sg.drawImage(noiseCanvas(256, { base: 4, octaves: 5, seed: 31, contrast: 0.6 }), 0, 0);
  const simg = sg.getImageData(0, 0, 256, 256), sd = simg.data;
  for (let i = 0; i < sd.length; i += 4) { const v = sd[i] / 255; sd[i] = 220 + v * 35; sd[i + 1] = 228 + v * 27; sd[i + 2] = 240 + v * 15; }
  sg.putImageData(simg, 0, 0);
  const snowH = noiseCanvas(256, { base: 8, octaves: 4, seed: 32, contrast: 1.0 });
  // rock: strata + cracks
  const rockC = cvs(S), rg = rockC.getContext('2d');
  rg.drawImage(noiseCanvas(S, { base: 4, octaves: 6, seed: 41, contrast: 1.4 }), 0, 0);
  const rimg = rg.getImageData(0, 0, S, S), rd = rimg.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, v = rd[i] / 255, band = 0.85 + Math.sin(y * 0.09 + v * 3) * 0.08; const k = (150 + v * 80) * band; rd[i] = k; rd[i + 1] = k * 0.97; rd[i + 2] = k * 0.93; }
  rg.putImageData(rimg, 0, 0);
  for (let i = 0; i < 60; i++) { rg.strokeStyle = `rgba(30,25,20,${0.2 + r() * 0.3})`; rg.lineWidth = 1 + r(); rg.beginPath(); let x = r() * S, y = r() * S; rg.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += r() * 25; rg.lineTo(x, y); } rg.stroke(); }
  const rockH = noiseCanvas(256, { base: 8, octaves: 5, seed: 42, contrast: 1.8 });
  TT = {
    grass: [tex(grassC), tex(normalMap(grassH, 2), 1, 1, false)],
    dirt: [tex(dirtC), tex(normalMap(dirtH, 3), 1, 1, false)],
    snow: [tex(snowC), tex(normalMap(snowH, 1.2), 1, 1, false)],
    rock: [tex(rockC), tex(normalMap(rockH, 4), 1, 1, false)],
  };
  return TT;
}
