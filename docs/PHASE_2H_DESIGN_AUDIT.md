# Phase 2H 设计审计（Design Audit）

> 输入材料：MarkItem 真机截图 12 张（浅色/深色 × 详情/编辑/列表/Header/Hero/时间线/附加花费/生命周期操作）、
> Apple Design Awards 2025 / 2026 获奖与入围 App 公开资料、Apple HIG（Materials / grouped interface）。
> 性质：观察 → 为什么有效 → 我们怎么落实。不是竞品复制清单。

## A. 当前 App 的视觉优点（保留）

1. **语义 token 体系已经成立**：组件只表达意图（`bg-surface` / `text-ink-secondary`），深色不是反色，是独立调过的第二套。
2. **chrome 材质方向正确**：内容层实色、blur 只给导航/顶栏，`prefers-reduced-transparency` 有降级。
3. **物品展台（plate）配方统一**：同一盏"柔光"照所有物品，整页光线一致。
4. **圆角 / 字距体系有纪律**：control/card/surface/sheet/app 五级；CJK 微开字距、数字负字距 + tabular nums。
5. **数据口径诚实**：不制造 ¥0.00、负成本保留、处置天数冻结——这是"成熟感"的地基，视觉永远不改口径。
6. **空状态、reduced-motion、44px 触达**这些底层素养已经就位。

## B. 当前 App 的主要问题（本轮要修）

1. **明度分层太克制，浅色近乎"白上加白"**：canvas `#fafafa` 与 surface `#ffffff` 只差 2% 明度，卡片靠 hairline 撑边界，页面底与卡片"浮"不起来。深色同理（`#0e0e10` vs `#17171a` 层差只有 4%）。
2. **Hero 只是"放大的卡片"**：详情页 Hero 用的是与普通卡片相同的 surface + plate 配方，没有"物品身份卡"的专属材质，与 MarkItem 一眼可辨的 Hero 差在层级而非颜色。
3. **没有 Large Title → Compact Header**：二级页进入即小标题，缺少 iOS 原生的滚动层级叙事。
4. **详情页信息块都是独立卡片**：保修 / 处置 / 投入 / 标签 / 备注 五张等权重卡片，没有"section + inner cell"的分组感，认知负担平摊。
5. **编辑页像另一套系统**：表单用裸 hairline + 输入框，与详情页的 grouped 卡片语言不统一，"编辑"没有"编辑这份档案"的连续感。
6. **缺一个"普通交互"色**：查看全部、清除、设置这类非危险链接目前用中性灰，可交互性弱；brand accent 被保护得很好但少了执行手。
7. **网格卡没有保修进度信息**：保修数据只以文字 chip 出现，MarkItem 用一条进度带把"还剩多久"变成一眼可读的图形。

## C. MarkItem 最值得学的 10 个原则

1. **浅色不是纯白页**：冷灰 canvas + 白色 card，卡片不靠重阴影也能自然抬升。→ 落实：重调 canvas/surface/sunken 明度差。
2. **深色"抬升"而非"变灰"**：canvas ≈ #1C1C1E → card ≈ #2C2C2E → inner ≈ #3A3A3C，一眼能分辨页面/卡片/内部控件。→ 落实：dark 三级各抬一档。
3. **Hero 是专属材质**：浅色是极淡的主题 tint，深色是更深更饱和的对应色；名称、状态、来源、图、三栏指标构成完整"身份卡"。→ 落实：新增 hero token 族 + `.hero-surface`。
4. **Large Title → 居中 Compact Header**：滚动后大标题离场、居中小标题在毛玻璃条上接管，两个标题从不同时抢注意力。→ 落实：IntersectionObserver + PageHeader 折叠态。
5. **Section header 带彩色图标、inner cell 有自己的底色**：分组不是"卡片里塞文字"，是"卡片里再铺一层更沉的 cell"。→ 落实：GroupCard / GroupCell 组件。
6. **蓝 = 可执行的普通操作**：清除 / 设置 / 查看全部 / 添加照片 都是链接蓝；红只留给删除。语义精确。→ 落实：新增 info token。
7. **保修条形图**：彩色分段 + 百分比 + 剩余月份，把时间距离图形化。→ 落实：WarrantyStrip（纯 CSS 分段），只对真正有保修数据的卡片出现。
8. **主操作是全宽实心主色按钮**：保存更改（蓝）在上、取消编辑（中性）在下，拇指可达，比右上角小按钮更明确。→ 落实：编辑页底部动作区。
9. **生命周期操作用 2×2 tinted 卡**：每个动作有自己的语义色调但饱和度极低，危险操作红、编辑蓝。→ 落实：详情页操作区加语义 tint（低饱和）。
10. **内容以"模态卷轴"呈现**：整页内容有圆角顶边浮在灰色画布上。→ 落实：桌面 shell 已有取景框，移动端 canvas 加深后自然获得同款层次，不额外加壳。

## D. Apple Design Award App 最值得学的 10 个原则

