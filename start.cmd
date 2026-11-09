@echo off
setlocal
pushd "%~dp0" || exit /b 1

if exist "until-morning.exe" goto bundled
if not exist "go.mod" goto missing
where go >nul 2>&1
if errorlevel 1 goto no_go

echo Building Until Morning...
if not exist ".local" mkdir ".local"
go build -o ".local\until-morning.exe" ./cmd/until-morning
if errorlevel 1 goto failed
set "APP_BINARY=.local\until-morning.exe"
goto run

:bundled
set "APP_BINARY=until-morning.exe"

:run
echo Until Morning - your browser will open automatically.
echo Keep this window open while playing. Press Ctrl+C to stop.
"%APP_BINARY%" -open-browser %*
set "APP_STATUS=%ERRORLEVEL%"
if not "%APP_STATUS%"=="0" goto failed
popd
exit /b 0

:no_go
echo Go 1.24+ is needed to run the source code.
echo For a ready-to-run app without Go, download an archive from:
echo https://github.com/MrPrograMax/fun-poker-club/releases/latest
goto failed

:missing
echo App binary is missing. Extract the entire release archive and try again.

:failed
echo.
echo Could not start Until Morning. See the message above.
pause
popd
exit /b 1
