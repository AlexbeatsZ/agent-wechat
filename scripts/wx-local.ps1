$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$localHome = Join-Path $repoRoot ".agent-wechat-home"
$wxCmd = Join-Path $repoRoot "node_modules\.bin\wx.cmd"

if (-not (Test-Path $wxCmd)) {
  throw "Local wx command not found. Run: pnpm install"
}

New-Item -ItemType Directory -Force -Path $localHome | Out-Null

$oldUserProfile = $env:USERPROFILE
$oldHomeDrive = $env:HOMEDRIVE
$oldHomePath = $env:HOMEPATH

try {
  $env:USERPROFILE = $localHome
  $env:HOMEDRIVE = Split-Path -Qualifier $localHome
  $env:HOMEPATH = $localHome.Substring($env:HOMEDRIVE.Length)
  $wxArgs = @($args)
  if ($wxArgs.Count -gt 0 -and $wxArgs[0] -eq "--") {
    $wxArgs = @($wxArgs | Select-Object -Skip 1)
  }
  & $wxCmd @wxArgs
  exit $LASTEXITCODE
} finally {
  $env:USERPROFILE = $oldUserProfile
  $env:HOMEDRIVE = $oldHomeDrive
  $env:HOMEPATH = $oldHomePath
}
