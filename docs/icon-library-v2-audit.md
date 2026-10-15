# 物品图标库 2.0 验收与更新审计

验收日期：2026-10-16。工作分支：`feat/icon-library-v2`。起点：`cdb19c09cc4ff00fd0115565f378a3467f54d3d2`。产品版本升级为 `0.2.0`。

本次交付 219 个图标（新增 63），九类 ID/名称、已有 156 个图标文件及所有既有 `preset-<key>` ID 保留。完成共享分类浏览/搜索、单击选择，以及仓库内可确认的 PWA 更新检查修复。没有执行 Cloudflare 生产部署、D1 操作或真实 iPhone 测试。最终提交 SHA 见交付回复或 `git rev-parse HEAD`。

## 图标数量与去重

以注册表、资源文件和生成记录交叉检查，起点实际为 156 个，不使用旧注释中的 73 等数字。

| ID | 分类 | 原有 | 新增 | 总数 |
|---|---|---:|---:|---:|
| digital | 数码 | 54 | 6 | 60 |
| office | 办公 | 9 | 8 | 17 |
| apparel | 服饰 | 19 | 8 | 27 |
| life | 生活 | 16 | 12 | 28 |
| care | 护理 | 10 | 5 | 15 |
| kitchen | 厨房 | 14 | 8 | 22 |
| home | 家居 | 12 | 10 | 22 |
| hobby | 兴趣 | 19 | 5 | 24 |
| other | 其他 | 3 | 1 | 4 |
| 合计 | | 156 | 63 | 219 |

64 个建议名称与现有名称/别名自动比较，发现三处重合：“卷尺”曾是 `ruler` 的宽泛关键词，但旧图是直尺；“置物架”曾是 `deskorg` 的关键词，但旧图是桌面文具整理架；二者分别新增独立图形。“杂物”与 `other` 通用物品完全重合，本轮不重复绘制。若以后补到 220，可考虑独立的“密封文件筒”，本轮保持 219。

新增清单（文件均为 `public/icons/items/<key>.webp`）：

| 分类 | 名称与稳定 key |
|---|---|
| 数码 | 笔记本支架 laptopstand、显示器支架 monitorarm、内存条 ram、显卡 graphicscard、光猫 opticalmodem、智能插座 smartplug |
| 办公 | 便签纸 stickynotes、胶带 tape、长尾夹 binderclip、回形针 paperclip、文件盒 filebox、活页夹 ringbinder、白板 whiteboard、笔袋 pencilcase |
| 服饰 | 袜子 socks、内衣 underwear、睡衣 pajamas、毛衣 sweater、裙子 skirt、皮靴 boots、凉鞋 sandals、运动服 sportswear |
| 生活 | 衣架 hanger、垃圾桶 trashcan、纸巾 tissues、湿巾 wetwipes、洗衣液 detergent、晾衣架 dryingrack、挂钩 hook、卷尺 tapemeasure、锤子 hammer、钳子 pliers、针线盒 sewingkit、收纳袋 storagebag |
| 护理 | 牙膏 toothpaste、洗发水 shampoo、沐浴露 bodywash、洗面奶 cleanser、防晒霜 sunscreen |
| 厨房 | 盘子 plate、勺子 spoon、叉子 fork、饭盒 lunchbox、保鲜盒 foodcontainer、调味罐 spicejar、锅铲 spatula、开瓶器 bottleopener |
| 家居 | 床 bed、枕头 pillow、被子 duvet、床单 bedsheet、衣柜 wardrobe、书架 bookshelf、置物架 shelf、椅子 chair、镜子 mirror、窗帘 curtains |
| 兴趣 | 跳绳 jumprope、弹力带 resistanceband、泡沫轴 foamroller、拼图 puzzle、画笔套装 paintbrushes |
| 其他 | 证书 certificate |

## 图像模型、来源与视觉验收

最初指定的模型 ID 是 `gpt-image-2.5-sunburst`。审计发现当前内置 `image_gen.imagegen` 工具只暴露提示词、透明背景和参考图参数，不暴露模型选择或实际模型 ID；没有配置可用于显式指定模型的 API Key，也没有执行独立付费 API 请求。在暂停批量生成并说明限制后，用户明确补充：“我的意思是指你的image2模型，不是api调用，你用生图模型帮我画图”。随后使用内置工具生成。

