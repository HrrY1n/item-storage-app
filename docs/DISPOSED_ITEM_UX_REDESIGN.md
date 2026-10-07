# 处置物品体验重设计（Disposed Item UX Redesign）

> **文档性质**：产品设计说明，供下一轮开发直接执行。
> **本轮不改任何运行时代码** —— 没有 React / TS / CSS / DB / Worker / PWA / domain 改动。
> 所有事实性描述均来自当前 `main` 的真实实现，引用处标注了文件与行号。
>
> 基线：`main@ cbb67d0` · schemaVersion 3 · Dexie v4 · APP_VERSION `0.7.0`

---

## 1. Current Problems（现状问题，全部有代码依据）

### 1.1 处置状态在视觉上与持有态几乎无差别

`StatusChip` 对 `disposed` 的取色是 **中性灰**（`src/components/StatusChip.tsx:17`）：

```tsx
status === 'disposed' ? 'bg-surface-sunken text-ink-tertiary' : ...
```

这不是 bug，而是**上一轮的明确设计决策**，其注释写得很清楚：

> 处置：已成历史 → 中性灰，安静地退到背景里（`StatusChip.tsx:10`）

在"处置物品"数量少、且用户是主动来查看的场景下，这个"退到背景"的判断不再成立 ——
用户进入处置页时**期待**看到明确的"这些已结束"，而现在需要读文字才能确认。

### 1.2 处置方式只出现在副标题，视觉权重极低

`src/pages/ItemsListPage.tsx:115-119`：

```tsx
{status === 'disposed' && item.disposalMethod
  ? `${DISPOSAL_METHOD_LABELS[item.disposalMethod]} · ${item.disposedAt ? formatPurchaseDate(item.disposedAt) : '—'}`
  : categoryName}
```

「出售 / 丢弃 / 其他」被塞进 `text-caption text-ink-tertiary` 的副标题行，
与持有态的分类名占**完全相同的位置和权重**。出售、丢弃、其他在财务语义上完全不同
（见 §3），却没有任何视觉区分。

### 1.3 图片区没有任何"结果"语义

`ItemsListPage.tsx:103-111` 图区只有一个 `StatusChip`（左��），且只在 `status !== 'owned'` 时出现。
sold / discarded / other 的图片**完全一致** —— 没有任何 overlay。

### 1.4 ⭐ 指标标签与数值语义不符（最高优先级缺陷）

`ItemsListPage.tsx:87-96`：

```tsx
const cost = effectiveCostCents(item)          // sold 时这是「净成本」
...
{ v: formatCentsCard(cost), l: sold ? '实际成本' : '总投入' }
```

`effectiveCostCents`（`src/domain/lifecycle.ts:114-125`）在 `sold` 且填了出售金额时返回
**总投入 − 出售金额**，即净成本。所以 sold 卡片第三行标签写「实际成本」。

问题有三个层次：

1. **术语不统一**：「实际成本」在本项目的 domain 文档与 README 里叫「**实际持有成本**」
   （`README.md` 成本口径章节、`docs/PHASE_2H_DESIGN_AUDIT.md`）。UI 用词与产品用词不一致。
2. **discarded / other 标「总投入」是对的**（无回收 = 投入即最终成本），
   但这意味着**同一个卡片组件、同一个位置，标签会随处置方式变化** ——
   而这个变化没有任何视觉提示，用户必须逐字阅读。
3. ⭐ **`ItemCard.tsx` 里还有第二份实现，完全没有这个区分**：
   `src/components/ItemCard.tsx:88-90` 把标签**硬编码**为 `持有天数 / 总投入 / 日均成本`。
   而 `ItemCard` 被 `HomePage` 与 `CategoryDetailPage` 使用
   （`git grep "from '.*ItemCard'"`）。结果是：

   | 页面 | 卡片实现 | sold 物品的标签 |
   |---|---|---|
   | `ItemsListPage` | 本地 `GridCard` / `ListRow` | `实际成本` |
   | `SearchPage` | 本地（复用 GridCard） | `实际成本` |
   | `HomePage` | `components/ItemCard` | `总投入`（**错**） |
   | `CategoryDetailPage` | `components/ItemCard` | `总投入`（**错**） |

   **同一件已售出物品，在概览页显示「总投入 ¥1,474」，在处置页显示「实际成本 ¥568」。**
   这是本轮最需要修的语义一致性问题。

### 1.5 排序选项标签与排序键语义不符

`ItemsListPage.tsx:45` 排序项 `{ key: 'cost', label: '总投入' }`，
而比较函数（`src/features/data/viewModels.ts:217`）用的是 `effectiveCostCents`。
在处置 tab 里按「总投入」排序，实际排的是**净成本**。

### 1.6 金额省略号来自 CSS，不是格式化函数

这一点必须说清楚，否则会修错地方：

- 格式化函数**已经**处理过这个问题。`formatCentsCard`
  （`src/domain/purchase.ts`）的注释写明：整元省略两位小数、非整元保留，
  就是为了避免 `¥399.00` 被截成 `¥399....`
- 实测各金额在 `formatCentsCard` 下的输出：

  | 金额 | `formatCentsCard` | `formatCentsCompact` |
  |---|---|---|
  | ¥476.00 | `¥476` | `¥476.00` |
  | ¥1,474.00 | `¥1,474` | `¥1,474` |
  | ¥12,999.00 | `¥12,999` | `¥12,999` |
  | **¥123,456.78** | **`¥123,457`（四舍五入）** | `¥123,457` |
  | −¥1,474.00 | `-¥1,474` | `-¥1,474` |

- 真正的省略号来源是**两处 CSS `truncate`**：
  - `src/components/ItemCard.tsx:58` `className="num truncate text-caption ..."`
  - `src/pages/ItemsListPage.tsx:59` 同上

  `text-overflow: ellipsis` 在三栏 `grid-cols-3` 里遇到长金额就会截断。
  **所以修法是移除金额上的 `truncate`，而不是改格式化函数。**

- ⚠️ 同时暴露一个格式化函数的真实取舍：`¥123,456.78 → ¥123,457` **发生了四舍五入**。
  domain 测试注释也承认「精确值始终能在详情页看到」。这是**有意的**取舍，
  本轮不改口径，但要在 §14 明确"大额 + 非整元"的显示规则。

### 1.7 处置卡沿用持有态的信息组织

持有态三栏是「持有天数 / 总投入 / 日均成本」——这是"正在持有"的视角。
处置后用户真正想知道的是**结果**（卖了多少、赚没赚、持有多久），
但卡片仍然把这三个"持有期指标"原样摆出来，出售回收只是额外一行
（`ItemsListPage.tsx:121-125`，`text-success` 小字）。

### 1.8 页面标题过泛

`ItemsListPage.tsx:264` 标题恒为「物品管理」，副标题为
`{count} 件{ITEM_STATUS_LABELS[status]}物品`。
`ITEM_STATUS_LABELS.disposed === '处置'`（`lifecycle.ts:54`），
所以处置 tab 的副标题读作「**3 件处置物品**」—— 中文里"处置"是动词，
"处置物品"读起来像"要处置它们"，语义拧着。

### 1.9 处置方式与生命周期状态层级混淆

`sold` 同时是"生命周期状态（disposed）"和"处置方式"两个维度，
但 UI 只用一个 `StatusChip`（显示"处置"）+ 一行副标题文字表达，
两个维度视觉上没有分层。

### 1.10 死代码（顺带记录，本轮不删）

`src/components/StatusChip.tsx:27` 的 `DisposalChip` 组件**已定义但全仓零使用**
（`git grep -n "DisposalChip" -- src` 只命中定义处）。
它恰好就是本设计需要的"处置方式徽标"，下一轮应复活并改造它，而不是新写一个。

---

## 2. Design Goals（设计目标）

