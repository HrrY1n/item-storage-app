/**
 * 生成「物品图标资产」到 public/icons/items/。
 *
 * 设计语法（全体图标共用，保证风格统一）：
 *   - viewBox 0 0 96 96，**透明背景**（底衬由 CSS 语义 token 提供，故浅色/深色主题都能用）
 *   - 统一描边 #57534E，stroke-width 3.2，round linejoin/cap
 *   - 统一调色板：冷蓝 / 暖沙 / 鼠尾草 / 玫瑰 / 薰衣草 / 白 + 两个克制强调（陶土、医用绿）
 *   - 底部一枚极淡投影，建立"陈列在台面上"的物感
 *   - 物体占据约 12–84 的安全区，使 ObjectPlate 里既不过小也不出框
 *
 * 这些图标是「物品展示资产」，不是工具栏线性 icon：允许填充色与体量，
 * 但全部收敛到同一套轮廓语言，避免多套风格混用造成视觉割裂。
 *
 * 用法：node scripts/gen-item-icons.mjs
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../public/icons/items')

// ------------------------------------------------------------------ 调色板

const S = '#57534E' // 描边（在浅/深底衬上都有足够对比）
const M = '#A8A29E' // 次级细节线（键盘按键、纹理、刻度）
const C1 = '#DCE6F2' // 冷蓝：数码
const C2 = '#E9E3D8' // 暖沙：纸品 / 木 / 布
const C3 = '#DCE8DF' // 鼠尾草：织物 / 生活
const C4 = '#F0DDDF' // 玫瑰：服饰 / 礼赠
const C5 = '#DFDEEE' // 薰衣草：箱包 / 收纳
const R = '#D08C74' // 陶土强调（书签、丝带、唱片标签）
const G = '#7FA48D' // 医用绿（药箱十字）
const W = '#FFFFFF'

/**
 * 底部接触阴影：所有"立得住"的物体共用，建立统一的台面感。
 *
 * 用径向渐变而不是实心椭圆 —— 实心椭圆在浅色底衬上会读成一块独立的灰斑，
 * 而不是影子。渐变让它从中心向外自然消失。
 */
const SH = `<defs><radialGradient id="sh"><stop offset="0" stop-color="${S}" stop-opacity="0.17"/><stop offset="0.62" stop-color="${S}" stop-opacity="0.07"/><stop offset="1" stop-color="${S}" stop-opacity="0"/></radialGradient></defs>
<ellipse cx="48" cy="85" rx="28" ry="4.2" fill="url(#sh)"/>`

// ------------------------------------------------------------------ 图标定义

