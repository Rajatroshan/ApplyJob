@echo off
title Autonomous Job Application Agent (Interactive Mode)
cd /d "c:\naukri"
echo ======================================================
echo Starting Autonomous Agent (Interactive Mode)...
echo ======================================================
node run_agent.js --interactive --headed --slow 700
pause
