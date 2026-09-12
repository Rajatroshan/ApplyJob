@echo off
title Autonomous LinkedIn Easy Apply Agent (Interactive Mode)
cd /d "c:\naukri"
echo ======================================================
echo 🚀 Launching Autonomous Agent for LINKEDIN EASY APPLY...
echo ======================================================
echo.
node run_agent.js --platform linkedin --interactive --limit 10 --mode auto-apply --headed --slow 700
pause

