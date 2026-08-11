param(
  [Parameter(Mandatory = $true)]
  [string]$Project,
  [int]$MaxRepairs = 80,
  [int]$MaxNarrationRepairsPerScene = 2,
  [int]$MaxActionsPerScene = 5,
  [string]$Model = "",
  [ValidateSet("low", "medium", "high")]
  [string]$ReasoningEffort = "low",
  [switch]$NoRender
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
& chcp.com 65001 | Out-Null
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$projectDir = Join-Path $repoRoot (Join-Path "projects" $Project)
$storyboardData = Join-Path $projectDir "storyboard-data.ts"
$storyboard = Join-Path $projectDir "storyboard.json"
$ttsScenes = Join-Path $projectDir "tts_scenes.json"
$repairTemplate = Join-Path $PSScriptRoot "prompts/auto-fidelity-repair.md"
$runLogDir = Join-Path $projectDir ".auto-fidelity"

foreach ($required in @($projectDir, $storyboardData, $repairTemplate)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required path missing: $required" }
}
New-Item -ItemType Directory -Force -Path $runLogDir | Out-Null
$sceneRepairCounts = @{}
$sceneActionCounts = @{}
$sceneFingerprints = @{}
$statePath = Join-Path $runLogDir "state.json"

function Import-StateMap($Object) {
  $map = @{}
  if ($null -ne $Object) {
    foreach ($property in $Object.PSObject.Properties) { $map[$property.Name] = $property.Value }
  }
  return $map
}

if (Test-Path -LiteralPath $statePath) {
  $savedState = Get-Content -Raw -Encoding utf8 -LiteralPath $statePath | ConvertFrom-Json
  $sceneRepairCounts = Import-StateMap $savedState.repairCounts
  $sceneActionCounts = Import-StateMap $savedState.actionCounts
  $sceneFingerprints = Import-StateMap $savedState.candidateFingerprints
}

function Save-RepairState {
  $state = @{
    schemaVersion = 1; project = $Project
    repairCounts = $sceneRepairCounts; actionCounts = $sceneActionCounts
    candidateFingerprints = $sceneFingerprints
  }
  Set-Content -LiteralPath $statePath -Value ($state | ConvertTo-Json -Depth 12) -Encoding utf8
}

function Invoke-Checked([string]$Label, [string]$File, [string[]]$Arguments) {
  Write-Host "`n[$Label] $File $($Arguments -join ' ')" -ForegroundColor Cyan
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

function Get-LatestFailure([datetime]$SinceUtc) {
  $runs = Join-Path $projectDir ".tts-runs"
  $failed = Get-ChildItem -LiteralPath $runs -Recurse -Filter "failed.json" -File |
    Where-Object { $_.LastWriteTimeUtc -ge $SinceUtc } |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $failed) { throw "TTS failed but produced no failure report for the current run under $runs" }
  $failedPayload = Get-Content -Raw -Encoding utf8 -LiteralPath $failed.FullName | ConvertFrom-Json
  $sceneId = [string]$failedPayload.sceneId
  $rejected = Get-ChildItem -LiteralPath (Join-Path $failed.Directory.FullName "rejected") `
    -Filter "$sceneId.attempt-*.json" -File |
    Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if (-not $rejected) { throw "No rejected alignment report found for $sceneId" }
  return @{ Failed = $failed; Rejected = $rejected; SceneId = $sceneId; Payload = $failedPayload }
}

function Stop-WithCircuitBreaker($Failure, [string]$Reason) {
  $report = @{
    schemaVersion = 1; project = $Project; sceneId = $Failure.SceneId
    reason = $Reason; classification = $Failure.Payload.classification
    policyResult = $Failure.Payload.policyResult
    repairCount = $sceneRepairCounts[$Failure.SceneId]
    actionCount = $sceneActionCounts[$Failure.SceneId]
    candidateFingerprints = @($sceneFingerprints[$Failure.SceneId])
    failedReport = $Failure.Failed.FullName
  }
  $path = Join-Path $runLogDir "circuit-breaker.json"
  Set-Content -LiteralPath $path -Value ($report | ConvertTo-Json -Depth 8) -Encoding utf8
  throw "Circuit breaker: $Reason for $($Failure.SceneId). See $path"
}

for ($repair = 0; $repair -le $MaxRepairs; $repair++) {
  Invoke-Checked "storyboard" "npx" @("ts-node", "scripts/build-storyboard.ts", "--project", $Project)
  Invoke-Checked "tts-input" "npx" @("ts-node", "scripts/storyboard-to-tts.ts", "--storyboard", $storyboard)

  $ttsLog = Join-Path $runLogDir ("tts-{0:D3}.log" -f $repair)
  Write-Host "`n[tts fidelity] repair pass $repair/$MaxRepairs" -ForegroundColor Cyan
  $env:TTS_REPAIR_COUNTS_JSON = $sceneRepairCounts | ConvertTo-Json -Compress
  $savedErrorPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $ttsStartedUtc = [datetime]::UtcNow.AddSeconds(-1)
  & py -3.11 scripts/tts_router.py --project $Project 2>&1 | Tee-Object -FilePath $ttsLog
  $ttsExit = $LASTEXITCODE
  $ErrorActionPreference = $savedErrorPreference
  if ($ttsExit -eq 0) {
    Write-Host "All TTS fidelity gates passed." -ForegroundColor Green
    break
  }
  if ($repair -eq $MaxRepairs) { throw "TTS fidelity still fails after $MaxRepairs repairs. See $ttsLog" }

  $failure = Get-LatestFailure $ttsStartedUtc
  if (-not $sceneRepairCounts.ContainsKey($failure.SceneId)) { $sceneRepairCounts[$failure.SceneId] = 0 }
  if (-not $sceneActionCounts.ContainsKey($failure.SceneId)) { $sceneActionCounts[$failure.SceneId] = 0 }
  if (-not $sceneFingerprints.ContainsKey($failure.SceneId)) { $sceneFingerprints[$failure.SceneId] = @() }
  $sceneActionCounts[$failure.SceneId] = [int]$sceneActionCounts[$failure.SceneId] + 1
  $fingerprint = [string]$failure.Payload.candidateFingerprint
  if ($fingerprint -and $sceneFingerprints[$failure.SceneId] -contains $fingerprint) {
    Stop-WithCircuitBreaker $failure "candidate fingerprint repeated"
  }
  if ($sceneActionCounts[$failure.SceneId] -gt $MaxActionsPerScene) {
    Stop-WithCircuitBreaker $failure "action budget exceeded"
  }
  $repairable = @("tts_omission", "tts_insertion", "critical_claim_mismatch", "scene_too_long")
  if ($repairable -notcontains [string]$failure.Payload.classification) {
    Stop-WithCircuitBreaker $failure "classification requires human review, not narration rewrite"
  }
  $sceneRepairCounts[$failure.SceneId] = [int]$sceneRepairCounts[$failure.SceneId] + 1
  Save-RepairState
  if ($sceneRepairCounts[$failure.SceneId] -gt $MaxNarrationRepairsPerScene) {
    Stop-WithCircuitBreaker $failure "narration repair budget exceeded"
  }
  $rejectedPayload = Get-Content -Raw -Encoding utf8 -LiteralPath $failure.Rejected.FullName | ConvertFrom-Json
  $ttsPayload = Get-Content -Raw -Encoding utf8 -LiteralPath $ttsScenes | ConvertFrom-Json
  $scene = $ttsPayload.scenes | Where-Object { $_.id -eq $failure.SceneId } | Select-Object -First 1
  if (-not $scene) { throw "Could not find $($failure.SceneId) in $ttsScenes" }
  $observed = (($rejectedPayload.words | ForEach-Object { $_.word }) -join " ")
  $metrics = $rejectedPayload.metrics | ConvertTo-Json -Compress
  $history = @($sceneFingerprints[$failure.SceneId]) -join ", "
  $prompt = Get-Content -Raw -Encoding utf8 -LiteralPath $repairTemplate
  $prompt = $prompt.Replace("{{PROJECT_ID}}", $Project)
  $prompt = $prompt.Replace("{{LANGUAGE}}", [string]$ttsPayload.language)
  $prompt = $prompt.Replace("{{STORYBOARD_DATA}}", $storyboardData)
  $prompt = $prompt.Replace("{{SCENE_ID}}", $failure.SceneId)
  $prompt = $prompt.Replace("{{SOURCE_RANGE}}", (($scene.sourceRange | ConvertTo-Json -Compress)))
  $prompt = $prompt.Replace("{{SCENE_FAILURE_COUNT}}", [string]$sceneRepairCounts[$failure.SceneId])
  $prompt = $prompt.Replace("{{FAILED_REPORT}}", $failure.Failed.FullName)
  $prompt = $prompt.Replace("{{REJECTED_REPORT}}", $failure.Rejected.FullName)
  $prompt = $prompt.Replace("{{EXPECTED_TEXT}}", [string]$scene.spokenText)
  $prompt = $prompt.Replace("{{OBSERVED_TEXT}}", $observed)
  $prompt = $prompt.Replace("{{METRICS}}", $metrics)
  $prompt = $prompt.Replace("{{ASR_CONFIDENCE}}", [string]$rejectedPayload.asrConfidence)
  $prompt = $prompt.Replace("{{CLASSIFICATION}}", [string]$failure.Payload.classification)
  $prompt = $prompt.Replace("{{TOKEN_DIFF}}", (($failure.Payload.tokenDiff | ConvertTo-Json -Depth 8 -Compress)))
  $prompt = $prompt.Replace("{{CRITICAL_CLAIM_DIFF}}", (($failure.Payload.criticalClaimDiff | ConvertTo-Json -Depth 8 -Compress)))
  $prompt = $prompt.Replace("{{CRITICAL_CLAIMS}}", (($scene.criticalClaims | ConvertTo-Json -Compress)))
  $prompt = $prompt.Replace("{{CANDIDATE_HISTORY}}", $history)

  $promptPath = Join-Path $runLogDir ("repair-{0:D3}-{1}.md" -f ($repair + 1), $failure.SceneId)
  Set-Content -LiteralPath $promptPath -Value $prompt -Encoding utf8
  $codexArgs = @(
    "exec", "--cd", $repoRoot, "--sandbox", "danger-full-access", "--ephemeral",
    "-c", 'approval_policy="never"', "-c", ('model_reasoning_effort="{0}"' -f $ReasoningEffort)
  )
  if ($Model) { $codexArgs += @("--model", $Model) }
  # Send the complete contract through stdin. The CLI's `-` prompt mode avoids
  # Windows command-line parsing of long JSON token diffs and embedded quotes.
  $codexArgs += "-"
  Write-Host "[repair] $($failure.SceneId) via Codex" -ForegroundColor Yellow
  $prompt | & codex @codexArgs
  if ($LASTEXITCODE -ne 0) { throw "Codex repair failed for $($failure.SceneId)" }
  # A fingerprint is only consumed after the authored repair completed. A
  # failed CLI invocation must remain retryable and must not trip the circuit.
  if ($fingerprint) { $sceneFingerprints[$failure.SceneId] += $fingerprint }
  Save-RepairState
}

$durations = Join-Path $projectDir "durations.json"
$words = Join-Path $projectDir "words.json"
$timeline = Join-Path $projectDir "timeline.json"
$audio = "audio/$Project/voice.wav"
Invoke-Checked "compile" "npx" @("ts-node", "scripts/compile-storyboard.ts", "--storyboard", $storyboard, "--out", $timeline, "--durations", $durations, "--words", $words, "--audio", $audio)
Invoke-Checked "validate" "npm" @("run", "validate", "--", $timeline)
Invoke-Checked "quality" "npm" @("run", "quality", "--", $timeline)
if (-not $NoRender) {
  Invoke-Checked "render" "npx" @("ts-node", "scripts/render.ts", "--project", $Project)
  Write-Host "Production render complete: output/$Project/video.mp4" -ForegroundColor Green
}
