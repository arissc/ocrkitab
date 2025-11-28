@echo off
cd /d "E:\BOOK\scanned_syarah_dalail\text"

echo ***** MULAI GABUNGAN TEKS ***** > all_pages.txt
echo. >> all_pages.txt

REM === Gunakan PowerShell untuk sortir numerik ===
for /f "delims=" %%f in ('powershell -NoProfile -Command ^
    "Get-ChildItem -Filter *.txt | Sort-Object {[int]($_.BaseName)} | ForEach-Object {$_.Name}"') do (
    echo [===== %%~nf =====] >> all_pages.txt
    type "%%f" >> all_pages.txt
    echo. >> all_pages.txt
)

echo ***** SELESAI ***** >> all_pages.txt
echo ✅ Semua file sudah digabung ke all_pages.txt
pause
