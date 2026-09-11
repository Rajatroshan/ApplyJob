@echo off
title Autonomous Job Application Agent (Visible Live Mode)
cd /d "c:\naukri"
echo ======================================================
echo Launching Autonomous Agent in VISIBLE BROWSER MODE...
echo You will see Google Chrome open on your screen.
echo ======================================================
node run_agent.js --keywords "Java Developer" --location "Hyderabad" --tech "Java, Spring Boot, Microservices" --yoe 1 --limit 3 --mode dry-run --headed --slow 700
pause

