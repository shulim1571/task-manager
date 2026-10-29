# Minimal static server for the app's pages: powershell -File serve.ps1
$port = 5173
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving on http://localhost:$port/"
$pages = @{ '/' = 'index.html'; '/index.html' = 'index.html'; '/admin.html' = 'admin.html' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  $name = $pages[$ctx.Request.Url.AbsolutePath]
  if ($name) {
    $bytes = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $name))
    $res.ContentType = 'text/html; charset=utf-8'
  } else {
    $res.StatusCode = 404
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
  }
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
  $res.Close()
}