/** @type {{key:string, body:string}[]} */
const ICONS = [
  // ============================================================ 数码与电子
  {
    key: 'phone',
    body: `
<rect x="30" y="12" width="36" height="72" rx="9" fill="${W}"/>
<rect x="36" y="21" width="24" height="46" rx="4" fill="${C1}"/>
<path d="M43 76h10" stroke-width="3"/>`,
  },
  {
    key: 'tablet',
    body: `
<rect x="19" y="14" width="58" height="68" rx="9" fill="${W}"/>
<rect x="26" y="22" width="44" height="44" rx="3" fill="${C1}"/>
<circle cx="48" cy="74" r="2.6" fill="${S}" stroke="none"/>`,
  },
  {
    key: 'laptop',
    body: `
<rect x="26" y="24" width="44" height="30" rx="4" fill="${C1}"/>
<path d="M22 56h52l6 9a2 2 0 0 1-1.8 3H17.8a2 2 0 0 1-1.8-3z" fill="${W}"/>`,
  },
  {
    key: 'desktop',
    body: `
<rect x="33" y="14" width="30" height="58" rx="6" fill="${W}"/>
<rect x="40" y="22" width="16" height="6" rx="2" fill="${C1}" stroke-width="3"/>
<circle cx="48" cy="42" r="4.5" fill="${C1}" stroke-width="3"/>
<circle cx="48" cy="58" r="4.5" fill="${C2}" stroke-width="3"/>
<rect x="28" y="72" width="40" height="8" rx="4" fill="${C2}"/>`,
  },
  {
    key: 'monitor',
    body: `
<rect x="11" y="22" width="74" height="46" rx="6" fill="${W}"/>
<rect x="17" y="28" width="62" height="34" rx="3" fill="${C1}"/>
<path d="M48 68v10M35 80h26" stroke-width="3"/>`,
  },
  {
    key: 'smartwatch',
    body: `
<rect x="34" y="6" width="28" height="20" rx="7" fill="${C2}"/>
<rect x="34" y="70" width="28" height="20" rx="7" fill="${C2}"/>
<rect x="27" y="22" width="42" height="52" rx="13" fill="${W}"/>
<rect x="33" y="30" width="30" height="36" rx="7" fill="${C1}"/>
<path d="M69 40v10" stroke-width="3"/>`,
  },
  {
    key: 'band',
    body: `
<rect x="32" y="8" width="32" height="80" rx="15" fill="${C2}"/>
<rect x="35" y="28" width="26" height="40" rx="9" fill="${W}"/>
<rect x="40" y="34" width="16" height="28" rx="5" fill="${C1}" stroke-width="3"/>`,
  },
  {
    key: 'earbuds',
    body: `
<circle cx="37" cy="28" r="7" fill="${C1}" stroke-width="3"/>
<path d="M37 35v16" stroke-width="3"/>
<circle cx="59" cy="28" r="7" fill="${C1}" stroke-width="3"/>
<path d="M59 35v16" stroke-width="3"/>
<rect x="25" y="50" width="46" height="26" rx="11" fill="${W}"/>`,
  },
  {
    key: 'headphones',
    body: `
<path d="M22 58V44a26 26 0 0 1 52 0v14"/>
<rect x="12" y="50" width="18" height="28" rx="8" fill="${C1}"/>
<rect x="66" y="50" width="18" height="28" rx="8" fill="${C1}"/>`,
  },
  {
    key: 'speaker',
    body: `
<rect x="26" y="14" width="44" height="68" rx="9" fill="${W}"/>
<circle cx="48" cy="35" r="9" fill="${C1}" stroke-width="3"/>
<circle cx="48" cy="62" r="6" fill="${C2}" stroke-width="3"/>`,
  },
  {
    key: 'microphone',
    body: `
<rect x="38" y="12" width="20" height="34" rx="10" fill="${C1}"/>
<path d="M30 42a18 18 0 0 0 36 0"/>
<path d="M48 60v14M38 78h20" stroke-width="3"/>`,
  },
  {
    key: 'camera',
    body: `
<rect x="12" y="28" width="72" height="44" rx="9" fill="${W}"/>
<path d="M34 28l4-8h20l4 8" fill="${C2}" stroke-width="3"/>
<circle cx="48" cy="50" r="13" fill="${C1}"/>
<circle cx="48" cy="50" r="5" fill="${W}" stroke-width="3"/>
<circle cx="70" cy="36" r="2.4" fill="${S}" stroke="none"/>`,
  },
  {
    key: 'lens',
    body: `
<rect x="26" y="12" width="44" height="68" rx="11" fill="${W}"/>
<path d="M26 34h44" stroke-width="3"/>
<circle cx="48" cy="52" r="14" fill="${C1}"/>
<circle cx="48" cy="52" r="6" fill="${W}" stroke-width="3"/>`,
  },
  {
    key: 'gameconsole',
    body: `
<rect x="7" y="30" width="82" height="40" rx="13" fill="${W}"/>
<rect x="34" y="38" width="28" height="24" rx="3" fill="${C1}" stroke-width="3"/>
<path d="M22 43v12M16 49h12" stroke-width="3"/>
<circle cx="74" cy="46" r="3.4" fill="${C2}" stroke-width="3"/>
<circle cx="66" cy="56" r="3.4" fill="${C1}" stroke-width="3"/>`,
  },
  {
    key: 'gamepad',
    body: `
<rect x="9" y="32" width="78" height="40" rx="20" fill="${W}"/>
<path d="M31 44v12M25 50h12" stroke-width="3"/>
<circle cx="65" cy="46" r="3.6" fill="${C1}" stroke-width="3"/>
<circle cx="73" cy="56" r="3.6" fill="${C3}" stroke-width="3"/>`,
  },
  {
    key: 'keyboard',
    body: `
<rect x="12" y="28" width="72" height="40" rx="8" fill="${W}"/>
<path d="M21 39h5M32 39h5M43 39h5M54 39h5M65 39h5" stroke="${M}" stroke-width="3"/>
<path d="M27 49h42" stroke="${M}" stroke-width="3"/>
<path d="M21 59h54" stroke="${M}" stroke-width="3"/>`,
  },
  {
    key: 'mouse',
    body: `
<rect x="32" y="16" width="32" height="62" rx="16" fill="${W}"/>
<path d="M48 28v13" stroke-width="3"/>`,
  },
  {
    key: 'trackpad',
    body: `
<rect x="11" y="24" width="74" height="52" rx="9" fill="${W}"/>
<rect x="17" y="30" width="62" height="40" rx="6" fill="${C1}" stroke-width="3"/>
<path d="M48 38v10" stroke-width="3"/>
<circle cx="48" cy="56" r="5.5" fill="${C2}" stroke-width="3"/>`,
  },
  {
    key: 'charger',
    body: `
<path d="M41 22V9M55 22V9" stroke-width="3"/>
<rect x="29" y="22" width="38" height="48" rx="9" fill="${W}"/>
<rect x="40" y="46" width="16" height="11" rx="3" fill="${C1}" stroke-width="3"/>`,
  },
  {
    key: 'powerbank',
    body: `
<rect x="26" y="12" width="44" height="72" rx="10" fill="${W}"/>
<rect x="34" y="24" width="28" height="9" rx="3" fill="${C3}" stroke-width="3"/>
<rect x="34" y="40" width="28" height="8" rx="3" fill="${C1}" stroke-width="3"/>
<rect x="34" y="54" width="28" height="8" rx="3" fill="${C1}" stroke-width="3"/>
<path d="M38 72h8M50 72h8" stroke="${M}" stroke-width="3"/>`,
  },
  {
    key: 'cable',
    body: `
<rect x="8" y="26" width="15" height="17" rx="4" fill="${C1}"/>
<rect x="73" y="53" width="15" height="17" rx="4" fill="${W}"/>
<path d="M23 34h10a10 10 0 0 1 10 10v6a10 10 0 0 0 10 10h20"/>`,
  },
  {
    key: 'hdd',
    body: `
<rect x="17" y="26" width="62" height="46" rx="9" fill="${W}"/>
<circle cx="62" cy="49" r="8" fill="${C1}" stroke-width="3"/>
<path d="M28 42h18M28 52h14" stroke="${M}" stroke-width="3"/>`,
  },
  {
    key: 'usb',
    body: `
<rect x="40" y="12" width="20" height="24" rx="4" fill="${C1}"/>
<path d="M44 21h12M44 29h12" stroke="${M}" stroke-width="3"/>
<rect x="30" y="36" width="40" height="48" rx="8" fill="${W}"/>
<path d="M42 58h12" stroke="${M}" stroke-width="3"/>`,
  },
  {
    key: 'sdcard',
    body: `
<path d="M30 12h23l15 15v57a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4V16a4 4 0 0 1 4-4z" fill="${C2}"/>
<g fill="${C1}" stroke-width="2.6">
<rect x="34" y="20" width="4.5" height="11" rx="1.6"/>
<rect x="41" y="20" width="4.5" height="11" rx="1.6"/>
<rect x="48" y="20" width="4.5" height="11" rx="1.6"/>
</g>`,
  },
  {
    key: 'router',
    body: `
<path d="M32 46V22M64 46V22" stroke-width="3"/>
<rect x="15" y="44" width="66" height="32" rx="9" fill="${W}"/>
<circle cx="31" cy="60" r="3" fill="${C3}" stroke-width="2.6"/>
<circle cx="43" cy="60" r="3" fill="${C3}" stroke-width="2.6"/>
<circle cx="55" cy="60" r="3" fill="${C2}" stroke-width="2.6"/>
<circle cx="67" cy="60" r="3" fill="${C1}" stroke-width="2.6"/>`,
  },
  {
    key: 'printer',
    body: `
<path d="M31 38V16h34v22" fill="${C2}"/>
<rect x="14" y="38" width="68" height="30" rx="8" fill="${W}"/>
<rect x="28" y="58" width="40" height="24" rx="4" fill="${C1}"/>
<circle cx="70" cy="48" r="2.6" fill="${C3}" stroke="none"/>`,
  },
  {
    key: 'ereader',
    body: `
<rect x="24" y="10" width="48" height="76" rx="9" fill="${W}"/>
<rect x="31" y="23" width="34" height="44" rx="3" fill="${C2}"/>
<path d="M37 34h22M37 43h22M37 52h13" stroke="${M}" stroke-width="2.6"/>
<circle cx="48" cy="76" r="3.2" fill="${C1}" stroke-width="2.6"/>`,
  },

  // ============================================================ 学习与办公
  {
    key: 'book',
    body: `
<rect x="27" y="18" width="42" height="60" rx="5" fill="${C2}"/>
<path d="M38 18v60" stroke-width="3"/>
<path d="M57 18v14l-5.5-4.5L46 32V18z" fill="${R}"/>`,
  },
  {
    key: 'notebook',
    body: `
<rect x="26" y="16" width="50" height="64" rx="6" fill="${W}"/>
<path d="M36 33h30M36 45h30M36 57h18" stroke="${M}" stroke-width="3"/>
<path d="M26 31h-9M26 47h-9M26 63h-9" stroke-width="3"/>`,
  },
  {
    key: 'folder',
    body: `
<path d="M10 32a7 7 0 0 1 7-7h16l7 9h40a7 7 0 0 1 7 7v32a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7z" fill="${C1}"/>
<path d="M10 44h76" stroke-width="3"/>`,
  },
  {
    key: 'pen',
    body: `
<path d="M61 19 77 35 40 72 21 80l8-19z" fill="${C1}"/>
<path d="M61 19l16 16" stroke-width="3"/>
<path d="M33 64l9 9" stroke-width="3"/>`,
  },
  {
    key: 'calculator',
    body: `
<rect x="25" y="12" width="46" height="72" rx="9" fill="${W}"/>
<rect x="33" y="20" width="30" height="15" rx="3" fill="${C1}" stroke-width="3"/>
<g fill="${C2}" stroke-width="2.6">
<rect x="33" y="43" width="8.5" height="8.5" rx="2.6"/>
<rect x="44" y="43" width="8.5" height="8.5" rx="2.6"/>
<rect x="55" y="43" width="8.5" height="8.5" rx="2.6"/>
<rect x="33" y="56" width="8.5" height="8.5" rx="2.6"/>
<rect x="44" y="56" width="8.5" height="8.5" rx="2.6"/>
<rect x="55" y="56" width="8.5" height="8.5" rx="2.6"/>
<rect x="33" y="69" width="8.5" height="8.5" rx="2.6"/>
<rect x="44" y="69" width="8.5" height="8.5" rx="2.6"/>
<rect x="55" y="69" width="8.5" height="8.5" rx="2.6"/>
</g>`,
  },
  {
    key: 'scissors',
    body: `
<circle cx="29" cy="67" r="9" fill="${W}"/>
<circle cx="67" cy="67" r="9" fill="${W}"/>
<path d="M35 61 69 21M61 61 27 21"/>`,
  },
  {
    key: 'stapler',
    body: `
<rect x="15" y="58" width="66" height="15" rx="7" fill="${W}"/>
<path d="M21 58V45a9 9 0 0 1 9-9h34a9 9 0 0 1 9 9v13" fill="${C2}"/>
<rect x="35" y="30" width="26" height="9" rx="4" fill="${C1}" stroke-width="3"/>`,
  },

  // ============================================================ 衣物与穿搭
  {
    key: 'tshirt',
    body: `
<path d="M38 23l-12 6-7 13 9 5 4-5v30h32V42l4 5 9-5-7-13-12-6c0 5-4.5 9-10 9s-10-4-10-9z" fill="${C1}"/>`,
  },
  {
    key: 'pants',
    body: `
<path d="M31 12h34v14l-3 55H52l-4-38-4 38H34l-3-55z" fill="${C3}"/>
<path d="M31 26h34" stroke-width="3"/>`,
  },
  {
    key: 'coat',
    body: `
<path d="M48 27 36 18 19 27 14 45l10 4 3-6v32h42V43l3 6 10-4-5-18-17-9z" fill="${C2}"/>
<path d="M41 18a7 7 0 0 0 14 0" stroke-width="3"/>
<path d="M48 27v22" stroke-width="3"/>`,
  },
  {
    key: 'shoes',
    body: `
<path d="M11 60v-8a6 6 0 0 1 6-6h12l9 7 9 2 19 5c6 1.6 9 4.6 9 9v1a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4z" fill="${C1}"/>
<path d="M40 55l4-8M51 57l4-8" stroke-width="3"/>`,
  },
  {
    key: 'sneakers',
    body: `
<path d="M11 60v-8a6 6 0 0 1 6-6h12l9 7 9 2 19 5c6 1.6 9 4.6 9 9v1a4 4 0 0 1-4 4H15a4 4 0 0 1-4-4z" fill="${C3}"/>
<path d="M17 66c12-1 22-7 29-16" stroke-width="3"/>`,
  },
  {
    key: 'hat',
    body: `
<path d="M22 56a26 26 0 0 1 52 0z" fill="${C1}"/>
<rect x="13" y="56" width="70" height="11" rx="5.5" fill="${W}"/>
<circle cx="48" cy="28" r="3.4" fill="${S}" stroke="none"/>`,
  },
  {
    key: 'glasses',
    body: `
<circle cx="29" cy="52" r="15" fill="${C1}"/>
<circle cx="67" cy="52" r="15" fill="${C1}"/>
<path d="M44 48h8" stroke-width="3"/>
<path d="M14 47 9 39M82 47l5-8" stroke-width="3"/>`,
  },
  {
    key: 'watch',
    body: `
<rect x="34" y="8" width="28" height="18" rx="6" fill="${C2}"/>
<rect x="34" y="70" width="28" height="18" rx="6" fill="${C2}"/>
<circle cx="48" cy="48" r="21" fill="${W}"/>
<circle cx="48" cy="48" r="13" fill="${C2}" stroke-width="3"/>
<path d="M48 40v8l6 4" stroke-width="3"/>`,
  },
  {
    key: 'backpack',
    body: `
<path d="M40 20a14 14 0 0 1 16 0" stroke-width="3"/>
<path d="M24 38a24 24 0 0 1 48 0v36a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6z" fill="${C1}"/>
<rect x="34" y="52" width="28" height="24" rx="6" fill="${W}" stroke-width="3"/>
<rect x="42" y="16" width="12" height="9" rx="3.5" fill="${C2}" stroke-width="3"/>`,
  },
  {
    key: 'handbag',
    body: `
<path d="M35 38V30a13 13 0 0 1 26 0v8" stroke-width="3"/>
<path d="M21 36h54l-5 42a6 6 0 0 1-6 5H32a6 6 0 0 1-6-5z" fill="${C4}"/>
<path d="M32 54h32" stroke-width="3"/>`,
  },
  {
    key: 'wallet',
    body: `
<rect x="12" y="27" width="72" height="45" rx="10" fill="${C2}"/>
<path d="M12 44h72" stroke-width="3"/>
<rect x="54" y="48" width="22" height="15" rx="5" fill="${W}" stroke-width="3"/>
<circle cx="62" cy="55.5" r="2.6" fill="${S}" stroke="none"/>`,
  },

  // ============================================================ 生活用品
  {
    key: 'bottle',
    body: `
<path d="M38 18h20v9l4 6v42a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V33l4-6z" fill="${C1}"/>
<path d="M34 44h28" stroke-width="3"/>`,
  },
  {
    key: 'thermos',
    body: `
<rect x="34" y="12" width="28" height="11" rx="4" fill="${C2}"/>
<path d="M36 23h24v50a8 8 0 0 1-8 8h-8a8 8 0 0 1-8-8z" fill="${C1}"/>
<path d="M36 46h24" stroke-width="3"/>`,
  },
  {
    key: 'umbrella',
    body: `
<path d="M48 20c14 0 26 10 28 25H20c2-15 14-25 28-25z" fill="${C1}"/>
<path d="M48 20v46" stroke-width="3"/>
<path d="M48 66v5a7 7 0 0 0 14 0" stroke-width="3"/>
<path d="M48 16v4" stroke-width="3"/>`,
  },
  {
    key: 'key',
    body: `
<circle cx="32" cy="39" r="15" fill="${C2}"/>
<circle cx="32" cy="39" r="5.5" fill="${W}" stroke-width="3"/>
<path d="M42.5 49.5 73 80" stroke-width="3.2"/>
<path d="M67 74l6-6M73 80l6-6" stroke-width="3.2"/>`,
  },
  {
    key: 'toolbox',
    body: `
<path d="M38 38v-7a10 10 0 0 1 20 0v7" stroke-width="3"/>
<rect x="13" y="36" width="70" height="44" rx="9" fill="${C2}"/>
<path d="M13 52h70" stroke-width="3"/>
<rect x="42" y="46" width="12" height="12" rx="3" fill="${C1}" stroke-width="3"/>`,
  },
  {
    key: 'firstaid',
    body: `
<path d="M38 36v-7a10 10 0 0 1 20 0v7" stroke-width="3"/>
<rect x="13" y="34" width="70" height="46" rx="10" fill="${W}"/>
<path d="M48 46v22M37 57h22" stroke="${G}" stroke-width="7"/>`,
  },
  {
    key: 'luggage',
    body: `
<path d="M38 32v-9a6 6 0 0 1 6-6h8a6 6 0 0 1 6 6v9" stroke-width="3"/>
<rect x="16" y="30" width="64" height="50" rx="9" fill="${C5}"/>
<path d="M33 45v22M48 45v22M63 45v22" stroke="${M}" stroke-width="3"/>
<path d="M24 46v20M72 46v20" stroke-width="3"/>`,
  },
  {
    key: 'towel',
    body: `
<rect x="16" y="32" width="64" height="17" rx="6" fill="${C3}"/>
<rect x="16" y="49" width="64" height="17" rx="6" fill="${C1}"/>
<path d="M26 32v17M26 49v17" stroke-width="3" stroke="${M}"/>`,
  },
  {
    key: 'cleaning',
    body: `
<path d="M56 26h14l-3 9" stroke-width="3"/>
<rect x="39" y="20" width="17" height="16" rx="4" fill="${C2}"/>
<rect x="31" y="36" width="33" height="46" rx="9" fill="${C1}"/>
<path d="M39 54h17M39 66h17" stroke="${M}" stroke-width="3"/>`,
  },

  // ============================================================ 家电与家居
  {
    key: 'tv',
    body: `
<rect x="9" y="24" width="78" height="48" rx="8" fill="${W}"/>
<rect x="15" y="30" width="66" height="36" rx="3" fill="${C1}"/>
<path d="M48 72v8M35 82h26" stroke-width="3"/>`,
  },
  {
    key: 'fan',
    body: `
<g fill="${W}" stroke-width="3">
<ellipse cx="48" cy="27" rx="8" ry="12"/>
<ellipse cx="62.1" cy="51.5" rx="8" ry="12" transform="rotate(120 62.1 51.5)"/>
<ellipse cx="33.9" cy="51.5" rx="8" ry="12" transform="rotate(240 33.9 51.5)"/>
</g>
<circle cx="48" cy="43" r="5" fill="${C2}" stroke-width="3"/>
<path d="M48 70v5" stroke-width="3"/>
<rect x="32" y="74" width="32" height="9" rx="4.5" fill="${C2}"/>`,
  },
  {
    key: 'ac',
    body: `
<rect x="9" y="24" width="78" height="34" rx="11" fill="${W}"/>
<path d="M17 44h62" stroke="${M}" stroke-width="3"/>
<path d="M26 58v16M48 58v20M70 58v16" stroke="${C1}" stroke-width="4.5"/>`,
  },
  {
    key: 'fridge',
    body: `
<rect x="23" y="10" width="50" height="76" rx="9" fill="${W}"/>
<path d="M23 40h50" stroke-width="3"/>
<path d="M34 22v10M34 50v14" stroke-width="3"/>`,
  },
  {
    key: 'washer',
    body: `
<rect x="17" y="12" width="62" height="72" rx="10" fill="${W}"/>
<path d="M17 32h62" stroke-width="3"/>
<circle cx="48" cy="57" r="18" fill="${C1}"/>
<circle cx="48" cy="57" r="9.5" fill="${W}" stroke-width="3"/>
<circle cx="30" cy="22" r="3" fill="${C3}" stroke="none"/>
<circle cx="40" cy="22" r="3" fill="${C2}" stroke="none"/>`,
  },
  {
    key: 'vacuum',
    body: `
<rect x="30" y="10" width="14" height="30" rx="7" fill="${C2}"/>
<path d="M37 40v14" stroke-width="3"/>
<rect x="25" y="52" width="26" height="22" rx="8" fill="${C1}"/>
<path d="M38 74v5" stroke-width="3"/>
<rect x="15" y="77" width="48" height="11" rx="5.5" fill="${W}"/>`,
  },
  {
    key: 'hairdryer',
    body: `
<path d="M18 32h28a17 17 0 0 1 17 17v2a17 17 0 0 1-17 17H18a6 6 0 0 1-6-6V38a6 6 0 0 1 6-6z" fill="${C1}"/>
<path d="M63 39h15v22H63" fill="${C2}" stroke-width="3"/>
<circle cx="33" cy="50" r="8" fill="${W}" stroke-width="3"/>
<path d="M42 68v6a10 10 0 0 1-10 10" stroke-width="3"/>`,
  },
  {
    key: 'ricecooker',
    body: `
<path d="M20 46h56v22a10 10 0 0 1-10 10H30a10 10 0 0 1-10-10z" fill="${W}"/>
<rect x="14" y="30" width="68" height="17" rx="8" fill="${C1}"/>
<circle cx="48" cy="38" r="4" fill="${C2}" stroke-width="3"/>
<rect x="42" y="54" width="12" height="8" rx="3" fill="${C2}" stroke-width="3"/>`,
  },
  {
    key: 'coffee',
    body: `
<rect x="20" y="12" width="56" height="24" rx="7" fill="${C1}"/>
<rect x="33" y="36" width="30" height="13" rx="4" fill="${C2}" stroke-width="3"/>
<path d="M41 49v7M55 49v7" stroke="${C1}" stroke-width="3.4"/>
<path d="M35 62h26v9a13 13 0 0 1-26 0z" fill="${W}"/>
<path d="M61 66h5a6 6 0 0 1 0 12h-4" stroke-width="3"/>`,
  },
  {
    key: 'desklamp',
    body: `
<path d="M16 22h30l13 18H28z" fill="${C1}"/>
<path d="M41 40v34" stroke-width="3.2"/>
<ellipse cx="44" cy="78" rx="24" ry="5" fill="${C2}" stroke-width="3"/>
<path d="M33 46h10" stroke="${M}" stroke-width="3"/>`,
  },

  // ============================================================ 兴趣与收藏
  {
    key: 'instrument',
    body: `
<rect x="41" y="6" width="15" height="12" rx="3" fill="${C1}" stroke-width="3"/>
<rect x="44" y="18" width="9" height="28" fill="${C2}" stroke-width="3"/>
<ellipse cx="48" cy="62" rx="23" ry="19" fill="${C2}"/>
<circle cx="48" cy="62" r="7.5" fill="${C1}" stroke-width="3"/>`,
  },
  {
    key: 'vinyl',
    body: `
<rect x="12" y="20" width="54" height="54" rx="7" fill="${C2}"/>
<circle cx="39" cy="47" r="16" fill="${C1}"/>
<circle cx="39" cy="47" r="4.5" fill="${W}" stroke-width="2.8"/>
<circle cx="63" cy="52" r="21" fill="${C5}"/>
<circle cx="63" cy="52" r="8" fill="${R}" stroke-width="2.8"/>
<circle cx="63" cy="52" r="2.4" fill="${W}" stroke="none"/>`,
  },
  {
    key: 'toy',
    body: `
<circle cx="30" cy="30" r="10" fill="${C2}"/>
<circle cx="66" cy="30" r="10" fill="${C2}"/>
<circle cx="48" cy="52" r="24" fill="${C2}"/>
<ellipse cx="48" cy="61" rx="10" ry="8" fill="${C4}" stroke-width="2.8"/>
<circle cx="40" cy="46" r="2.8" fill="${S}" stroke="none"/>
<circle cx="56" cy="46" r="2.8" fill="${S}" stroke="none"/>`,
  },
  {
    key: 'model',
    body: `
<circle cx="48" cy="22" r="10" fill="${C4}"/>
<path d="M38 34h20a6 6 0 0 1 6 6v16H32V40a6 6 0 0 1 6-6z" fill="${C1}"/>
<path d="M32 44H22M64 44h10" stroke-width="3"/>
<path d="M40 56v12M56 56v12" stroke-width="3"/>
<ellipse cx="48" cy="74" rx="19" ry="5" fill="${C2}" stroke-width="3"/>`,
  },
  {
    key: 'cards',
    body: `
<g transform="rotate(-13 35 50)"><rect x="18" y="26" width="34" height="48" rx="5" fill="${C2}"/></g>
<g transform="rotate(11 59 48)"><rect x="42" y="24" width="34" height="48" rx="5" fill="${W}"/></g>
<circle cx="59" cy="44" r="5" fill="${R}" stroke-width="2.8"/>`,
  },
  {
    key: 'souvenir',
    body: `
<path d="M34 64l7 20 7-8 7 8 7-20" fill="${R}" stroke-width="3"/>
<circle cx="48" cy="40" r="24" fill="${C2}"/>
<circle cx="48" cy="40" r="14" fill="${C1}" stroke-width="3"/>
<path d="M48 32v16M40 40h16" stroke-width="3"/>`,
  },

  // ============================================================ 其他
  {
    key: 'gift',
    body: `
<path d="M48 27C40 27 32 23 32 17s10-6 16 10zM48 27c8 0 16-4 16-10s-10-6-16 10z" fill="${C4}" stroke-width="3"/>
<rect x="15" y="38" width="66" height="44" rx="7" fill="${C4}"/>
<rect x="12" y="26" width="72" height="13" rx="5" fill="${C2}"/>
<path d="M48 39v43" stroke-width="3.2"/>`,
  },
  {
    key: 'collectionbox',
    body: `
<rect x="13" y="36" width="70" height="44" rx="7" fill="${C2}"/>
<path d="M13 36 23 17h50l10 19" fill="${C1}"/>
<rect x="41" y="36" width="14" height="11" rx="3" fill="${W}" stroke-width="3"/>`,
  },
  {
    key: 'other',
    body: `
<path d="M26 40l11-14h22l11 14" stroke-width="3"/>
<rect x="24" y="40" width="48" height="34" rx="5" fill="${C2}"/>
<path d="M48 40v8" stroke-width="3"/>
<rect x="17" y="48" width="62" height="12" rx="6" fill="${C1}" stroke-width="3"/>`,
  },
]

