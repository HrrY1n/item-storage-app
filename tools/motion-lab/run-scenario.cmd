@echo off
setlocal enableextensions enabledelayedexpansion
rem 运行单个场景；无论从哪个工作目录调用都会正确定位项目根目录。
cd /d "%~dp0\..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo [MotionLab] 错误：未找到 Node.js（node 不在 PATH 中）。
  echo              请先安装 Node.js 18 或更高版本: https://nodejs.org/zh-cn
  pause
  exit /b 1
)

if "%~1"=="" (
  echo [用法] run-scenario.cmd ^<场景ID^>
  echo 可选场景:
  echo   item-detail-open, item-detail-close, cost-disclosure-expand, cost-disclosure-collapse,
  echo   bottom-nav-switch, bottom-nav-rapid-switch, icon-picker-open, icon-picker-close,
  echo   icon-picker-select, theme-switch, theme-switch-light, reduced-motion-detail-open,
  echo   item-detail-open-small, panel-swipe-dismiss,
  echo   item-form-open, item-detail-open-delayed, item-detail-open-landscape
  echo.
  set /p SCENARIO="请输入场景ID (直接回车默认测 item-detail-open): "
) else (
  set "SCENARIO=%~1"
)
if "!SCENARIO!"=="" set "SCENARIO=item-detail-open"
echo [MotionLab] 正在运行场景: !SCENARIO!
node deliverables/motion-integration-final/verification/motion-acceptance.mjs --scenario=!SCENARIO!
set "EC=%errorlevel%"

if exist "tools\motion-lab\artifacts\latest-report.txt" (
  set /p LATEST=<"tools\motion-lab\artifacts\latest-report.txt"
  if not "!LATEST!"=="" echo [MotionLab] 本次运行报告: !LATEST!
)
pause
exit /b %EC%
