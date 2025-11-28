$inputFolder = "E:\BOOK\scanned_syarah_dalail\1-50"
$outputFolder = "E:\BOOK\scanned_syarah_dalail\text"
$tesseractPath = "C:\Program Files\Tesseract-OCR\tesseract.exe"

Get-ChildItem $inputFolder -Filter *.jpg | ForEach-Object {
    $out = Join-Path $outputFolder $_.BaseName
    & $tesseractPath $_.FullName $out -l ara
}
Write-Host "✅ OCR selesai! Semua hasil tersimpan di folder text"