**实际模型 ID 无法验证，记录为 `null`。不宣称已验证 GPT Image 2.5。** 调用方式为内置 `image_gen.imagegen`、`transparent_background=true`：63 次单图生成，加 1 次洗面奶修图。没有用 Emoji、SVG 或程序绘图代替生图结果。程序仅执行透明裁边、等比缩放、WebP 编码和验收拼图合成。

先完成并检查 12 个代表项：内存条、白板、袜子、垃圾桶、洗发水、饭盒、枕头、拼图、显卡、衣架、跳绳、证书。与旧图混合检查材质、左上光照、三分之四视角、主体比例及浅深色 40px 辨识度，再分批完成其余 51 个。洗面奶初稿有中文和印花，被拒绝后用内置编辑移除，初稿和修改提示词均保留。原有图标没有重绘。

所有新文件为真实 alpha 透明背景、768×768 WebP，最长边主体区域约 600px（78.125%），质量 90、alpha 质量 100。原始生成图尺寸不一，保留原图后规范化输出；没有把棋盘格当作透明背景。全部输出经过 alpha 检查、浅深色大图及 40px 缩略图检查；浏览器离线解码又检查了全部 219 张图的尺寸和透明角落。

- [219 个图标总览](../assets/item-icons/overview.webp)
- [首批 12 个与旧图的对比拼图](../assets/item-icons/comparison-first-12.webp)
- [逐图提示词、来源及输出校验值](../assets/item-icons/prompts.json)
- [新图原图与记录 ZIP（本地交付件，不入 Git）](../.tmp/icon-library-v2/source-images.zip)，79,308,144 字节。接受的原图在 ZIP 的 `originals/<key>.png`，包含被拒绝的洗面奶初稿。

原图 ZIP SHA-256：`2fdbf31ffa48ea267a88117f6dd85a3b9c1beb00aa7d365fbe02ddd7cbd52826`。请将 ZIP 另存到长期项目备份；`.tmp` 不属于 Git 历史。旧图原图仍在既有 `.tmp/icon-redraw/`，内置工具原始输出也保持原位。

## iPhone 旧图标：调用链与分层结论

`PRESET_ICONS → buildPresetAssets → Boot.syncPresetAssets → assets 表 → assetRepository.iconUrl / usePresetAssetMap → 卡片、列表、详情、编辑页`。

1. 当前所有**已知 preset** 页面通过注册表使用 `/icons/items/<key>.webp`，没有发现生产页面硬编码旧 SVG。`f797051` 实际改了 7 个文件，其中 6 个 SVG、0 个 WebP，其 SVG 润色不会改变当前 WebP 内容；后续 `cdb19c0` 才加入整套物品 WebP（另有总览 WebP）。
2. 历史 SVG 资源保留用于兼容。未知历史 preset 仍可使用其存储路径，不能为升级删除它们；这不代表已知 preset 页面仍在选旧 SVG。
3. `syncPresetAssets()` 已支持对旧路径、MIME 和宽高原位更新，保留 `createdAt`、ID 和用户字段；重复执行不产生重复记录，也不修改物品行。
4. 已知 preset 的 `iconUrl` 使用当前注册表，即使旧备份还带 SVG 路径也会显示 WebP。新增修复了“恢复旧备份后不重启 Boot，资产表暂时缺少后来新增 preset”的问题：在原有替换恢复事务中同步 preset，一起成功或一起回滚。

| 层次 | 已确认事实 | 无法据此确认的事项 |
|---|---|---|
| GitHub 仓库 | 开始时 main 为 cdb19c0；新代码和图标在本工作分支 | 推送代码不等于 Cloudflare 发布 |
| Cloudflare 部署 | 确认的线上地址返回旧基线 bundle `index-CzHxvlbI.js`；线上 SW 列出 156 张 WebP；laptop/phone/other 响应与原有本地文件逐字节相同 | 未访问账号或 Dashboard 部署记录；没有发布本轮 0.2.0 |
| SW 预缓存 | Workbox 为 WebP 生成内容 revision；改变同 URL 图片会改变预缓存记录/SW；A→B 实测替换成功 | 未读取用户 iPhone 当前 active SW 或其 Cache Storage |
| 浏览器运行时图片缓存 | 本地同 origin 更新后，相同 URL 的响应 SHA-256 和 40px 解码像素都变化；切回旧构建后离线像素也正确 | Edge 结果不能替代 iOS WebKit 真机缓存诊断 |
| IndexedDB 资产元数据 | 幂等 upsert 与旧路径兼容已验证；旧物品引用和创建时间保留 | 用户 iPhone 实际数据库内容未经查看 |
| iOS 主屏幕 App 图标缓存 | 属于 manifest/apple-touch-icon PNG 和系统缓存，独立于物品 WebP | 本轮未改 App 桌面图标，也未验证系统重新取图行为 |

