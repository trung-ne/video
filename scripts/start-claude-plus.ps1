$ErrorActionPreference = 'Stop'

$proxyExe = Join-Path $env:USERPROFILE '.local\bin\claude-code-proxy.exe'
$claudeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
$proxyPort = 18765

if (-not (Test-Path -LiteralPath $proxyExe)) {
    throw "claude-code-proxy was not found at $proxyExe"
}
if (-not (Test-Path -LiteralPath $claudeExe)) {
    throw "Claude Code native binary was not found at $claudeExe"
}

if (-not (Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $proxyExe -ArgumentList 'serve' -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(10)
    while (-not (Get-NetTCPConnection -LocalPort $proxyPort -State Listen -ErrorAction SilentlyContinue)) {
        if ((Get-Date) -ge $deadline) {
            throw "claude-code-proxy did not start listening on port $proxyPort"
        }
        Start-Sleep -Milliseconds 250
    }
}

$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:$proxyPort"
$env:ANTHROPIC_AUTH_TOKEN = 'unused'
$env:ANTHROPIC_MODEL = $null
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = 'gpt-5.6-sol'
$env:ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = 'GPT-5.6 Sol'
$env:ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES = 'effort,xhigh_effort,max_effort'
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = 'gpt-5.6-terra'
$env:ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = 'GPT-5.6 Terra'
$env:ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES = 'effort,xhigh_effort,max_effort'
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'gpt-5.6-luna'
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = 'GPT-5.6 Luna'
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES = 'effort,xhigh_effort,max_effort'
$env:CLAUDE_CODE_SUBAGENT_MODEL = 'gpt-5.6-sol'
$env:ANTHROPIC_SMALL_FAST_MODEL = 'gpt-5.6-luna'
$env:CLAUDE_CODE_AUTO_COMPACT_WINDOW = '272000'
$env:CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = '1'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
$env:CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1'

& $claudeExe @args