| # | 目标 | 验收方式 |
|---|---|---|
| G1 | **Recognition**：不读文字也能识别"这是已处置物品" | 图区左上角必有方法级徽标，图片有结果 overlay |
| G2 | **Disposition Method**：出售 / 丢弃 / 其他 可快速区分 | 三种方法各有独立徽标文案 + 独立 token |
| G3 | **Hierarchy**：处置后核心财务信息主次分明 | 三栏指标 + 一条财务 footer，二者权重不同 |
| G4 | **Consistency**：仍属于 Phase 2H 视觉系统 | 只用现有语义 token + 现有组件（SegmentedControl / Chip） |
| G5 | **Calm UI**：处置是正常生命周期，不是错误 | **全方案禁止使用 `danger` 表达处置状态** |
| G6 | **Density**：不因增加状态信息而臃肿 | disposed 卡片高度增幅 ≤ 持有态 + 40px |
| G7 | **Semantic Consistency**：同一物品在任何页面显示同一口径 | 消除 §1.4 的双实现分歧 |
| G8 | **完整金额可读**：任何金额不出现省略号 | 见 §14 规则集 |

**非目标**见 §19。

---

## 3. Domain Constraints（领域约束 —— 不可突破）

### 3.1 真实枚举（`src/domain/types.ts:39`）

```ts
export type DisposalMethod = 'sold' | 'discarded' | 'other'
```

**只有三个值，没有第四个。** 不存在"赠送 / 报废 / 退役 / 损坏"等细分。

### 3.2 真实标签（`src/domain/lifecycle.ts:57-61`）

```ts
export const DISPOSAL_METHOD_LABELS = {
  sold: '出售',
  discarded: '丢弃',
  other: '其他',
}
```

### 3.3 真实字段（`src/domain/types.ts`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `'wishlist' \| 'owned' \| 'disposed'` | 生命周期状态 |
| `disposalMethod` | `DisposalMethod \| null` | 仅 disposed 时非空 |
| `disposedAt` | `string \| null` | `YYYY-MM-DD` |
| `salePriceCents` | `number \| null` | 整数分；**仅 sold 时可非 null；允许 0** |
| `purchasePriceCents` / `additionalCostCents` | `number \| null` | 整数分 |
| `disposalNote` | `string \| null` | 自由文本处置备注 |
| `warrantyExpiresAt` | `string \| null` | 已处置物品**不应**展示保修 |

### 3.4 财务口径（必须直接复用，不得重算）

全部来自 `src/domain/lifecycle.ts`：

```
totalInvestment = calculateTotalCostCents(purchasePriceCents, additionalCostCents)   // purchase.ts
                 // 两者皆 null → null（不制造 ¥0.00）

effectiveCostCents(item)        // lifecycle.ts:114
  非 disposed            → totalInvestment
  disposed + sold 且有 salePriceCents → totalInvestment − salePriceCents   // 可为负
  disposed + 其他方法     → totalInvestment                                // 无回收
  salePriceCents 为 null → totalInvestment（退回，不计算净成本）

dailyCostOf(item)      // lifecycle.ts:126  = effectiveCostCents ÷ ownershipDaysOf
ownershipDaysOf(item)  // lifecycle.ts:73+  // disposed 时以 disposedAt 冻结
```

**四条硬约束**：

1. **净成本不夹逼到 0** —— `lifecycle.ts:121` 有明确注释：
   "卖得比买得多 = 实际收益"。负数是合法结果。
2. **持有天数在 `disposedAt` 冻结**，不再增长。
3. **出售金额为空 ≠ 出售 0 元** —— 前者退回总投入，后者净成本 = 总投入（测试见
   `lifecycle.test.ts:162`、`:174`）。
4. **`disposalMethod='other'` 在数据里没有 subtype**，
   所以 UI **只能**表达"其他处置"，绝不能显示"赠送 / 退役 / 报废"。

### 3.5 ⚠️ 术语不一致（只记录，本轮不改 domain）

| 层次 | 处置状态 | 出售方式 | 其他方式 |
|---|---|---|---|
| domain 存储值 | `disposed` | `sold` | `discarded` / `other` |
| `ITEM_STATUS_LABELS` | **处置** | — | — |
| `DISPOSAL_METHOD_LABELS` | — | **出售** | **丢弃** / **其他** |
| README / 设计文档 | 已处置 | 出售 | 丢弃 / 其他 |
| 本设计（UI 徽标） | — | **已售出** | **已丢弃** / **其他处置** |

三处不一致需要说明：

1. `ITEM_STATUS_LABELS.disposed = '处置'` 用动词表达状态，读作"3 件处置物品"不通顺。
2. `DISPOSAL_METHOD_LABELS.sold = '出售'` 是**动作**；但处置**已经完成**，
   卡片要表达的是**结果**（已售出），不是动作。所以徽标用「已售出」而副标题仍可用「出售」。
3. 「丢弃 / 其他处置」加「已」前缀，与「已售出」对齐。

> **本轮不修改任何 domain 常量。** 上表第 5 行只约束**新增的 UI 徽标文案**
> （新增组件的 props 文案），`DISPOSAL_METHOD_LABELS` 原值保持不变、继续用于详情页与表单。

---

## 4. Page Information Architecture（页面信息架构）

处置 tab 的最终纵向顺序（**这是唯一方案**）：

```
┌─────────────────────────────────┐
│ ①  Large Title                  │  已处置物品        ← 随 lifecycle 动态
│    Subtitle                3 件 │  随 lifecycle 动态
├─────────────────────────────────┤
│ ②  Lifecycle SegmentedControl   │  持有 · 心愿 · 处置（带数量 hint）
│    （全站唯一控件，紧贴标题组）    │
├─────────────────────────────────┤
│ ③  Disposition Subfilter        │  仅 status==='disposed' 时出现
│    全部 · 已售出 · 已丢弃 · 其他 │  与 ② 视觉成组（间距更紧）
├─────────────────────────────────┤
│ ④  Search                       │  field-shell h-11（现状保留）
├─────────────────────────────────┤
│ ⑤  分类 · 排序 · 视图切换         │  单行（现状保留）
├─────────────────────────────────┤
│ ⑥  Cards                       │
└─────────────────────────────────┘
```

**关于 ⑤ 的取舍（明确决策）**：分类过滤、排序、搜索**全部保留**，
不为了减少层数而砍功能（§20 允许保留，只要求解决"过于密集"）。

解决密集的具体办法不是删控件，而是**把 ②③ 在视觉上合并成一组**：
`②` 与 `③` 之间的间距（`mt-5` → `mt-2`）小于 `③` 与 `④` 之间的间距（`mt-4`），
形成"生命周期轴（粗） → 处置方式细分（细） → 通用工具"的三级层次。
这样**层数没有增加**，但新增的 ③ 读起来是 ② 的下钻而非独立的筛选行。

---

## 5. Lifecycle Header（标题与副标题）

### 5.1 最终决策

| lifecycle | Large Title | Subtitle |
|---|---|---|
| `owned` | **我的物品** | `N 件持有物品` |
| `wishlist` | **心愿物品** | `N 件心愿物品` |
| `disposed` | **已处置物品** | `N 件已处置物品` |

**是否动态切换：是。** 三个 tab 共用同一个 `<h1>`，随 `status` 变化。

### 5.2 为什么

- **「物品管理」是 section 级名词，不是状态级名词。**
  设置页里已经有「分类管理」「标签管理」「物品图标库」等同族命名
  （`SettingsPage.tsx:378-380`），所以「物品管理」在应用内的角色是
  **这一族管理页的总称**。而这里的三个 tab 是**物品的生命周期状态**，
  用状态名做 Large Title 更符合 iOS Large Title 的语义（它描述"你在看什么"）。
- **「我的物品」比「持有物品」更自然**。Large Title 是空间锚点，
  应当是名词短语；`持有物品物品`（副标题拼接后）这类重复必须避免，
  所以 Large Title 与 Subtitle 的用词要错开。
- **「已处置物品」**：§5表格中 `disposed` 的当前文案「处置」是动词，
  副标题拼接后得到「3 件处置物品」——中文里读作"3 件（要）处置的物品"。
  改为「已处置物品」后得到「3 件已处置物品」，语义完整。
- 保持与 Phase 2H 的 Large Title 视觉规格一致（`text-page-title` + `text-ink-primary`），
  只换文案，**不改字号与字重**。

### 5.3 Subtitle 数字来源

沿用现状 `counts[status]`（`ItemsListPage.tsx:266`），格式
`{n} 件{title}物品`，其中 `n` 套 `text-ink-primary` + `num`。
**不改**这行结构，仅把 `{title}` 从 `ITEM_STATUS_LABELS[status]` 换成 §5.1 的标题词。

---