线上静态响应观察到 `Cache-Control: public, max-age=0, must-revalidate`；没有观察到强制长期缓存旧图片的响应头。原站点已部署原有 WebP，因此缺乏证据将真实 iPhone 的旧图问题统一归因于“Cloudflare 没部署 WebP”或“浏览器缓存”。完整响应状态、头和 SHA-256 见 [资源与线上探测结果](screenshots/icon-library-v2/resource-results.json)。最近检查时间为 2026-10-16 04:33（UTC+8）。

### 已确认并修复的问题

- **更新失败仍提示最新**：旧 host 在 registration 缺失时静默返回；manager 吞掉网络/安装错误，Context 仍返回 up-to-date。现在显式记录失败，手动显示“未能完成线上版本检查，请稍后重试”。自动检查失败继续不打断使用。
- **检查过早完成**：旧逻辑只等固定 900ms，不能证明静态资源安装完成；手动点击遇到正在进行的自动检查还可能立即返回。现在手动加入同一个进行中的 Promise，等待真实 worker 安装/激活状态，失败/冗余或 120s 超时明确报告未完成。超时不会删除缓存或阻止之后的 SW 激活。
- **旧备份恢复会话的缺图窗口**：恢复后立即在原有原子事务中补齐 preset，避免选择新增图标保存后卡片回落为通用图标；失败整体回滚。
- **部署可能误用本地旧 dist**：Wrangler 原本只消费 `dist`，增加 `build.command: npm run build`，本地 deploy 默认先构建。Cloudflare Dashboard 自己的触发分支、构建命令与发布记录仍需账号侧核对。
- **预缓存条目重复**：旧产物 482 项、323 个唯一 URL，SVG 和部分 manifest PNG 重复声明。移除重复入口后，本轮 386 项均唯一，仍覆盖 156 SVG、219 WebP 和全部 PWA PNG。原 Workbox 会按 cache key 去重；不能把少掉的重复条目说成节省了等量下载字节。

### 更新机制及待验证部分

已有 `visibilitychange`、`pageshow` 和 `online` 检查入口继续使用，60s 节流保持；安装后仍由既有 manager 决定刷新时机，编辑/处置等保护、前台限制和防重复刷新保持。未新增清空 IndexedDB、注销 SW、删除 PWA 或清除所有 Cache Storage 的操作。Workbox 既有版本清理逻辑保留。

真实 iPhone 是否派发相应恢复事件、是否正在旧 worker 控制下，以及受系统挂起/网络影响的时序均待人工验收。本地测试使用合成 `visibilitychange`，不冒充真实 iOS 挂起测试。

**区分“GitHub 已更新，线上未部署”**：先在普通网络请求中查看线上设置版本、HTML 引用的 bundle 和 `/sw.js` 清单，再与部署产物比较。只推送本分支时，线上仍可合法返回 0.1.0/156 图标。“当前已是线上最新版本”仅表示该 origin 已部署的版本，不检查 GitHub。成功发布本轮后应为 0.2.0/219；本机构建 bundle 为 `index-BEFSfJdP.js`，不同构建环境可能产生不同指纹，应同时核对版本和清单。若站点已是新构建而已安装 PWA 仍旧，再调查该设备的 active worker、请求来源和元数据。

## 选择交互与兼容性

`IconBrowser` 由弹层与设置页共享。主页三列九类卡片、代表性 3D 图、动态数量及最近使用；详情四列移动网格、名称、数量、返回和选中状态。每个视图独立保存滚动位置，搜索始终覆盖全部图标，清空后恢复原分类。

