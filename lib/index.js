// dsh-staging-guard —— 硬拒受保护区写入的 pre-execute 钩子
//
// 阶段：V0 观察 → V1 挂载 → V3 路径归一 → V2 异常行为 → V4-A 只拒成果区 → 【V5 根列表】
//
// V5 规则：
//   写入目标落在「某个受保护根下的 <成果区>/」⇒ deny，其余 next() 放行。
//   受保护根 = 配置文件 roots ∪ 当前会话 cwd（cwd 兜底：配置缺失也不会失去保护）。
//
// 配置（全部可用环境变量覆盖，默认在 ~/.dsh/staging-guard/ 下）：
//   DSH_STAGING_GUARD_DIR         状态目录，默认 ~/.dsh/staging-guard/
//   DSH_STAGING_GUARD_RESULT_DIR  只读区目录名，默认「成果区」
//   DSH_STAGING_GUARD_DRAFT_DIR   草稿区目录名，默认「草稿区」
//   roots.json                    受保护根列表（{"roots":["D:\\项目A"]}），每次调用现读
//                                 ⇒ 增删根不必重启宿主（改 index.js 才需要重启）
//
// 为什么有根列表（2026-10-27 实测）：V4-A 只按会话自己的 cwd 判 ⇒ 在别的工作区开
// 会话写 A 项目的成果区会被放行（跨会话即绕过）。V5 用显式根补掉这个洞，
// 同时保留 cwd 兜底，行为是 V4-A 的严格超集（只会多拦，不会少拦）。
//
// 已实测：
//   - 钩子抛异常 = fail-closed（该次调用失败、错误可见、宿主不受影响）
//   - path.resolve 不归一盘符大小写 ⇒ 比较一律走 normalizeForCompare（正斜杠 + 全小写）
//   - 只拦 write / edit / str_replace_editor；pwsh / 脚本 / git 写文件绕得过去
//     ⇒ 本插件是「防手滑的软边界」，不是安全边界
//
// 应急：状态目录下出现 disabled 文件时全放行（不重启即可自救）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const name = 'staging-guard';

const STATE_DIR = process.env.DSH_STAGING_GUARD_DIR
  || path.join(os.homedir(), '.dsh', 'staging-guard');
const LOG_DIR = path.join(STATE_DIR, 'logs');
const LOG = path.join(LOG_DIR, 'staging-guard.log');
const THROW_FLAG = path.join(STATE_DIR, 'throw-now');
const KILL_SWITCH = path.join(STATE_DIR, 'disabled');
const ROOTS_CFG = path.join(STATE_DIR, 'roots.json');
const MUTATION_TOOLS = new Set(['write', 'edit', 'str_replace_editor']);
const RESULT_DIR = process.env.DSH_STAGING_GUARD_RESULT_DIR || '成果区';
const DRAFT_DIR = process.env.DSH_STAGING_GUARD_DRAFT_DIR || '草稿区';

function log(line) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + line + '\n', 'utf8');
  } catch (_) { /* 日志失败绝不能影响工具 */ }
}

function argRecord(args) {
  return args !== null && typeof args === 'object' && !Array.isArray(args) ? args : undefined;
}

function mutationPath(tool, args) {
  const a = argRecord(args);
  if (a === undefined) return undefined;
  if (tool === 'str_replace_editor') {
    if (a.command === 'view') return undefined;
    return typeof a.path === 'string' && a.path.trim() !== '' ? a.path : undefined;
  }
  return typeof a.file_path === 'string' && a.file_path.trim() !== '' ? a.file_path : undefined;
}

function resolvePath(raw, cwd) {
  try {
    if (path.isAbsolute(raw)) return path.resolve(raw);
    if (typeof cwd === 'string' && cwd !== '') return path.resolve(cwd, raw);
  } catch (_) {}
  return undefined;
}

// V3 实测：path.resolve 不归一盘符大小写（f:\ 与 F:\ 原样保留），而 Windows
// 文件系统不区分大小写、字符串比较区分 ⇒ 一切比较前必须归一：正斜杠 + 全小写。
function normalizeForCompare(p) {
  if (typeof p !== 'string' || p === '') return undefined;
  try {
    return path.resolve(p).replace(/\\/g, '/').toLowerCase();
  } catch (_) {
    return undefined;
  }
}

