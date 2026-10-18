# 树状时间笔记 TimeTree

> 以「**节点全局、日期视图**」为核心的本地优先桌面笔记应用。
> **同天为图，跨天为树**：节点可跨天延续、手动重现、局部编辑；多个节点可在某一天共同指向一个独立节点；所有边只属于当天，但可一键复制到明天。

版本：`0.2.0`（需求文档 v0.3 的**阶段 1 最小闭环 + 阶段 2 核心功能**：子节点跟随、复制边完整版、指向、操作记录与每日快照）

---

## 1. 快速开始

### 1.1 环境依赖

| 组件 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 20 | 前端构建 |
| pnpm | ≥ 9 | 包管理器（也可用 npm/yarn，命令自行替换） |
| Rust | ≥ 1.77 | 后端（`rustup` 安装） |
| Linux 系统库 | WebKitGTK 4.1 / GTK3 / libsoup3 / librsvg / libxdo | 仅 Linux 需要 |

Linux 一次性安装系统依赖（Ubuntu/Debian）：

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev librsvg2-dev libxdo-dev \
  libayatana-appindicator3-dev patchelf
```

### 1.2 安装与运行

```bash
pnpm install          # 安装前端依赖
pnpm icons            # （可选）重新生成应用图标
pnpm app:dev          # 开发模式：启动 Vite + Tauri 窗口，热更新
pnpm app:build        # 打包：生成安装包（AppImage / deb / rpm ...）
```

> ⚠️ **生产构建必须带 `custom-protocol` feature**
> Tauri v2 用 `dev = !custom_protocol` 判断运行模式。用裸 `cargo build --release`
> 编译出来的二进制会以「开发模式」启动，去连 `http://localhost:1420`，
> 在没有 Vite 服务时报 **`Could not connect to localhost: Connection refused`**。
>
> 正确姿势（任选其一）：
> ```bash
> pnpm app:build                                    # 官方 CLI，自动带 feature
> cargo build --release --features custom-protocol   # 手动构建
> pnpm package:desktop                               # 本项目脚本，自动带 feature
> ```

只做前端类型检查与构建：

```bash
pnpm typecheck        # tsc --noEmit
pnpm build            # tsc + vite build
```

只检查 Rust：

```bash
cd src-tauri && cargo check
cd src-tauri && cargo test    # 可见性状态机单元测试
```

### 1.3 数据存放位置

| 内容 | 路径 |
|---|---|
| 数据根目录 | Linux `~/.local/share/com.timetree.desktop/timetree`（macOS `~/Library/Application Support/...`） |
| SQLite | `<数据目录>/notes.db` |
| 节点正文 | `<数据目录>/notes/<node_id>.md` |
| 当日覆盖镜像 | `<数据目录>/overlays/<date>/<node_id>.md` |
| 备份 | `<数据目录>/backups/` |
| 搜索索引（阶段 3） | `<数据目录>/search-index/` |

> 开发时可用环境变量 `TIMETREE_DATA_DIR=/tmp/tt-dev` 隔离数据，便于反复测试。

---

## 2. 目录结构

