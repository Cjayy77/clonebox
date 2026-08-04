# Clonebox installer (Windows)
#
#   powershell -ExecutionPolicy Bypass -File install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1 -DryRun
#
# -DryRun prints everything it WOULD do without changing anything.
# Items needing admin rights are collected into elevated-commands.ps1 rather
# than silently hanging on a UAC prompt this script cannot answer.

param([switch]$DryRun, [switch]$YesEquivalents, [switch]$NoEquivalents)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $here "manifest.json"

if (-not (Test-Path $manifestPath)) {
    Write-Host "manifest.json not found next to this script. Aborting." -ForegroundColor Red
    exit 1
}

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$results = @()
$elevatedCommands = @()

function Have-Cmd($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$isAdmin = Test-IsAdmin
$samePlatform = ($manifest.sourcePlatform -eq "win32")

Write-Host "Clonebox — restoring $($manifest.items.Count) items captured on $($manifest.sourcePlatform) at $($manifest.createdAt)" -ForegroundColor Cyan
if ($DryRun) { Write-Host "DRY RUN — nothing will actually be installed." -ForegroundColor Magenta }
if (-not $isAdmin) { Write-Host "Not running as admin — items needing elevation will be written to elevated-commands.ps1 for you to run separately." -ForegroundColor Yellow }
if (-not $samePlatform) {
    Write-Host "" 
    Write-Host "This manifest came from $($manifest.sourcePlatform), not Windows." -ForegroundColor Yellow
    Write-Host "Compiled SDK folders will NOT run here and are skipped." -ForegroundColor Yellow
    Write-Host "See COMPATIBILITY.md for what does and does not carry over." -ForegroundColor Yellow
}
Write-Host ""

function Add-ToUserPath($newPath) {
    $currentUserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentUserPath -split ';' -contains $newPath) {
        Write-Host "  Already on PATH: $newPath" -ForegroundColor DarkGray
        return
    }
    if ($DryRun) {
        Write-Host "  [dry run] would add to PATH: $newPath" -ForegroundColor Magenta
        return
    }
    $updated = if ($currentUserPath) { "$currentUserPath;$newPath" } else { $newPath }
    if ($updated.Length -gt 2000) {
        Write-Host "  PATH is near the length limit — add manually: $newPath" -ForegroundColor Yellow
        return
    }
    [Environment]::SetEnvironmentVariable("Path", $updated, "User")
    $env:Path = "$env:Path;$newPath"
    Write-Host "  Added to PATH (permanent, user-level): $newPath" -ForegroundColor Green
}

$equivPolicy = if ($manifest.equivalentPolicy) { $manifest.equivalentPolicy } else { "ask" }
if ($YesEquivalents) { $equivPolicy = "always" }
if ($NoEquivalents) { $equivPolicy = "never" }

# Returns $true to substitute. Remembers "all"/"skip all" for the rest of the run.
function Confirm-Equivalent($label, $cmd, $note) {
    if ($script:equivPolicy -eq "always") { return $true }
    if ($script:equivPolicy -eq "never") { return $false }

    Write-Host ""
    Write-Host "  $label is not available on Windows." -ForegroundColor Yellow
    Write-Host "  Verified equivalent: $cmd"
    if ($note) { Write-Host "  Note: $note" -ForegroundColor DarkGray }
    $reply = Read-Host "  Install this equivalent? [y]es / [n]o / [a]ll / [s]kip all"
    switch ($reply.ToLower()) {
        "y" { return $true }
        "yes" { return $true }
        "a" { $script:equivPolicy = "always"; Write-Host "  -> substituting all remaining." -ForegroundColor Cyan; return $true }
        "s" { $script:equivPolicy = "never"; Write-Host "  -> skipping all remaining." -ForegroundColor Cyan; return $false }
        default { return $false }
    }
}

