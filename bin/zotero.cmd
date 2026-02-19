@echo off
setlocal

rem Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"

rem Run the CLI using Node.js
node "%~dp0..\apps\cli\dist\index.js" %*

endlocal