1. **Moonlitt（2026 交互 winner）— Liquid Glass 只给 chrome**：材质感属于导航与悬浮控件，内容层永远冷静。→ 与现有方向一致，坚持。
2. **Moonlitt — 上手零门槛**：第一屏没有教程、没有配置，工具"直接可用"。→ 新视觉不增加任何前置理解成本。
3. **Tide Guide（2026 视觉 winner）— 主题色随内容走**：配色由"天空/海洋"状态决定，数据可视化不装饰、只解释数据。→ 保修条 / 分布条的颜色必须编码数据，不是好看。
4. **Tide Guide — 信息密度高但不乱**：靠字号差与留白而非分割线堆叠。→ 详情页分组用留白 + hairline，不画满格线。
5. **Structured（2026 入围）— 布局清晰即包容**：神经多样性用户 praised 的不是功能而是"一眼看懂"。→ Dashboard 保持"1 个 anchor + N 个 supporting"。
6. **Play（2025 创新 winner）— 复杂工具不做后台感**：工具界面用内容自身的质感代替表单灰。→ 编辑页复用详情页的 grouped 语言。
7. **Vocabulary（2025 入围）— typography 撑起节奏**：字号/字重/颜色三轴配合，次要信息真正退后。→ 审计三级文字的实际对比，secondary 信息统一走 ink-tertiary。
8. **Mela（2025 入围）— 内容状态要被强调或弱化，不能一律平等**。→ 详情页四层信息优先级（是谁 → 花了多少钱 → 购买/保修 → 操作）。
9. **Speechify（2025 多元包容 winner）— 高密度下降低认知负担**：Dynamic Type 思路、不只用颜色表达状态。→ 125%/150% 字号放大验证；状态 chip 保留文字。
10. **Guitar Wiz（2026 包容 winner）— 动态字体 + 不以颜色区分**：文字放大后布局不爆版是硬指标。→ flex/min-w 布局审查，进度条与文字并存（不只有色）。

## E. 明确不学

- **不学 MarkItem 的业务**：容器/存放位置/房间、数量系统、多货币、总价模式、使用次数成本、贴纸系统、图标编辑器、完整 Timeline Event 表、日历 Tab——全部拒绝。时间线只做"记录信息"（创建于/最近更新），不伪造审计日志。
- **不学它的紫色品牌**：Hero 用本项目的暖色 DNA（陶土 + 极轻 plum 倾向），不是 MarkItem 的紫。
- **不学它的底部导航结构**（概览/列表/容器/日历 + 独立 FAB）：我们的 概览/列表/分类/搜索 + 嵌入式 + 是已验证的不变量。
- **不学 Awwwards 营销站的动效**：没有漂浮、粒子、长 easing；动效只解释层级变化。
- **不把详情页做成模态 sheet**：那是 native 转场语义，Web 里硬模仿会破坏返回手势与 URL 语义。

## F. Phase 2H 最终设计方向

1. **两套独立调校的材质系统，同一信息架构**：
   - 浅色：冷灰 canvas（≈#F2F2F4）→ 白 surface → 沉一档的 sunken（≈#E9E9EC），三级清楚但克制。
   - 深色：深灰 canvas（≈#101013）→ 抬升 surface（≈#1C1C21）→ inner/raised（≈#26262C+），杜绝"糊成一团"。
2. **Hero Surface 成为独立层级**：新增 `--color-hero-*` / `--hero-glow` token 族 + `.hero-surface` 打光配方。浅色 = 极淡暖 plum tint；深色 = 更深更饱和的暖 plum。所有物品同一规则，颜色绝不硬编码进页面。
3. **Large Title → Compact Header**：IntersectionObserver 哨兵 + chrome 材质折叠，纯 CSS + 少量 JS，`prefers-reduced-motion` 自然降级（直接显示折叠态/无过渡）。应用于 ItemDetailPage；ItemsListPage / Settings 自身已是 large-title 结构，不机械铺开。
4. **Grouped Section 落地**：详情页（保修/处置/投入/标签/备注）与编辑页统一为「section 卡 + sunken inner cell + hairline 分隔」，每个字段不再单独成卡。
5. **新增 info 语义色**：链接、查看全部、编辑、添加等"普通交互"，系统蓝风格但降饱和以适配暖色品牌；品牌 accent 仍只做选中与品牌。
6. **WarrantyStrip**：纯 CSS 分段进度（elapsed=warning/danger 调，remaining=success），带百分比与剩余月份；仅对有 `warrantyExpiresAt` 的持有物品渲染，无保修卡片零空白。
7. **编辑页 = 详情页的编辑态**：同 header、同分组、同圆角、同 token；底部「保存更改」主操作 + 「取消编辑」次操作；危险操作不进表单。
8. **验收不变量**：数据库零改动、256 既有测试全绿、无新增依赖、44px 触达、reduced-motion/transparency 可用、125%/150% 字号不爆版、浅深两套成对截图。