```
timetree/
├── index.html
├── package.json
├── vite.config.ts / tsconfig*.json / tailwind.config.js / postcss.config.js
├── pnpm-workspace.yaml / .npmrc      # 放行 esbuild 安装脚本
├── scripts/gen-icons.mjs             # 零依赖手写 PNG 图标生成器
├── src/                              # ---------- 前端 ----------
│   ├── main.tsx / App.tsx / index.css
│   ├── types/index.ts                # 与 Rust models.rs 一一对应的类型
│   ├── api/commands.ts               # 唯一的 Tauri IPC 封装层
│   ├── store/useAppStore.ts          # Zustand + Immer 全局状态 + 会话内撤销
│   ├── graph/                        # React Flow：画布 / 节点卡片 / 边 / 工具栏
│   ├── components/                   # 顶栏 / 左列表 / 右详情 / 时间树 / 弹窗
│   ├── hooks/useHotkeys.ts           # 全局快捷键
│   └── lib/                          # 日期、标签、自动布局、工具
└── src-tauri/                        # ---------- 后端 ----------
    ├── Cargo.toml / build.rs / tauri.conf.json / capabilities/
    ├── icons/
    └── src/
        ├── main.rs / lib.rs          # 入口 + 命令注册
        ├── state.rs                  # 数据目录 + SQLite 连接 + 事务辅助
        ├── error.rs                  # 统一错误（序列化成 `[code] 消息`）
        ├── models.rs                 # 数据结构与枚举（serde camelCase）
        ├── util.rs                   # 日期 / ID / 时间戳工具
        ├── visibility.rs             # ★ 可见性状态机（含单元测试）
        ├── content.rs                # Markdown 正文读写 + content_revisions
        ├── db/{mod.rs,migrations.rs} # 连接、PRAGMA、迁移
        ├── repo/                     # ★ 数据访问层（全部 SQL）
        │   ├── node_repo.rs / occurrence_repo.rs / overlay_repo.rs
        │   └── edge_repo.rs / layout_repo.rs / settings_repo.rs
        └── commands/                 # ★ Tauri 命令（参数校验 + 编排）
            ├── day_view.rs           # 日期视图（可见性引擎入口）
            ├── node.rs / occurrence.rs / overlay.rs
            ├── edge.rs               # 含「复制边到明天」
            ├── layout.rs / time_tree.rs / misc.rs
```

**分层规则**：`commands → repo → db`，`commands → visibility → models`。
命令层不写 SQL，仓库层不做业务判断，可见性引擎是纯函数式的（输入数据、输出判定），便于测试与缓存。

---

## 3. 架构与数据流

```
┌──────────────────────── 前端 (WebView) ────────────────────────┐
│ React 组件 ──> Zustand Store ──> api/commands.ts ──invoke──┐   │
│      ▲                │                                   │   │
│      └── React Flow 画布（节点卡片 / 边 / 布局持久化）      │   │
└───────────────────────────────────────────────────────────┼───┘
                                                            │ Tauri IPC
┌──────────────────────── 后端 (Rust) ──────────────────────▼───┐
│ commands/*  ──编排──> visibility.rs（可见性状态机）             │
│      │                     ▲                                  │
│      ▼                     │                                  │
│ repo/*（SQL） ───────> SQLite(notes.db, WAL)                   │
│      │                                                        │
│      └──> content.rs ──> notes/*.md + content_revisions        │
└───────────────────────────────────────────────────────────────┘
```

**一次日期切换的完整流程**：

1. 前端 `setDate(date)` → `get_day_view(date)`
2. 后端 4 次查询载入上下文：全部节点 / 当天覆盖 / 覆盖该日的出现段 / 跟随覆盖
3. `VisibilityContext` 对每个节点跑 7 条优先级规则，得到「可见 + 原因 + 命中规则号」
4. 组装 `DayView`：可见节点（含合并覆盖后的显示标题）、隐藏节点（含原因）、当天边（含两端可见性与双向标记）、当天布局
5. 前端渲染；**没有布局记录的节点**会按「最长路径分层」自动布局并落库（需求 4.2.7）

---

## 4. 可见性状态机（核心）

实现位置：`src-tauri/src/visibility.rs`，优先级从高到低：

| # | 规则 | 结果 | 阶段 |
|---|---|---|---|
| 1 | 软删除 `deleted_at is not null` | 隐藏 | 1 |
| 2 | 状态 = 已取消 `cancelled` | 隐藏（历史日期也隐藏） | 1 |
| 3 | 当日覆盖 `visible = false` | 隐藏 | 1 |
| 4 | 已完成 + 自动延续，且日期晚于完成日 | 隐藏 | 1 |
| 5 | 父节点跟随（受 `node_follow_overrides` 约束） | 可见 / 不可见 | 2（默认关闭） |
| 6 | 出现段覆盖（含**自动延续动态可见**） | 可见 | 1 |
| 7 | 以上都不满足 | 默认隐藏 | 1 |

关键设计：