function Invoke-Install($label, $cmd, $needsElev, $isEquiv, $equivNote) {
    if ($needsElev -and -not $isAdmin) {
        $script:elevatedCommands += $cmd
        if ($isEquiv) {
            $script:results += "[DEFERRED-EQUIV] $label -> Windows equivalent queued for admin: $cmd"
        } else {
            $script:results += "[DEFERRED] $label: needs admin"
        }
        return $true
    }

    if ($DryRun) {
        if ($isEquiv) {
            Write-Host "  [dry run] Windows equivalent: $cmd" -ForegroundColor Magenta
        } else {
            Write-Host "  [dry run] $cmd" -ForegroundColor Magenta
        }
        return $true
    }

    try {
        Invoke-Expression $cmd
        if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
        if ($isEquiv) {
            Write-Host "  Installed the Windows equivalent instead." -ForegroundColor Green
            $script:results += "[OK-EQUIV] $label -> installed the Windows equivalent: $cmd"
            if ($equivNote) { $script:results += "           note: $equivNote" }
        } else {
            $script:results += "[OK] $label"
        }
        return $true
    } catch {
        return $false
    }
}

# ---------- Portable SDK folders ----------
$sdkItems = @($manifest.items | Where-Object { $_.type -eq "portable-folder" })

if ($sdkItems.Count -gt 0 -and $samePlatform) {
    Write-Host "Portable SDKs in this package:" -ForegroundColor Yellow
    foreach ($item in $sdkItems) { Write-Host "  - $($item.name)" }
    $destRoot = if ($DryRun) { "C:\sdks" } else { Read-Host "Extract these to which folder? (e.g. C:\sdks)" }
    if (-not $DryRun -and -not (Test-Path $destRoot)) { New-Item -ItemType Directory -Path $destRoot -Force | Out-Null }

    foreach ($item in $sdkItems) {
        $zipFull = Join-Path $here $item.zipFile
        $destFolder = Join-Path $destRoot ($item.id -replace "portable:", "")
        if (-not (Test-Path $zipFull)) {
            Write-Host "Missing archive for $($item.name) — skipping" -ForegroundColor Red
            $results += "[FAIL] $($item.name): archive not found in package"
            continue
        }
        Write-Host "Extracting $($item.name) -> $destFolder"
        if ($DryRun) {
            Write-Host "  [dry run] would extract and add to PATH" -ForegroundColor Magenta
            continue
        }
        try {
            Expand-Archive -Path $zipFull -DestinationPath $destFolder -Force
            $binCandidate = if ($item.binSubdir) { Join-Path $destFolder $item.binSubdir } else { $destFolder }
            if (Test-Path $binCandidate) { Add-ToUserPath $binCandidate } else { Add-ToUserPath $destFolder }
            $results += "[OK] $($item.name) -> $destFolder"
        } catch {
            Write-Host "  Failed: $_" -ForegroundColor Red
            $results += "[FAIL] $($item.name): $_"
        }
    }
    Write-Host ""
} elseif ($sdkItems.Count -gt 0) {
    foreach ($item in $sdkItems) {
        $n = $item.name
        $eq = $null
        if ($item.equivalents -and $item.equivalents.win32) { $eq = $item.equivalents.win32 }
        if ($eq -and $eq.cmd) {
            if (Confirm-Equivalent "$n (compiled binary can't cross OS)" $eq.cmd $eq.note) {
                if (Invoke-Install $n $eq.cmd $eq.needsElevation $true $eq.note) { continue }
                $results += "[FAIL-EQUIV] $n"
            } else {
                $results += "[DECLINED] $n : equivalent declined"
            }
        } elseif ($n -match "Flutter" -and (Have-Cmd "fvm")) {
            Write-Host "Flutter: installing via fvm at version $($item.version) (zipped binary is not usable cross-OS)"
            if (-not $DryRun) { fvm install $item.version }
            $results += "[OK] Flutter via fvm"
        } elseif ($n -match "Node" -and (Have-Cmd "nvm")) {
            Write-Host "Node: installing via nvm at version $($item.version)"
            if (-not $DryRun) { nvm install $item.version }
            $results += "[OK] Node via nvm"
        } else {
            $results += "[SKIP] $n — cross-OS binary, install fvm/nvm or set it up manually"
        }
    }
    Write-Host ""
}

