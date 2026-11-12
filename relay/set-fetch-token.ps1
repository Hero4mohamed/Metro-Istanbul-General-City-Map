# Creates the secret that lets the notices job on GitHub read the ferry announcements through the relay, and stores it in
# the two places that need it: the Worker (as FETCH_TOKEN) and this repository's GitHub Actions secrets (as RELAY_FETCH_TOKEN).
# The value is random, is never shown, and is not written to any file. Run it again at any time to replace the secret.
#
#   powershell -ExecutionPolicy Bypass -File relay\set-fetch-token.ps1
#
# Needs: `npx wrangler login` done once on this computer, and `gh` signed in.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')

Write-Host 'Storing the secret in the Worker (Cloudflare)...'
$token | npx wrangler secret put FETCH_TOKEN
if ($LASTEXITCODE -ne 0) { Write-Host 'Cloudflare refused it. Nothing was changed on GitHub.'; exit 1 }

Write-Host 'Storing the same secret for the job on GitHub...'
$token | gh secret set RELAY_FETCH_TOKEN --repo Hero4mohamed/Metro-Istanbul-General-City-Map
if ($LASTEXITCODE -ne 0) { Write-Host 'GitHub refused it. The Worker has the new secret but the job does not: run this script again.'; exit 1 }

$token = $null
Write-Host 'Done. The ferry notices can now be refreshed by the job on GitHub.'
