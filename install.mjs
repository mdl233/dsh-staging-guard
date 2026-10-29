// install.mjs —— 安装 dsh-staging-guard（幂等，先备份后改）
// 只改 profile/package.json 的两处：dependencies 与 dsh.profile.bundles。
// 【不动 cordis.patch.yml】，避免污染主配置。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.DSH_STAGING_GUARD_DIR || path.join(os.homedir(), '.dsh', 'staging-guard');
const PROFILE = process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh', 'profiles', 'desktop');
const PKG = path.join(PROFILE, 'package.json');
const BACKUP = path.join(STATE_DIR, 'rollback');
const NAME = 'dsh-staging-guard';
const DEP = 'file:' + HERE.replace(/\\/g, '/');

if (!fs.existsSync(PKG)) {
  console.error('找不到 profile/package.json：' + PKG);
  console.error('用 DSH_PROFILE_DIR 指定你的 profile 目录（默认 ~/.dsh/profiles/desktop）。');
  process.exit(2);
}

fs.mkdirSync(BACKUP, { recursive: true });
const raw = fs.readFileSync(PKG, 'utf8');

const baseline = path.join(BACKUP, 'package.json.baseline');
if (!fs.existsSync(baseline)) {
  fs.writeFileSync(baseline, raw, 'utf8');
  console.log('[备份] 基线已保存：' + baseline);
} else {
  console.log('[备份] 基线已存在，不覆盖：' + baseline);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(BACKUP, 'package.json.' + stamp + '.bak'), raw, 'utf8');
console.log('[备份] 本次快照：package.json.' + stamp + '.bak');

let pkg;
try {
  pkg = JSON.parse(raw);
} catch (e) {
  console.error('profile/package.json 不是合法 JSON，已中止：' + e.message);
  process.exit(3);
}

pkg.dependencies = pkg.dependencies || {};
const hadDep = pkg.dependencies[NAME] === DEP;
pkg.dependencies[NAME] = DEP;

pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = [];
const bundles = pkg.dsh.profile.bundles;
const hadBundle = bundles.includes(NAME);
if (!hadBundle) bundles.push(NAME);

fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log('[配置] dependencies ' + (hadDep ? '已存在' : '已添加'));
console.log('[配置] bundles ' + (hadBundle ? '已存在' : '已添加'));

const isWin = process.platform === 'win32';
const r = spawnSync(
  isWin ? 'powershell' : 'sh',
  isWin
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'pnpm install --prefer-offline']
    : ['-c', 'pnpm install --prefer-offline'],
  { cwd: PROFILE, stdio: 'inherit', windowsHide: true }
);
console.log('[pnpm] exit = ' + r.status);
if (r.status !== 0) {
  console.error('[警告] pnpm install 未成功。插件可能加载不到，但不影响宿主启动（解析不到就跳过）。');
  console.error('        需要回滚就执行 rollback（还原 package.json 基线）。');
  process.exit(4);
}
console.log('[完成] 若宿主没有热加载，请重启 DeepSeek Harness。');
