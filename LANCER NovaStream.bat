@echo off
title NovaStream
cd /d "%~dp0"

REM Verification : le site compile est-il la ?
if not exist "dist\public\index.html" (
  echo.
  echo   [ERREUR] dossier dist\public introuvable.
  echo   Tu as probablement lance ce fichier SANS extraire l'archive.
  echo   Fais : clic droit sur le .tar.gz -^> "Extraire tout" -^> puis relance.
  echo.
  pause
  exit /b 1
)

cd dist\public
echo   Demarrage de NovaStream sur http://localhost:8080
echo   Laisse cette fenetre ouverte pendant l'utilisation.
echo.

REM Laisse le serveur demarrer 2 s avant d'ouvrir le navigateur
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8080"

python -m http.server 8080 2>nul
if %errorlevel%==0 goto fin
py -m http.server 8080 2>nul
if %errorlevel%==0 goto fin

echo.
echo   [ERREUR] Python est installe mais introuvable par le raccourci.
echo   Reinstalle Python en cochant la case "Add python.exe to PATH"
echo   (tout en bas du premier ecran d'installation).
echo.
pause
:fin
