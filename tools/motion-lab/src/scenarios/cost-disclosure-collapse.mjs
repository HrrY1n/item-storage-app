import { costSpec, runCost } from './cost-disclosure.mjs'
export default { id: 'cost-disclosure-collapse', title: '卡片成本明细收起', viewport: { width: 390, height: 844, dpr: 2 },
  description: '独立采集收起方向及邻卡全程位置，不用准备阶段代替验证。', spec: costSpec, run: ctx => runCost(ctx, false) }
