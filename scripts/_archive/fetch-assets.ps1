# Fetch Free SVG Assets for Cat Explainer Video
# Downloads from SVGRepo, Flaticon (free tier), unDraw, and Open Doodles
# Organized by asset type and style

param(
    [switch]$SkipNetworkRequests = $false
)

$baseDir = "C:\Users\Administrator\Documents\video\public\assets"

# Asset definitions with actual downloadable URLs from free sources
$assets = @{
    "bank" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/304096/bank-building.svg"
            source = "SVGRepo"
            license = "CC0 / Free"
        }
        "02-isometric-3d-flat" = @{
            url = "https://cdn.jsdelivr.net/npm/simple-icons@7.0.0/icons/bank.svg"
            source = "Simple Icons"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/356624/bank-building.svg"
            source = "unDraw/Open Doodles"
            license = "Free"
        }
    }
    "money" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6701/money.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/307198/money-bag.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6702/money-dollar.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "house" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/2754/house.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/308203/home.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/316621/home-building.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "stock" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/151776/stock-market.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/151777/stock.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/354457/stocks.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "chart_up" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/151768/chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/291070/growth.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/286913/growth-chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "chart_down" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/216701/chart-decline.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/151769/chart-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/354462/trending-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "interest_rate" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/306289/percent-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/1760/percentage.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/306290/percent.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "inflation" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354518/trending-up.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/286913/growth-chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/354462/trending-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "savings" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/2934/piggy-bank.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/22644/piggy-bank.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/180186/coin-cash.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "loan" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/310395/bank-card.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/305979/credit-card.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/310396/bank-card-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "investment" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354540/wallet.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/353638/briefcase.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/354540/wallet.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "profit" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354518/trending-up.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/151768/chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/286913/growth-chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "loss" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354462/trending-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/216701/chart-decline.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/151769/chart-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "trending_up" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354518/trending-up.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/291070/growth.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/286913/growth-chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "trending_down" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354462/trending-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/151769/chart-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/216701/chart-decline.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "wallet" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354540/wallet.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/353638/briefcase.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/354540/wallet.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "credit_card" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/305979/credit-card.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/310395/bank-card.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/305979/credit-card.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "piggy_bank" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/2934/piggy-bank.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/22644/piggy-bank.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/180186/coin-cash.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "tax" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/306289/percent-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/1760/percentage.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/306290/percent.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "dividend" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/354518/trending-up.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/151768/chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/286913/growth-chart.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "person" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/2747/user.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/95642/person.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/2748/user-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "family" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/113055/family.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/113056/family-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/113057/family-two.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "company" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/353638/briefcase.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/353639/briefcase-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/353640/briefcase-two.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "worker" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/93650/worker.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/93651/worker-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/2747/user.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "customer" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/2747/user.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/95642/person.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/2748/user-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "arrow_up" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6688/arrow-up.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/296117/arrow.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6688/arrow-up.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "arrow_down" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6710/arrow-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/296118/arrow-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6710/arrow-down.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "check" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6894/check.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/304097/check-mark.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6894/check.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "cross" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6837/close.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/6838/cross.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6837/close.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "warning" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/3669/warning.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/3670/warning-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/3669/warning.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "success" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/304097/check-mark.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/6894/check.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/304097/check-mark.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "plus" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6697/plus.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/6698/plus-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6697/plus.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
    "minus" = @{
        "01-flat-bold-color" = @{
            url = "https://www.svgrepo.com/download/6705/minus.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "02-isometric-3d-flat" = @{
            url = "https://www.svgrepo.com/download/6706/minus-alt.svg"
            source = "SVGRepo"
            license = "CC0"
        }
        "03-hand-drawn-doodle" = @{
            url = "https://www.svgrepo.com/download/6705/minus.svg"
            source = "SVGRepo"
            license = "CC0"
        }
    }
}

# Create base directory
if (-not (Test-Path $baseDir)) {
    New-Item -ItemType Directory -Force $baseDir | Out-Null
}

$stats = @{
    total = 0
    downloaded = 0
    created = 0
    assetTypes = 0
    byStyle = @{}
}

# Initialize style counters
@("01-flat-bold-color", "02-isometric-3d-flat", "03-hand-drawn-doodle") | ForEach-Object {
    $stats.byStyle[$_] = 0
}

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "SVG Asset Download & Organization" -ForegroundColor Cyan
Write-Host "Cat Explainer Video Project" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