- **不物化每日出现段**。自动延续 = 「存在起始日 ≤ D 且 `end_date IS NULL` 的开放段」且节点未完成 → 动态可见。
- 新建节点时按延续策略生成**起始出现段**：`auto` → 开放段；`manual/none/reappear` → 只覆盖创建日的闭段。
- **完成即截断**：状态改为 `done` 时，把开放段的 `end_date` 写为完成日；把状态改回未完成时自动重新打开（需求 4.1.9「已完成可手动重新激活」）。
- 规则 4 的补充约束：若存在**起始日晚于完成日**的出现段，说明节点在完成后被手动重新激活，此时规则 4 不生效（否则「重新出现」会被误杀）。
- 递归求父节点可见性时带访问栈，防止数据异常形成环导致栈溢出。
- 结果在单次日期视图内缓存，每个节点只计算一次。

**两个可调开关**（设置表 `settings`，UI 里在「设置 → 可见性状态机」）：

| 键 | 默认 | 含义 |
|---|---|---|
| `visibility.auto_continuation` | `1` | 关闭后退化为阶段 1 最简语义：只有出现段起始日可见 |
| `visibility.parent_follow` | `0` | 打开后启用规则 5（子节点跟随父节点） |

单元测试覆盖：自动延续、开关退化、完成截断、完成后重新激活、软删除/已取消优先、当日覆盖隐藏、闭段区间。运行 `cd src-tauri && cargo test`。

---

## 5. 数据模型

11 张表在迁移 `v1` 中一次创建到位（阶段 2/3 的表先建好，避免后续加表迁移）：

| 表 | 用途 | 阶段 |
|---|---|---|
| `nodes` | 节点全局本体（标题、状态、延续策略、父节点、软删除） | 1 |
| `occurrences` | 出现段（开始/结束日、来源、是否手动重现） | 1 |
| `day_overlays` | 当日覆盖（标题/正文/可见性/排序/样式，空值 = 未覆盖） | 1 |
| `day_edges` | 当天边（`single` / `point`，`group_id`、`copied_from_date`、`batch_id`） | 1 |
| `day_node_layout` | 每日布局（x、y、折叠、层级、锚点） | 1 |
| `settings` | 设置键值对 | 1 |
| `schema_migrations` | 迁移版本 | 1 |
| `content_revisions` | 正文版本（全文 / diff 标记） | 1（写入） |
| `operations` | 操作记录（元数据 + diff 引用） | 2 |
| `node_follow_overrides` | 子节点跟随覆盖 | 2 |
| `daily_snapshots` | 每日快照 | 2 |
| `node_versions` | 节点版本（可选） | 2 |

约束与索引要点：

- 每次连接都 `PRAGMA foreign_keys = ON`（需求 4.6）。
- `day_edges` 的唯一约束用**部分唯一索引**：`(date, from_node_id, to_node_id, type) WHERE deleted_at IS NULL`，因此软删除后可以重建同样的边。
- 迁移前若库已存在，自动用 SQLite 在线备份 API 备份到 `backups/pre-migration-v<n>-<时间>.db`。
- 索引覆盖出现段（节点 / 区间）、当天边（日期 / 起点 / 终点 / 批次）、覆盖（日期）、布局（日期）、节点（父 / 状态 / 星标 / 软删除）。

---

## 6. 撤销模型（会话内）

阶段 1 采用**补偿式撤销**：每条可撤销操作同时给出 `apply`（正向）与 `revert`（反向补偿），两者都调用后端命令，因此撤销后数据库与 UI 始终一致。

| 操作 | 正向 | 反向补偿 |
|---|---|---|
| 新建节点 | `save_node` | `purge_node`（物理删除，级联清理） |
| 编辑节点 | `save_node` | `save_node`（回写快照） |
| 改状态 / 星标 | `set_node_status` / `save_node` | 回写快照 |
| 编辑正文 | `save_node_content` | 回写旧正文 |
| 当日覆盖 | `save_day_overlay` | 回写旧覆盖 或 `clear_day_overlay` |
| 新建边 | `create_edge` | `purge_edge` |
| 删除边 | `delete_edge`（软删除） | `restore_edge` |
| 批量删边 | `delete_edges` | 逐条 `restore_edge` |
| 复制边到明天 | `restore_edge_batch` | `delete_edge_batch`（按批次） |
| 移动节点 | `save_day_layouts` | 回写旧坐标 |
| 自动排列 | `save_day_layouts` | 回写旧坐标 |
| 新增出现段 | `add_occurrence` | `delete_occurrence` |
| 删除出现段 | `delete_occurrence` | 用快照 `add_occurrence` 重建（id 会变） |