// ------------------------------------------------------------------ 输出

/**
 * 统一内缩系数。
 *
 * 图标是"陈列在底衬上的物体"，四周必须留出呼吸空间，否则宽扁的物体
 * （显示器、路由器、数据线）会顶到圆角边缘，看起来像被裁切。
 * 这里对整幅画面做一次以中心为原点的等比缩放：
 * 物体实际落在画布约 13%–87% 的区间，任何容器里都自然留白，
 * 且描边一并变细，小尺寸下更精致。
 */
const INSET = 0.86

function render(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" stroke-linecap="round" stroke-linejoin="round">
<g transform="translate(48 48) scale(${INSET}) translate(-48 -48)">
${SH}
<g stroke="${S}" stroke-width="3.2">
${body}
</g>
</g>
</svg>
`
}

const keys = new Set(ICONS.map((i) => i.key))
if (keys.size !== ICONS.length) {
  const dup = ICONS.map((i) => i.key).filter((k, i, a) => a.indexOf(k) !== i)
  throw new Error(`重复的图标 key：${dup.join(', ')}`)
}

mkdirSync(OUT_DIR, { recursive: true })

// 清理旧的物品图标，避免改名后残留孤儿文件
for (const file of readdirSync(OUT_DIR)) {
  if (file.endsWith('.svg')) rmSync(resolve(OUT_DIR, file))
}

for (const { key, body } of ICONS) {
  writeFileSync(resolve(OUT_DIR, `${key}.svg`), render(body), 'utf8')
}

console.log(`已生成 ${ICONS.length} 个物品图标 → ${OUT_DIR}`)
