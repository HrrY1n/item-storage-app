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
<rect x="29" y="10" width="38" height="76" rx="10" fill="${W}"/>
<rect x="34" y="17" width="28" height="55" rx="5" fill="${C1}"/>
<rect x="42" y="13" width="12" height="3" rx="1.5" fill="${S}" stroke="none"/>
<circle cx="48" cy="78" r="2.4" fill="${C2}" stroke="none"/>`,
  },
  {
    key: 'tablet',
    body: `
<rect x="17" y="12" width="62" height="72" rx="10" fill="${W}"/>
<rect x="24" y="19" width="48" height="54" rx="5" fill="${C1}"/>
<circle cx="48" cy="15.5" r="2" fill="${S}" stroke="none"/>
<circle cx="48" cy="78" r="2.6" fill="${C2}" stroke="none"/>`,
  },
  {
    key: 'laptop',
    body: `
<path d="M24 18h48a5 5 0 0 1 5 5v34H19V23a5 5 0 0 1 5-5z" fill="${W}"/>
<rect x="27" y="22" width="42" height="31" rx="3" fill="${C1}"/>
<path d="M18 57h60l7 12a3 3 0 0 1-2.7 4H13.7a3 3 0 0 1-2.7-4z" fill="${C2}"/>
<path d="M42 63h12" stroke="${M}" stroke-width="2.6"/>`,
  },
  {
    key: 'desktop',
    body: `
<rect x="25" y="13" width="46" height="70" rx="8" fill="${C2}"/>
<rect x="33" y="22" width="30" height="12" rx="3" fill="${C1}"/>
<path d="M34 44h28M34 51h28M34 58h28" stroke="${M}" stroke-width="2.8"/>
<rect x="35" y="65" width="17" height="6" rx="2" fill="${W}" stroke-width="2.6"/>
<circle cx="60" cy="69" r="3.5" fill="${C3}" stroke="none"/>`,
  },
  {
    key: 'monitor',
    body: `
