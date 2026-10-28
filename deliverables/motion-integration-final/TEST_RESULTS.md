# 本轮测试结果

状态：**集成及自动化验证完成，待实机验收**。所有下列通过项均来自本轮独立副本，不引用历史853/44/42轮作为本轮结果。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| TypeScript | PASS | evidence/typecheck.txt |
| 完整业务单元测试 | 853项、57文件PASS | evidence/unit.txt |
| 生产构建 | PASS，379项PWA预缓存 | evidence/build.txt |
| CRUD | 9项PASS | evidence/crud.txt |
| 表单/草稿/同步UI/合成备份恢复 | 9组PASS | evidence/form-state-results.json |
| 当前组件相关交互 | 57项PASS | evidence/interactions-results.json、verification/interactions-adaptation.patch |
| 组件生命周期回归 | 16项含清理PASS | evidence/compatibility-pass.json |
| App边界/布局/取消 | 17项含清理PASS | evidence/app-edges.json |
| MotionLab工具自测 | 44项PASS | evidence/motionlab-unit-final.txt |
| 原版MotionLab | 17场景×3轮，PASS | motionlab/before/manifest.json |
| 集成版MotionLab | 17场景×3轮，51/51 PASS | motionlab/after/manifest.json |
| 原仓库保护 | 2860文件、HEAD/分支/状态相同 | evidence/protected-repositories-after.json |

覆盖：正常/异步/小屏/横屏详情入场；关闭卸载、焦点和滚动恢复；新增表单；长拉关闭、短拉回弹、快甩、触摸取消、斜向、内部滚动、pointercancel；快速底栏切换；reduced-motion；迟到旧查询；聚焦输入后的可用视口缩放；取消退出、外部暂停/恢复、无关暂停动画与快速重开。

测试适配公开保留：原scripts/verify-interactions.mjs在未修改原版也出现相同的过早Escape断言失败。实际键盘探针证明正常取消并保留草稿；生成副本等待Router关闭DOM终态。既有“可见前必须等全部数据、固定高度、state=open表示数据已到齐”假设与本次分阶段入场冲突，改为显式加载/表单、transform单调、实际表单就绪及三帧静止终态。保留零面板动画、焦点、外层滚动等原断言；CPU4采样不再固定1400ms截断，使用8s看门狗与真实终态。原文件未修改，补丁及准备脚本在verification，原始失败日志仍在evidence。

交付验证：复制后的354个原始数据/PNG文件SHA256全部一致，130个HTML本地引用有效，3份HTML在独立Edge中加载无运行或网络错误；进程及上下文清理通过。见evidence/delivery-validation.json。手势主raw记录长拉轨迹，附加回弹、快甩和取消保存功能断言，未另存每次附加动作的完整曲线。

自动化限制：Edge156无头/disable-gpu，移动视口不是Safari；可用高度变化不是手机键盘/地址栏本身；pointercancel为真实CDP鼠标拖动后派发DOM事件；n=3开发构建样本不能证明真机性能提升。未重新跑历史整套故障注入审计；复用相同采样器并执行本轮44个工具自测及全部正例。构建仍提示主包>500KB，未为此扩大重构或更新依赖。

部署、push、生产账号、Worker、D1与真实物品数据：均未使用/修改。

Git证据保存：交付目录的.gitattributes禁止换行转换；暂存对象逐文件与磁盘原件按Git blob哈希核对一致，确保Windows重新检出后原始SHA256仍可验证。见evidence/git-artifact-bytes.json。
