# Private Item Library

一个本地优先的个人物品管理 PWA，用来记录、整理和追踪自己的物品。
它支持分类、标签、搜索、购买与持有成本、保修和物品生命周期管理，并可在手机或桌面浏览器中离线使用。
数据默认保存在当前设备；云端同步是可选能力，不影响本地使用。

## 主要功能

- 物品记录：名称、图标、备注、分类、标签与搜索。
- 分类与标签：管理分类层级、标签和物品归属。
- 生命周期：支持「心愿 → 持有 → 已处置」，处置方式包括出售、丢弃和其他。
- 购买与持有成本：记录购买日期、购买价格、附加花费和购买平台，计算总投入、实际持有成本与日均成本。
- 保修追踪：记录保修到期日，并在列表和详情页显示保修状态。
- 备份恢复：导出和恢复经过校验的 ZIP 备份，包含业务数据及用户资产。
- 可选云同步：通过恢复码连接同步空间，在设备之间同步或恢复数据。
- PWA：支持安装到主屏幕、响应式界面和离线使用。

## 界面预览

以下截图来自仓库内的真实浏览器验收记录：

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/phase2h/01-dashboard-light.png" alt="概览页"></td>
    <td width="50%"><img src="docs/screenshots/phase2h/03-items-grid-light.png" alt="物品列表"></td>
  </tr>
  <tr>
    <td align="center"><sub>概览：投入、分类、保修提醒与最近添加</sub></td>
    <td align="center"><sub>物品列表：筛选、排序、标签与成本信息</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/phase2h/05-detail-top-light.png" alt="物品详情"></td>
    <td><img src="docs/screenshots/phase2h/11-settings-light.png" alt="设置页"></td>
  </tr>
  <tr>
    <td align="center"><sub>物品详情：购买信息、成本和保修追踪</sub></td>
    <td align="center"><sub>设置：外观、备份、分类、标签与图标库</sub></td>
  </tr>
</table>

## 技术栈

- React、TypeScript、React Router
- Vite、Tailwind CSS
- Dexie / IndexedDB
- JSZip、vite-plugin-pwa
- Vitest
- 可选同步：Cloudflare Workers + D1

## 快速开始

需要 Node.js 环境。在项目根目录执行：

```bash
npm ci
npm run dev
```

开发服务器启动后，按终端提示打开本地地址。其他常用命令：

```bash
npm test
npm run build
```

## 数据存储与安全

- 本地数据保存在浏览器 IndexedDB。应用采用 local-first 方式，新增、编辑和删除首先写入本机，不依赖网络才能使用。
- ZIP 备份由应用在本地生成；恢复前会先校验内容，确认后才替换当前本地数据。
- 云端同步默认关闭。开启后，应用通过自行配置的 Cloudflare Worker 与 D1 同步；D1 保存的是同步数据镜像，不是本地 IndexedDB 的替代品。
- 恢复码包含连接同步空间所需的凭据，应像密码一样离线保管，不要提交到 Git、截图或公开聊天中。恢复码丢失且本机数据已清除时，无法重新认证原同步空间。
- 关闭云同步不会删除本地业务数据；恢复码也不会写入 ZIP 备份。

## 开发文档

- [架构与维护入口](docs/architecture.md)：当前目录边界、数据契约、同步边界和验证入口。
- [AGENTS.md](AGENTS.md)：仓库工程约束、浏览器测试安全规则和提交前检查。
- [BROWSER_TESTING.md](BROWSER_TESTING.md)：隔离浏览器验收说明。
- [仓库治理记录](docs/REPOSITORY_GOVERNANCE.md)：文件保留、忽略规则和仓库维护约定。
- [同步设计文档](docs/PHASE_3A_SYNC_DESIGN.md)：同步边界与设计背景。
- [同步实现计划](docs/PHASE_3B_IMPLEMENTATION_PLAN.md)：云同步实现与审查记录。

## License

仓库当前没有 `LICENSE` 文件，未声明开源许可证，保留所有权利。
