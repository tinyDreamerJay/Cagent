# Pi 剪贴板图片工具
# 用法：在 pi 中输入 /paste-image 或直接运行此脚本
# 从剪贴板读取图片，保存为临时 PNG，输出路径供 pi 读取

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$img = [System.Windows.Forms.Clipboard]::GetImage()
if (-not $img) {
    Write-Host "NO_IMAGE"
    exit 1
}

$tmpFile = [System.IO.Path]::Combine($env:TEMP, "pi-clipboard-$(Get-Date -Format 'yyyyMMddHHmmss').png")
$img.Save($tmpFile, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host $tmpFile
