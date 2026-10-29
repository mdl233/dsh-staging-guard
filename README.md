# dsh-staging-guard

> DSH（DeepSeek Harness）的 `tools/pre-execute` 钩子：拒绝写入「受保护根下的 `成果区/`」，其余一律放行。
>
> 用途：把「只读真源」和「草稿」分开。agent 只能往 `草稿区/` 写，要进 `成果区/` 必须由人手工放行。

## 规则

- 写入目标落在 `<受保护根>/成果区/` ⇒ **deny**，理由写明该往哪写。
- 受保护根 = 配置里的根列表 **∪** 当前会话的 cwd（cwd 兜底：配置丢了也不至于完全失去保护）。
- 只拦 `write` / `edit` / `str_replace_editor` 三个工具，其他工具不看。
- 配置**每次调用现读** ⇒ 增删根不必重启宿主（改 `lib/index.js` 才需要重启）。

## 安装

```bash
# 方式一：本地目录
node install.mjs

# 方式二：npm（若有发布）
dsh plugin add dsh-staging-guard
```

`install.mjs` 会先备份 `profile/package.json` 基线，再加 `dependencies` 与 `dsh.profile.bundles` 各一行，最后跑 `pnpm install`。装完若宿主没有热加载，重启 DSH。

## 配置

全部可用环境变量覆盖：

| 变量 | 默认 | 作用 |
|---|---|---|
| `DSH_STAGING_GUARD_DIR` | `~/.dsh/staging-guard/` | 状态目录（日志、`roots.json`、应急开关） |
| `DSH_STAGING_GUARD_RESULT_DIR` | `成果区` | 只读区目录名 |
| `DSH_STAGING_GUARD_DRAFT_DIR` | `草稿区` | 草稿区目录名 |
| `DSH_PROFILE_DIR` | `~/.dsh/profiles/desktop` | 安装目标 profile |

受保护根写在 `<状态目录>/roots.json`：

```json
{ "roots": ["D:\\projects\\alpha", "E:\\projects\\beta"] }
```

## 应急开关

在状态目录下建一个 `disabled` 文件，钩子立刻全放行（不用重启）：

```bash
# Windows
"%USERPROFILE%\.dsh\staging-guard\disabled"
# 或双击 emergency-allow-all.bat / emergency-restore-guard.bat
```

`throw-now` 文件用来验证「钩子抛异常 = fail-closed」：建它，下一次写操作会故意抛错。

## 放行通道

`promote.mjs` 必须在**宿主进程之外**运行（人手工启动）：

```bash
node promote.mjs <工作区根> [--check]
```

它读 `草稿区/待定/清单.md`，逐条 `git diff --no-index` 给你看，只有输入 `y` 才复制进成果区，然后归档草稿并记账。**插件本身没有任何放行入口**，模型无法自己解锁。

## 限制（重要）

这是**防手滑的软边界，不是安全边界**：

- `pwsh`、脚本、`git` 写文件都绕得过去；
- 钩子抛异常时是 fail-closed（该次调用失败），但不影响宿主；
- 它拦的是「模型忘了规矩」这类错误，不是恶意绕过。

## 文件

| 文件 | 用途 |
|---|---|
| `lib/index.js` | 钩子本体 |
| `cordis.patch.yml` | 插件自带 patch（挂 `staging-guard`） |
| `install.mjs` / `install.bat` | 安装（备份基线 → 改 package.json → pnpm） |
| `rollback.bat` | 回滚（还原 package.json 基线，不依赖 DSH / node / pnpm） |
| `promote.mjs` / `promote.bat` | 放行通道（宿主外运行） |
| `emergency-allow-all.bat` / `emergency-restore-guard.bat` | 应急总开关（建 / 删 `disabled`） |
| `clear-v2-flag.bat` | 清 `throw-now` 标记 |
| `test-scope.mjs` | 判定逻辑离线单测（自包含，换机器可直接跑） |

## 许可

MIT
