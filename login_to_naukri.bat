@echo off
title Log In To Naukri (One-Time Setup)
cd /d "c:\naukri"
echo ======================================================
echo Opening Chrome for One-Time Naukri Login...
echo.
echo 1. Sign in with Google (or your Naukri email/password).
echo 2. Once logged in, you can close the browser window.
echo 3. Your login session will be saved PERMANENTLY for the agent!
echo ======================================================
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\ChromeProfile" "https://www.naukri.com/nlogin/login"
pause