## 6. Disposition Filter（处置二级筛选）

### 6.1 最终决策：**需要，且只在 `status === 'disposed'` 时出现**

| 决策项 | 结论 |
|---|---|
| 是否需要 | **需要**。三个方法的财务语义完全不同，混在一起无法比较 |
| 四个选项 | **全部 / 已售出 / 已丢弃 / 其他处置** |
| 文案来源 | 全部 / 已售出 / 已丢弃 / 其他处置 —— 全部来自 §3 的三个真实值 + "全部" |
| 控件 | **复用全站唯一的 `SegmentedControl`**（与 lifecycle、设置页外观模式同一套控件语言） |
| 数量显示 | **显示**，作为 `hint`（`SegmentedControl` 已支持 hint 属性，`ItemsListPage.tsx:281` 在用） |
| 数量为 0 | **显示但禁用**（不隐藏）。隐藏会让控件宽度在切换时跳动 |
| 搜索 / 分类 / 排序 | **保留**（见 §4） |

### 6.2 窄屏处理（390px）

四个选项 + 数量在 390px 下必然拥挤（`SegmentedControl` 三选项已占满）。

**方案**：在处置态下，subfilter 的选项文案**去掉数量 hint**，数量只在"全部"上显示总量：

```
全部 3    已售出 2    已丢弃 1    其他 0
          ↓ 390px
全部 3    已售出    已丢弃    其他
```

若 390px 下仍溢出，则允许 `SegmentedControl` 自身横向滚动
（`overflow-x-auto` + `scrollbar-width: none`），**不允许换行**——
换行会把标题组下方的节奏打乱。

### 6.3 状态保持

- 该筛选是**纯 UI 状态**（`useState<'all' | DisposalMethod>`），
  **不写入 URL、不写入 IndexedDB、不进入 sync**（它不是业务数据）。
- 切换 lifecycle tab 时**重置为 `all`**（避免"心愿 tab 下遗留 sold 筛选"这种隐藏态）。

---

## 7. Disposed Grid Card（图区与徽标）

### 7.1 图区两层结构

```
┌───────────────────────────────┐
│ [已售出]              ← L1 徽标 │  absolute left-2 top-2（沿用现有槽位）
│                                │
│         [物品图标]              │  ← 物品保持清晰，不降 opacity
│                                │
│           [售出]               │  ← L2 overlay，仅 sold，图片底部居中
└───────────────────────────────┘
```

**L1 Card Status Badge** — 位置沿用 `ItemsListPage.tsx:106` 现有的
`absolute left-2 top-2` 槽位（不引入新位置，避免"同一槽位在不同状态下跳位"）。

| method | 徽标文案 | token |
|---|---|---|
| `sold` | **已售出** | `bg-success-soft text-success` |
| `discarded` | **已丢弃** | `bg-surface-sunken text-ink-secondary` |
| `other` | **其他处置** | `bg-info-soft text-info` |

**L2 Image Outcome Overlay** — **仅 `sold`**：

| method | 是否使用 overlay | 理由 |
|---|---|---|
| `sold` | **是**，文案「售出」 | 出售有明确的正向结果（回收了钱），值得视觉锚点 |
| `discarded` | **否** | 没有"回收"这个结果，加 overlay 只增加噪音 |
| `other` | **否** | 同上；且 §3.4.4 禁止虚构子类 |

overlay 规格：
- 位置：图片区**底部居中**（`absolute inset-x-0 bottom-2 flex justify-center`）
- 材质：**`bg-ink-solid` 实心** + `text-ink-inverse`（⚠️ 原设计的 `bg-ink-primary/72` 不可用，见 §15实测结论）
- 文字：`text-ink-inverse`，`text-caption`，`rounded-pill`，`px-2 py-[3px]`
- **高度不超过图片区 22%**，不遮挡物品主体（§16）

### 7.2 ⭐ 不使用 danger 表达处置（§5 G5 / §9）

`sold` 用 `success`（绿）而不是 `danger`（红）。处置不是错误。

### 7.3 图片处理（§16 明确禁止项）

| 禁止 | 本方案 |
|---|---|
| 整体降低 opacity 到看不清 | ❌ 不做。图标保持 `opacity: 1` |
| 加大红叉 | ❌ 不做 |
| 黑白滤镜 | ❌ 不做 |
| 强烈 blur | ❌ 不做（overlay 自身仅 `blur-sm`，且只覆盖底部一小条） |

状态表达**只**通过 badge / overlay / tint 三种手段，不触碰图片本身。

---

## 8. Disposed List Row（列表视图）

语义与 Grid Card **完全一致**，排版不同（横向更密）。

```
┌──────────────────────────────────────────────────────┐
│ ┌────────┐  [已售出]                                    │
│ │  图标   │  小米平板 5 6+128                           │
│ │ 52×52  │  处置于 2026年9月14日 · 数码与电子             │
│ └────────┘  1463 天 · 售出回收 ¥568 · 日均 ¥0.39       │
│            总投入 ¥2,042 · 亏损 ¥1,474                  │  ← 仅 sold 有意义
└──────────────────────────────────────────────────────┘
```

| 区域 | 内容 | 与 Grid 的差异 |
|---|---|---|
| 缩略图 | 52×52 `ObjectPlate`，**右下角**放 24px 方法徽标 | 空间有限，不做全宽 overlay |
| 标题行 | 物品名 | — |
| 副标题 | `处置于 {date} · {categoryName}` | Grid 只放日期；列表行加回分类（横向有空间） |
| 指标行 | `持有天数 · 出售回收 · 日均成本` 单行内联 | Grid 是三栏栅格 |
| 财务行 | 仅 sold：`总投入 · 盈利/亏损/持平` | discarded / other **无此行** |

列表行不叠加 overlay（52px 缩略图上放文字会不可读），
方法语义由**缩略图右下角的缩小版徽标**承担 —— 与 Grid 的 L1 badge 是同一个组件、同一套 token，
只是尺寸档位不同。

#### ⚠️ 财务口径必须与 Grid 完全一致（勘误 FIX-B）

**Grid 与 List 只能改变布局，不能改变财务口径。** 二者都来自同一个
presentation model，因此：

| | Grid Card | List Row |
|---|---|---|
| 指标（三栏 / 内联） | 持有天数 · 出售回收 · 日均成本 | **完全相同** |
| 财务行 | 总投入 · 盈利/亏损/持平 | **完全相同** |
| 「实际持有成本」 | ❌ 不显示 | ❌ **也不显示** |

「实际持有成本」与「盈亏」互为相反数，同时展示是重复信息
（见 §9.1 第 2 点）。**详情页**作为完整账目视图仍可显示「实际持有成本」，
但那是另一层级的事，本轮不实施。

---

## 9. Sold Card Data Priority（已售出卡片字段顺序）

### 9.1 ⭐ 最终方案（不留选项）

**三栏指标**：`持有天数` · `出售回收` · `日均成本`
**财务 footer**：`总投入` · `盈亏`

**为什么这样选**（对比另一个候选「持有天数 / 实际持有成本 / 日均成本」）：

1. **`出售回收` 必须是三栏之一。** 它是出售**独有**的字段，
   是"这件物品被卖掉了"这一事实的唯一直接证据。放进三栏能让出售卡与
   丢弃卡在第一眼就区分开，而不需要读标签。
2. **`实际持有成本` 与 `盈亏` 数值上互为相反数**：
   `净成本 = 总投入 − 出售回收`，`盈亏 = 出售回收 − 总投入 = −净成本`。
   两者同时出现在卡上是**同一笔账的两种符号**，属于 §11 禁止的"重复显示"。
3. **`实际持有成本` 可能为负**。若把它放进三栏，它会与同栏的
   `日均成本`（同样可能为负）**两个负数并列**，互相削弱且易被误读为异常。
   放进 footer 并与 `盈亏` 并列时，"花了多少"和"赚没赚"的对照关系反而更清楚。
4. 三栏里的 `日均成本` 是**效率**（每天多少钱），与 footer 的 `盈亏`（**结果**）
   量纲不同，不是重复信息。

### 9.2 字段优先级表（sold）

