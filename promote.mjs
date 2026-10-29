// promote.mjs —— 放行通道（必须在 DSH 宿主进程之外运行）
//
// 为什么是独立进程：插件在宿主内，分不清"模型调用"和"用户点击"。
// 任何注册给模型的放行工具都是假放行。所以放行只能由本地手工启动。
//
// 规则：
//   1. 清单是唯一入口 —— 待定区里没登记的文件，本脚本一律不认
//   2. 依据字段为空的不认
//   3. diff 用 git --no-index 机械生成，不做任何总结
//   4. 只有 y 才复制；复制后从清单移除并记账
//
// 用法：node promote.mjs <工作区根> [--check]
//   工作区根 = 同时含「草稿区」（草稿区/待定/清单.md）和「成果区」的目录
//   目录名可用 DSH_STAGING_GUARD_RESULT_DIR / DSH_STAGING_GUARD_DRAFT_DIR 覆盖
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';

const RESULT_DIR = process.env.DSH_STAGING_GUARD_RESULT_DIR || '成果区';
const DRAFT_DIR = process.env.DSH_STAGING_GUARD_DRAFT_DIR || '草稿区';
const STATE_DIR = process.env.DSH_STAGING_GUARD_DIR
  || path.join(os.homedir(), '.dsh', 'staging-guard');

const args = process.argv.slice(2);
const workspaceArg = args.find((a) => !a.startsWith('--'));
if (!workspaceArg) {
  console.error('用法：node promote.mjs <工作区根> [--check]');
  console.error('  工作区根 = 同时含「' + DRAFT_DIR + '」和「' + RESULT_DIR + '」的目录');
  process.exit(1);
}

const WORKSPACE = path.resolve(workspaceArg);
const CHECK_ONLY = args.includes('--check');
const DRAFT = path.join(WORKSPACE, DRAFT_DIR, '待定');
const RESULT = path.join(WORKSPACE, RESULT_DIR);
const LIST = path.join(DRAFT, '清单.md');
const ARCHIVE = path.join(WORKSPACE, DRAFT_DIR, '已放行');
const AUDIT_DIR = path.join(STATE_DIR, 'logs');
const AUDIT = path.join(AUDIT_DIR, 'promote-audit.log');

function die(msg) {
  console.error('\n错误：' + msg);
  process.exit(1);
}

if (!fs.existsSync(LIST)) die('找不到清单：' + LIST);
if (!fs.existsSync(RESULT)) die('找不到 ' + RESULT_DIR + '：' + RESULT);
fs.mkdirSync(AUDIT_DIR, { recursive: true });

const raw = fs.readFileSync(LIST, 'utf8');
const lines = raw.split(/\r?\n/);
const entries = [];

lines.forEach((ln, i) => {
  const t = ln.trim();
  if (!t.startsWith('|')) return;
  const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
  if (cells.length < 3) return;
  if (/^[-: ]+$/.test(cells[0])) return;
  if (cells[0] === '路径') return;
  if (cells[0] === '' || cells[0] === '（无）') return;
  entries.push({ lineIndex: i, rel: cells[0], action: cells[1] || '', basis: cells[2] || '', note: cells[3] || '' });
});

if (entries.length === 0) {
  console.log('\n清单里没有任何条目。没有可放行的东西。');
  process.exit(0);
}

const DIFF_LINE_LIMIT = 40;

function showDiff(target, candidate) {
  let out = '';
  try {
    out = execFileSync('git', ['-c', 'core.quotepath=false', 'diff', '--no-index', '--', target, candidate], { encoding: 'utf8' });
  } catch (e) {
    out = (e && e.stdout) ? e.stdout : '';
    if (!out) {
      console.log('(无法生成 diff：' + (e && e.message ? e.message : '未知错误') + ')');
      return;
    }
  }
  out = out || '(无差异)\n';
  const lines = out.split('\n');
  if (lines.length > DIFF_LINE_LIMIT) {
    process.stdout.write(lines.slice(0, DIFF_LINE_LIMIT).join('\n') + '\n');
    process.stdout.write('……（diff 共 ' + lines.length + ' 行，只显示前 ' + DIFF_LINE_LIMIT + ' 行；要看全的请直接比对两个文件）\n');
  } else {
    process.stdout.write(out);
  }
}

// 新文件不预览内容：要看直接打开草稿区文件。这里只给规模，够判断值不值得点 y。
function showNewFile(candidate) {
  const content = fs.readFileSync(candidate, 'utf8');
  const lines = content.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(content, 'utf8');
  process.stdout.write('（新文件：' + lines + ' 行 / ' + bytes + ' 字节 —— 不预览，要看请直接打开草稿区文件）\n');
}

function audit(o) {
  try {
    fs.appendFileSync(AUDIT, JSON.stringify(Object.assign({ ts: new Date().toISOString(), workspace: WORKSPACE }, o)) + '\n', 'utf8');
  } catch (_) {}
}

