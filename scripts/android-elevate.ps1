param(
    [Parameter(Mandatory = $true)][string]$RequestPath,
    [Parameter(Mandatory = $true)][string]$ResultPath,
    [switch]$Elevated
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8
if (-not $Elevated) {
    try {
        $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RequestPath "{1}" -ResultPath "{2}" -Elevated' -f $PSCommandPath, $RequestPath, $ResultPath
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        $logPath = $ResultPath + ".log"
        if (Test-Path -LiteralPath $logPath) { Get-Content -LiteralPath $logPath -Encoding UTF8 }
        exit $process.ExitCode
    } catch {
        [Console]::Error.WriteLine('Administrator approval was cancelled or elevation failed: ' + $_.Exception.Message)
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
    # Windows PowerShell treats native stderr as ErrorRecord; continue collecting
    # diagnostics instead of aborting on harmless tool warnings.
    $ErrorActionPreference = 'Continue'
    & $request.node @nodeArgs 2>&1 | ForEach-Object { $_.ToString() } | Out-File -LiteralPath ($ResultPath + ".log") -Encoding utf8
    $ErrorActionPreference = 'Stop' 
    $exitCode = $LASTEXITCODE
} catch {
    $_.Exception.Message | Out-File -LiteralPath ($ResultPath + ".log") -Encoding utf8 -Append
    $exitCode = 1
} finally {
    @{ exitCode = $exitCode } | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultPath -Encoding ASCII
}
exit $exitCode
