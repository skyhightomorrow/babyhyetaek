# 베이비혜택 파비콘/OG PNG 생성 (GDI+). senior-benefits 재사용 — 핑크+하트.
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pub  = Join-Path $root "public"
$pink = [System.Drawing.ColorTranslator]::FromHtml("#ff6b81")
$pinkDark = [System.Drawing.ColorTranslator]::FromHtml("#e84e66")
$white = [System.Drawing.Color]::White

function Add-Heart($g, [float]$cx, [float]$cy, [float]$s, $brush) {
  # 두 원(위 혹) + 삼각형(아래 꼭지)으로 하트 근사
  $r = $s * 0.29
  $g.FillEllipse($brush, $cx - $s*0.30 - $r, $cy - $s*0.34 - $r + $r, $r*2, $r*2)
  $g.FillEllipse($brush, $cx + $s*0.30 - $r, $cy - $s*0.34 - $r + $r, $r*2, $r*2)
  $pts = @(
    (New-Object System.Drawing.PointF([float]($cx - $s*0.56), [float]($cy - $s*0.10))),
    (New-Object System.Drawing.PointF([float]($cx + $s*0.56), [float]($cy - $s*0.10))),
    (New-Object System.Drawing.PointF([float]($cx), [float]($cy + $s*0.52)))
  )
  $g.FillPolygon($brush, $pts)
}

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::Transparent)
  $r = [int]($size * 0.24)
  $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
  $gp.AddArc(0, 0, $r, $r, 180, 90)
  $gp.AddArc($size-$r, 0, $r, $r, 270, 90)
  $gp.AddArc($size-$r, $size-$r, $r, $r, 0, 90)
  $gp.AddArc(0, $size-$r, $r, $r, 90, 90)
  $gp.CloseFigure()
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $pink, $pinkDark, 45.0)
  $g.FillPath($grad, $gp)
  Add-Heart $g ([float]($size*0.5)) ([float]($size*0.46)) ([float]($size*0.5)) (New-Object System.Drawing.SolidBrush($white))
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "  $path ($size x $size)"
}

Write-Host "Icons:"
New-Icon 180 (Join-Path $pub "apple-touch-icon.png")
New-Icon 192 (Join-Path $pub "icon-192.png")
New-Icon 512 (Join-Path $pub "icon-512.png")
New-Icon 32  (Join-Path $pub "favicon-32.png")

# favicon.ico
$png32 = Join-Path $pub "favicon-32.png"
$icoPath = Join-Path $pub "favicon.ico"
$pngBytes = [System.IO.File]::ReadAllBytes($png32)
$ico = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ico)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]1)
$bw.Write([Byte]32); $bw.Write([Byte]32); $bw.Write([Byte]0); $bw.Write([Byte]0)
$bw.Write([UInt16]1); $bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length); $bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $ico.ToArray())
$bw.Dispose()
Write-Host "  $icoPath"

# OG 1200x630
$ogW = 1200; $ogH = 630
$bmp = New-Object System.Drawing.Bitmap($ogW, $ogH)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"
$g.TextRenderingHint = "AntiAliasGridFit"
$rect = New-Object System.Drawing.Rectangle(0, 0, $ogW, $ogH)
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $pink, $pinkDark, 60.0)
$g.FillRectangle($grad, $rect)
Add-Heart $g 185 175 130 (New-Object System.Drawing.SolidBrush($white))
$famName = "Malgun Gothic"
$wBrush = New-Object System.Drawing.SolidBrush($white)
$softBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 226, 232))
$f1 = New-Object System.Drawing.Font($famName, 82, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$f2 = New-Object System.Drawing.Font($famName, 42, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$f3 = New-Object System.Drawing.Font($famName, 32, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString("베이비혜택", $f1, $wBrush, 105, 320)
$g.DrawString("우리 동네 출산·육아 지원금, 8세까지 총액", $f2, $wBrush, 110, 430)
$g.DrawString("부모급여·첫만남이용권 + 우리 시군구 지원금까지 한 번에", $f3, $softBrush, 112, 500)
$g.Dispose()
$bmp.Save((Join-Path $pub "og.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "  og.png (1200 x 630)"
Write-Host "Done."
