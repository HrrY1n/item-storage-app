# MotionLab

当前项目的动效验证工具，直接使用本项目依赖和隔离浏览器启动器，不需要其他实验副本。

在项目根目录执行：

```powershell
node --test tools/motion-lab/test/*.test.mjs
node deliverables/motion-integration-final/verification/motion-acceptance.mjs --repeat=1 --out=YOUR_UNIQUE_RUN_ID --port=9222
```

验收入口包含17个场景；`run-all.cmd` 和 `run-scenario.cmd` 使用同一入口。`run.mjs` 保留原14个核心场景。退出码0为PASS、1为FAIL、2为INCONCLUSIVE；运行标识须唯一，已有结果拒绝覆盖。

每次结果生成在 `artifacts/<runId>`，包含HTML、原始记录、截图和环境信息；`open-report.cmd` 打开最近一次生成的报告。该目录及候选基线均被Git忽略，按需保留。`baselines/*.json` 是固定的历史对照；单元测试必需的实测夹具位于 `test/fixtures`。

最终A/B结果和补充回归脚本见 [最终交付](../../deliverables/motion-integration-final/INTEGRATION_RESULT.md) 与 [验证说明](../../deliverables/motion-integration-final/verification/README.md)。原始视频、关键帧和旧隔离浏览器资料仅存于本机忽略目录 `.workbuddy`。旧实验提交已归并至本仓库 `refs/archive/`；可用 `git for-each-ref refs/archive` 查看，按需从相应提交恢复文件。

需要独立基线时设置 `MOTIONLAB_APP_ROOT`；工具入口和采样源码仍使用本目录。浏览器只使用目标项目 `.tmp/edge-test-profile-<port>`，通过 `npm run browser:start/stop` 启停并校验进程身份。勿使用日常登录的浏览器配置。
