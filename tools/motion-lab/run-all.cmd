@echo off
setlocal enableextensions enabledelayedexpansion
rem 无论从哪个工作目录双击/调用，都先定位到项目根目录（本脚本位于 <根>\tools\motion-lab）。
cd /d "%~dp0\..\.."
if errorlevel 1 (
  echo [MotionLab] 错误：无法定位项目根目录（脚本位置异常）。
  pause
  exit /b 1
)
echo [MotionLab] 项目根目录: %cd%

where node >nul 2>nul
if errorlevel 1 (
  echo [MotionLab] 错误：未找到 Node.js（node 不在 PATH 中）。
  echo              请先安装 Node.js 18 或更高版本: https://nodejs.org/zh-cn
  echo              安装后重新打开本脚本。
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node --version 2^>nul') do echo [MotionLab] Node 版本: %%v

echo [MotionLab] 正在运行全部 17 个交互动效自动化检测（约 15-25 分钟，期间请勿关闭本窗口）...
node deliverables/motion-integration-final/verification/motion-acceptance.mjs %*
set "EC=%errorlevel%"

if exist "tools\motion-lab\artifacts\latest-report.txt" (
  set /p LATEST=<"tools\motion-lab\artifacts\latest-report.txt"
  if not "!LATEST!"=="" echo [MotionLab] 本次运行报告: !LATEST!
) else (
  echo [MotionLab] 未生成本次报告（可能运行失败或使用了 --no-report）。
)
if "%EC%"=="0" (echo [MotionLab] 全部完成：PASS) else if "%EC%"=="2" (echo [MotionLab] 完成：存在 INCONCLUSIVE 项，请查看报告) else (echo [MotionLab] 完成：存在 FAIL 项，请查看报告)
pause
exit /b %EC%
