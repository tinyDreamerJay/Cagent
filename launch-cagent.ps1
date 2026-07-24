$port = 4120
$proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
if ($proc) {
    Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
    Write-Host "Cleared port $port"
}
# Kill any existing Cagent instances
Get-Process -Name "Cagent" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Keep the agent workspace at the repository root; the executable itself lives in release.
$proc = Start-Process -FilePath "D:\Cagent\release\win-unpacked\Cagent.exe" -WorkingDirectory "D:\Cagent" -PassThru
Write-Host "Cagent started (PID: $($proc.Id))"
Write-Host "Close this window to stop Cagent"
$proc.WaitForExit()