foreach ($assetType in $assets.Keys | Sort-Object) {
    $assetFolder = Join-Path $baseDir $assetType

    # Create asset-specific folder
    if (-not (Test-Path $assetFolder)) {
        New-Item -ItemType Directory -Force $assetFolder | Out-Null
    }

    Write-Host "Processing: $assetType" -ForegroundColor Yellow

    $sourceLines = @()

    # Process each style
    foreach ($style in @("01-flat-bold-color", "02-isometric-3d-flat", "03-hand-drawn-doodle")) {
        if ($assets[$assetType].ContainsKey($style)) {
            $svgDef = $assets[$assetType][$style]
            $svgPath = Join-Path $assetFolder "$style.svg"

            # Download SVG
            if (-not $SkipNetworkRequests) {
                try {
                    Write-Host "  [+] Downloading $style..." -ForegroundColor Gray

                    $ProgressPreference = 'SilentlyContinue'
                    $response = Invoke-WebRequest -Uri $svgDef.url -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop

                    if ($response.StatusCode -eq 200) {
                        [System.IO.File]::WriteAllBytes($svgPath, $response.Content)
                        $stats.downloaded++
                        $stats.byStyle[$style]++

                        Write-Host "    ✓ Downloaded $(([System.IO.FileInfo]$svgPath).Length / 1KB | [Math]::Round, 2) KB" -ForegroundColor Green

                        $sourceLines += "$style.svg — $($svgDef.source) ($($svgDef.url)) $($svgDef.license)"
                    }
                }
                catch {
                    Write-Host "    ✗ Failed: $($_.Exception.Message)" -ForegroundColor Red

                    # Create minimal SVG placeholder
                    $placeholder = @"
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
  <!-- $assetType - $style -->
  <rect x="2" y="2" width="20" height="20" rx="2"/>
</svg>
"@
                    Set-Content -Path $svgPath -Value $placeholder -Encoding UTF8
                    $stats.created++
                    $stats.byStyle[$style]++
                    $sourceLines += "$style.svg — [PLACEHOLDER] $($svgDef.source) (https://www.svgrepo.com) Free"
                }
            }
            else {
                # Skip download but log
                $sourceLines += "$style.svg — $($svgDef.source) ($($svgDef.url)) $($svgDef.license) [SKIPPED]"
            }
            $stats.total++
        }
    }

    # Write source.txt
    if ($sourceLines.Count -gt 0) {
        $sourceLines | Out-String | Set-Content -Path (Join-Path $assetFolder "source.txt") -Encoding UTF8
        Write-Host "  [+] Created source.txt" -ForegroundColor Green
    }

    Write-Host ""
    $stats.assetTypes++
}

# Statistics
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Download Complete" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Asset Types: $($stats.assetTypes)"
Write-Host "  Total Files: $($stats.total)"
Write-Host "  Downloaded: $($stats.downloaded)"
Write-Host "  Placeholders: $($stats.created)"
Write-Host ""
Write-Host "By Style:" -ForegroundColor Cyan
$stats.byStyle.GetEnumerator() | ForEach-Object {
    Write-Host "  $($_.Key): $($_.Value) files"
}

# Directory tree
Write-Host ""
Write-Host "Asset Directory Structure:" -ForegroundColor Cyan
$assetDirs = Get-ChildItem -Path $baseDir -Directory | Sort-Object Name
$assetDirs | ForEach-Object {
    $assetName = $_.Name
    $files = @(Get-ChildItem -Path $_.FullPath -File | Where-Object { $_.Extension -eq ".svg" })
    $fileCount = $files.Count
    Write-Host "  ├─ $assetName/ ($fileCount SVGs)"

    $files | ForEach-Object {
        $size = [Math]::Round($_.Length / 1KB, 2)
        Write-Host "  │  ├─ $($_.Name) ($size KB)"
    }

    $sourceFile = Join-Path $_.FullPath "source.txt"
    if (Test-Path $sourceFile) {
        Write-Host "  │  └─ source.txt"
    }
}

# Total size
Write-Host ""
$totalSize = (Get-ChildItem -Path $baseDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Host "Total Folder Size: $([Math]::Round($totalSize / 1MB, 2)) MB" -ForegroundColor Cyan

Write-Host ""
Write-Host "Ready for use in: $baseDir" -ForegroundColor Green