// 放行成功后把待定区那份挪到 草稿区/已放行/ 归档，不留在待定区堆着。
// 同名已存在时加时间戳后缀，保留历史版本。移动失败不影响已写入的成果。
function archive(candidate, rel) {
  try {
    const dest = path.join(ARCHIVE, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let final = dest;
    if (fs.existsSync(dest)) {
      const ext = path.extname(dest);
      const base = dest.slice(0, dest.length - ext.length);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
      final = base + '.' + stamp + ext;
    }
    fs.renameSync(candidate, final);
    return final;
  } catch (e) {
    return null;
  }
}

// 清单移除：不在循环里按行号删（会错位），等全部审完统一重写。
function pruneList(approvedRels) {
  if (!approvedRels.length) return;
  const cur = fs.readFileSync(LIST, 'utf8').split(/\r?\n/);
  const keep = cur.filter((l) => {
    const t = l.trim();
    if (!t.startsWith('|')) return true;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    return !approvedRels.includes(cells[0]);
  });
  fs.writeFileSync(LIST, keep.join('\n'), 'utf8');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// 用异步迭代器逐行取，而不是 rl.question：question 只消费一行，管道一次喂多行
// 时其余行会丢。迭代器在真人和管道下行为一致。输入结束时返回 q（退出）。
const lineIt = rl[Symbol.asyncIterator]();
async function ask(q) {
  process.stdout.write(q);
  const r = await lineIt.next();
  if (r.done) return 'q';
  return String(r.value).trim().toLowerCase();
}

// --check：只体检清单，不交互、不放行、不复制。
if (CHECK_ONLY) {
  console.log('== 清单体检（--check，不放行）==');
  console.log('工作区：' + WORKSPACE);
  console.log('');
  let bad = 0;
  for (const e of entries) {
    const candidate = path.join(DRAFT, e.rel);
    const target = path.join(RESULT, e.rel);
    const hasFile = fs.existsSync(candidate);
    const hasBasis = !!(e.basis && e.basis !== '—' && e.basis !== '-' && e.basis !== '空');
    const exists = fs.existsSync(target);
    const ok = hasFile && hasBasis;
    if (!ok) bad++;
    console.log((ok ? '✓ ' : '✗ ') + e.rel +
      '  | 动作=' + e.action +
      ' | 文件=' + (hasFile ? '有' : '缺') +
      ' | 依据=' + (hasBasis ? '有' : '缺') +
      ' | ' + RESULT_DIR + '=' + (exists ? '已存在(将出 diff)' : '新文件'));
  }
  console.log('');
  console.log('条目 ' + entries.length + ' 个，不合格 ' + bad + ' 个。');
  process.exit(bad === 0 ? 0 : 1);
}

const approved = [];
const rejected = [];
const skipped = [];
const invalid = [];

for (const e of entries) {
  const candidate = path.join(DRAFT, e.rel);
  const target = path.join(RESULT, e.rel);

  console.log('\n' + '='.repeat(70));
  console.log('文件：' + e.rel);
  console.log('动作：' + e.action);
  console.log('依据：' + (e.basis || '（空）'));
  if (e.note) console.log('批注：' + e.note);

  if (!fs.existsSync(candidate)) {
    console.log('✗ 待定区里没有这个文件，跳过。');
    invalid.push(e);
    continue;
  }
  if (!e.basis || e.basis === '—' || e.basis === '-' || e.basis === '空') {
    console.log('✗ 依据为空，按未登记处理，跳过。');
    invalid.push(e);
    continue;
  }

  const exists = fs.existsSync(target);
  if (exists) {
    console.log('\n---- diff（- ' + RESULT_DIR + '现状 / + 待定版）----');
    showDiff(target, candidate);
  } else {
    console.log('\n---- 新文件（' + RESULT_DIR + '尚无此文件）----');
    showNewFile(candidate);
  }

  let decision = '';
  while (decision !== 'y' && decision !== 'n' && decision !== 's' && decision !== 'q') {
    decision = await ask('\n[y] 放行  [n] 退回  [s] 跳过  [q] 退出 → ');
  }
  if (decision === 'q') {
    console.log('\n已退出，未处理的条目保持原样。');
    break;
  }
  if (decision === 's') {
    skipped.push(e);
    continue;
  }
  if (decision === 'n') {
    rejected.push(e);
    console.log('退回。文件留在待定区，可在清单里写批注。');
    continue;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(candidate, target);
  approved.push(e.rel);
  audit({ action: 'approve', file: e.rel, basis: e.basis, form: e.action, target });
  const moved = archive(candidate, e.rel);
  console.log('✓ 已放行进 ' + RESULT_DIR + '：' + target);
  if (moved) console.log('  待定区副本已归档：' + moved);
  else console.log('  ⚠ 归档失败（成果已写入，待定区副本保留）：' + candidate);
}

// 全部审完再统一重写清单，避免放行一条就删行导致后续行号错位。
pruneList(approved);

rl.close();

console.log('\n' + '='.repeat(70));
console.log('放行 ' + approved.length + ' 个' + (approved.length ? '：' + approved.join('、') : ''));
console.log('退回 ' + rejected.length + ' 个');
console.log('跳过 ' + skipped.length + ' 个');
console.log('未登记/无效 ' + invalid.length + ' 个' + (invalid.length ? '：' + invalid.map((x) => x.rel).join('、') : ''));
console.log('变更记录：' + AUDIT);
