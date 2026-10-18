/**
 * 生成应用图标（不依赖任何图像库，直接用 zlib 手写 PNG）。
 * 运行：node scripts/gen-icons.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../src-tauri/icons");

// ---------------------------------------------------------------------------
// 最小 PNG 编码器
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 极简矢量绘制（3x3 超采样抗锯齿）
// ---------------------------------------------------------------------------
const SS = 3;

function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4, 0) };
}

function blend(canvas, x, y, [r, g, b], alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= canvas.size || y >= canvas.size) return;
  const idx = (y * canvas.size + x) * 4;
  const dstA = canvas.data[idx + 3] / 255;
  const outA = alpha + dstA * (1 - alpha);
  if (outA <= 0) return;
  const mix = (src, dst) => Math.round((src * alpha + dst * dstA * (1 - alpha)) / outA);
  canvas.data[idx] = mix(r, canvas.data[idx]);
  canvas.data[idx + 1] = mix(g, canvas.data[idx + 1]);
  canvas.data[idx + 2] = mix(b, canvas.data[idx + 2]);
  canvas.data[idx + 3] = Math.round(outA * 255);
}

/** 用测试函数填充（返回 true 表示该点属于图形） */
function fill(canvas, color, test, alpha = 1) {
  const { size } = canvas;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (test(px, py)) hits += 1;
        }
      }
      if (hits > 0) blend(canvas, x, y, color, (hits / (SS * SS)) * alpha);
    }
  }
}

const inRoundedRect = (x, y, left, top, w, h, r) => {
  if (x < left || y < top || x > left + w || y > top + h) return false;
  const dx = Math.min(Math.max(x, left + r), left + w - r);
  const dy = Math.min(Math.max(y, top + r), top + h - r);
  const cx = x - dx;
  const cy = y - dy;
  return cx * cx + cy * cy <= r * r || (x >= left + r && x <= left + w - r) || (y >= top + r && y <= top + h - r);
};

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const inSegment = (x, y, x1, y1, x2, y2, w) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return (x - px) ** 2 + (y - py) ** 2 <= (w / 2) ** 2;
};

/** 画一个「树状时间」图标：圆角底 + 主干 + 三个分支节点 */
function drawIcon(size) {
  const canvas = makeCanvas(size);
  const s = size / 1024; // 以 1024 为设计基准

  // 背景：深靛蓝渐变圆角方块
  fill(
    canvas,
    [0, 0, 0],
    (x, y) => inRoundedRect(x, y, 64 * s, 64 * s, 896 * s, 896 * s, 200 * s),
    1,
  );
  // 用两遍填充模拟渐变
  for (let i = 0; i < 24; i += 1) {
    const t = i / 23;
    const color = [
      Math.round(79 + t * 60),
      Math.round(70 + t * 40),
      Math.round(229 - t * 30),
    ];
    fill(
      canvas,
      color,
      (x, y) =>
        inRoundedRect(x, y, 64 * s, 64 * s, 896 * s, 896 * s, 200 * s) &&
        y >= 64 * s + t * 896 * s &&
        y < 64 * s + (t + 1 / 24) * 896 * s,
      1,
    );
  }

  const white = [255, 255, 255];
  const trunkX = 400 * s;
  const topY = 250 * s;
  const bottomY = 780 * s;

  // 主干
  fill(canvas, white, (x, y) => inSegment(x, y, trunkX, topY, trunkX, bottomY, 34 * s), 0.95);
  // 分支
  const branches = [
    [trunkX, 430 * s, 680 * s, 340 * s],
    [trunkX, 560 * s, 700 * s, 580 * s],
    [trunkX, 690 * s, 660 * s, 800 * s],
  ];
  for (const [x1, y1, x2, y2] of branches) {
    fill(canvas, white, (x, y) => inSegment(x, y, x1, y1, x2, y2, 26 * s), 0.9);
  }
  // 节点圆点
  fill(canvas, white, (x, y) => inCircle(x, y, trunkX, topY, 46 * s), 1);
  for (const [x2, y2] of branches) {
    fill(canvas, white, (x, y) => inCircle(x, y, x2, y2, 42 * s), 1);
    fill(canvas, [199, 210, 254], (x, y) => inCircle(x, y, x2, y2, 20 * s), 1);
  }
  fill(canvas, [199, 210, 254], (x, y) => inCircle(x, y, trunkX, topY, 22 * s), 1);

  return canvas;
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

for (const [name, size] of targets) {
  const canvas = drawIcon(size);
  fs.writeFileSync(path.join(OUT_DIR, name), encodePng(size, size, canvas.data));
}

console.log(`已生成 ${targets.length} 个图标 → ${OUT_DIR}`);
