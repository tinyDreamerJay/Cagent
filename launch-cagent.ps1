$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$executable = Join-Path $repoRoot "release\win-unpacked\Cagent.exe"

# Compatibility entry point only. The desktop shortcut launches the EXE directly.
Start-Process -FilePath $executable -WorkingDirectory $repoRoot
