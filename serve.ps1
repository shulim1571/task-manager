# Minimal static server for index.html: powershell -File serve.ps1
$port = 5173
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving on http://localhost:$port/"
$page = Join-Path $PSScriptRoot 'index.html'
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  if ($ctx.Request.Url.AbsolutePath -eq '/') {
    $bytes = [System.IO.File]::ReadAllBytes($page)
    $res.ContentType = 'text/html; charset=utf-8'
  } else {
    $res.StatusCode = 404
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
  }
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}
