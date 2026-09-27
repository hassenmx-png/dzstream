@echo off
title NovaStream — Serveur
cd /d "%~dp0"

REM Version SERVEUR : l'app tourne avec son API (Node.js requis).
if not exist "dist\public\index.html" (
  echo   [ERREUR] dist\public introuvable — extrais l'archive d'abord.
  pause & exit /b 1
)
if not exist "dist\boot.js" (
  echo   [ERREUR] dist\boot.js introuvable.
  pause & exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERREUR] Node.js n'est pas installe.
  echo   Installe-le : https://nodejs.org (version LTS, coche "Add to PATH").
  echo.
  pause & exit /b 1
)

cd dist
echo   Serveur NovaStream : http://localhost:3000 (app + API)
echo   Laisse cette fenetre ouverte.
echo.
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
set NODE_ENV=production
node boot.js
pause
