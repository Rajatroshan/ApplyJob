@echo off
title Log In To LinkedIn (One-Time Setup)
cd /d "c:\naukri"
echo ======================================================
echo Opening Chrome for One-Time LinkedIn Login...
echo.
echo 1. Sign in with your LinkedIn account.
echo 2. Once logged in to your LinkedIn feed, close the window.
echo 3. Your session is saved PERMANENTLY for the agent!
echo ======================================================
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --user-data-dir="C:\ChromeProfile" "https://www.linkedin.com/login"
pause

