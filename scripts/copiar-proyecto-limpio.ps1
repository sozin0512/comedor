# Copia HonduRaite SIN carpetas de rutas largas (node_modules, builds, etc.)
# Uso:
#   powershell -ExecutionPolicy Bypass -File scripts\copiar-proyecto-limpio.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\copiar-proyecto-limpio.ps1 -Destino "C:\dev\honduraite"

param(
    [string]$Destino = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not $Destino) {
    $Destino = Join-Path ([Environment]::GetFolderPath("Desktop")) "honduraite-github"
}

Write-Host ""
Write-Host "Origen : $Root"
Write-Host "Destino: $Destino"
Write-Host ""

if (Test-Path $Destino) {
    $ans = Read-Host "La carpeta destino ya existe. Se vaciara y se volvera a copiar. Continuar? (S/N)"
    if ($ans -notmatch '^[sS]') {
        Write-Host "Cancelado."
        exit 0
    }
    Remove-Item -LiteralPath $Destino -Recurse -Force
}

New-Item -ItemType Directory -Path $Destino -Force | Out-Null

# Exclusiones: lo que causa "nombre demasiado largo" y basura de build
$excludeDirs = @(
    'node_modules',
    '.git',
    '.gradle',
    'build',
    'dist',
    '.idea',
    '.vscode',
    '.firebase',
    '__pycache__',
    'captures',
    '.cxx'
)

# Robocopy es mas fiable en Windows con muchas carpetas
$xdArgs = @()
foreach ($d in $excludeDirs) {
    $xdArgs += '/XD'
    $xdArgs += $d
}

# /E copiar subdirs, /NFL /NDL menos ruido, /NJH /NJS sin header, /R:1 reintentos
$robolog = Join-Path $env:TEMP "honduraite-copy-log.txt"
$args = @(
    $Root,
    $Destino,
    '/E',
    '/R:1',
    '/W:1',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/XD'
) + $excludeDirs

Write-Host "Copiando (sin node_modules ni builds)..."
& robocopy @args | Out-Null
$code = $LASTEXITCODE

# Robocopy: 0-7 = exito parcial/ok; >=8 error real
if ($code -ge 8) {
    Write-Host "ERROR al copiar. Codigo robocopy: $code"
    exit 1
}

# Borrar node_modules residuales por si quedo alguno anidado con otro nombre
Get-ChildItem -LiteralPath $Destino -Recurse -Directory -Filter 'node_modules' -ErrorAction SilentlyContinue |
    ForEach-Object {
        Write-Host "Eliminando residual: $($_.FullName)"
        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }

Write-Host ""
Write-Host "Listo. Copia limpia en:"
Write-Host "  $Destino"
Write-Host ""
Write-Host "Siguiente paso en esa carpeta:"
Write-Host "  1) Abrela en GitHub Desktop o:"
Write-Host "  2) git init  /  git add .  /  git commit  /  git remote add origin ..."
Write-Host "  3) En la PC destino: npm install  y  cd functions && npm install"
Write-Host ""
Write-Host "NO copies node_modules a mano. Siempre se reinstala con npm install."
Write-Host ""
