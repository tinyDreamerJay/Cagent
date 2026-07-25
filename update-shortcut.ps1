$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$executable = Join-Path $repoRoot "release\win-unpacked\Cagent.exe"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\Desktop\Cagent.lnk")
$shortcut.TargetPath = $executable
$shortcut.Arguments = ""
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$executable,0"
$shortcut.WindowStyle = 1
$shortcut.Save()
Write-Host "Updated"
