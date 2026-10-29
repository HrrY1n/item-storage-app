// 场景 13：详情面板下拉关闭手势（对应 REF_06_panel_dismiss_gesture）。
// 四条路径全部走真实 CDP 触摸：长拉关闭（距离阈值）、短拉回弹、快甩关闭（速度阈值）、
// touchcancel 中途取消。主采集是长拉关闭：panel ty 跟随手指（输入驱动，无声明时长），
// backdrop 透明度随拖动进度同步变化。

import { CARD_LINK, openItemList, panelTargets } from './lib.mjs'

const DRAG_FROM = [195, 300]

const sheetState = () => `(() => {
  const sheet = document.querySelector('.modal-sheet')
  const panel = document.querySelector('.modal-sheet-panel')
  if (!sheet || !panel) return { closed: !document.querySelector('dialog[open]') }
  const m = new DOMMatrixReadOnly(getComputedStyle(panel).transform)
  return { closed: !document.querySelector('dialog[open]'), state: sheet.getAttribute('data-state'),
    dragging: sheet.getAttribute('data-dragging'), rebounding: sheet.getAttribute('data-rebounding'),
    ty: Math.round(m.m42), dragVar: sheet.style.getPropertyValue('--sheet-drag-y'),
    scrollLock: document.body.style.overflow }
})()`

export default {
  id: 'panel-swipe-dismiss',
  title: '详情面板下拉关闭手势',
  description:
    '打开详情面板后用合成触摸下拉：长拉（280px 后停顿）应关闭；短拉（80px 慢速）应回弹到原位；' +
    '快甩（155px 但 <距离阈值）应凭释放速度关闭；拖动中途 touchcancel 应无残留。' +
    '主采集测量 panel translateY 跟随与 backdrop 同步变化。',
  viewport: { width: 390, height: 844, dpr: 2 },
  spec: {
    // 输入驱动：位移几何由 CDP 拖动节奏决定，不做时长/幅度基线断言（见 baseline.mjs 的豁免）。
    inputDriven: true,
    primary: { label: 'panel', signal: 'ty', declaredMs: null, eventProperty: 'transform' },
    secondary: [
      { label: 'backdrop', signal: 'o', declaredMs: null },
      { label: 'listCard', signal: 'y', declaredMs: null, stable: true },
    ],
  },

  async run(ctx) {
    const { page } = ctx
    await openItemList(page)
    const point = await page.prepareClick(CARD_LINK)
    const open = async () => {
      await page.dispatchClick(point)
      await page.until(`!!document.querySelector('.modal-sheet[data-state="open"][data-ready="true"]')`)
      await page.waitAnimationsIdle()
    }
    await open()
    const before = await page.screenshot('before')

    const checks = []
    const check = async (name, pass) => checks.push({ name, pass: Boolean(pass) })

    // 路径 1（主采集）：长拉 280px + 末段停顿 → 速度归零，仅凭距离阈值关闭。
    const record = await page.captureGesture({
      targets: panelTargets(),
      drag: { from: DRAG_FROM, steps: [[0, 70, 90], [0, 140, 90], [0, 210, 90], [0, 280, 90]], holdMs: 200 },
      settleMs: 420,
      maxMs: 3200,
    })
    const dragSeries = (record.frames ?? []).map(frame => frame.tg.panel?.ty).filter(Number.isFinite)
    const peak = Math.max(...dragSeries)
    check('拖动期间面板跟随手指（ty 峰值 ≥ 240px）', peak >= 240)
    check('拖动期间 backdrop 同步变暗（最低不透明度 ≤ 0.75）',
      Math.min(...(record.frames ?? []).map(frame => frame.tg.backdrop?.o).filter(Number.isFinite)) <= 0.75)
    check('长拉释放后面板关闭', (await page.ev(sheetState())).closed)
    check('关闭后滚动锁释放且无面板残留',
      await page.ev(`document.body.style.overflow === '' && !document.querySelector('.modal-sheet')`))

    // 路径 2：短拉 80px 慢速 → 回弹。
    await open()
    const reboundRecord = await page.captureGesture({
      targets: panelTargets(),
      drag: { from: DRAG_FROM, steps: [[0, 40, 70], [0, 80, 90]], holdMs: 120 },
      settleMs: 420,
      maxMs: 2600,
    })
    const reboundTys = (reboundRecord.frames ?? []).map(frame => frame.tg.panel?.ty).filter(Number.isFinite)
    check('短拉期间面板跟随（ty 峰值 ≥ 60px）', Math.max(...reboundTys) >= 60)
    const after = await page.ev(sheetState())
    check('短拉释放后面板回弹到原位（ty ≤ 2 且仍打开）', !after.closed && after.ty <= 2)
    check('回弹后无拖动状态残留', !after.dragging && !after.rebounding && !after.dragVar)

    // 路径 3：快甩 155px（低于 160px 距离阈值）→ 凭速度关闭。
    // 单步到位：CDP 触摸分发往返可达 ~50ms/次，多步快甩的窗口内速度会被分发延迟稀释
    // （实测跌到 0.63px/ms < 0.65 阈值）；单步即便 140ms 跨度速度仍 ≥ 1.1px/ms。
    await page.captureGesture({
      targets: panelTargets(),
      drag: { from: [195, 200], steps: [[0, 155, 20]] },
      settleMs: 420,
      maxMs: 2600,
    })
    check('快甩释放后面板关闭（速度阈值路径）', (await page.ev(sheetState())).closed)

    // 路径 4：拖动中途 touchcancel → 面板回弹、无残留、保持打开。
    await open()
    await page.dispatchTouchCancel({ from: DRAG_FROM, steps: [[0, 60, 40], [0, 110, 40]] })
    await page.waitAnimationsIdle()
    const cancelled = await page.ev(sheetState())
    check('touchcancel 后面板保持打开且回弹（ty ≤ 2）', !cancelled.closed && cancelled.ty <= 2)
    check('touchcancel 后无拖动状态残留', !cancelled.dragging && !cancelled.rebounding && !cancelled.dragVar)

    const afterShot = await page.screenshot('after')
    return {
      record,
      shots: [before, afterShot],
      checks,
      notes: [
        `主采集为长拉关闭路径，ty 峰值 ${Math.round(peak)}px；回弹/快甩/取消为附加功能断言，完整原始数据在各自 raw JSON。`,
        '位移由输入驱动（无声明时长）；timing 字段反映输入节奏，不用于动画时长验收。',
      ],
    }
  },
}