| 字段 | 层级 | 文案 | 值来源 |
|---|---|---|---|
| `disposalMethod === 'sold'` | L1 badge | 已售出 | 枚举 |
| — | L2 overlay | 售出 | 固定 |
| `disposedAt` | 副标题 | 处置于 2026年9月14日 | `formatPurchaseDate` |
| `ownershipDaysOf` | 三栏 1 | 持有天数 | `ownershipDaysOf`（已冻结） |
| `salePriceCents` | 三栏 2 | 出售回收 | `formatCentsCard(salePriceCents)` |
| `dailyCostOf` | 三栏 3 | 日均成本 | `formatCentsCompact(dailyCostOf)` |
| `purchasePrice + additionalCost` | footer 1 | 总投入 | `grossCostCents`（**毛投入**，不受回收影响） |
| `total − sale` | footer 2 | 盈利 / 亏损 / 持平 | `effectiveCostCents` 取反 |

> ⚠️ 注意 footer 的"总投入"必须用 **`grossCostCents`**（`viewModels.ts:119`），
> **不能**用 `effectiveCostCents` —— 后者对 sold 已是净成本，
> 会在同一个 footer 里同时出现"净成本"和"净成本"，彻底自相矛盾。

### 9.3 盈亏的人类可读表达（§12 最终决策）

```
盈亏 = salePriceCents − grossTotal      （即 −effectiveCostCents）
```

| 条件 | 文案 | token |
|---|---|---|
| `盈亏 > 0` | `盈利 ¥X` | `text-success` |
| `盈亏 < 0` | `亏损 ¥X` | `text-money`（暖色，**不用 danger**） |
| `盈亏 === 0` | `持平` | `text-ink-tertiary` |

#### ⚠️ 盈亏方向（勘误 FIX-A，勿再搞反）

项目已有的口径是 `netHoldingCost = grossTotal − salePrice`（**花费**视角），
而 `profitLoss` 是它的**相反数**（**结果**视角）：

```
netHoldingCost = grossTotal − salePriceCents      // 可能是正数，也可能是负数
profitLoss     = salePriceCents − grossTotal      // = −netHoldingCost
```

| 条件 | 判定 | UI 文案 |
|---|---|---|
| `profitLoss > 0` | 卖得比买得多 | **盈利** ¥X（`text-success`） |
| `profitLoss < 0` | 卖得比买得少 | **亏损** ¥X（`text-money`） |
| `profitLoss === 0` | 恰好回本 | **持平**（`text-ink-tertiary`） |

⚠️ **禁止把 `grossTotal − salePrice > 0` 显示成「盈利」** —— 那是净成本为正，
意思是"确实花了钱"，与盈利正好相反。

| 算例 | 总投入 | 出售回收 | 净持有成本 | profitLoss | UI |
|---|---|---|---|---|---|
| A | ¥2,042 | ¥568 | ¥1,474 | **−¥1,474** | **亏损 ¥1,474** |
| B | ¥1,000 | ¥1,200 | **−¥200** | **+¥200** | **盈利 ¥200** |
| C | ¥1,000 | ¥1,000 | ¥0 | ¥0 | **持平** |

算例 B 是「净成本为负」的情形 —— 卖出回收超过总投入，
`netHoldingCost` 为负而 `profitLoss` 为正，**UI 必须显示「盈利 ¥200」**。

**亏损为什么不用 `danger`**：亏损是**结果**，不是**故障**。
用红色会让"卖亏了"读起来像"数据出错了"，与 §19「处置不是墓地」冲突。
`text-money`（琥珀，暖色）是项目里已有的语义 token，与"这笔钱有关"契合，
且明暗两套都通过了对比度门槛。

**计算口径来自现有 domain**：`effectiveCostCents` 已返回净成本，
盈亏就是它的相反数。**不新增任何计算函数**，只做符号翻转与文案。

---

## 10. Discarded Card Data Priority（已丢弃）

### 10.1 禁止项（§13）

以下**绝对不出现**：

- ❌ `出售回收 ¥0`
- ❌ `出售价格 ¥0`
- ❌ 任何 `¥0` 的回收类字段
- ❌ `盈亏` 行（丢弃没有回收，盈亏在语义上不存在）

> 现状 `ItemsListPage.tsx:121-125` 的 `出售回收` 行有
> `sold` 前置守卫，discarded 不会出现 —— 这是**已经正确的**，
> 本设计要求保留该守卫，并在代码注释里写明"禁止为 discarded 补 ¥0 占位"。

### 10.2 最终结构

**三栏指标**：`持有天数` · `总投入` · `日均成本`
**副标题**：`处置于 {date}`
**无财务 footer**

| 字段 | 层级 | 文案 | 值来源 |
|---|---|---|---|
| `disposalMethod === 'discarded'` | L1 badge | 已丢弃 | 枚举 |
| — | L2 overlay | **无** | §7.1 |
| `disposedAt` | 副标题 | 处置于 2026年9月14日 | `formatPurchaseDate` |
| `ownershipDaysOf` | 三栏 1 | 持有天数 | `ownershipDaysOf`（已冻结） |
| `grossCostCents` | 三栏 2 | 总投入 | `grossCostCents`（== 投入即最终成本） |
| `dailyCostOf` | 三栏 3 | 日均成本 | `dailyCostOf` |

discarded 的「总投入」就是这件物品的**最终成本**，无需另起字段。

---

## 11. Other Disposal Card（其他处置）

### 11.1 强制约束（§14）

domain **只有** `method = 'other'`，**没有 subtype 字段**。
因此：

- ❌ 禁止显示「赠送」「报废」「退役」「损坏」「丢失」等任何具体原因
- ❌ 禁止根据 `disposalNote` 猜测原因
- ✅ 只能表达「其他处置」

> `disposalNote` 确实存在（`types.ts` 有该字段），但它是自由文本，
> 数据质量不可控。**本轮禁止把它提升为徽标文案**。
> 若未来要做，方向应是"用户显式选择 subtype"，而不是推断 —— 那需要改 domain。

### 11.2 最终结构

**三栏指标**：`持有天数` · `总投入` · `日均成本`
**副标题**：`处置于 {date}`
**无财务 footer**

与 discarded **完全同构**，唯一差异是 L1 徽标文案与 token：

| method | 徽标 | token |
|---|---|---|
| `discarded` | 已丢弃 | `bg-surface-sunken text-ink-secondary` |
| `other` | 其他处置 | `bg-info-soft text-info` |

**为什么不把 other 与 discarded 合并成一个视觉层级**：
它们的信息结构确实相同，但用户需要区分"主动丢弃"与"其他原因"，
而合并会让 other 彻底隐形。差异只放在徽标（低成本的形状/色彩区分），
不复制一整套卡片变体。

---

## 12. Status Badge & Image Overlay（视觉语义规范）

### 12.1 token 映射表（§9：复用现有 token，不新增色）

| 语义 | 背景 | 前景 | 出现位置 |
|---|---|---|---|
| 已售出 | `bg-success-soft` | `text-success` | L1 badge |
| 已丢弃 | `bg-surface-sunken` | `text-ink-secondary` | L1 badge |
| 其他处置 | `bg-info-soft` | `text-info` | L1 badge |
| 售出 overlay | `bg-ink-solid` | `text-ink-inverse` | L2 图片底部 |
| 盈利 | — | `text-success` | sold footer |
| 亏损 | — | `text-money` | sold footer |
| 持平 | — | `text-ink-tertiary` | sold footer |

**全部来自现有 token**（`src/index.css`）：
`success-soft/success`、`info-soft/info`、`money`、`surface-sunken`、`ink-primary/ink-secondary/ink-tertiary/ink-inverse`。
明暗两套均已在 `index.css:28-67`（light）与 `:103-137`（dark）定义完毕，**无需新增任何 hex**。

**❌ 禁止使用**：`danger` / `danger-soft` 表达处置状态。

### 12.2 与既有 chip 的区分（§8 最后一条）

处置徽标可能与 `TagChip`、`WarrantyChip`、`StatusChip` 同处一张卡。区分手段：

| 特征 | 处置方法徽标（L1） | TagChip | WarrantyChip |
|---|---|---|---|
| 位置 | 图区**左上**（绝对定位） | 正文流内 | 正文流内 / 底部条 |
| 底色 | `-soft` 语义底色 | 无底色 | `-soft` 语义底色 |
| 文案来源 | `DISPOSAL_METHOD_LABELS` 派生 | 用户数据 | `warrantyInfo` |
| 是否可点击 | **否**（`pointer-events-none`） | 否 | 否 |

