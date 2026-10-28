# 本轮前后对比

基线fa8fa77、集成Appc1fe47e；Edg/156.0.4314.42、v24.14.1、同一工具指纹40719bd37f37bacb、扩展场景指纹98747753d0ab1157。开发构建；通常390×844@2x，小屏360×760，横屏844×390；同一合成种子及CDP鼠标/触摸。两套服务分别核验实际源码root与SHA256指纹。

正常详情：输入→首次几何/样式变化，原版194.0 (186.4–205.9, n=3)ms，集成版157.3 (157.0–158.1, n=3)ms；面板首次进入视口（几何判定），原版223.6 (222.3–231.3, n=3)ms，集成版157.3 (157.0–158.1, n=3)ms。每侧n=3，未做统计显著性检验，不将小样本中位差称为确定性能提升。

受控异步查询尚未释放时，原版0/3轮面板已打开并移动，集成版3/3轮；两侧均有明确加载占位并在释放查询后显示当前物品。它证明入场与查询结果解耦，不是真机性能认证。

原版状态：PASS（{"total":51,"pass":51,"fail":0,"inconclusive":0,"warnings":0}）；集成版状态：PASS（{"total":51,"pass":51,"fail":0,"inconclusive":0,"warnings":0}）。

| 场景 | 原版 输入→首变 ms（中位/范围） | 集成版 输入→首变 ms | 集成版三轮 |
| --- | --- | --- | --- |
| item-detail-open | 194.0 (186.4–205.9, n=3) | 157.3 (157.0–158.1, n=3) | PASS / PASS / PASS |
| item-detail-close | 116.2 (105.1–117.7, n=3) | 98.8 (97.5–98.9, n=3) | PASS / PASS / PASS |
| cost-disclosure-expand | 65.5 (63.1–65.6, n=3) | 65.6 (65.5–66.1, n=3) | PASS / PASS / PASS |
| bottom-nav-switch | 105.2 (102.2–118.9, n=3) | 98.9 (61.1–101.0, n=3) | PASS / PASS / PASS |
| icon-picker-open | 111.9 (108.2–117.9, n=3) | 99.0 (83.4–108.2, n=3) | PASS / PASS / PASS |
| icon-picker-close | 103.0 (91.2–106.8, n=3) | 85.8 (85.6–96.6, n=3) | PASS / PASS / PASS |
| theme-switch | 99.2 (98.4–100.1, n=3) | 98.7 (97.6–115.3, n=3) | PASS / PASS / PASS |
| reduced-motion-detail-open | 207.7 (203.1–210.5, n=3) | — (—–—, n=0) | PASS / PASS / PASS |
| item-detail-open-small | 205.4 (191.9–210.1, n=3) | 172.5 (156.2–197.0, n=3) | PASS / PASS / PASS |
| panel-swipe-dismiss | 68.3 (66.8–68.3, n=3) | 67.7 (52.1–69.2, n=3) | PASS / PASS / PASS |
| bottom-nav-rapid-switch | 102.3 (77.2–163.7, n=3) | 101.8 (101.6–107.4, n=3) | PASS / PASS / PASS |
| cost-disclosure-collapse | 80.4 (63.3–81.7, n=3) | 80.7 (80.6–81.3, n=3) | PASS / PASS / PASS |
| theme-switch-light | 95.1 (82.4–99.3, n=3) | 99.1 (82.4–99.5, n=3) | PASS / PASS / PASS |
| icon-picker-select | 109.0 (100.2–112.2, n=3) | 102.9 (81.9–115.6, n=3) | PASS / PASS / PASS |
| item-form-open | 217.3 (216.1–224.0, n=3) | 162.1 (160.8–162.9, n=3) | PASS / PASS / PASS |
| item-detail-open-delayed | 359.2 (307.6–373.2, n=3) | 156.4 (155.5–159.0, n=3) | PASS / PASS / PASS |
| item-detail-open-landscape | 205.1 (204.1–217.2, n=3) | 168.4 (157.6–184.5, n=3) | PASS / PASS / PASS |

曲线与截图见[index.html](index.html)，完整本轮报告为[motionlab/before/report.html](motionlab/before/report.html)、[motionlab/after/report.html](motionlab/after/report.html)。原始逐轮数据与文件SHA256在各manifest中。历史实验结果未用于本轮结论。

“首变”可能发生在面板仍不可见时，因此另列真实视口交集与opacity判断。原版100%偏移可在不可见阶段随内容高度变化；不能把隐藏阶段的数值跳变称为可见闪烁。可见位移回退次数仅在两相邻采样均位于视口且opacity>0.02时统计。采样间隔/事件回调包含调度波动，不等于屏幕FPS或GPU呈现。

未发现集成版开场、关闭、手势、滚动与草稿的功能回归；暂停/取消退出和入场回调清理另有受控组件证据。iPhone Safari、真实地址栏与软键盘等待人工验收。