# ---------- Package manager items ----------
# Try the original command when its package manager exists here. Otherwise
# (or on failure) fall back to the verified Windows equivalent recorded in the
# manifest, and state clearly that a substitution happened.
foreach ($item in @($manifest.items | Where-Object { $_.type -eq "package" -and $_.installCmd })) {
    $tool = $item.source
    $bin = switch ($tool) {
        "vscode" { "code" }
        "brew-cask" { "brew" }
        default { $tool }
    }

    $equiv = $null
    if ($item.equivalents -and $item.equivalents.win32) { $equiv = $item.equivalents.win32 }

    $originalUsable = (Have-Cmd $bin)
    if (-not $samePlatform -and -not $item.portable) { $originalUsable = $false }

    if ($originalUsable) {
        Write-Host "Installing $($item.name) via $tool..."
        if (Invoke-Install $item.name $item.installCmd $item.needsElevation $false $null) { continue }
        if ($equiv -and $equiv.cmd) {
            Write-Host "  $tool install failed." -ForegroundColor Yellow
            if (Confirm-Equivalent $item.name $equiv.cmd $equiv.note) {
                if (Invoke-Install $item.name $equiv.cmd $equiv.needsElevation $true $equiv.note) { continue }
            } else {
                $results += "[DECLINED] $($item.name): equivalent available but not installed by your choice"
                continue
            }
        }
        Write-Host "  Failed: $($item.name)" -ForegroundColor Red
        $results += "[FAIL] $($item.name)"
        continue
    }

    if ($equiv -and $equiv.cmd) {
        $equivBin = switch ($equiv.manager) {
            "script" { "curl" }
            "manual" { "" }
            "none" { "" }
            default { $equiv.manager }
        }
        if ($equivBin -and -not (Have-Cmd $equivBin)) {
            $results += "[SKIP] $($item.name): Windows equivalent needs '$equivBin', which isn't installed"
            continue
        }
        if (-not (Confirm-Equivalent $item.name $equiv.cmd $equiv.note)) {
            $results += "[DECLINED] $($item.name): Windows equivalent available but declined"
            continue
        }
        if (Invoke-Install $item.name $equiv.cmd $equiv.needsElevation $true $equiv.note) { continue }
        $results += "[FAIL-EQUIV] $($item.name): Windows equivalent failed"
        continue
    }

    if ($equiv -and $equiv.note) {
        $results += "[NO-EQUIV] $($item.name): $($equiv.note)"
    } else {
        $results += "[NO-EQUIV] $($item.name) ($tool): not in the equivalence table — install manually"
    }
}

# ---------- Deferred elevated commands ----------
if ($elevatedCommands.Count -gt 0 -and -not $DryRun) {
    $elevatedPath = Join-Path $here "elevated-commands.ps1"
    $elevatedCommands | Set-Content $elevatedPath
    Write-Host ""
    Write-Host "$($elevatedCommands.Count) item(s) need admin rights." -ForegroundColor Yellow
    Write-Host "Right-click PowerShell -> Run as Administrator, then run:" -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File \"$elevatedPath\"" -ForegroundColor Yellow
}

# ---------- Manual items ----------
$manualItems = @($manifest.items | Where-Object { $_.type -eq "manual-note" })
if ($manualItems.Count -gt 0) {
    Write-Host ""
    Write-Host "Needs manual attention:" -ForegroundColor Yellow
    foreach ($item in $manualItems) {
        Write-Host "  - $($item.name)"
        if ($item.note) { Write-Host "      $($item.note)" -ForegroundColor DarkGray }
    }
}

# ---------- Summary ----------
Write-Host ""
Write-Host "----- Summary -----" -ForegroundColor Cyan
$results | ForEach-Object { Write-Host $_ }
if (-not $DryRun) {
    $logPath = Join-Path $here "install-log.txt"
    $results | Set-Content $logPath
    Write-Host ""
    Write-Host "Log written to $logPath"
    Write-Host "Open a NEW terminal so PATH changes take effect." -ForegroundColor Green
}
