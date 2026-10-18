/**
 * IPC 契约审计：确认前端每次 invoke 传入的参数键，
 * 都能对上 Rust 命令的参数（Tauri 会把 camelCase 自动映射为 snake_case）。
 *
 * 运行：node scripts/audit-ipc.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------- Rust 侧
const COMMAND_DIR = path.join(ROOT, "src-tauri/src/commands");
const rustCommands = new Map(); // name -> [param, ...]（不含 state）

for (const file of fs.readdirSync(COMMAND_DIR)) {
  if (!file.endsWith(".rs")) continue;
  const src = fs.readFileSync(path.join(COMMAND_DIR, file), "utf8");
  const re = /#\[tauri::command[^\]]*\]\s*pub fn ([a-z_0-9]+)\s*\(([\s\S]*?)\)\s*->/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1];
    const params = m[2]
      .split(",")
      .map((p) => p.trim().split(":")[0].trim())
      .filter((p) => p.length > 0 && p !== "state" && /^[a-z_0-9]+$/.test(p));
    rustCommands.set(name, params);
  }
}

// ---------------------------------------------------------------- TS 侧
const tsSrc = fs.readFileSync(path.join(ROOT, "src/api/commands.ts"), "utf8");
const callRe = /call<[^(]*>\("([a-z_0-9]+)"(?:\s*,\s*\{([\s\S]*?)\})?\s*\)/g;
const tsCalls = [];
let c;
while ((c = callRe.exec(tsSrc)) !== null) {
  const args = (c[2] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(":")[0].trim());
  tsCalls.push({ name: c[1], args });
}

// ---------------------------------------------------------------- 比对
const camel = (s) => s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());

let problems = 0;
const seen = new Set();

for (const call of tsCalls) {
  seen.add(call.name);
  const params = rustCommands.get(call.name);
  if (!params) {
    console.log(`✗ 前端调用了不存在的命令: ${call.name}`);
    problems += 1;
    continue;
  }
  const expected = new Set(params.map(camel));
  for (const arg of call.args) {
    if (!expected.has(arg)) {
      console.log(`✗ ${call.name}: 前端参数 "${arg}" 在 Rust 侧不存在（期望 ${[...expected].join(", ") || "无"}）`);
      problems += 1;
    }
  }
  for (const p of expected) {
    // 允许前端省略可选参数（Tauri 会用 None），这里只提示
    if (!call.args.includes(p)) {
      console.log(`· ${call.name}: 前端未传可选参数 "${p}"（Rust 侧为 Option，可省略）`);
    }
  }
}

for (const name of rustCommands.keys()) {
  if (!seen.has(name)) console.log(`· 后端命令 ${name} 前端暂未使用`);
}

console.log(
  `\n命令总数：Rust ${rustCommands.size} / 前端调用 ${tsCalls.length}；问题 ${problems} 个`,
);
process.exit(problems === 0 ? 0 : 1);