搜索按名称完全匹配、前缀、包含、别名/key 完全匹配、宽泛关键词包含排序，同分保持注册表顺序。继续支持中文、英文、简称和品牌；验证“电脑”“笔记本”“iPad”“插排”“DDR5”“NVIDIA”等。无需外部搜索服务。

单击调用原有 `setIconAssetId`，最近使用最多 8 个、去重前置，并关闭弹层；必须经过正常表单保存才写物品。打开焦点落在关闭按钮，避免主动聚焦搜索；键盘 Tab 限制在弹层，Escape/关闭恢复触发按钮焦点。iOS 实际键盘行为待真机确认。

数据风险检查：所有原有 key/路径和 SVG/WebP 文件保留；业务分类树未改变；无 Dexie 表/迁移、备份格式、同步 wire、Worker 或 D1 迁移变更。Dexie 版本 4、备份版本 3、同步协议 2 保持。用户主动执行 Replace Restore 时，原有使旧同步会话失效的行为保持；本轮没有新增普通更新时清空 outbox 的行为。幂等同步、旧备份、用户/退休资产、恢复失败回滚和同步契约均通过现有及新增测试。原有未跟踪 `docs/WORKBUDDY_HANDOFF.md` 保留且未提交。

## 体积与缓存成本

| 指标 | 起点 | 本轮 |
|---|---:|---:|
| WebP 数量 | 156 | 219 |
| WebP 总字节 | 11,794,130（11.25 MiB） | 15,360,898（14.65 MiB） |
| 新 WebP | — | 3,566,768（3.40 MiB，平均 55.3 KiB） |
| 最大单张 WebP | — | 213,426 字节（208.4 KiB） |
| 构建预缓存 | 12,530.85 KiB | 16,019.22 KiB（15.64 MiB） |
| 清单项 / 唯一 URL | 482 / 323 | 386 / 386 |
| 主 JS（未 gzip） | 564.68 kB | 569.80 kB |

首次离线缓存约 15.64 MiB，不是首屏必须解码全部图片。已有安装更新时，Workbox 按内容 revision 复用未改资源，下载新增图标和改变的 bundle；实际网络开销还受响应压缩、协议和缓存状态影响，未在真机计费网络测量。保留整套离线资源，没有引入图片后端。构建继续报告既有主 bundle 超过 500 kB 的提示，本轮未进行无关拆包。

## 自动化与截图

