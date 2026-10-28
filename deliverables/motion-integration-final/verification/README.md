# 验证脚本

生产App只改5个源文件；本目录保存补充验证与旧交互脚本的适配补丁，不进入应用构建。完整历史MotionLab框架没有加入生产项目。

在集成项目根目录执行。当前 `.tmp/motionlab-runner` 已配置；如果迁移到全新目录，先运行 `node deliverables/motion-integration-final/verification/setup-motionlab.mjs D:/Codex/item-storage-motion-optimization-v2`。目标存在时脚本拒绝覆盖；只复制工具src/test/入口及一个U01历史单测夹具，不复制历史运行报告或数据。原工具源码不改动。

```powershell
npm run typecheck
npm test
npm run build
$env:MOTIONLAB_APP_ROOT=(Get-Location).Path
node --test .tmp/motionlab-runner/tools/motion-lab/test/*.test.mjs
node deliverables/motion-integration-final/verification/compatibility.mjs
node deliverables/motion-integration-final/verification/app-edges.mjs
node deliverables/motion-integration-final/verification/prepare-interactions.mjs
node deliverables/motion-integration-final/verification/business-browser.mjs --adapted
node deliverables/motion-integration-final/verification/motion-acceptance.mjs --repeat=3 --out=YOUR_UNIQUE_RUN_ID --port=9222 --dev-port=5173
```

所有浏览器均由项目原有 `browser:start/stop` 启停，使用 `.tmp/edge-test-profile-<port>`，CIM核验PID/创建时间/命令行/监听端口。Vite只监听127.0.0.1，身份接口核验root和业务源码指纹。每场景创建一次性BrowserContext，仅合成数据；MotionLab导航前拒绝API和外源请求。正常用户浏览器、正式仓库、生产Worker/D1和真实数据不接触。

原版对比设置 `MOTIONLAB_APP_ROOT` 为独立 `.tmp/before-app`；同一入口/工具/浏览器/视口/输入/种子。`motion-acceptance.mjs` 注册原14场景和新增表单、显式门控异步查询、横屏3场景。延迟查询在观测到查询开始后8个rAF释放，不以固定sleep规避竞态。

`prepare-interactions.mjs` 生成忽略的 `.tmp/current-interactions.mjs`；原 `scripts/verify-interactions.mjs` 保持不变。补丁明确等待确认框关闭的DOM终态；把旧的“可见内容必须等表单、固定面板高度”假设，改为明确加载占位/最终表单、视口边界和transform单调性。其余业务断言保留。原脚本在未修改原版也有相同的过早断言失败，独立键盘事件探针证明取消后草稿保留。

App边界脚本中的可用高度变化只模拟布局空间；pointercancel使用真实CDP鼠标拖动后派发DOM PointerEvent作清理路径测试。它们不等于iPhone键盘、Safari地址栏或硬件手势认证。

旧脚本中的state=open只表示入场已就绪，适配版另等真实表单字段且无加载提示；reduced-motion仍保留零面板动画断言。CPU4按真实静止终态采集，而非固定1400ms截断。手势主raw记录长拉，附加回弹/快甩/取消保留功能断言，不声称已保存所有附加动作的完整曲线。