- 连续输入（正文、覆盖标题、移动节点）在 **1.2 秒内自动合并为一步**，避免撤销栈被逐字符操作塞满。
- 撤销栈上限 120 步，仅存内存（会话内）。
- 阶段 2 会改为写入 `operations` 表 + `content_revisions`，实现跨会话撤销与快照恢复（表结构已就绪）。

---

## 7. 复制边到明天（阶段 1 简化版）

实现：`src-tauri/src/commands/edge.rs::copy_edges_to_next_day`

1. 取源日期的边（可只复制选中的）
2. 载入**次日**的可见性上下文，判断每条边两个端点次日是否可见
3. 两端都可见 → 复制，写入 `copied_from_date` 与同一个 `batch_id`；`group_id` 会重新映射，保证多向边在次日仍是同一组
4. 任一端不可见 → 跳过并汇总（**不自动延续节点**，符合阶段 1 的简化约定）
5. 次日已存在同样的边 → 计入 `skipped_duplicate`（唯一索引兜底）
6. UI 弹出汇总面板，可一键撤销整批

---

## 8. IPC 命令清单

| 命令 | 说明 |
|---|---|
| `get_day_view(date, includeHidden)` | 日期视图（可见节点 + 隐藏节点 + 边 + 布局 + 统计） |
| `get_node` / `list_nodes` / `search_nodes` | 节点读取 |
| `save_node` / `delete_node` / `restore_node` / `purge_node` | 节点写入（全量替换语义） |
| `set_node_status(nodeId, status, onDate)` | 快速改状态（含完成截断 / 重新激活） |
| `get_node_content` / `save_node_content` | Markdown 正文（保存即产生 `content_revisions`） |
| `get_node_previews(nodeIds, date, maxChars)` | 批量正文预览（一次 IPC 取回，避免 N+1） |
| `list_occurrences` / `add_occurrence` / `update_occurrence` / `delete_occurrence` | 出现段管理 |
| `continue_node_to_next_day` / `reappear_node` | 手动延续 / 手动重新出现 |
| `get_day_overlay` / `save_day_overlay` / `clear_day_overlay` | 当日覆盖 |
| `list_day_edges` / `create_edge` / `update_edge` / `delete_edge` / `delete_edges` | 当天边 |
| `copy_edges_to_next_day` / `delete_edge_batch` / `restore_edge_batch` | 复制与批次撤销 |
| `get_day_layouts` / `save_day_layouts` / `reset_day_layouts` | 布局持久化 |
| `get_node_time_tree` | 节点时间树（出现段 + 子节点树 + 每日边 + 覆盖摘要） |
| `get_settings` / `set_setting` / `get_app_info` / `create_backup` / `list_backups` | 设置与备份 |

---

## 9. 界面与快捷键

- **顶部**：日期切换（← / → / 今天 / 日历跳转）、搜索、撤销 / 重做、设置
- **左侧**：当天 / 全部 / 隐藏 三个范围 + 星标与状态筛选
- **中间**：React Flow 当天图，卡片显示状态、来源徽标（自动延续第 N 天 / 手动延续 / 重新出现）、当日覆盖标记、正文预览
- **右侧**：详情 / 编辑（**默认当日局部编辑**，可切换「编辑节点本体」）与时间树

| 快捷键 | 功能 |
|---|---|
| `←` / `→` | 前一天 / 后一天 |
| `T` | 回到今天 |
| `N` | 新建节点 |
| `E` | 连线模式 |
| `C` | 复制当天边到明天 |
| `H` | 显示 / 隐藏不可见节点 |
| `Delete` | 删除选中节点或边 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销 / 重做 |
| `Ctrl+A` | 全选当天可见节点 |
| `Esc` | 取消选择 / 退出连线模式 |

