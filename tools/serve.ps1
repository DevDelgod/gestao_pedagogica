<#
  Servidor estático mínimo para desenvolvimento (só PowerShell, sem instalar nada).
  ES Modules não funcionam via file://, então o projeto precisa ser servido por HTTP.

  Uso (na raiz do projeto):
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1
    powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Porta 8080
#>
param(
  [int]$Porta = 5500,
  [string]$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$Raiz = $Raiz.TrimEnd('\') + '\'
$tipos = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
}

$http = [System.Net.HttpListener]::new()
$http.Prefixes.Add("http://localhost:$Porta/")
$http.Start()
Write-Host "Servindo $Raiz em http://localhost:$Porta/  (Ctrl+C para parar)"

try {
  while ($http.IsListening) {
    $ctx = $http.GetContext()
    $caminho = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($caminho -eq '' -or $caminho.EndsWith('/')) { $caminho += 'index.html' }

    # GetFullPath resolve ".." — só entrega arquivo que esteja dentro da raiz do projeto
    $arquivo = [System.IO.Path]::GetFullPath((Join-Path $Raiz $caminho))
    if ($arquivo.StartsWith($Raiz) -and (Test-Path -LiteralPath $arquivo -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($arquivo).ToLower()
      $ctx.Response.ContentType = if ($tipos.ContainsKey($ext)) { $tipos[$ext] } else { 'application/octet-stream' }
      $ctx.Response.Headers.Add('Cache-Control', 'no-store')
      $bytes = [System.IO.File]::ReadAllBytes($arquivo)
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
    else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  }
}
finally {
  $http.Stop()
}
