# Contact sheet of N frames from a GIF (to eyeball a recording). -Gif <gif> -Out <png> [-N 6]
param([string]$Gif, [string]$Out, [int]$N = 6)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Gif)
$dim = New-Object System.Drawing.Imaging.FrameDimension($img.FrameDimensionsList[0])
$count = $img.GetFrameCount($dim)
$delays = $img.GetPropertyItem(0x5100).Value
$times = @(); $t = 0
for ($i = 0; $i -lt $count; $i++) { $times += $t; $t += [BitConverter]::ToInt32($delays, $i * 4) * 10 }
"frames=$count total_ms=$t size=$($img.Width)x$($img.Height)"
$scale = 0.5
$w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
$cols = 3; $rows = [Math]::Ceiling($N / $cols)
$sheet = New-Object System.Drawing.Bitmap ($w * $cols), ($h * $rows + 0)
$g = [System.Drawing.Graphics]::FromImage($sheet)
$g.InterpolationMode = 'HighQualityBicubic'
$font = New-Object System.Drawing.Font('Arial', 14, [System.Drawing.FontStyle]::Bold)
for ($k = 0; $k -lt $N; $k++) {
  $target = [int]($t * ($k + 0.5) / $N)
  $idx = 0; for ($i = 0; $i -lt $count; $i++) { if ($times[$i] -le $target) { $idx = $i } }
  $img.SelectActiveFrame($dim, $idx) | Out-Null
  $x = ($k % $cols) * $w; $y = [Math]::Floor($k / $cols) * $h
  $g.DrawImage($img, $x, $y, $w, $h)
  $g.FillRectangle([System.Drawing.Brushes]::Yellow, $x, $y, 110, 24)
  $g.DrawString("t=$($times[$idx])ms", $font, [System.Drawing.Brushes]::Black, $x + 2, $y + 2)
}
$sheet.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose(); $img.Dispose()