关键：**已处置物品不渲染 `WarrantyStrip`**。
现状 `ItemsListPage.tsx:146` 已有 `{status === 'owned' && ...}` 守卫，保持不变 ——
保修属于"持有期"语义，对已处置物品无意义。

---

## 13. Financial Semantics（财务语义）

### 13.1 口径（与代码逐字一致）

```
总投入      grossTotal  = purchasePriceCents + additionalCostCents
                        （两者皆 null → null，不制造 ¥0.00）

实际持有成本  netCost    = sold 且 salePriceCents 非 null
                              ? grossTotal − salePriceCents
                              : grossTotal          // 丢弃/其他/未填金额

出售回收    recovery    = salePriceCents           // 仅 sold

盈亏        profitLoss  = salePriceCents − grossTotal = −netCost   // 仅 sold

持有天数    days        = disposed 时以 disposedAt 冻结
日均成本    daily       = netCost ÷ days
```

### 13.2 负值纪律

| 值 | 负数含义 | 处理 |
|---|---|---|
| `netCost` | 卖出回收超过总投入 = **实际赚到钱** | **原样显示**，禁止 `Math.max(0)` |
| `daily` | 同上按天摊薄 | 原样显示 |
| `profitLoss` | 亏损 | 显示绝对值 + "亏损" 文案 + `text-money` |

`lifecycle.ts:121` 已有注释「刻意不夹逼到 0」，
`lifecycle.test.ts:132-160` 有对应回归测试。**本设计不得与该口径分叉。**

### 13.3 排序标签修正（§1.5）

`{ key: 'cost', label: '总投入' }` 在处置 tab 下排的是净成本。

**最终决策**：标签**随 lifecycle 动态**：
- `owned` / `wishlist` → 「总投入」
- `disposed` → 「实际持有成本」

**不改** `viewModels.ts:217` 的比较函数（它对两种 tab 都是正确口径）。

---

## 14. Number Formatting（金额显示规则 —— 完整可读优先）

### 14.1 规则集（全部为强制要求）

| # | 规则 | 理由 |
|---|---|---|
| F1 | **任何金额禁止 `truncate` / `text-overflow: ellipsis`** | §1.6：这才是省略号的真实来源 |
| F2 | 金额使用 `num` + `tabular-nums` | 数字等宽，多行对齐 |
| F3 | 卡片用 `formatCentsCard`；详情页用 `formatCents`（全 2 位小数） | 沿用现有口径 |
| F4 | **禁止紧凑记法**（`¥1.2k` / `¥12.3万`） | 紧凑记法牺牲精确性，本项目已决定不走这条路 |
| F5 | **严格复用现有 `formatCentsCard` 的既有行为**，本轮不改其口径 | 见下方「F5 精确说明」 |
| F6 | 负数格式 `-¥1,474`（负号在 ¥ 前） | 现有 `formatCents` 已实现 |
| F7 | 三栏均溢出时：**先降一档字号**（caption → 10px），仍溢出则该卡降为 2 栏 | 不牺牲可读性 |
| F8 | 卡片 = `formatCentsCard`；详情页 = `formatCents`（两位小数全精度） | 本轮**不改** formatter |

#### F5 精确说明（勘误 FIX-C，消除"非整元保留"与"四舍五入"的矛盾）

初稿同时写了「非整元保留」与「¥123,456.78 → ¥123,457」，两者冲突。
**本轮以现有实现为准，不重新设计 formatter**：

- **卡片**：严格复用现有 `formatCentsCard`。其既有行为包含：
  - 整元 → 省略 `.00`（`¥476.00` → `¥476`）
  - 非整元且 < ¥1,000 → 保留两位小数（`¥57.14` → `¥57.14`）
  - 非整元且 ≥ ¥1,000 → **四舍五入到整元**（`¥123,456.78` → `¥123,457`）
- **详情页**：`formatCents`，始终两位小数（`¥123,456.78`）

⚠️ 最后一条（大额四舍五入）是 `formatCentsCompact` 的既有行为，
`domain/purchase.ts` 的注释与测试都承认这一点。本轮**保留**，
精确值始终可在详情页看到。

**本轮真正要修的不是 formatter，而是 CSS `truncate` / `text-overflow: ellipsis`。**
除测试证明设计文档对现有实现理解错误外，不改
`formatCents` / `formatCentsCard` / `formatCentsCompact`。

### 14.2 大额验证（必须全部可读，无省略号）

| 场景 | 三栏栅格内的显示 | 判定 |
|---|---|---|
| ¥476 | `¥476` | ✅ |
| ¥1,474 | `¥1,474` | ✅ |
| ¥12,999 | `¥12,999` | ✅ |
| ¥123,457 | `¥123,457` | ✅ 8 字符，`num` 在 10px 下约 48px，三栏每栏约 100px（390px 屏） |
| −¥1,474 | `-¥1,474` | ✅ |
| −¥12,346 | `-¥12,346` | ✅ |
| ¥476.00（日均成本） | `¥476.00` | ✅ `<1000` 保留 2 位 |

> `formatCentsCompact` 的 `<1000 保留 2 位 / ≥1000 省 2 位` 规则**继续用于日均成本**
> （日均几乎总在小额区间，保留 2 位有意义），**不用于绝对金额**。

### 14.3 不允许的"解决方案"

- ❌ 缩短 label（「总投入」→「投入」）来腾宽度
- ❌ 换成更窄的字体
- ❌ 用 `1,474.00` 之外的紧凑记法
- ❌ tooltip / 长按查看（移动端不可发现）

---

## 15. Light / Dark Theme（两套主题）

所有使用点均引用 `src/index.css` 现有 token，**不新增变量**。

| 元素 | Light | Dark |
|---|---|---|
| L1 badge `sold` | `bg-success-soft #eaf4ef` + `text-success #2f7d5b` | `bg-success-soft #16241d` + `text-success #5cab86` |
| L1 badge `discarded` | `bg-surface-sunken #e9e9ec` + `text-ink-secondary #525252` | `bg-surface-sunken #2a2a31` + `text-ink-secondary #b8b8b5` |
| L1 badge `other` | `bg-info-soft #edf2fb` + `text-info #2f6bd0` | `bg-info-soft #1d2536` + `text-info #7aa7f0` |
| L2 overlay | `bg-ink-solid #171717` + `text-ink-inverse #ffffff` | `bg-ink-solid #f4f4f2` + `text-ink-inverse #0e0e10` |
| 盈利 | `text-success` | `text-success` |
| 亏损 | `text-money` | `text-money` |
| 持平 | `text-ink-tertiary` | `text-ink-tertiary` |

**对比度要求**：
- badge 前景/背景 ≥ 4.5:1（正文级）
- overlay 文字/背景 ≥ 4.5:1
### 实现阶段实测结论（V4 已完成）

原设计的 `bg-ink-primary/72` **在本项目不可用**，实测发现了一个真实缺陷：

>⚠️ 本项目颜色 token 一律是 `var(--color-*)`，而 **Tailwind 的 opacity 修饰符
> 对 `var()` 颜色不生成 CSS**。`bg-ink-primary/72` 在构建产物里**根本没有对应规则**，
> 浏览器实测 computed `background-color` = `rgba(0, 0, 0, 0)`（**完全透明**）。
> 那会让 overlay 退化成「白字直接压在物品图标上」，遇到浅色 plate 时**白字白底彻底不可读**。

**最终方案**：改用 `bg-ink-solid`（已存在且确实会生成 CSS 的实心 token）。
它与 `ink-primary` / `ink-inverse` 是同一对"互为反色"的组合，跨主题自动成立：

| 主题 | 背景 | 前景 | 理论对比度 | **真实截图像素实测** |
|---|---|---|---|---|
| light | `bg-ink-solid` `#171717` | `text-ink-inverse` `#ffffff` | 17.93:1 | **17.93:1** ✅ |
| dark | `bg-ink-solid` `#f4f4f2` | `text-ink-inverse` `#0e0e10` | 17.51:1 | **17.51:1** ✅ |

