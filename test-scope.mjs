// staging-guard 判定逻辑离线单测（不依赖宿主；改 js 后、重启前先跑这个）
// 用法：node test-scope.mjs
//
// 自包含：先建临时状态目录并把 DSH_STAGING_GUARD_DIR 指过去，再动态 import，
// 因此不依赖本机任何真实路径，换台机器也能直接跑。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-guard-test-'));
process.env.DSH_STAGING_GUARD_DIR = tmp;

// 受保护根写进测试用配置（构造的路径，不指向真实目录）
const PROJ_A = path.join(tmp, 'projA');
const PROJ_B = path.join(tmp, 'projB');
fs.writeFileSync(
  path.join(tmp, 'roots.json'),
  JSON.stringify({ roots: [PROJ_A] }, null, 2),
  'utf8'
);

const mod = await import('./lib/index.js');
const { resultZones, isInResultZone, normalizeForCompare, readRoots } = mod;
const n = (p) => normalizeForCompare(p);

const roots = readRoots();
console.log('配置读到的受保护根 =', JSON.stringify(roots));

const zonesA = resultZones(n(tmp), roots);          // 会话在临时根，配置里有 projA
const zonesB = resultZones(n(PROJ_A), roots);       // 会话就在 projA
const zonesC = resultZones(n(tmp), []);             // 配置丢失

const cases = [
  ['配置里的根：写成果区（跨会话拦截）', path.join(PROJ_A, '成果区', 'a.md'), zonesA, true],
  ['.. 穿越到成果区', path.join(tmp, '..', path.basename(tmp), 'projA', '成果区', 'a.md'), zonesA, true],
  ['成果区目录本身（无尾斜杠）', path.join(PROJ_A, '成果区'), zonesA, true],
  ['草稿区（放行）', path.join(PROJ_A, '草稿区', '待定', 'a.md'), zonesA, false],
  ['名字相似：成果区备份（放行）', path.join(PROJ_A, '成果区备份', 'a.md'), zonesA, false],
  ['本会话 cwd 的成果区（兜底）', path.join(tmp, '成果区', 'a.md'), zonesA, true],
  ['工作区外（放行）', path.join(tmp, '别的地方', 'a.md'), zonesA, false],
  ['配置丢失时：别的工作区成果区不拦', path.join(PROJ_A, '成果区', 'a.md'), zonesC, false],
  ['配置丢失时：本会话 cwd 成果区仍拦', path.join(tmp, '成果区', 'a.md'), zonesC, true],
  ['cwd 就是该工作区时也拦', path.join(PROJ_A, '成果区', 'a.md'), zonesB, true],
];

let bad = 0;
for (const [label, target, zones, expect] of cases) {
  const got = isInResultZone(n(target), zones);
  const ok = got === expect;
  if (!ok) bad += 1;
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + label + ' | expect=' + expect + ' got=' + got);
}

// readRoots 必须能读到配置里的 projA
if (!roots.includes(n(PROJ_A))) { bad += 1; console.log('FAIL | 配置文件没读到 ' + PROJ_A); }

// 收尾
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(bad === 0 ? '\n全部通过（' + cases.length + ' 例 + 配置 1 项）' : '\n失败 ' + bad + ' 项');
process.exitCode = bad === 0 ? 0 : 1;
