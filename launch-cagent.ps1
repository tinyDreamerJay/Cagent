$port = 4120
$proc = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess
if ($proc) {
    Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue
    Write-Host "Cleared port $port"
}
# Kill any existing Cagent instances
Get-Process -Name "Cagent" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Start with visible console for debugging
$proc = Start-Process -FilePath "D:\Cagent\release\win-unpacked\Cagent.exe" -WorkingDirectory "D:\Cagent\release\win-unpacked" -PassThru
Write-Host "Cagent started (PID: $($proc.Id))"
Write-Host "Close this window to stop Cagent"
$proc.WaitForExit()
