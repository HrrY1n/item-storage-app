# 本次 App 动效集成

基线：正式本地仓库 `C:\Users\Administrator\WorkBuddy\物品归置小app` 的 `main / fa8fa774aee707e6ff8d05273b632727e7275cb9`。已通过保存项目映射、Git根目录与远程URL核实。源码无未提交修改；未跟踪内容仅为交接/研究/历史报告，全部留在原处。未执行fetch/pull，也不声称检查了未获取的远端新提交。

独立集成目录：`D:\Codex\item-storage-app-motion-integration`，分支 `codex/motion-integration-final`。使用 `clone --no-local --no-hardlinks`，独立Git对象库，无共享worktree、alternates或硬链接。原版对照为其 `.tmp/before-app` 下的另一独立克隆。

## 来源与范围

实际读取 `797c6ac` 和 `ca1219d` 的Git diff；两者业务App范围共5个文件。正式HEAD是实验历史基线 `eb3b6de` 的祖先，未发现更晚业务实现冲突。第一个提交所需的提前启动入场前置一并移植；未移植更早的无关卡片按压CSS。

| 文件 | 实际改变 |
| --- | --- |
| `src/components/ItemPanel.tsx` | 首次绘制前提交入场；第三个rAF再释放内容；reduced-motion直接释放；返回 entering 给现有两处页面调用者。 |
| `src/pages/ItemDetailPage.tsx` | 在异步加载或入场分阶段期间显示既有加载提示，保留当前物品查询/缺失状态/业务操作。 |
| `src/pages/ItemFormPage.tsx` | 使用同一入场状态控制既有表单占位，保留初始化、路由拦截、草稿、金额验证与保存。 |
| `src/components/ModalSheet.tsx` | 退出兜底感知外部暂停的位移过渡，保留正常transitionend、取消兜底和现有手势。 |
| `src/index.css` | pending/closing/starting-style起点使用100dvh；面板will-change:transform。未改导航曲线或视觉布局。 |

## 本轮复现并修复的兼容问题

1. 嵌套rAF只保存第一个ID，第一/第二帧后卸载会留下后续回调。逐层保存当前ID，完成时同时清理兜底计时器；受控真实浏览器夹具验证无残留。
2. 原暂停感知检查把任意暂停动画都当作退出冻结，取消位移后若仍有无关暂停opacity动画会保留弹层与滚动锁。仅等待暂停的transform CSS过渡；验证暂停/恢复、取消、无关暂停和快速重开。

App检查点：`c1fe47e`。测试夹具直接导入实际组件，无新依赖。MotionLab工具已收拢至 tools/motion-lab，统一App路径、工具指纹和测试夹具，不进入生产应用构建。

没有改变数据Schema、IndexedDB/outbox、同步协议、Worker、D1、备份实现、手势阈值/算法或导航曲线。没有推送或部署。

仅App补丁：[app-motion.patch](app-motion.patch)，已在独立原版上通过 git apply --check；未实际应用到正式项目。


过程审计、旧报告、失败日志和临时测试副本已清理；保留App补丁、回归测试及最终对比结果。重跑验证直接按verification/README.md执行，不再依赖旧工程目录。

目录归并（2026-10-29）：工具、测试和必需夹具统一为 tools/motion-lab；删除重复的临时准备/历史审计入口。旧工程全部19个Git引用已存入当前仓库 refs/archive/；参考视频、关键帧和旧隔离浏览器资料仅保留一份于本机忽略目录 .workbuddy。App业务源码及既有最终测量数据未改变。