// 受保护工作区根：每次调用现读，改配置不必重启。
// 读失败 / 结构不对 ⇒ 空数组（由 cwd 兜底，保护不会静默消失）。
function readRoots() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ROOTS_CFG, 'utf8'));
    const arr = Array.isArray(parsed.roots) ? parsed.roots : [];
    return arr
      .filter((r) => typeof r === 'string' && r.trim() !== '')
      .map(normalizeForCompare)
      .filter((r) => typeof r === 'string' && r !== '');
  } catch (_) {
    return [];
  }
}

function killSwitchOn() {
  try { return fs.existsSync(KILL_SWITCH); } catch (_) { return false; }
}

// 受保护区集合＝{ roots ∪ cwd } 各自的 <根>/<成果区>/（归一后、去重）。
function resultZones(normCwd, normRoots) {
  const roots = [];
  if (Array.isArray(normRoots)) roots.push(...normRoots);
  if (typeof normCwd === 'string' && normCwd !== '') roots.push(normCwd);
  const zones = [];
  for (const root of roots) {
    if (typeof root !== 'string' || root === '') continue;
    const base = root.endsWith('/') ? root : root + '/';
    const zone = base + RESULT_DIR.toLowerCase() + '/';
    if (!zones.includes(zone)) zones.push(zone);
  }
  return zones;
}

// 命中判定：目标等于「…/<成果区>」或以「…/<成果区>/」开头。
function isInResultZone(normTarget, zones) {
  if (typeof normTarget !== 'string' || !Array.isArray(zones)) return false;
  return zones.some((zone) => normTarget === zone.slice(0, -1) || normTarget.startsWith(zone));
}

export function apply(ctx) {
  ctx.on('tools/pre-execute', async (exec, next) => {
    // V2 测试口：存在 throw-now 时故意抛出（先吃掉标记，崩了也能自救）。
    try {
      if (fs.existsSync(THROW_FLAG)) {
        try { fs.unlinkSync(THROW_FLAG); } catch (_) {}
        log('V2 throw-flag detected -> consumed flag, throwing out of the hook');
        throw new Error('staging-guard V2 deliberate throw');
      }
    } catch (e) {
      if (e && typeof e.message === 'string' && e.message.includes('V2 deliberate')) throw e;
    }

    try {
      const tool = exec && exec.name;
      if (!MUTATION_TOOLS.has(tool)) return next();

      const raw = mutationPath(tool, exec.arguments);
      const header = exec && exec.agent && exec.agent.session && exec.agent.session.header;
      const cwd = header && header.cwd;
      const abs = raw === undefined ? undefined : resolvePath(raw, cwd);
      const norm = abs === undefined ? undefined : normalizeForCompare(abs);
      const normCwd = normalizeForCompare(cwd);
      const normRoots = readRoots();
      const zones = resultZones(normCwd, normRoots);
      const argsPreview = JSON.stringify(argRecord(exec.arguments) || {}).slice(0, 300);

      log('WRITE tool=' + tool + ' raw=' + JSON.stringify(raw) + ' abs=' + JSON.stringify(abs) +
          ' norm=' + JSON.stringify(norm) + ' cwd=' + JSON.stringify(cwd) +
          ' roots=' + JSON.stringify(normRoots) + ' args=' + argsPreview);

      if (killSwitchOn()) {
        log('KILL-SWITCH on -> allow');
        return next();
      }

      if (isInResultZone(norm, zones)) {
        log('DENY result-zone ' + JSON.stringify(norm) + ' zones=' + JSON.stringify(zones));
        return {
          kind: 'deny',
          reason:
            RESULT_DIR + ' 是只读区，不能直接写入：' + raw + '\n' +
            '请改为写到「' + DRAFT_DIR + '/待定/」下，并在「' + DRAFT_DIR + '/待定/清单.md」登记（路径 / 动作 / 依据）。' +
            '人工放行后才进 ' + RESULT_DIR + '。',
        };
      }

      return next();
    } catch (e) {
      log('HOOK-INNER-ERROR ' + (e && e.message));
      try { return next(); } catch (_) { return undefined; }
    }
  });

  log('staging-guard armed (V5: deny writes under ' + RESULT_DIR + ' of {roots ∪ cwd}; roots=' +
      JSON.stringify(readRoots()) + '; cfg=' + ROOTS_CFG + '; kill-switch=' + KILL_SWITCH + ')');
}

// 供离线单测（不影响插件加载：注册只认 apply / name）。
export { isInResultZone, resultZones, readRoots, normalizeForCompare };
