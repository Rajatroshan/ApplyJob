@echo off
title Autonomous LinkedIn Easy Apply Agent (Visible Live Mode)
cd /d "c:\naukri"
echo ======================================================
echo Launching Autonomous Agent for LINKEDIN EASY APPLY...
echo Target: Backend Developer ^| Tech: Spring Boot, Docker, AWS
echo You will see Google Chrome open on your screen.
echo ======================================================
node run_agent.js --platform linkedin --keywords "Backend Developer" --tech "Spring Boot, Docker, AWS" --yoe 2 --limit 2 --mode dry-run --headed --slow 700
pause

