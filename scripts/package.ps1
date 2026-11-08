#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskDist = Join-Path $taskRoot 'dist'
New-Item -ItemType Directory -Force -Path $taskDist | Out-Null

$taskFiles = @(
    '.gitattributes', '.gitignore', 'LICENSE', 'README.md', 'CHANGELOG.md',
    'package.json', 'package-lock.json', '启动课程助手.cmd', '停止课程助手.cmd',
    'data/.gitkeep', 'docs/harness-agent.md',
    'packages/harness-course-agent/LICENSE',
    'packages/harness-course-agent/package.json',
    'packages/harness-course-agent/cordis.patch.yml',
    'packages/harness-course-agent/index.js',
    'packages/harness-course-agent/bridge.js',
    'packages/harness-course-agent/protocol.js'
)
foreach ($taskFolder in 'src', 'public', 'scripts', 'tests', 'tests/fixtures') {
    $taskFiles += Get-ChildItem -LiteralPath (Join-Path $taskRoot $taskFolder) -File |
        Where-Object Extension -In '.js', '.cjs', '.html', '.css', '.ps1' |
        ForEach-Object { "$taskFolder/$($_.Name)" }
}

$taskCache = Join-Path $taskRoot 'npm-cache'
Push-Location $taskRoot
try {
    $taskPlugin = & npm.cmd pack ./packages/harness-course-agent --ignore-scripts --offline --silent --pack-destination $taskDist --cache $taskCache
    if ($LASTEXITCODE -ne 0 -or -not $taskPlugin) { throw 'Harness plugin packaging failed.' }
}
finally {
    Pop-Location
}

$taskVersion = (Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json).version
$taskOutput = Join-Path $taskDist ('course-assistant-v' + $taskVersion + '.zip')
$taskTemp = Join-Path $taskDist ([guid]::NewGuid().ToString() + '.tmp')
try {
    $taskZip = [IO.Compression.ZipFile]::Open($taskTemp, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($taskFile in ($taskFiles | Sort-Object)) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $taskZip, (Join-Path $taskRoot $taskFile), $taskFile
            ) | Out-Null
        }
    }
    finally {
        $taskZip.Dispose()
    }
    Move-Item -LiteralPath $taskTemp -Destination $taskOutput -Force
}
finally {
    if (Test-Path -LiteralPath $taskTemp) { Remove-Item -LiteralPath $taskTemp }
}

Get-Item -LiteralPath $taskOutput, (Join-Path $taskDist $taskPlugin) | Select-Object FullName, Length
