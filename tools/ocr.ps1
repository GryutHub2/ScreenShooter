# 画像に写っている文字を、Windows 標準の文字読み取り（Windows.Media.Ocr）で読んで JSON で1行返す。
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\ocr.ps1 -Path "C:\...\ScreenShooter_2026-09-27_101500.png"
#
# 返すのは「エンジン × 倍率」ごとの、行 → 単語（文字と、元の絵の実ピクセルでの位置）。
# 日本語エンジンは英数字を崩し（\ を * に化かす）、英語エンジンは行ごと落とすことがあるので両方で読む。
# 小さい字は2倍に拡大すると読める所が変わるので、絵が大きすぎなければ2倍でも読む。
# 読んだ文字はどこにも書き残さない。外へも送らない（読むのはこのパソコンの中だけで完結する）。
#
# PowerShell の変数は大文字・小文字を区別しない（$w と $W は同じ変数）ので、名前は重ならないように付ける。

param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = 'Stop'
# 日本語を標準出力で返すので UTF-8 にする（既定の cp932 のままだと Node 側で化ける）。
# 念のため JSON の中の ASCII 以外も \uXXXX にして出す
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

function JsonStr([string]$s) {
  $out = New-Object System.Text.StringBuilder
  [void]$out.Append('"')
  foreach ($ch in $s.ToCharArray()) {
    $code = [int]$ch
    if ($ch -eq '"') { [void]$out.Append('\"') }
    elseif ($ch -eq '\') { [void]$out.Append('\\') }
    elseif ($code -lt 32 -or $code -gt 126) { [void]$out.Append('\u' + $code.ToString('x4')) }
    else { [void]$out.Append($ch) }
  }
  [void]$out.Append('"')
  $out.ToString()
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapTransform, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($op, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
  }

  $engines = @()
  foreach ($tag in @('ja', 'en-US')) {
    $lang = New-Object Windows.Globalization.Language $tag
    if (-not [Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lang)) { continue }
    $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
    if ($eng) { $engines += , @($tag, $eng) }
  }
  if ($engines.Count -eq 0) {
    $eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($eng) { $engines += , @('user', $eng) }
  }
  if ($engines.Count -eq 0) { [Console]::Out.WriteLine('{"error":"no-engine"}'); exit 0 }

  # StorageFile は「/」区切りのパスを受け付けないので、Windows の形に直してから渡す
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync([IO.Path]::GetFullPath($Path))) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $imgW = [int]$dec.PixelWidth
  $imgH = [int]$dec.PixelHeight
  $inv = [Globalization.CultureInfo]::InvariantCulture

  # 一度に読めるのは縦横 10000px まで（MaxImageDimension）。スクロール撮影の長い絵は重ねながら分けて読む。
  # 重ねるのは、分け目にかかった行を片方で丸ごと読めるようにするため
  $maxDim = [int][Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  if ($maxDim -le 0) { $maxDim = 10000 }
  $OVERLAP = 200

  $scales = @(1)
  # 2倍は絵が大きすぎないときだけ（4K 1画面ぶんくらいまで）。大きい絵だと時間がかかりすぎる
  if ([double]$imgW * $imgH -le 9000000) { $scales += 2 }

  $passes = New-Object System.Collections.Generic.List[string]
  foreach ($scale in $scales) {
    $scaledW = [int]($imgW * $scale)
    $scaledH = [int]($imgH * $scale)
    $tile = $maxDim - 16
    $step = $tile - $OVERLAP * $scale
    $xs = @(); $pos = 0
    while ($true) { $xs += $pos; if ($pos + $tile -ge $scaledW) { break }; $pos += $step }
    $ys = @(); $pos = 0
    while ($true) { $ys += $pos; if ($pos + $tile -ge $scaledH) { break }; $pos += $step }

    $lineJson = @{}
    foreach ($e in $engines) { $lineJson[$e[0]] = New-Object System.Collections.Generic.List[string] }

    foreach ($ty in $ys) {
      foreach ($tx in $xs) {
        $tileW = [Math]::Min($tile, $scaledW - $tx)
        $tileH = [Math]::Min($tile, $scaledH - $ty)
        if ($tileW -lt 8 -or $tileH -lt 8) { continue }
        $tf = New-Object Windows.Graphics.Imaging.BitmapTransform
        if ($scale -ne 1) {
          $tf.ScaledWidth = [uint32]$scaledW
          $tf.ScaledHeight = [uint32]$scaledH
          $tf.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
        }
        # 切り出す範囲は「拡大したあと」の座標で指定する
        $bounds = New-Object Windows.Graphics.Imaging.BitmapBounds
        $bounds.X = [uint32]$tx; $bounds.Y = [uint32]$ty; $bounds.Width = [uint32]$tileW; $bounds.Height = [uint32]$tileH
        $tf.Bounds = $bounds
        $bmp = Await ($dec.GetSoftwareBitmapAsync(
            [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
            [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
            $tf,
            [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
            [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
        foreach ($e in $engines) {
          $res = Await ($e[1].RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
          foreach ($line in $res.Lines) {
            $words = New-Object System.Collections.Generic.List[string]
            foreach ($word in $line.Words) {
              $r = $word.BoundingRect
              # 拡大・分割した座標を、元の絵の実ピクセルに戻す
              $wx = [Math]::Round(($r.X + $tx) / $scale, 1)
              $wy = [Math]::Round(($r.Y + $ty) / $scale, 1)
              $ww = [Math]::Round($r.Width / $scale, 1)
              $wh = [Math]::Round($r.Height / $scale, 1)
              $words.Add('[' + (JsonStr $word.Text) + ',' + $wx.ToString($inv) + ',' + $wy.ToString($inv) + ',' + $ww.ToString($inv) + ',' + $wh.ToString($inv) + ']')
            }
            if ($words.Count) { $lineJson[$e[0]].Add('[' + ($words -join ',') + ']') }
          }
        }
        $bmp.Dispose()
      }
    }
    foreach ($e in $engines) {
      $passes.Add('{"lang":' + (JsonStr $e[0]) + ',"scale":' + $scale + ',"lines":[' + ($lineJson[$e[0]] -join ',') + ']}')
    }
  }
  $stream.Dispose()

  [Console]::Out.WriteLine('{"width":' + $imgW + ',"height":' + $imgH + ',"passes":[' + ($passes -join ',') + ']}')
} catch {
  # 失敗の中身（パスなど）は返さない。呼ぶ側は黙って諦めるだけなので、失敗したことだけ分かればよい
  [Console]::Out.WriteLine('{"error":"failed"}')
}