**实测方法**（不是理论推导）：无头 Edge 真机截取overlay 胶囊区域（40×18@6x），
读回浏览器 canvas 逐像素统计色簇，取"底色主簇"与"文字簇"计算 WCAG 对比度。
两套主题均 ≥ 4.5:1，实际为 17.5:1 以上。

**取舍说明**：实心胶囊牺牲了原设计的 72% 半透明质感，但
① 半透明在本项目根本无法实现（见上）；
② 胶囊只有 40×18px，实心与半透明的视觉差异可忽略；
③ 实心保证文字对比度**不受背景图片影响**（文字压在100% 不透明填充上）。
`backdrop-blur-sm` 一并移除 —— 没有透明度时它没有意义，只白烧 GPU。

⚠️ 未新增任何 hex、未新增任何主题变量（`bg-ink-solid` 是既有 token）。

**Phase 2H 明度重校准纪律**：新增 overlay 是唯一的新增表面，
必须同时在两套主题下截图验证，不得只验浅色。

---

## 16. Responsive Design（响应式）

| 断点 | 布局 | 差异 |
|---|---|---|
| **390px**（iPhone 14/15） | 单列 grid `grid-cols-2`；三栏指标 `grid-cols-3` | subfilter 去掉数量 hint；金额 10px |
| **430px**（iPhone 15 Pro Max） | 同 390，但金额可回 `caption` | subfilter 恢复完整 hint |
| **桌面 ≥768px** | `grid-cols-3` 或 `grid-cols-4`；`SegmentedControl` 居中定宽 | 三栏指标可用 `caption`；footer 单行展开 |
| **列表视图（任意宽度）** | 单列全宽行 | 见 §8 |

**基线不变**：处置卡在 390px 下也保持两列网格 —— 等高栅格才能让
「持有天数 / 出售回收 / 日均成本」三栏数字横向对齐比较（`ItemCard.tsx:72-75`
已把这条写成明确的设计理由，不推翻）。

**高度预算（§5 G6）**：

| 元素 | 持有态 | 处置态 | 增幅 |
|---|---|---|---|
| 图区 | aspect-[4/3] | aspect-[4/3] | 0 |
| L1 badge | 无（owned 不渲染 chip） | +26px（绝对定位，不占流） | 0 |
| L2 overlay | — | +0（绝对定位） | 0 |
| 副标题 | 分类名 | 处置日期 | 0 |
| 出售回收行 | — | +20px（**sold only**） | +20 |
| 三栏指标 | 3 栏 | 3 栏 | 0 |
| 财务 footer | — | +34px（**sold only**） | +34 |

**结论：sold 卡片 +54px（≈ 网格卡高度的 11%），discarded / other +0px。**
符合 G6 的"≤ +40px"目标上限吗？**sold 超出**。
修正方案：出售回收行与 footer 合并为**一个两列 footer**
（`总投入 · 盈亏`），出售回收已在三栏中 → sold 增幅收窄到 **+34px**。

---

## 17. Accessibility（无障碍）

| 要求 | 规格 |
|---|---|
| **Touch target ≥ 44×44** | L1 badge 为**非交互**元素，`pointer-events-none`，不占触摸目标 |
| | 整卡 `<Link>` 已是整块可点区域，满足 44px |
| **文字对比度 ≥ 4.5:1** | badge 前景/背景按 §15 表 |
| **Dynamic Type** | badge 用 `text-caption`；overlay 用 `text-caption`；均不锁死 `px` |
| | 三栏数值用 `text-caption`，允许浏览器字号缩放 |
| | **禁止**用 `truncate` 承载金额（截断对放大用户等同不可读） |
| **不依赖颜色单独传达** | 徽标带**文字**（「已售出」），色弱用户可读；L2 overlay 亦带文字 |
| **Screen reader** | 徽标与 overlay 文字必须在无障碍树中（不用 `aria-hidden`） |
| | 装饰性 overlay 背景 `aria-hidden="true"` |
| **reduced motion** | 本方案**不引入任何动效**；若实现时加过渡，须包 `@media (prefers-reduced-motion: no-preference)` |
| **状态语义** | 不用颜色单独表达 disposed（`ITEM_STATUS_LABELS` 文字仍在副标题之外出现） |

---

## 18. Detail Page Follow-up（详情页后续同步）

本轮**不实施**，但定义目标结构，保证卡片与详情页口径一致。

已售出物品的详情页 Hero：

| 区域 | 内容 |
|---|---|
| Hero status | L1 badge「已售出」+ L2 overlay「售出」（与卡片同组件同 token） |
| Hero 副标 | `处置于 {disposedAt}` |
| Hero 指标三栏 | 持有天数（冻结）· 出售回收 · 日均成本（**与卡片完全一致**） |
| 财务区 | 总投入 · 实际持有成本（`formatCents` 全精度）· 盈亏 |
| 保修区 | **不显示**（已处置物品无保修语义） |
| 处置备注 | `disposalNote` 若非空，展示为只读文本 |
| 生命周期操作区 | 不显示「处置物品」按钮（已处置）；可提供「恢复为持有」 |

**与卡片的一致性契约**：详情页 = 卡片结构 + 两项增强
（`formatCents` 全精度代替 `formatCentsCard`；`actual holding cost` 完整显式展示）。
**禁止**详情页出现卡片没有的第三种口径。

> 本文档范围内不实现详情页改动；此节作为下一轮或下下轮的接口约定。

---

## 19. Non-goals（本轮不做什么）

| 不做 | 理由 |
|---|---|
| ❌ 修改 domain 枚举 / 增加 `other` subtype | §10 硬约束 |
| ❌ 修改 `DISPOSAL_METHOD_LABELS` / `ITEM_STATUS_LABELS` 原值 | 本轮只定**新徽标文案** |
| ❌ 新增 `actualHoldingCost` 等计算函数 | 复用 `effectiveCostCents` |
| ❌ 改变净成本不夹逼的现有口径 | 有测试锁定 |
| ❌ 改 `formatCents*` 的四舍五入行为 | F8 是有意取舍 |
| ❌ 删除 `DisposalChip` | 它是复活对象（§1.10） |
| ❌ 新增颜色 / 硬编码 hex | §9 复用现有 token |
| ❌ 引入真实动效 / 大幅转场 | Calm UI + reduced motion |
| ❌ 把处置区做成灰色"墓地" | §19 情绪纪律 |
| ❌ bump `APP_VERSION` | 本轮无 runtime 变更 |
| ❌ 改 Dexie / D1 / Worker / sync / PWA | 超范围 |

---

## 20. Implementation Checklist（下一轮可逐项执行）

### 20.1 前置：口径收敛（**必须先做**）

- [ ] **S1** 复活并改造 `StatusChip.tsx:27` 的 `DisposalChip` →
      新增 `method` prop + `size: 'sm' | 'md'`，渲染 §12.1 的 token 映射
- [ ] **S2** 新增 `DISPOSITION_BADGE_LABELS = { sold: '已售出', discarded: '已丢弃', other: '其他处置' }`
      （**新常量，不改** `DISPOSAL_METHOD_LABELS`）
- [ ] **S3** 解决 §1.4 的双实现分歧：
      让 `components/ItemCard.tsx` 与 `ItemsListPage.GridCard` **共用同一个卡片组件**
      （否则改了列表页，概览页仍是旧标签）。二者当前指标定义必须收敛为一处。
- [ ] **S4** 在 `viewModels.ts` 扩展 `ItemMetric`，使「指标标签」由 lifecycle + method 决定，
      **而不是在组件里硬编码字符串**
- [ ] **S5** 修正排序标签（§13.3）：`cost` 项随 `status` 显示「总投入」/「实际持有成本」

### 20.2 卡片

- [ ] **C1** 移除 `ItemCard.tsx:58` 与 `ItemsListPage.tsx:59` 金额上的 `truncate`（F1）
- [ ] **C2** 金额加 `tabular-nums`（F2）
- [ ] **C3** 三栏栅格：溢出时降一档字号，仍溢出降 2 栏（F7）
- [ ] **C4** 图区加 L1 badge：`status === 'disposed'` 时用 §12.1 token
- [ ] **C5** 图区加 L2 overlay：**仅** `disposalMethod === 'sold'`
- [ ] **C6** 副标题：`disposed` → `处置于 {date}`；owned/wishlist 保持 `categoryName`
- [ ] **C7** sold 卡：三栏 = 持有天数 / 出售回收 / 日均成本
- [ ] **C8** sold 卡：footer = 总投入（`grossCostCents`）/ 盈亏
- [ ] **C9** discarded / other 卡：三栏 = 持有天数 / 总投入 / 日均成本，**无 footer**
- [ ] **C10** 确认 discarded / other **绝不出现**任何 `¥0` 回收字段
- [ ] **C11** 列表行：缩略图右下角加 `size='sm'` 方法徽标；实现 §8 的信息顺序

