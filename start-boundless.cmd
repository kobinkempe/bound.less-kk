@echo off
rem Double-click to start the bound.less servers (tools\launch.js). Close the window to stop them.
title bound.less servers - close this window to stop them
cd /d "%~dp0"
node tools\launch.js
pause
