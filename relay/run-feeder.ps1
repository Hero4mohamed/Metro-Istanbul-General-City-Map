# Starts the TurkMaps feeder and keeps its output in a log. Meant to be started by a Windows scheduled task at sign-in
# (and again every 15 minutes: a second copy is refused while one is running, so this only restarts it if it stopped).
# It expects feeder.cjs and feeder.env next to it.
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $dir 'logs'
$log = Join-Path $logDir 'feeder.log'
New-Item -ItemType Directory -Force $logDir | Out-Null
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) { Move-Item -Force $log ($log + '.old') }
function Note($text) { Add-Content -Encoding utf8 -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $text) }

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { Note 'node.exe was not found on this computer; the feeder cannot run'; exit 1 }
Note 'starting the feeder'
& $node (Join-Path $dir 'feeder.cjs') 2>&1 | ForEach-Object { Add-Content -Encoding utf8 -Path $log -Value ([string]$_) }
Note ('the feeder stopped (exit code ' + $LASTEXITCODE + ')')