### 20.3 页面

- [ ] **P1** Large Title / Subtitle 随 lifecycle 动态（§5.1）
- [ ] **P2** 处置态加二级筛选（§6）：`useState<'all' | DisposalMethod>`，切 tab 时重置
- [ ] **P3** `②` 与 `③` 间距 `mt-5` → `mt-2`，`③` 与 `④` 保持 `mt-4`（§4）
- [ ] **P4** `status === 'disposed'` 且 `disposalMethod === null` 的历史数据：
      归入「其他处置」，**不崩溃**（`disposalMethod` 类型允许 null）

### 20.4 测试（对应项目现有 `src/**/*.test.ts` 风格）

- [ ] **T1** `viewModels`：三种 method 的指标标签与层级各自正确
- [ ] **T2** `viewModels`：sold 的 footer「总投入」用 `grossCostCents` 而非净成本（回归 §9.2 警告）
- [ ] **T3** 纯函数：盈亏文案映射（正/零/负 三分支）+ token 选择
- [ ] **T4** 纯函数：discarded / other 的字段集合**不含**任何 sale 相关 key（结构断言）
- [ ] **T5** 格式化：`[476, 1474, 12999, 123457, -1474, -12346]` 在卡片模式下
      **每项长度 ≤ 8 字符**（保证三栏放得下）
- [ ] **T6** 回归：净成本为负时**不**被 clamp（已有测试保护，不要改坏）
- [ ] **T7** 组件级：三种 method 渲染出的 badge 文案与 overlay 存在性

### 20.5 视觉验证（沿用项目既有方式）

- [ ] **V1** `.tmp/verify/verify-visual.mjs` 跑一遍
- [ ] **V2** 明暗两套主题**都**截图（Phase 2H 纪律：不许只验浅色）
- [ ] **V3** 390 / 430 / 桌面三档截图
- [x] **V4** dark 主题 overlay 对比度实测（§15）—— 已完成，见下方「实现阶段实测结论」
- [ ] **V5** sold / discarded / other **各至少一件**真实数据卡

### 20.6 验收门禁

- [ ] `npm run typecheck` PASS
- [ ] `npm run test` PASS（现有 594 项**不得减少**，新增只增不减）
- [ ] `npm run build` PASS
- [ ] `git diff --name-only` 只含预期文件，无 `wrangler.jsonc` / `package.json` 改动

---

## 21. Wireframes

### 21.1 Sold Grid Card（已售出 · 网格卡）

```
┌─────────────────────────────────┐
│ ╭─ 已售出 ─╮                     │  ← L1 badge · bg-success-soft/text-success
│ │                             │     absolute left-2 top-2 · pointer-events-none
│ │                             │
│ │        ┌───────────┐        │
│ │        │           │        │
│ │        │  物品图标  │        │     ← 图标保持完整清晰，不降 opacity
│ │        │  (96×96)  │        │
│ │        │           │        │
│ │        └───────────┘        │
│ │                             │
│ │        ┌ 售出 ─┐            │  ← L2 overlay · bg-ink-solid + text-ink-inverse
│ ╰─────────────────────────────╯     底部居中，高度 ≤ 图片区 22%
├─────────────────────────────────┤
│ 小米平板 5                        │  text-item · line-clamp-2 · min-h-[40px]
│ 处置于 2026年9月14日              │  text-caption · text-ink-tertiary
│ #常用 #数码                       │  TagChip ×2（可选，≤2）
├─────────────────────────────────┤
│  1463天   │  ¥568    │  ¥0.39   │  ← 三栏 · grid-cols-3 · divide-x
│  持有天数  │  出售回收 │  日均成本 │     数值 num + tabular-nums，**无 truncate**
├─────────────────────────────────┤
│ 总投入 ¥2,042           亏损 ¥1,474│  ← footer · 仅 sold
└─────────────────────────────────┘
```

> 盈亏为负时右侧显示 `亏损 ¥1,474` · `text-money`；为 0 显示 `持平` · `text-ink-tertiary`。

### 21.2 Discarded Grid Card（已丢弃）

```
┌─────────────────────────────────┐
│ ╭─ 已丢弃 ─╮                     │  ← L1 · bg-surface-sunken/text-ink-secondary
│ │                             │
│ │        ┌───────────┐        │
│ │        │  物品图标  │        │
│ │        │           │        │  ← ⚠️ 无 L2 overlay
│ │        └───────────┘        │
│ │                             │
│ ╰─────────────────────────────╯
├─────────────────────────────────┤
│ 旧款电风扇                      │
│ 处置于 2026年3月2日              │
├─────────────────────────────────┤
│  820天   │  ¥199    │  ¥0.24   │
│  持有天数 │  总投入   │  日均成本 │
├─────────────────────────────────┤
│  （无 footer —— 没有回收，无盈亏）   │
└─────────────────────────────────┘
```

**注意**：三栏第 2 列是**总投入**，不是"实际成本"；且**绝不出现** `出售回收 ¥0`。

### 21.3 Other Grid Card（其他处置）

```
┌─────────────────────────────────┐
│ ╭─ 其他处置 ─╮                   │  ← L1 · bg-info-soft/text-info
│ │        ┌───────────┐        │
│ │        │  物品图标  │        │  ← ⚠️ 无 L2 overlay
│ │        └───────────┘        │
│ │                             │
│ ╰─────────────────────────────╯
├─────────────────────────────────┤
│ 数据线若干                      │
│ 处置于 2025年11月8日              │  ← 只能写「处置于」，不得推断具体原因
├─────────────────────────────────┤
│  240天   │  ¥89     │  ¥0.37   │
│  持有天数 │  总投入   │  日均成本 │
└─────────────────────────────────┘
```

### 21.4 List Row（列表行 · sold）

```
┌────────────────────────────────────────────────────────────┐
│ ┌────────┐                                    ╭ 已售出 ╮   │  ← 缩略图右下
│ │  物品  │  小米平板 5                                       │     sm 徽标
│ │  52px  │  处置于 2026年9月14日 · 数码与电子                 │
│ └────────┘  1463 天 · 售出回收 ¥568 · 日均 ¥0.39            │  ← 内联指标行
│            实际持有成本 ¥0 · 持平                            │  ← 仅 sold
└────────────────────────────────────────────────────────────┘
```

52px 缩略图上**不放文字 overlay**（不可读），方法语义交给右下角徽标。

---

## 22. Field Display Matrix（字段显示矩阵）

图例：`P` = Primary（主信息） · `S` = Secondary（次级） · `H` = Hidden（隐藏）
· `N/A` = 该状态下无意义

| 字段 | 持有 owned | 心愿 wishlist | 出售 sold | 丢弃 discarded | 其他 other |
|---|---|---|---|---|---|
| `purchaseDate` | **S** 副标题/详情 | **H** | **H** | **H** | **H** |
| `purchasePriceCents` | **H**（并入总投入） | **H** | **H**（并入总投入） | **H** | **H** |
| `additionalCostCents` | **H**（并入总投入） | **H** | **H**（并入总投入） | **H** | **H** |
| `totalInvestment`（毛） | **P** 三栏 2 | **H** | **P** footer 1 | **P** 三栏 2 | **P** 三栏 2 |
| `disposedAt` | **N/A** | **N/A** | **P** 副标题「处置于」 | **P** 副标题 | **P** 副标题 |
| `disposalMethod` | **N/A** | **N/A** | **P** L1 badge + L2 | **P** L1 badge | **P** L1 badge |
| `salePriceCents` | **N/A** | **N/A** | **P** 三栏 2「出售回收」 | **H**（禁显示 ¥0） | **H**（禁显示 ¥0） |
| `ownershipDaysOf` | **P** 三栏 1 | **H**（无购买日期必为 null） | **P** 三栏 1（冻结） | **P** 三栏 1（冻结） | **P** 三栏 1（冻结） |
| `effectiveCostCents`（实际持有成本） | **H**（= 总投入，冗余） | **H** | **H**（卡片隐藏，与盈亏互为相反数；详情页显式展示） | **H**（= 总投入，冗余） | **H**（= 总投入，冗余） |
| `dailyCostOf` | **P** 三栏 3 | **H** | **P** 三栏 3 | **P** 三栏 3 | **P** 三栏 3 |
| `profitLoss` | **N/A**（未发生交易） | **N/A** | **P** footer 2 | **N/A**（无回收） | **N/A**（无回收） |
| `warrantyExpiresAt` | **S** WarrantyStrip | **H** | **H**（已处置无保修语义） | **H** | **H** |
| `tagNames` | **S** ≤2 | **S** ≤2 | **S** ≤2 | **S** ≤2 | **S** ≤2 |
| `categoryName` | **S** 副标题 | **S** 副标题 | **H**（副标题让位给日期） | **H** | **H** |
| `disposalNote` | **N/A** | **N/A** | **S** 详情页只读 | **S** 详情页只读 | **S** 详情页只读 |