| 检查 | 实际结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm test` | 43 个测试文件，686 项通过（起点 675 项） |
| `npm run build` | 通过；125 modules，386 个唯一预缓存项 |
| `npm run verify:icons` | 28/28；项目 Edge Profile :9222，390×844 / 390×568 / 1280×900 |
| 同源 Build A→B→A | 35/35；项目 Edge Profile :9223，origin :4190 |
| 资源/来源自检 | 219 key/文件/生成清单对应；63 张输出 SHA-256 对应；5 个 PWA PNG 也保留预缓存 |
| Git 数据范围 | 原 156 WebP 和 156 SVG 未修改；没有数据库迁移或 Worker 逻辑变更 |

构建与 Vitest 在本机受限执行环境曾因 Windows EPERM 在加载阶段失败，允许本地执行后完整通过；不是通过删测试或清数据绕过。首次 A/B 试跑因等待首次 SW 安装不足被作废，改为等待 active/controller 后重跑。最终 35/35 的已测脚本保存为 `scripts/verify-pwa-update.mjs`，执行体与本地通过版本相同。测试后已恢复源码、原 phone.webp 和正式 0.2.0 的 dist。

本地更新测试分别验证：同 URL 旧/新图片响应及像素、旧 SVG 元数据及 createdAt、无重复 preset、物品/自建分类/标签/待同步条目保留、编辑时不刷新与离开后自动应用、手动最新/503 失败/离线提示，以及离线像素正确。所有测试都使用项目隔离 Profile；未访问日常登录 Profile，也未清空存储。复现命令见 [BROWSER_TESTING.md](../BROWSER_TESTING.md)。结果：[UI](screenshots/icon-library-v2/results.json)、[PWA](screenshots/icon-library-v2/pwa-results.json)。

| 状态 | 截图 |
|---|---|
| 分类主页 / 浅色 | [01-home-light](screenshots/icon-library-v2/01-home-light.png) |
| 分类详情 / 浅色 | [02-digital-light](screenshots/icon-library-v2/02-digital-light.png) |
| 全局搜索 | [03-search-light](screenshots/icon-library-v2/03-search-light.png) |
| 已选中 / 分类详情 | [04-selected-light](screenshots/icon-library-v2/04-selected-light.png) |
| 无结果 | [05-empty-light](screenshots/icon-library-v2/05-empty-light.png) |
| 分类主页 / 深色 | [06-home-dark](screenshots/icon-library-v2/06-home-dark.png) |
| 分类详情 / 深色（含新图） | [07-care-dark](screenshots/icon-library-v2/07-care-dark.png) |
| 设置图标库 / 深色 | [08-library-dark](screenshots/icon-library-v2/08-library-dark.png) |
| 桌面响应式 | [09-desktop-dark](screenshots/icon-library-v2/09-desktop-dark.png) |
| 新内存条搜索选中 | [10-new-icon-selected-light](screenshots/icon-library-v2/10-new-icon-selected-light.png) |

## 发布与 iPhone 人工验收

以下是操作说明，**本次没有代为发布**。

1. 合并或检出本分支提交，按现有方式安装依赖并运行 typecheck、test、build。检查 `APP_VERSION` 为 0.2.0、注册表 219；不要上传更新测试的 0.6.x 产物。
2. 在具备权限的 Cloudflare 环境，由维护者执行既有发布流程，例如 `npx wrangler deploy`（现在默认先 build），或确认 Git 集成选择正确分支并完成生产部署。无需执行 D1 迁移、删除线上资源或调整恢复码。
3. 从独立普通网络请求核对目标 [workers.dev 站点](https://item-storage-app.ciosg716.workers.dev/) 的设置版本、HTML bundle、`/sw.js` 的 219 WebP 清单以及 `/icons/items/ram.webp` 的 image/webp 响应。仅 GitHub CI 成功不证明已部署。
4. 在**原有** iPhone 主屏幕 PWA 中联网打开，先完成或退出当前编辑，在设置点击“检查更新”；等待安装完成和安全刷新。应看到 0.2.0、219 图标及上述九类数量。首次从旧代码启动时，其旧版检查文案可能在本轮修复被安装前仍提前显示；应保持前台等待并在安全页面重查，切勿删数据。
5. 查看原有物品的卡片、详情和编辑预览；选一次新图标，关闭弹层确认预览变化，取消表单确认未保存，再正常保存确认物品显示正确。检查已有分类、标签、备份和同步设置保留。
6. 在下次测试部署可用时，让已安装 PWA 后台停留超过 60s 再恢复，确认发现更新；编辑状态中应保留输入并提示新版本就绪，完成操作后再自动刷新。这一步需要真实 iOS，不以合成事件替代。
7. 完成在线缓存后开启飞行模式，从主屏启动并打开列表/详情/图标库，检查新旧图片。检查设备可用存储及系统离线表现；实际 iPhone Safari/WebKit 解码和进程终止后的冷启动仍待人工验收。
8. 如果仍旧，先记录 iOS 版本、实际 origin、设置版本、在线是否新构建、active SW/请求来源及对应 preset 元数据，逐层定位。不要用清空 IndexedDB、删除 PWA、注销 SW 或清除全部缓存处理。

## 修改文件清单

下面列出本次 Git 交付文件；原图 ZIP、临时构建和 Profile 作为本地验收材料保留，不入 Git。

<!-- delivery-files -->

- [BROWSER_TESTING.md](../BROWSER_TESTING.md)
- [assets/item-icons/README.md](../assets/item-icons/README.md)
- [assets/item-icons/comparison-first-12.webp](../assets/item-icons/comparison-first-12.webp)
- [assets/item-icons/overview.webp](../assets/item-icons/overview.webp)
- [assets/item-icons/prompts.json](../assets/item-icons/prompts.json)
- [docs/architecture.md](../docs/architecture.md)
- [docs/icon-library-v2-audit.md](../docs/icon-library-v2-audit.md)
- [docs/screenshots/icon-library-v2/01-home-light.png](../docs/screenshots/icon-library-v2/01-home-light.png)
- [docs/screenshots/icon-library-v2/02-digital-light.png](../docs/screenshots/icon-library-v2/02-digital-light.png)
- [docs/screenshots/icon-library-v2/03-search-light.png](../docs/screenshots/icon-library-v2/03-search-light.png)
- [docs/screenshots/icon-library-v2/04-selected-light.png](../docs/screenshots/icon-library-v2/04-selected-light.png)
- [docs/screenshots/icon-library-v2/05-empty-light.png](../docs/screenshots/icon-library-v2/05-empty-light.png)
- [docs/screenshots/icon-library-v2/06-home-dark.png](../docs/screenshots/icon-library-v2/06-home-dark.png)
- [docs/screenshots/icon-library-v2/07-care-dark.png](../docs/screenshots/icon-library-v2/07-care-dark.png)
- [docs/screenshots/icon-library-v2/08-library-dark.png](../docs/screenshots/icon-library-v2/08-library-dark.png)
- [docs/screenshots/icon-library-v2/09-desktop-dark.png](../docs/screenshots/icon-library-v2/09-desktop-dark.png)
- [docs/screenshots/icon-library-v2/10-new-icon-selected-light.png](../docs/screenshots/icon-library-v2/10-new-icon-selected-light.png)
- [docs/screenshots/icon-library-v2/pwa-results.json](../docs/screenshots/icon-library-v2/pwa-results.json)
- [docs/screenshots/icon-library-v2/resource-results.json](../docs/screenshots/icon-library-v2/resource-results.json)
- [docs/screenshots/icon-library-v2/results.json](../docs/screenshots/icon-library-v2/results.json)
- [package-lock.json](../package-lock.json)
- [package.json](../package.json)
- [public/icons/items/bed.webp](../public/icons/items/bed.webp)
- [public/icons/items/bedsheet.webp](../public/icons/items/bedsheet.webp)
- [public/icons/items/binderclip.webp](../public/icons/items/binderclip.webp)
- [public/icons/items/bodywash.webp](../public/icons/items/bodywash.webp)
- [public/icons/items/bookshelf.webp](../public/icons/items/bookshelf.webp)
- [public/icons/items/boots.webp](../public/icons/items/boots.webp)
- [public/icons/items/bottleopener.webp](../public/icons/items/bottleopener.webp)
- [public/icons/items/certificate.webp](../public/icons/items/certificate.webp)
- [public/icons/items/chair.webp](../public/icons/items/chair.webp)
- [public/icons/items/cleanser.webp](../public/icons/items/cleanser.webp)
- [public/icons/items/curtains.webp](../public/icons/items/curtains.webp)
- [public/icons/items/detergent.webp](../public/icons/items/detergent.webp)
- [public/icons/items/dryingrack.webp](../public/icons/items/dryingrack.webp)
- [public/icons/items/duvet.webp](../public/icons/items/duvet.webp)
- [public/icons/items/filebox.webp](../public/icons/items/filebox.webp)
- [public/icons/items/foamroller.webp](../public/icons/items/foamroller.webp)
- [public/icons/items/foodcontainer.webp](../public/icons/items/foodcontainer.webp)
- [public/icons/items/fork.webp](../public/icons/items/fork.webp)
- [public/icons/items/graphicscard.webp](../public/icons/items/graphicscard.webp)
- [public/icons/items/hammer.webp](../public/icons/items/hammer.webp)
- [public/icons/items/hanger.webp](../public/icons/items/hanger.webp)
- [public/icons/items/hook.webp](../public/icons/items/hook.webp)
- [public/icons/items/jumprope.webp](../public/icons/items/jumprope.webp)
- [public/icons/items/laptopstand.webp](../public/icons/items/laptopstand.webp)
- [public/icons/items/lunchbox.webp](../public/icons/items/lunchbox.webp)
- [public/icons/items/mirror.webp](../public/icons/items/mirror.webp)
- [public/icons/items/monitorarm.webp](../public/icons/items/monitorarm.webp)
- [public/icons/items/opticalmodem.webp](../public/icons/items/opticalmodem.webp)
- [public/icons/items/paintbrushes.webp](../public/icons/items/paintbrushes.webp)
- [public/icons/items/pajamas.webp](../public/icons/items/pajamas.webp)
- [public/icons/items/paperclip.webp](../public/icons/items/paperclip.webp)
- [public/icons/items/pencilcase.webp](../public/icons/items/pencilcase.webp)
- [public/icons/items/pillow.webp](../public/icons/items/pillow.webp)
- [public/icons/items/plate.webp](../public/icons/items/plate.webp)
- [public/icons/items/pliers.webp](../public/icons/items/pliers.webp)
- [public/icons/items/puzzle.webp](../public/icons/items/puzzle.webp)
- [public/icons/items/ram.webp](../public/icons/items/ram.webp)
- [public/icons/items/resistanceband.webp](../public/icons/items/resistanceband.webp)
- [public/icons/items/ringbinder.webp](../public/icons/items/ringbinder.webp)
- [public/icons/items/sandals.webp](../public/icons/items/sandals.webp)
- [public/icons/items/sewingkit.webp](../public/icons/items/sewingkit.webp)
- [public/icons/items/shampoo.webp](../public/icons/items/shampoo.webp)
- [public/icons/items/shelf.webp](../public/icons/items/shelf.webp)
- [public/icons/items/skirt.webp](../public/icons/items/skirt.webp)
- [public/icons/items/smartplug.webp](../public/icons/items/smartplug.webp)
- [public/icons/items/socks.webp](../public/icons/items/socks.webp)
- [public/icons/items/spatula.webp](../public/icons/items/spatula.webp)
- [public/icons/items/spicejar.webp](../public/icons/items/spicejar.webp)
- [public/icons/items/spoon.webp](../public/icons/items/spoon.webp)
- [public/icons/items/sportswear.webp](../public/icons/items/sportswear.webp)
- [public/icons/items/stickynotes.webp](../public/icons/items/stickynotes.webp)
- [public/icons/items/storagebag.webp](../public/icons/items/storagebag.webp)
- [public/icons/items/sunscreen.webp](../public/icons/items/sunscreen.webp)
- [public/icons/items/sweater.webp](../public/icons/items/sweater.webp)
- [public/icons/items/tape.webp](../public/icons/items/tape.webp)
- [public/icons/items/tapemeasure.webp](../public/icons/items/tapemeasure.webp)
- [public/icons/items/tissues.webp](../public/icons/items/tissues.webp)
- [public/icons/items/toothpaste.webp](../public/icons/items/toothpaste.webp)
- [public/icons/items/trashcan.webp](../public/icons/items/trashcan.webp)
- [public/icons/items/underwear.webp](../public/icons/items/underwear.webp)
- [public/icons/items/wardrobe.webp](../public/icons/items/wardrobe.webp)
- [public/icons/items/wetwipes.webp](../public/icons/items/wetwipes.webp)
- [public/icons/items/whiteboard.webp](../public/icons/items/whiteboard.webp)
- [scripts/verify-icon-library.mjs](../scripts/verify-icon-library.mjs)
- [scripts/verify-pwa-update.mjs](../scripts/verify-pwa-update.mjs)
- [src/appInfo.ts](../src/appInfo.ts)
- [src/components/IconBrowser.tsx](../src/components/IconBrowser.tsx)
- [src/components/IconPickerSheet.tsx](../src/components/IconPickerSheet.tsx)
- [src/data/icons.test.ts](../src/data/icons.test.ts)
- [src/data/icons.ts](../src/data/icons.ts)
- [src/db/repositories/backupRepository.test.ts](../src/db/repositories/backupRepository.test.ts)
- [src/db/repositories/backupRepository.ts](../src/db/repositories/backupRepository.ts)
- [src/domain/types.ts](../src/domain/types.ts)
- [src/features/pwa/PwaUpdateContext.tsx](../src/features/pwa/PwaUpdateContext.tsx)
- [src/features/pwa/updateManager.test.ts](../src/features/pwa/updateManager.test.ts)
- [src/features/pwa/updateManager.ts](../src/features/pwa/updateManager.ts)
- [src/pages/IconLibraryPage.tsx](../src/pages/IconLibraryPage.tsx)
- [src/pages/SettingsPage.tsx](../src/pages/SettingsPage.tsx)
- [src/services/checkServiceWorkerUpdate.test.ts](../src/services/checkServiceWorkerUpdate.test.ts)
- [src/services/checkServiceWorkerUpdate.ts](../src/services/checkServiceWorkerUpdate.ts)
- [src/services/pwaUpdate.ts](../src/services/pwaUpdate.ts)
- [vite.config.ts](../vite.config.ts)
- [wrangler.jsonc](../wrangler.jsonc)