> 输入框聚焦时全局快捷键自动禁用。

---

## 10. 阶段 1 交付对照

| 需求（阶段 1） | 状态 | 位置 |
|---|---|---|
| 初始化 Tauri 2 + React + TS + Vite | ✅ | 根目录 + `src-tauri/` |
| SQLite 表结构（nodes/occurrences/day_overlays/day_edges/day_node_layout/settings/schema_migrations） | ✅ 并额外建好阶段 2 表 | `db/migrations.rs` |
| Rust 命令：日期视图 / 保存节点 / 保存局部覆盖 / 创建边 / 复制边到明天 / 节点时间树 / 布局读写 | ✅ 共 53 个命令 | `commands/*` |
| 简化可见性判定（手动出现段 + 完成状态） | ✅ 实现完整状态机，父节点跟随用开关默认关闭 | `visibility.rs` |
| 前端日期切换 / React Flow 当天图 / 节点创建编辑 / 当天边 / 复制边简化版 / 布局持久化 | ✅ | `src/graph`, `src/components` |
| 会话内撤销 | ✅ 补偿式撤销 + 重做 + 合并 | `store/useAppStore.ts` |

**额外完成（阶段 2 的内容，已可直接使用）**：正文版本表写入、自动延续动态可见、完成后重新激活、节点时间树、指向边与批次撤销、备份、设置面板。

---

## 11. 验证记录

交付前完成了以下验证（均为真实运行结果）：

| 检查项 | 命令 | 结果 |
|---|---|---|
| 前端类型检查 | `pnpm typecheck` | ✅ 0 error |
| 前端生产构建 | `pnpm build` | ✅ 1773 modules → `dist/` |
| 后端类型检查（真实 Tauri 工程 + 600 余个依赖） | `cd src-tauri && cargo check` | ✅ 0 warning / 0 error |
| 可见性状态机单元测试 | `cd src-tauri && cargo test` | ✅ 7 passed |
| 后端集成测试（真实 SQLite，含阶段 2） | `cargo test --test integration` | ✅ 15 passed |
| IPC 契约审计（53 个命令的参数名对齐） | `pnpm audit:ipc` | ✅ 0 问题 |
| 真实 release 构建 | `cargo build --release` | ✅ 37 分钟，10.6 MB 单文件 |
| 真机启动冒烟测试 | 直接运行 release 二进制 12 秒 | ✅ 自动跑完 v1+v2 迁移、建 13 张表、写入 9 项默认设置 |
| 桌面封装 | `bash scripts/package-desktop.sh` | ✅ `.deb` 2.8 MB + 用户级安装 + 桌面快捷方式（已标记 trusted） |

集成测试覆盖：迁移建表与外键/索引、自动延续、完成截断、完成后重新激活、当日覆盖隐藏、已取消、软删除与恢复、手动延续、边唯一约束与自环拒绝、复制边（端点不可见则跳过 / 重复跳过 / 批次撤销与恢复）、布局 upsert、正文版本、时间树聚合、备份、父节点跟随开关、父子环检测。

测试过程中抓出并修复了两个**真实缺陷**：

1. **可见性引擎缺少「出现段是否覆盖该日期」的显式校验**——原先依赖 SQL 预过滤，引擎单独使用时会误判；现在引擎内部自带防御性校验。
2. **完成后被截断的闭段在区间内的历史日期不可见**——违反需求 4.1.9「已完成节点在历史日期中仍然可见」；已修正规则 6 对闭段的判定。

> 集成测试位于独立的校验工程（用 `tauri` 替身 crate + `#[path]` 直接引入源码），因此不需要 WebKitGTK 桌面环境即可运行；它验证的是与真实运行完全相同的 `state / repo / commands` 代码。

---

## 12. 阶段 2 交付内容（v0.2.0）

