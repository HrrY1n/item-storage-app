@echo off
setlocal enableextensions enabledelayedexpansion
rem 用法：
rem   双击（无参数）      → 打开"最近一次运行"生成的报告（artifacts\latest-report.txt 指针）。
rem   open-report.cmd <runId> → 打开 artifacts\<runId>\report.html。
rem   open-report.cmd "C:\...\report.html"   → 打开指定报告文件。
rem 绝不打开旧报告却标注为本次结果：指针只由最近一次实际运行的 run.mjs 写入。
cd /d "%~dp0\..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo [MotionLab] 提示：未检测到 Node.js。打开已有报告不需要 Node，但重新生成报告需要先安装。
)

set "REPORT="
if not "%~1"=="" (
  set "REPORT=%~1"
  rem 参数不含冒号/反斜杠时视为 runId，补全为标准报告路径。
  echo !REPORT! | findstr /r /c:":" /c:"\\" >nul || set "REPORT=tools\motion-lab\artifacts\%~1\report.html"
) else if exist "tools\motion-lab\artifacts\latest-report.txt" (
  set /p REPORT=<"tools\motion-lab\artifacts\latest-report.txt"
)

if "!REPORT!"=="" (
  echo [MotionLab] 错误：还没有任何报告记录。
  echo             请先双击 run-all.cmd 运行一次完整检测生成报告。
  pause
  exit /b 1
)
if not exist "!REPORT!" (
  echo [MotionLab] 错误：报告文件不存在或已被移动: !REPORT!
  echo             请重新运行 run-all.cmd 生成最新报告。
  pause
  exit /b 1
)

echo [MotionLab] 正在打开报告:
echo   !REPORT!
start "" "!REPORT!"
exit /b 0