<rect x="10" y="21" width="76" height="47" rx="7" fill="${W}"/>
<rect x="16" y="27" width="64" height="34" rx="4" fill="${C1}"/>
<path d="M22 33h18" stroke="${W}" stroke-width="2.6"/>
<path d="M48 68v10M34 80h28" stroke-width="3"/>`,
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
<circle cx="34" cy="27" r="9" fill="${C1}"/>
<path d="M34 36v19a6 6 0 0 1-6 6" stroke="${M}" stroke-width="4.5"/>
<circle cx="62" cy="27" r="9" fill="${C1}"/>
<path d="M62 36v19a6 6 0 0 0 6 6" stroke="${M}" stroke-width="4.5"/>
<circle cx="34" cy="27" r="2.2" fill="${W}" stroke="none"/>
<circle cx="62" cy="27" r="2.2" fill="${W}" stroke="none"/>`,
  },
  {
    key: 'headphones',
    body: `
<path d="M22 53V43a26 26 0 0 1 52 0v10" fill="none" stroke-width="5"/>
<rect x="11" y="48" width="20" height="32" rx="9" fill="${C1}"/>
<rect x="65" y="48" width="20" height="32" rx="9" fill="${C1}"/>
<rect x="16" y="55" width="10" height="18" rx="5" fill="${C2}" stroke="none"/>
<rect x="70" y="55" width="10" height="18" rx="5" fill="${C2}" stroke="none"/>`,
  },
  {
    key: 'speaker',
    body: `
<rect x="24" y="13" width="48" height="71" rx="9" fill="${C2}"/>
<circle cx="48" cy="35" r="12" fill="${C1}"/>
<circle cx="48" cy="35" r="5" fill="${W}" stroke-width="2.6"/>
<circle cx="48" cy="62" r="9" fill="${C3}"/>
<circle cx="48" cy="62" r="3" fill="${W}" stroke="none"/>
<path d="M39 75h18" stroke="${M}" stroke-width="2.6"/>`,
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
<path d="M17 29h62a7 7 0 0 1 7 7v32a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7V36a7 7 0 0 1 7-7z" fill="${C2}"/>
<path d="M23 35h50a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V39a4 4 0 0 1 4-4z" fill="${W}" stroke="none"/>
<rect x="27" y="44" width="42" height="6" rx="3" fill="${C1}"/>
<circle cx="31" cy="59" r="3" fill="${C4}" stroke="none"/>
<circle cx="39" cy="59" r="3" fill="${C3}" stroke="none"/>`,
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
<path d="M14 34h68l-5 28a8 8 0 0 1-8 6H27a8 8 0 0 1-8-6z" fill="${C1}"/>
<path d="M26 46h44" stroke="${W}" stroke-width="3"/>`,
  },
  {
    key: 'charger',
    body: `
<path d="M40 22V9M56 22V9" stroke-width="3.5"/>
<rect x="27" y="21" width="42" height="50" rx="9" fill="${C2}"/>
<circle cx="48" cy="30" r="2" fill="${C3}" stroke="none"/>
<rect x="38" y="41" width="20" height="14" rx="3" fill="${C1}"/>
<path d="M37 63h22" stroke="${M}" stroke-width="2.6"/>`,
  },
  {
    key: 'powerbank',
    body: `
<path d="M18 29h60a10 10 0 0 1 10 10v18a10 10 0 0 1-10 10H18A10 10 0 0 1 8 57V39a10 10 0 0 1 10-10z" fill="${C2}"/>
<rect x="25" y="40" width="29" height="11" rx="5.5" fill="${W}"/>
<path d="M31 45h3M38 45h3M45 45h3" stroke="${G}" stroke-width="3"/>
<rect x="67" y="41" width="10" height="11" rx="3" fill="${W}"/>
<rect x="70" y="44" width="4" height="5" rx="1.5" fill="${C1}" stroke="none"/>`,
  },
  {
    key: 'cable',
    body: `
<rect x="10" y="20" width="16" height="14" rx="4" fill="${C1}"/>
<rect x="70" y="20" width="16" height="14" rx="4" fill="${C2}"/>
<path d="M18 34v10c0 20 11 31 30 31s30-11 30-31V34" fill="none" stroke-width="4.5"/>`,
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
<rect x="7" y="20" width="82" height="49" rx="7" fill="${C2}"/>
<rect x="13" y="26" width="70" height="35" rx="4" fill="${C1}"/>
<path d="M25 69l-7 10M71 69l7 10" stroke-width="3"/>
<path d="M22 80h8M66 80h8" stroke="${C2}" stroke-width="3"/>`,
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
<circle cx="48" cy="48" r="27" fill="${C4}"/>
<circle cx="48" cy="48" r="17" fill="${W}" stroke-width="3"/>
<path d="M48 37l3.4 7 7.6 1-5.5 5.3 1.4 7.6-6.9-3.7-6.9 3.7 1.4-7.6-5.5-5.3 7.6-1z" fill="${R}" stroke-width="2.2"/>`,
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

  // ============================================================ Phase 2G 新增：数码及配件
  { key: 'stylus', label: '触控笔', body: `
<path d="M30 64 56 38a6 6 0 0 1 8 0l4 4a6 6 0 0 1 0 8L42 76H30z" fill="${W}"/>
<path d="M56 38l6-6 8 8-6 6z" fill="${C1}"/>
<rect x="24" y="74" width="16" height="4" rx="2" fill="${C2}"/>` },
  { key: 'phonecase', label: '手机壳', body: `
<rect x="30" y="10" width="36" height="76" rx="10" fill="${C1}"/>
<rect x="36" y="16" width="14" height="14" rx="4" fill="${W}" stroke-width="2.6"/>
<circle cx="41" cy="21" r="2.4" fill="${S}" stroke="none"/>
<circle cx="47" cy="27" r="1.6" fill="${S}" stroke="none"/>` },
  { key: 'tabletcase', label: '平板保护壳', body: `
<rect x="18" y="14" width="60" height="68" rx="9" fill="${C1}"/>
<path d="M38 14v68M58 14v68" stroke="${W}" stroke-width="3"/>
<rect x="66" y="38" width="6" height="20" rx="3" fill="${W}" stroke-width="2.6"/>` },
  { key: 'earbudcase', label: '耳机盒', body: `
<rect x="27" y="24" width="42" height="18" rx="9" fill="${C1}"/>
<path d="M22 36h52v24a14 14 0 0 1-14 14H36a14 14 0 0 1-14-14z" fill="${W}"/>
<path d="M23 42h50" stroke-width="3"/>
<circle cx="48" cy="59" r="3" fill="${C3}" stroke="none"/>` },
  { key: 'dock', label: '充电底座', body: `
<rect x="34" y="16" width="28" height="40" rx="6" fill="${C1}"/>
<path d="M28 54h40l7 13a4 4 0 0 1-3.6 5.6H24.6A4 4 0 0 1 21 67z" fill="${C2}"/>
<rect x="43" y="49" width="10" height="5" rx="2" fill="${W}" stroke="none"/>
<path d="M36 65h24" stroke="${M}" stroke-width="2.6"/>` },
  { key: 'wirelesscharger', label: '无线充', body: `
<circle cx="48" cy="48" r="28" fill="${W}"/>
<circle cx="48" cy="48" r="20" fill="none" stroke="${C1}" stroke-width="3"/>
<circle cx="48" cy="48" r="10" fill="${C1}" stroke-width="2.6"/>
<path d="M40 46a10 10 0 0 1 16 0" stroke-width="3"/>` },
  { key: 'usbhub', label: 'USB 集线器', body: `
<rect x="16" y="38" width="64" height="28" rx="7" fill="${C2}"/>
<g fill="${W}" stroke-width="2.6">
<rect x="24" y="46" width="12" height="6" rx="2"/>
<rect x="42" y="46" width="12" height="6" rx="2"/>
<rect x="60" y="46" width="12" height="6" rx="2"/>
</g>` },
  { key: 'hdmiadapter', label: 'HDMI 转接器', body: `
<rect x="14" y="34" width="40" height="32" rx="7" fill="${C2}"/>
<rect x="22" y="44" width="24" height="12" rx="2" fill="${W}" stroke-width="2.6"/>
<path d="M54 50h14a10 10 0 0 1 10 10v6" fill="none"/>
<rect x="70" y="60" width="16" height="12" rx="3" fill="${C1}"/>` },
  { key: 'netcable', label: '网线', body: `
<rect x="10" y="42" width="18" height="14" rx="3" fill="${C2}"/>
<rect x="68" y="42" width="18" height="14" rx="3" fill="${C2}"/>
<path d="M28 49h10a6 6 0 0 0 6-6v-4a6 6 0 0 1 6-6h6a6 6 0 0 1 6 6v4a6 6 0 0 0 6 6h2" fill="none"/>
<path d="M32 45v8M38 45v8" stroke="${M}" stroke-width="2.6"/>` },
  { key: 'netswitch', label: '交换机', body: `
<rect x="10" y="32" width="76" height="32" rx="7" fill="${C2}"/>
<g fill="${W}" stroke-width="2.6">
<rect x="18" y="42" width="10" height="10" rx="2"/>
<rect x="34" y="42" width="10" height="10" rx="2"/>
<rect x="50" y="42" width="10" height="10" rx="2"/>
<rect x="66" y="42" width="10" height="10" rx="2"/>
</g>
<circle cx="24" cy="58" r="2" fill="${G}" stroke="none"/>
<circle cx="36" cy="58" r="2" fill="${M}" stroke="none"/>` },
  { key: 'nas', label: 'NAS', body: `
<rect x="18" y="12" width="60" height="26" rx="6" fill="${C2}"/>
<rect x="18" y="46" width="60" height="26" rx="6" fill="${C2}"/>
<circle cx="30" cy="25" r="4" fill="${C1}" stroke-width="2.6"/>
<circle cx="30" cy="59" r="4" fill="${C1}" stroke-width="2.6"/>
<path d="M42 22h26M42 56h26" stroke="${M}" stroke-width="3"/>
<circle cx="68" cy="25" r="2.4" fill="${G}" stroke="none"/>
<circle cx="68" cy="59" r="2.4" fill="${M}" stroke="none"/>` },
  { key: 'hdddock', label: '硬盘盒', body: `
<rect x="30" y="14" width="36" height="34" rx="5" fill="${W}"/>
<path d="M36 22h24M36 30h24" stroke="${M}" stroke-width="3"/>
<rect x="18" y="46" width="60" height="34" rx="8" fill="${C2}"/>
<circle cx="66" cy="63" r="3.4" fill="${C1}" stroke-width="2.6"/>
<path d="M28 63h24" stroke="${M}" stroke-width="3"/>` },
  { key: 'cfreader', label: '读卡器', body: `
<path d="M38 12h14l6 6v20H38z" fill="${C1}"/>
<rect x="22" y="38" width="52" height="40" rx="9" fill="${W}"/>
<path d="M32 38h32" stroke-width="3.4"/>
<path d="M42 58h12" stroke="${M}" stroke-width="3"/>
<circle cx="64" cy="58" r="2.6" fill="${G}" stroke="none"/>` },
  { key: 'mousepad', label: '鼠标垫', body: `
<rect x="10" y="28" width="76" height="42" rx="9" fill="${C3}"/>
<rect x="17" y="35" width="62" height="28" rx="5" fill="none" stroke="${W}" stroke-width="2.6" stroke-dasharray="5 5"/>` },
  { key: 'wristrest', label: '键盘腕托', body: `
<path d="M18 40h60a8 8 0 0 1 8 8v8a12 12 0 0 1-12 12H22a12 12 0 0 1-12-12v-8a8 8 0 0 1 8-8z" fill="${C3}"/>
<path d="M22 50h52" stroke="${W}" stroke-width="3"/>` },
  { key: 'webcam', label: '摄像头', body: `
<rect x="16" y="26" width="64" height="28" rx="14" fill="${C2}"/>
<circle cx="48" cy="40" r="10" fill="${C1}"/>
<circle cx="48" cy="40" r="4" fill="${W}" stroke-width="2.6"/>
<circle cx="27" cy="40" r="2.2" fill="${S}" stroke="none"/>
<path d="M40 54v8a6 6 0 0 0 6 6h4a6 6 0 0 0 6-6v-8z" fill="${W}"/>
<path d="M34 74h28" stroke-width="3"/>` },
  { key: 'lightring', label: '环形灯', body: `
<circle cx="48" cy="36" r="25" fill="${C1}"/>
<circle cx="48" cy="36" r="14" fill="${W}" stroke-width="3"/>
<path d="M48 61v12M40 73h16" stroke-width="3"/>
<rect x="36" y="76" width="24" height="7" rx="3.5" fill="${C2}"/>` },
  { key: 'recorder', label: '录音笔', body: `
<rect x="34" y="10" width="28" height="70" rx="9" fill="${C2}"/>
<circle cx="48" cy="32" r="8" fill="${C1}"/>
<path d="M38 52h20M38 62h20" stroke="${M}" stroke-width="3"/>
<circle cx="48" cy="72" r="3" fill="${S}" stroke="none"/>` },
  { key: 'projector', label: '投影仪', body: `
<rect x="14" y="30" width="70" height="40" rx="9" fill="${W}"/>
<circle cx="36" cy="50" r="12" fill="${C1}"/>
<circle cx="36" cy="50" r="5" fill="${W}" stroke-width="2.6"/>
<circle cx="66" cy="44" r="4" fill="${M}" stroke-width="2.6"/>
<circle cx="66" cy="58" r="4" fill="${M}" stroke-width="2.6"/>
<path d="M16 40H8M16 60H8" stroke-width="3"/>` },
  { key: 'remote', label: '遥控器', body: `
<rect x="30" y="8" width="36" height="80" rx="11" fill="${C2}"/>
<circle cx="48" cy="26" r="6" fill="${C1}" stroke-width="2.6"/>
<g fill="${W}" stroke-width="2.4">
<rect x="38" y="42" width="8" height="8" rx="2.5"/>
<rect x="50" y="42" width="8" height="8" rx="2.5"/>
<rect x="38" y="54" width="8" height="8" rx="2.5"/>
<rect x="50" y="54" width="8" height="8" rx="2.5"/>
</g>
<rect x="42" y="70" width="12" height="5" rx="2.5" fill="${M}" stroke="none"/>` },
  { key: 'handheld', label: '游戏掌机', body: `
<rect x="14" y="24" width="68" height="48" rx="14" fill="${W}"/>
<rect x="32" y="32" width="32" height="32" rx="4" fill="${C1}" stroke-width="3"/>
<circle cx="25" cy="42" r="4" fill="${C2}" stroke-width="2.6"/>
<circle cx="23" cy="56" r="4" fill="${C2}" stroke-width="2.6"/>
<circle cx="72" cy="48" r="5" fill="${C4}" stroke-width="2.6"/>` },
  { key: 'vrmask', label: 'VR 设备', body: `
<rect x="10" y="26" width="76" height="44" rx="16" fill="${W}"/>
<ellipse cx="32" cy="48" rx="13" ry="12" fill="${C1}"/>
<ellipse cx="64" cy="48" rx="13" ry="12" fill="${C1}"/>
<path d="M45 48h6" stroke-width="3"/>
<path d="M24 30l-6-8M72 30l6-8" stroke-width="3"/>` },
  { key: 'battery', label: '充电电池', body: `
<rect x="22" y="26" width="20" height="54" rx="7" fill="${C2}"/>
<rect x="28" y="17" width="8" height="9" rx="2.5" fill="${C2}"/>
<rect x="54" y="26" width="20" height="54" rx="7" fill="${C1}"/>
<rect x="60" y="17" width="8" height="9" rx="2.5" fill="${C1}"/>
<path d="M28 45h8M60 45h8" stroke-width="2.8"/>
<path d="M47 39l-5 14h7l-3 12 10-16h-7l4-10z" fill="${R}" stroke-width="2.2"/>` },
  { key: 'powerstrip', label: '插线板', body: `
<rect x="8" y="30" width="80" height="36" rx="8" fill="${C2}"/>
<g fill="${W}" stroke-width="2.4">
<rect x="15" y="38" width="17" height="18" rx="5"/>
<rect x="39" y="38" width="17" height="18" rx="5"/>
<rect x="63" y="38" width="17" height="18" rx="5"/>
</g>
<g stroke="${M}" stroke-width="2.4">
<path d="M20 44v6M27 44v6M44 44v6M51 44v6M68 44v6M75 44v6"/>
</g>
<circle cx="48" cy="73" r="3" fill="${C3}" stroke="none"/>` },
  { key: 'cableorganizer', label: '理线器', body: `
<path d="M14 39h68v26a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8z" fill="${C3}"/>
<path d="M25 64V48a6 6 0 0 1 12 0v16" fill="none" stroke="${W}" stroke-width="6"/>
<path d="M53 64V48a6 6 0 0 1 12 0v16" fill="none" stroke="${W}" stroke-width="6"/>
<path d="M31 48V29M59 48V25" stroke="${C1}" stroke-width="4.5"/>
<path d="M31 29h7M59 25h7" stroke="${C4}" stroke-width="4.5"/>` },
  { key: 'screenprotector', label: '屏幕保护膜', body: `
<path d="M28 10h40a4 4 0 0 1 4 4v68a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z" fill="${C1}"/>
<path d="M72 74 56 86h16z" fill="${W}" stroke-width="2.6"/>
<path d="M36 32l12-12M40 44l18-18" stroke="${W}" stroke-width="3"/>` },
  { key: 'labelprinter', label: '标签打印机', body: `
<rect x="12" y="24" width="72" height="44" rx="10" fill="${W}"/>
<rect x="22" y="34" width="52" height="18" rx="4" fill="${C2}" stroke-width="2.6"/>
<path d="M30 60h36" stroke-width="3"/>
<path d="M22 68l6 14h40l6-14" fill="${C1}"/>
<circle cx="72" cy="34" r="3" fill="${G}" stroke="none"/>` },

  // ============================================================ Phase 2G 新增：个人护理
  { key: 'electrictoothbrush', label: '电动牙刷', body: `
<rect x="40" y="8" width="16" height="18" rx="6" fill="${C2}"/>
<path d="M44 13h8M44 18h8" stroke-width="2.4"/>
<rect x="42" y="26" width="12" height="20" rx="4" fill="${W}"/>
<path d="M38 46h20l-2 30a8 8 0 0 1-16 0z" fill="${C1}"/>
<circle cx="48" cy="60" r="3.4" fill="${W}" stroke-width="2.6"/>` },
  { key: 'toothbrush', label: '牙刷', body: `
<rect x="40" y="20" width="16" height="56" rx="8" fill="${C1}"/>
<rect x="42" y="10" width="12" height="12" rx="4" fill="${W}"/>
<path d="M43 14h10M43 18h10" stroke-width="2.4"/>
<path d="M44 84h8" stroke="${M}" stroke-width="3"/>` },
  { key: 'shaver', label: '剃须刀', body: `
<path d="M30 14h36a8 8 0 0 1 8 8v11a8 8 0 0 1-8 8H30a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill="${C2}"/>
<rect x="27" y="19" width="42" height="12" rx="5" fill="${W}"/>
<path d="M35 22v6M43 22v6M51 22v6M59 22v6" stroke="${M}" stroke-width="2.4"/>
<path d="M37 41h22v34a9 9 0 0 1-9 9h-4a9 9 0 0 1-9-9z" fill="${C1}"/>
<circle cx="48" cy="60" r="3" fill="${W}" stroke="none"/>` },
  { key: 'trimmer', label: '理发器', body: `
<path d="M34 39h28a8 8 0 0 1 8 8v19a12 12 0 0 1-12 12H38a12 12 0 0 1-12-12V47a8 8 0 0 1 8-8z" fill="${C2}"/>
<path d="M28 29h40v10H28z" fill="${C1}"/>
<path d="M33 23h30v6H33z" fill="${W}"/>
<path d="M35 23v6M42 21v8M49 21v8M56 21v8M63 23v6" stroke-width="2.6"/>
<circle cx="48" cy="56" r="3" fill="${W}" stroke="none"/>` },
  { key: 'curlingiron', label: '卷发棒', body: `
<g transform="rotate(-20 48 48)">
<rect x="32" y="9" width="26" height="54" rx="13" fill="${C1}"/>
<path d="M32 24h26" stroke="${W}" stroke-width="3"/>
<path d="M28 18h11v27a7 7 0 0 0 7 7" fill="none" stroke="${C2}" stroke-width="5"/>
<rect x="36" y="59" width="20" height="29" rx="8" fill="${C2}"/>
<path d="M39 69h14" stroke="${M}" stroke-width="2.4"/>
</g>` },
  { key: 'skincare', label: '护肤品', body: `
<path d="M43 12h10v10h-10z" fill="${C2}"/>
<path d="M43 16h-9" stroke-width="3"/>
<path d="M44 22h8v8h-8z" fill="${C2}"/>
<rect x="32" y="30" width="32" height="52" rx="9" fill="${C4}"/>
<path d="M48 50c4.4 5 6.6 7.6 6.6 10.6a6.6 6.6 0 0 1-13.2 0c0-3 2.2-5.6 6.6-10.6z" fill="${W}" stroke-width="2.6"/>` },
  { key: 'perfume', label: '香水', body: `
<rect x="34" y="36" width="28" height="46" rx="8" fill="${C4}"/>
<rect x="42" y="22" width="12" height="16" rx="4" fill="${C2}"/>
<rect x="38" y="12" width="20" height="12" rx="4" fill="${C2}"/>
<circle cx="48" cy="58" r="8" fill="${W}" stroke-width="2.6"/>` },
  { key: 'comb', label: '梳子', body: `
<rect x="14" y="34" width="68" height="20" rx="8" fill="${C2}"/>
<g stroke-width="2.6"><path d="M24 54v16M32 54v18M40 54v16M48 54v18M56 54v16M64 54v18M72 54v16"/></g>` },
  { key: 'nailclipper', label: '指甲剪', body: `
<g transform="rotate(-22 48 52)">
<path d="M16 46 L58 40a10 10 0 0 1 10 10v4a10 10 0 0 1-10 10H22z" fill="${C2}"/>
<path d="M16 46l-6-3M16 50l-7 1M16 54l-6 4" stroke-width="2.6"/>
<rect x="26" y="22" width="28" height="7" rx="3.5" fill="${C1}" transform="rotate(-16 26 29)"/>
<circle cx="27" cy="50" r="3.6" fill="${W}" stroke-width="2.6"/>
</g>` },
  { key: 'scale', label: '体重秤', body: `
<rect x="18" y="16" width="60" height="64" rx="12" fill="${W}"/>
<rect x="28" y="28" width="40" height="24" rx="5" fill="${C1}" stroke-width="2.6"/>
<path d="M36 40h8M50 40h8" stroke="${W}" stroke-width="3"/>
<circle cx="34" cy="64" r="4" fill="${M}" stroke="none"/>
<circle cx="62" cy="64" r="4" fill="${M}" stroke="none"/>` },

  // ============================================================ Phase 2G 新增：厨房
  { key: 'pot', label: '锅', body: `
<path d="M20 38h48v20a20 20 0 0 1-20 20H40a20 20 0 0 1-20-20z" fill="${C2}"/>
<rect x="16" y="30" width="56" height="10" rx="5" fill="${C1}"/>
<path d="M68 44h10a8 8 0 0 1 0 16h-4" fill="none" stroke-width="3"/>
<path d="M36 18v10M48 16v12M60 18v10" stroke="${M}" stroke-width="3"/>` },
  { key: 'pan', label: '平底锅', body: `
<path d="M18 44h44v6a22 22 0 0 1-22 22 22 22 0 0 1-22-22z" fill="${C2}"/>
<path d="M62 48h18a4 4 0 0 1 0 8H62z" fill="${C1}"/>
<path d="M14 40h52" stroke-width="3"/>` },
  { key: 'knife', label: '刀具', body: `
<path d="M20 62 58 24a10 10 0 0 1 14 0l2 2a10 10 0 0 1 0 14L36 78z" fill="${W}"/>
<path d="M58 24l10-8 14 14-10 8z" fill="${C1}"/>
<path d="M20 62l-6 10 12-2z" fill="${C2}"/>` },
  { key: 'cuttingboard', label: '菜板', body: `
<rect x="14" y="24" width="68" height="52" rx="10" fill="${C2}"/>
<circle cx="48" cy="50" r="16" fill="none" stroke="${M}" stroke-width="3"/>
<path d="M30 34h12M54 66h12" stroke="${M}" stroke-width="3"/>` },
  { key: 'bowl', label: '碗', body: `
<path d="M18 42h60c0 20-12 34-30 34S18 62 18 42z" fill="${C1}"/>
<path d="M14 42h68" stroke-width="3"/>
<ellipse cx="48" cy="42" rx="34" ry="7" fill="${W}" stroke-width="2.6"/>
<path d="M30 52c4 6 10 9 18 9" stroke="${W}" stroke-width="3"/>` },
  { key: 'cup', label: '杯子', body: `
<path d="M26 26h40v42a16 16 0 0 1-16 16H42a16 16 0 0 1-16-16z" fill="${C1}"/>
<path d="M66 36h6a10 10 0 0 1 0 20h-6" fill="none" stroke-width="3"/>
<path d="M26 40h40" stroke="${W}" stroke-width="3"/>` },
  { key: 'kettle', label: '水壶', body: `
<path d="M28 40h34a8 8 0 0 1 8 8v18a12 12 0 0 1-12 12H32a12 12 0 0 1-12-12V48a8 8 0 0 1 8-8z" fill="${C2}"/>
<path d="M70 48h6a8 8 0 0 1 0 16h-6" fill="none" stroke-width="3"/>
<rect x="36" y="28" width="18" height="12" rx="5" fill="${C2}"/>
<path d="M34 24h22" stroke-width="3"/>` },
  { key: 'airfryer', label: '空气炸锅', body: `
<rect x="24" y="16" width="48" height="64" rx="10" fill="${W}"/>
<rect x="32" y="26" width="32" height="18" rx="4" fill="${C1}" stroke-width="2.6"/>
<circle cx="48" cy="60" r="12" fill="${C2}"/>
<circle cx="48" cy="60" r="5" fill="${W}" stroke-width="2.6"/>
<circle cx="64" cy="24" r="3" fill="${S}" stroke="none"/>` },
  { key: 'microwave', label: '微波炉', body: `
<rect x="10" y="28" width="76" height="44" rx="8" fill="${C2}"/>
<rect x="18" y="36" width="44" height="28" rx="5" fill="${C1}" stroke-width="2.6"/>
<rect x="68" y="38" width="10" height="24" rx="4" fill="${W}" stroke-width="2.6"/>
<circle cx="78" cy="44" r="2.4" fill="${S}" stroke="none"/>
<circle cx="78" cy="56" r="2.4" fill="${S}" stroke="none"/>` },
  { key: 'oven', label: '烤箱', body: `
<rect x="10" y="18" width="76" height="62" rx="8" fill="${W}"/>
<rect x="20" y="32" width="56" height="34" rx="6" fill="${C2}" stroke-width="2.6"/>
<rect x="28" y="40" width="40" height="18" rx="3" fill="${C1}" stroke-width="2.6"/>
<g fill="${M}" stroke="none"><circle cx="24" cy="26" r="3"/><circle cx="36" cy="26" r="3"/><circle cx="48" cy="26" r="3"/></g>` },
  { key: 'juicer', label: '榨汁机', body: `
<rect x="39" y="8" width="18" height="12" rx="4" fill="${C2}"/>
<path d="M31 20h34l-3 16H34z" fill="${W}"/>
<path d="M29 36h38l-7 18H36z" fill="${C3}"/>
<path d="M58 45h12a5 5 0 0 1 5 5v4H59z" fill="${C2}"/>
<rect x="37" y="54" width="22" height="26" rx="6" fill="${C1}"/>
<path d="M41 65h14" stroke="${W}" stroke-width="2.8"/>` },
  { key: 'blender', label: '破壁机', body: `
<rect x="28" y="8" width="40" height="10" rx="5" fill="${C2}"/>
<path d="M29 18h38l-3 31a16 16 0 0 1-32 0z" fill="${C1}"/>
<path d="M67 27h5a8 8 0 0 1 0 16h-7" fill="none" stroke-width="3.2"/>
<path d="M36 42h24" stroke="${W}" stroke-width="2.8"/>
<rect x="30" y="54" width="36" height="26" rx="7" fill="${C2}"/>
<circle cx="48" cy="69" r="6" fill="${W}" stroke-width="2.6"/>` },
  { key: 'wineglass', label: '酒杯', body: `
<path d="M30 10h36c0 18-8 28-18 28S30 28 30 10z" fill="${W}"/>
<path d="M33 14h30c-1 14-7 21-15 21s-14-7-15-21z" fill="${C4}" stroke="none"/>
<path d="M48 38v32M34 76h28" stroke-width="3"/>` },
  { key: 'chopsticks', label: '筷子', body: `
<path d="M28 82 52 20" stroke-width="4"/>
<path d="M40 84 64 22" stroke-width="4"/>
<path d="M28 82l-2 4M40 84l-2 4" stroke-width="3"/>` },

  // ============================================================ Phase 2G 新增：服饰
  { key: 'shirt', label: '衬衫', body: `
<path d="M38 24l-14 6-6 14 9 5 4-5v30h34V44l4 5 9-5-6-14-14-6c0 5-4.5 9-10 9s-10-4-10-9z" fill="${W}"/>
<path d="M40 24h16l-8 12z" fill="${C1}"/>
<path d="M48 36v34" stroke-width="2.6"/>
<g fill="${M}" stroke="none"><circle cx="48" cy="46" r="2"/><circle cx="48" cy="56" r="2"/><circle cx="48" cy="66" r="2"/></g>` },
  { key: 'hoodie', label: '卫衣', body: `
<path d="M38 26l-14 6-6 14 9 5 4-5v28h34V46l4 5 9-5-6-14-14-6z" fill="${C3}"/>
<path d="M36 24a12 12 0 0 0 24 0" fill="none" stroke-width="3"/>
<path d="M40 30v12M56 30v12" stroke-width="2.6"/>
<rect x="36" y="54" width="24" height="14" rx="4" fill="${W}" stroke-width="2.6"/>` },
  { key: 'downjacket', label: '羽绒服', body: `
<path d="M38 24l-14 6-6 14 9 5 4-5v32h34V44l4 5 9-5-6-14-14-6z" fill="${C1}"/>
<path d="M27 46h42M27 58h42M27 70h42" stroke="${W}" stroke-width="3"/>
<path d="M48 24v52" stroke="${W}" stroke-width="2.6"/>` },
  { key: 'shorts', label: '短裤', body: `
<path d="M30 22h36v14l-4 36H50l-2-32-2 32H34l-4-36z" fill="${C4}"/>
<path d="M30 36h36" stroke-width="3"/>
<path d="M44 22v8h8v-8" fill="${C2}" stroke-width="2.6"/>` },
  { key: 'slippers', label: '拖鞋', body: `
<path d="M12 62c0-8 6-12 14-12h10l8 10c4 5 2 12-4 12H16a4 4 0 0 1-4-4z" fill="${C3}"/>
<path d="M84 62c0-8-6-12-14-12H60l-8 10c-4 5-2 12 4 12h24a4 4 0 0 0 4-4z" fill="${C3}"/>
<path d="M12 68h72" stroke-width="3"/>` },
  { key: 'belt', label: '腰带', body: `
<rect x="10" y="40" width="56" height="16" rx="4" fill="${C2}"/>
<rect x="62" y="32" width="24" height="32" rx="6" fill="${C1}"/>
<rect x="69" y="44" width="10" height="8" rx="2" fill="${W}" stroke-width="2.6"/>` },
  { key: 'gloves', label: '手套', body: `
<path d="M28 78V44a5 5 0 0 1 10 0V32a5 5 0 0 1 10 0V26a5 5 0 0 1 10 0v6a5 5 0 0 1 10 0v20a10 10 0 0 1-10 10H38a10 10 0 0 1-10-10z" fill="${C4}"/>
<path d="M38 52h30" stroke="${M}" stroke-width="3"/>` },
  { key: 'scarf', label: '围巾', body: `
<path d="M28 16a20 20 0 0 1 40 0v10a20 20 0 0 1-40 0z" fill="${C4}"/>
<path d="M34 36h28v36a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6z" fill="${C4}"/>
<path d="M40 48h16M40 60h16" stroke="${M}" stroke-width="3"/>` },

  // ============================================================ Phase 2G 新增：办公
  { key: 'ruler', label: '尺子', body: `
<g transform="rotate(-20 48 50)">
<rect x="8" y="38" width="80" height="24" rx="4" fill="${C2}"/>
<path d="M22 44v8M32 40v8M42 44v8M52 40v8M62 44v8M72 40v8" stroke-width="2.6"/>
</g>` },
  { key: 'deskorg', label: '桌面收纳', body: `
<rect x="12" y="50" width="72" height="28" rx="5" fill="${C2}"/>
<path d="M12 50V26a4 4 0 0 1 4-4h64a4 4 0 0 1 4 4v24" fill="${W}"/>
<path d="M30 50V38M48 50V34M66 50V38" stroke-width="3"/>
<rect x="26" y="20" width="10" height="10" rx="2" fill="${C1}" stroke-width="2.4"/>
<rect x="44" y="16" width="10" height="10" rx="2" fill="${C1}" stroke-width="2.4"/>` },

  // ============================================================ Phase 2G 新增：运动 / 兴趣
  { key: 'dumbbell', label: '哑铃', body: `
<rect x="20" y="38" width="56" height="20" rx="6" fill="${C2}"/>
<rect x="8" y="26" width="16" height="44" rx="5" fill="${C1}"/>
<rect x="72" y="26" width="16" height="44" rx="5" fill="${C1}"/>
<path d="M30 48h36" stroke="${M}" stroke-width="3"/>` },
  { key: 'yogamat', label: '瑜伽垫', body: `
<circle cx="29" cy="55" r="17" fill="${C3}"/>
<circle cx="29" cy="55" r="7.5" fill="none" stroke-width="3"/>
<path d="M29 72h37v-9a7 7 0 0 1 7-7h3a6 6 0 0 1 6 6v13a8 8 0 0 1-8 8H29z" fill="${C3}"/>
<path d="M52 72v7" stroke="${M}" stroke-width="3" stroke-dasharray="3 4"/>` },
  { key: 'basketball', label: '篮球', body: `
<circle cx="48" cy="48" r="30" fill="${C2}"/>
<path d="M48 18v60M18 48h60" stroke-width="2.8"/>
<path d="M30 22a34 34 0 0 0 0 52M66 22a34 34 0 0 1 0 52" fill="none" stroke-width="2.8"/>` },
  { key: 'football', label: '足球', body: `
<circle cx="48" cy="48" r="30" fill="${W}"/>
<path d="M48 34l12 9-5 15H41l-5-15z" fill="${C1}"/>
<path d="M48 18v16M48 58v14M22 40l16 6M74 40l-16 6M30 70l8-12M66 70l-8-12" stroke-width="2.6"/>` },
  { key: 'badminton', label: '羽毛球拍', body: `
<ellipse cx="40" cy="32" rx="20" ry="26" fill="${W}"/>
<path d="M28 20a24 24 0 0 0 24 24M28 32h24M40 10v44" stroke="${C1}" stroke-width="2.4" fill="none"/>
<path d="M52 52l8 8-28 28-8-8z" fill="${C2}"/>
<path d="M24 82l-6 6 8-2z" fill="${S}"/>` },
  { key: 'pingpong', label: '乒乓球拍', body: `
<circle cx="40" cy="34" r="22" fill="${C4}"/>
<circle cx="40" cy="34" r="17" fill="${W}" stroke-width="2.6"/>
<path d="M50 50l10 10-22 22-10-10z" fill="${C2}"/>
<path d="M28 72l-6 6 8-2z" fill="${S}"/>` },
  { key: 'bicycle', label: '自行车', body: `
<circle cx="26" cy="62" r="18" fill="none" stroke-width="3.4"/>
<circle cx="70" cy="62" r="18" fill="none" stroke-width="3.4"/>
<path d="M26 62 44 34h18l8 28M44 34l-6 28h24" fill="none" stroke-width="3"/>
<path d="M62 30h10" stroke-width="3"/>` },
  { key: 'helmet', label: '头盔', body: `
<path d="M14 58a34 34 0 0 1 68 0v4H14z" fill="${C1}"/>
<path d="M14 62h68" stroke-width="3"/>
<path d="M34 32a20 20 0 0 1 28 0" fill="none" stroke="${W}" stroke-width="3"/>
<rect x="40" y="66" width="16" height="8" rx="4" fill="${C2}"/>` },
  { key: 'camplight', label: '露营灯', body: `
<path d="M34 20h28l6 12v34a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6V32z" fill="${C2}"/>
<rect x="38" y="32" width="20" height="26" rx="5" fill="${C1}"/>
<circle cx="48" cy="45" r="7" fill="${W}" stroke-width="2.6"/>
<path d="M38 20a10 10 0 0 1 20 0" fill="none" stroke-width="3"/>
<path d="M28 78h40" stroke-width="3"/>` },
  { key: 'tent', label: '帐篷', body: `
<path d="M48 16 12 76h72z" fill="${C3}"/>
<path d="M48 16 34 76M48 16l14 60" stroke-width="3"/>
<path d="M48 44v32" stroke="${M}" stroke-width="3"/>
<path d="M6 76h84" stroke-width="3.4"/>` },
  { key: 'tripod', label: '三脚架', body: `
<rect x="37" y="10" width="22" height="14" rx="5" fill="${C2}"/>
<circle cx="48" cy="29" r="7" fill="${C1}"/>
<path d="M48 36v16M48 52 22 84M48 52l26 32M48 52v32" stroke="${M}" stroke-width="4"/>
<path d="M18 84h8M44 84h8M70 84h8" stroke="${M}" stroke-width="3"/>` },
  { key: 'fishingrod', label: '钓鱼竿', body: `
<path d="M24 82 L76 16" stroke-width="3.2"/>
<path d="M24 82 L40 58" stroke-width="5.5"/>
<circle cx="44" cy="62" r="7" fill="${C1}" stroke-width="3"/>
<circle cx="52" cy="66" r="2.2" fill="${S}" stroke="none"/>
<path d="M76 16c8 4 8 14 8 22v12" fill="none" stroke="${M}" stroke-width="2.2"/>
<path d="M84 50v6a5 5 0 0 1-10 0" fill="none" stroke-width="2.6"/>` },
  { key: 'skateboard', label: '滑板', body: `
<path d="M12 44h72a4 4 0 0 1 4 4v6a10 10 0 0 1-10 10H18a10 10 0 0 1-10-10v-6a4 4 0 0 1 4-4z" fill="${C4}"/>
<path d="M26 64v6M70 64v6" stroke-width="3.4"/>
<circle cx="26" cy="74" r="4" fill="${C2}"/>
<circle cx="70" cy="74" r="4" fill="${C2}"/>
<path d="M34 50h28" stroke="${W}" stroke-width="3"/>` },

  // ============================================================ Phase 2G 新增：工具与生活
  { key: 'screwdriver', label: '螺丝刀', body: `
<path d="M28 76h16V44H28z" fill="${C2}"/>
<rect x="26" y="34" width="20" height="14" rx="4" fill="${C1}"/>
<path d="M36 34V12l10 8-10 8" fill="${W}"/>
<path d="M28 58h16" stroke="${M}" stroke-width="3"/>` },
  { key: 'wrench', label: '扳手', body: `
<path d="M70 18a18 18 0 0 0-24 4l-8 8 10 10 8-8a18 18 0 0 0 22-10l-12 6-6-6z" fill="${C2}"/>
<circle cx="38" cy="66" r="7" fill="${W}"/>
<path d="M32 72 16 88" stroke-width="3"/>` },
  { key: 'flashlight', label: '手电筒', body: `
<path d="M34 34h28v34H34z" fill="${C2}"/>
<path d="M62 40h10a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H62z" fill="${C1}"/>
<ellipse cx="78" cy="51" rx="4" ry="12" fill="${W}"/>
<path d="M38 40h20v22H38z" fill="${W}" stroke-width="2.6"/>
<path d="M34 30h28" stroke-width="3"/>` },
  { key: 'storagebox', label: '收纳盒', body: `
<rect x="14" y="33" width="68" height="12" rx="4" fill="${C2}"/>
<path d="M18 43h60v35a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6z" fill="${C5}"/>
<rect x="38" y="24" width="20" height="10" rx="3" fill="${C1}"/>
<path d="M27 55h42M27 65h42" stroke="${M}" stroke-width="2.6"/>` },
  { key: 'documentbag', label: '文件袋', body: `
<path d="M20 30h56a6 6 0 0 1 6 6v44a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V36a6 6 0 0 1 6-6z" fill="${C5}"/>
<path d="M14 44h68" stroke-width="3"/>
<path d="M30 30v-6a4 4 0 0 1 4-4h20" fill="none" stroke-width="3"/>
<circle cx="48" cy="62" r="7" fill="${W}" stroke-width="2.6"/>` },
  { key: 'idcard', label: '证件夹', body: `
<rect x="14" y="24" width="68" height="48" rx="8" fill="${W}"/>
<path d="M14 32a8 8 0 0 1 8-8h52a8 8 0 0 1 8 8v6H14z" fill="${C1}"/>
<circle cx="34" cy="54" r="10" fill="${C2}"/>
<path d="M52 48h22M52 58h16" stroke="${M}" stroke-width="3"/>` },
  { key: 'pillbox', label: '药盒', body: `
<rect x="16" y="32" width="68" height="24" rx="8" fill="${W}"/>
<path d="M16 44h68" stroke-width="3"/>
<circle cx="34" cy="70" r="8" fill="${C4}"/>
<circle cx="52" cy="74" r="8" fill="${C1}"/>
<circle cx="68" cy="68" r="8" fill="${C3}"/>` },
  { key: 'humidifier', label: '加湿器', body: `
<path d="M30 34h36a10 10 0 0 1 10 10v34a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V44a10 10 0 0 1 10-10z" fill="${W}"/>
<path d="M32 58h32v20H32z" fill="${C1}" stroke-width="2.6"/>
<path d="M40 20c0 6 8 6 8 12M52 16c0 6 8 6 8 12" fill="none" stroke="${C3}" stroke-width="3"/>` },
  { key: 'purifier', label: '空气净化器', body: `
<rect x="22" y="16" width="52" height="66" rx="12" fill="${W}"/>
<circle cx="48" cy="48" r="18" fill="none" stroke="${C1}" stroke-width="3"/>
<circle cx="48" cy="48" r="9" fill="${C1}" stroke-width="2.6"/>
<path d="M34 26h28" stroke="${M}" stroke-width="3"/>
<circle cx="48" cy="74" r="2.6" fill="${G}" stroke="none"/>` },

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