**读法**：出售列与其他处置列的差异集中在
`salePriceCents`（P vs H）、`profitLoss`（P vs N/A）、`disposalMethod` 的 overlay（L2 有 vs 无）。
这正是 §5 G2 要求"可快速区分"的落点。

---

## 23. FINAL DESIGN CONTRACT（唯一实现依据）

> 下一轮开发**必须**按本节实现。本节与上文冲突时，以本节为准。

```
FINAL DESIGN CONTRACT — Disposed Item UX

[F1] Card Status Badge（图区左上 absolute left-2 top-2，pointer-events-none）
     sold       → 已售出    bg-success-soft     / text-success
     discarded  → 已丢弃    bg-surface-sunken  / text-ink-secondary
     other      → 其他处置  bg-info-soft        / text-info
     禁用 danger / danger-soft 表达处置状态

[F2] Image Outcome Overlay（图片区底部居中，bg-ink-solid + text-ink-inverse）
     sold       → 有，文案「售出」
     discarded  → 无
     other      → 无
     高度 ≤ 图片区 22%；不得模糊 / 降 opacity / 加叉

[F3] 副标题
     owned / wishlist → categoryName（现状不变）
     disposed（三法一致）→ 处置于 {formatPurchaseDate(disposedAt)}
     disposed 且 disposalMethod === null → 处置于 {date}，徽标按 other 处理

[F4] SOLD 卡片字段（顺序固定，不得增删）
     三栏：持有天数(ownershipDaysOf)
           出售回收(formatCentsCard(salePriceCents))
           日均成本(formatCentsCompact(dailyCostOf))
     footer：总投入(grossCostCents —— 不是 effectiveCostCents)
             盈亏(salePriceCents − grossTotal；盈利 text-success /
                  亏损 text-money / 持平 text-ink-tertiary)
     ⚠️ 卡片不显示「实际持有成本」（与盈亏互为相反数，冗余）

[F5] DISCARDED / OTHER 卡片字段（顺序固定）
     三栏：持有天数(ownershipDaysOf)
           总投入(grossCostCents)
           日均成本(formatCentsCompact(dailyCostOf))
     无 footer；无 overlay
     ⚠️ 绝不出现 出售回收 / 出售价格 / ¥0 占位 / 盈亏

[F6] OTHER 的文案纪律
     domain 无 subtype → UI 只能写「其他处置」
     ❌ 禁止：赠送 / 报废 / 退役 / 损坏 / 丢失 / 由 disposalNote 推断

[F7] 页面标题（随 lifecycle 动态）
     owned    → 我的物品    / N 件持有物品
     wishlist → 心愿物品    / N 件心愿物品
     disposed → 已处置物品  / N 件已处置物品
     （「物品管理」是 section 总称，不再作为这三个 tab 的 Large Title）

[F8] 处置二级筛选
     仅 status === 'disposed' 时出现
     复用 SegmentedControl；四项：全部 / 已售出 / 已丢弃 / 其他处置
     数量作为 hint；0 数量显示但禁用
     390px 去掉 hint，仍溢出则横向滚动，不换行
     与 lifecycle 控件视觉成组（间距 mt-2 vs 后续 mt-4）
     纯 UI 状态：不入 URL / IndexedDB / sync；切 tab 重置为 all

[F9] 顶部纵向顺序（唯一方案）
     ① Large Title + Subtitle
     ② Lifecycle SegmentedControl
     ③ Disposition Subfilter（仅 disposed）
     ④ Search
     ⑤ 分类 · 排序 · 视图切换
     ⑥ Cards
     搜索 / 分类 / 排序全部保留，不为减层数而删功能

[F10] 排序标签
      cost 项随 status：owned/wishlist → 总投入；disposed → 实际持有成本
      比较函数不变

[F11] 金额格式（强制）
      禁止 truncate / ellipsis / 紧凑记法(k、万)
      卡片 formatCentsCard；详情 formatCents（全精度）
      金额用 num + tabular-nums
      溢出先降一档字号，仍溢出降 2 栏
      净成本为负原样显示，禁止 Math.max(0)

[F12] 财务口径（直接复用，禁止重算）
      totalInvestment = calculateTotalCostCents(price, additional)
      effectiveCostCents = sold 且有 salePrice → total − sale，否则 total
      ownershipDaysOf 在 disposedAt 冻结
      dailyCostOf = effectiveCostCents ÷ days
      净成本不夹逼到 0（lifecycle.ts:121）

[F13] 卡片变体收敛
      components/ItemCard.tsx 与 ItemsListPage.GridCard 必须共用同一实现
      指标标签由 lifecycle + method 决定，不得在组件内硬编码
      （消除 HomePage/CategoryDetailPage 仍显示「总投入」的现状）

[F14] 列表行（与 Grid 同一 presentation model，只改布局不改口径）
       缩略图 52×52，右下角 sm 方法徽标，不放文字 overlay
       副标题：处置于 {date} · {categoryName}
       指标内联：持有天数 · 出售回收 · 日均成本（仅 sold）
       财务行：总投入 · 盈利/亏损/持平（仅 sold）
       ❌ 不显示「实际持有成本」（与盈亏互为相反数，重复）

[F15] 禁止项（自检清单）
       ❌ 新增任何 hex / 颜色变量
       ❌ danger 系表达处置
       ❌ 图片降 opacity / 灰化 / blur / 红叉
       ❌ 为 discarded/other 补 ¥0 回收字段
       ❌ 卡片同时显示「实际持有成本」与「盈亏」
       ❌ 金额 truncate
       ❌ 引入动效
       ❌ 改 domain 枚举 / schema / APP_VERSION
```

---

## 24. Terminology Audit（术语一致性附记）

本轮发现的术语不一致，**均不在本轮修改**，在此登记以便后续统一：

| # | 位置 | 现状 | 建议 | 优先级 |
|---|---|---|---|---|
| 1 | `ITEM_STATUS_LABELS.disposed` | `处置` | `已处置` | 高（本设计已在 UI 侧绕开） |
| 2 | `DISPOSAL_METHOD_LABELS.sold` | `出售`（动作） | UI 用 `已售出`（结果），常量保留 | 已在本设计解决 |
| 3 | `ItemsListPage.tsx:93` | `实际成本` | `实际持有成本` | 高 |
| 4 | `ItemsListPage.tsx:45` 排序 | 标签 `总投入`，实排净成本 | 随 status 动态 | 高 |
| 5 | `ItemCard.tsx:88-90` | 硬编码 `总投入` | 随 method 动态 | 高 |
| 6 | 副标题 | `3 件处置物品` | `3 件已处置物品` | 高 |
| 7 | `StatusChip.tsx:27` `DisposalChip` | 死代码 | 复活为本设计的 L1 badge | 中 |

---

## 25. 文档边界声明

- 本文档**不含**任何已提交的代码改动（`git diff --name-only` 仅本文件）
- 未 bump `APP_VERSION`（仍 `0.7.0`）
- 未修改 Dexie schemaVersion（仍 3）/ Dexie v4 stores / Worker / D1 / migration / sync / PWA
- 文档中所有行号引用基于 `main@cbb67d0`