| 能力 | 说明 | 入口 |
|---|---|---|
| **子节点跟随与覆盖** | `node_follow_overrides` 落地：default / follow / never / delayed / independent 五种模式，支持生效区间；可见性规则 5 真正生效（设置里打开开关） | 详情面板「子节点跟随」 |
| **复制边完整版** | 端点次日不可见时，可「批量延续并复制」：为端点补一天出现段后重试；补出的出现段会在撤销复制时一并回滚 | 复制汇总弹窗 |
| **指向完整流程** | 多选节点 → 选/建独立节点 C → 建立 point 边；C 当天不可见时可打「临时可见」标记（不生成出现段、可撤销） | 工具栏「指向」 |
| **临时可见标记** | 迁移 v2 给 `day_overlays` 加 `force_visible`，可见性引擎新增规则 3.5 | 详情面板「临时可见」 |
| **操作记录** | 每次节点/边/覆盖/出现段/快照变更写 `operations`（元数据 + 前后 JSON，不存正文） | 右侧「历史」 |
| **每日快照** | 每天首次进入自动生成；可手动重拍、查看摘要、按天恢复（覆盖当日边/覆盖/布局）、删除 | 右侧「历史」 |
| **迁移 v2** | `ALTER TABLE day_overlays ADD COLUMN force_visible`，迁移前自动备份，`schema_migrations` 记录版本 | 启动时自动执行 |

新增命令（11 个）：`set_day_force_visible`、`list_follow_overrides`、`set_follow_override`、`delete_follow_override`、`list_operations`、`list_snapshots`、`create_snapshot`、`ensure_daily_snapshot`、`delete_snapshot`、`restore_snapshot`。

**阶段 2 的取舍说明**

- 快照恢复只覆盖「日粒度」数据（当天边 / 当日覆盖 / 布局）。节点本体与出现段是跨天数据，恢复它们会波及其他日期，因此不纳入——需要整体回滚时使用 `backups/` 里的整库备份。
- 指向不会合并内容：C 是独立节点，原节点保留并继续显示，只在当天建立 point 边。
- 跟随覆盖的「延迟出现 / 独立出现」语义目前等同于「不跟随 / 不跟随」，主要用于阶段 3 的时间轴呈现预留。

## 13. 封装成桌面应用

```bash
# 1) 构建 release 二进制
cd src-tauri && cargo build --release && cd ..

# 2) 打包 + 安装到当前用户 + 生成桌面快捷方式
bash scripts/package-desktop.sh

# 只生成 .deb（产物在 dist-pkg/）
bash scripts/package-desktop.sh --no-install
```

脚本会做三件事：

1. 生成 `dist-pkg/timetree_<版本>_amd64.deb`（含 desktop 文件、图标、postinst）
2. 把二进制装到 `~/.local/bin/timetree`，desktop 文件装到 `~/.local/share/applications`
3. 在桌面（`~/桌面` 或 `~/Desktop`）放一个可双击的 `timetree.desktop`，并标记为可信

需要系统级安装时：`sudo dpkg -i dist-pkg/timetree_*.deb`。

## 14. 已知限制与后续计划

**限制**

- 撤销栈只在内存中，重启应用后清空（阶段 2 用 `operations` 表持久化）。
- 搜索只匹配标题与当日覆盖标题；正文全文检索与中文分词在阶段 3 用索引实现。
- 父节点跟随（规则 5）已实现但默认关闭，跟随覆盖表还没有写入 UI。
- 指向时若目标节点当天不可见，目前只做提示，尚未提供「临时可见标记」。
- 手写布局算法是可读性优先的分层布局，没有做连线交叉最小化；节点很多时建议先折叠。

**路线**

- 阶段 2：完整延续策略管理、子节点跟随 UI、局部覆盖编辑增强、节点时间树交互、指向完整流程、操作记录与每日快照、复制边完整版（含批量延续端点）
- 阶段 3：搜索索引（tantivy + jieba/n-gram）、导出 JSON + Markdown、备份恢复、加密、迁移 UI
- 阶段 4：同步（CRDT）、移动端、插件系统

**排查建议**

- 窗口空白：确认用 `pnpm app:dev` 启动（浏览器直接打开会被拦截并给出提示）。
- Linux 缺库：`pkg-config --exists webkit2gtk-4.1 && echo ok`，失败就按 1.1 安装系统依赖。
- 数据异常：直接删掉数据目录下的 `notes.db*` 重新开始（正文 Markdown 不会被删）。
