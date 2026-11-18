param(
    [Parameter(Mandatory = $true)][string]$RequestPath,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
if (-not $Elevated) {
    try {
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RequestPath "{1}" -ResultPath "{2}" -Elevated' -f $PSCommandPath, $RequestPath, $ResultPath
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        $logPath = $ResultPath + ".log"
        if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath }
        exit $process.ExitCode
    } catch {
        Write-Error ('管理员确认被取消或提权失败：' + $_.Exception.Message)
        exit 1
    }
}
$exitCode = 1
try {
    $request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $request.environment.PSObject.Properties) {
        [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
    }
    Set-Location -LiteralPath $request.root
    $nodeArgs = @((Join-Path $request.root 'scripts/android-run.mjs'), '--elevated') + @($request.args)
    & $request.node @nodeArgs *> ($ResultPath + ".log")
    $exitCode = $LASTEXITCODE
} catch {
    $exitCode = 1
} finally {
    @{ exitCode = $exitCode } | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding ASCII
}
exit $exitCode
