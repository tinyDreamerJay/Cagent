$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut("$env:USERPROFILE\Desktop\Cagent.lnk")
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""D:\Cagent\launch-cagent.ps1"""
$shortcut.WorkingDirectory = "D:\Cagent"
$shortcut.IconLocation = "D:\Cagent\release\win-unpacked\Cagent.exe,0"
$shortcut.Save()
Write-Host "Updated"
