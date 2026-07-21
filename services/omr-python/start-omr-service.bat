@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   خدمة OMR (Python)
echo   العنوان: http://127.0.0.1:8001
echo   للإيقاف: اضغط Ctrl+C في هذه النافذة
echo ============================================
echo.

where py >nul 2>&1
if %errorlevel%==0 (
  echo استخدام: py -3.12
  py -3.12 -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
  goto :end
)

where python >nul 2>&1
if %errorlevel%==0 (
  echo استخدام: python
  python -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
  goto :end
)

echo لم يُعثر على py أو python. ثبّت Python أو أضفه إلى PATH.
pause
exit /b 1

:end
echo.
echo توقفت الخدمة.
pause
