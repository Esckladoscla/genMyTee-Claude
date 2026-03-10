param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$WebhookSecret = $env:SHOPIFY_WEBHOOK_SECRET
)

$ErrorActionPreference = "Stop"

$script:Failures = 0
$script:Warnings = 0
$script:Passes = 0

function Write-Pass([string]$Message) {
  $script:Passes += 1
  Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
  $script:Failures += 1
  Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Write-Warn([string]$Message) {
  $script:Warnings += 1
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Invoke-HttpRequest {
  param(
    [ValidateSet("GET", "POST")]
    [string]$Method,
    [string]$Uri,
    [string]$Body,
    [hashtable]$Headers
  )

  try {
    if ($Method -eq "GET") {
      $response = Invoke-WebRequest -Method GET -Uri $Uri -Headers $Headers -UseBasicParsing
    } else {
      $response = Invoke-WebRequest -Method POST -Uri $Uri -Headers $Headers -Body $Body -UseBasicParsing
    }

    return [PSCustomObject]@{
      StatusCode = [int]$response.StatusCode
      Body = [string]$response.Content
    }
  } catch {
    $webResponse = $_.Exception.Response
    if ($null -ne $webResponse) {
      $statusCode = [int]$webResponse.StatusCode
      $stream = $webResponse.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $content = $reader.ReadToEnd()
      $reader.Close()
      if ($null -ne $stream) { $stream.Close() }

      return [PSCustomObject]@{
        StatusCode = $statusCode
        Body = [string]$content
      }
    }
    throw
  }
}

function ConvertTo-JsonBody([object]$Data) {
  return ($Data | ConvertTo-Json -Compress -Depth 10)
}

function New-ShopifyHmac {
  param(
    [string]$Secret,
    [string]$Payload
  )

  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
  try {
    $hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($Payload))
    return [Convert]::ToBase64String($hash)
  } finally {
    $hmac.Dispose()
  }
}

$base = $BaseUrl.TrimEnd('/')
Write-Host "Running local smoke tests against $base" -ForegroundColor Cyan

# 1) Health
$health = Invoke-HttpRequest -Method GET -Uri "$base/health"
if ($health.StatusCode -eq 200 -and $health.Body -match "ok") {
  Write-Pass "GET /health -> 200 ok"
} else {
  Write-Fail "GET /health expected 200/ok, got $($health.StatusCode) body=$($health.Body)"
}

# 2) Preview short prompt should fail validation
$shortPromptBody = ConvertTo-JsonBody @{ prompt = "hola" }
$shortPreview = Invoke-HttpRequest -Method POST -Uri "$base/api/preview/image" -Headers @{ "Content-Type" = "application/json" } -Body $shortPromptBody
if ($shortPreview.StatusCode -eq 422) {
  Write-Pass "POST /api/preview/image short prompt -> 422"
} else {
  Write-Fail "Expected 422 for short prompt, got $($shortPreview.StatusCode) body=$($shortPreview.Body)"
}

# 3) Preview valid prompt (200 if OpenAI+R2 OK, 429 if quota/rate limit, 503 if AI disabled)
$validPreviewBody = ConvertTo-JsonBody @{
  prompt = "A retro geometric tiger in orange and blue"
  pf_product_key = "all-over-print-mens-athletic-t-shirt"
  pf_placement = "front"
}
$validPreview = Invoke-HttpRequest -Method POST -Uri "$base/api/preview/image" -Headers @{ "Content-Type" = "application/json" } -Body $validPreviewBody
if ($validPreview.StatusCode -eq 200) {
  Write-Pass "POST /api/preview/image valid prompt -> 200"
} elseif ($validPreview.StatusCode -eq 429) {
  Write-Warn "POST /api/preview/image valid prompt -> 429 (OpenAI quota/rate limit)"
} elseif ($validPreview.StatusCode -eq 503) {
  Write-Warn "POST /api/preview/image valid prompt -> 503 (AI disabled)"
} else {
  Write-Fail "Unexpected status for valid preview: $($validPreview.StatusCode) body=$($validPreview.Body)"
}

# 4) Webhook unsigned should be rejected
$unsignedPayload = ConvertTo-JsonBody @{ id = 1; line_items = @() }
$unsignedWebhook = Invoke-HttpRequest -Method POST -Uri "$base/api/webhooks/orders/create" -Headers @{ "Content-Type" = "application/json" } -Body $unsignedPayload
if ($unsignedWebhook.StatusCode -eq 401) {
  Write-Pass "POST /api/webhooks/orders/create unsigned -> 401"
} else {
  Write-Fail "Expected 401 for unsigned webhook, got $($unsignedWebhook.StatusCode) body=$($unsignedWebhook.Body)"
}

# 5) Webhook signed (if secret available)
if ([string]::IsNullOrWhiteSpace($WebhookSecret)) {
  Write-Warn "Skipping signed webhook test: SHOPIFY_WEBHOOK_SECRET not set"
} else {
  $signedPayload = ConvertTo-JsonBody @{
    id = 999001
    line_items = @(
      @{
        variant_title = "M"
        quantity = 1
        properties = @(
          @{ name = "ai_prompt"; value = "demo" },
          @{ name = "pf_product_key"; value = "all-over-print-mens-athletic-t-shirt" },
          @{ name = "pf_placement"; value = "front" }
        )
      }
    )
  }

  $signature = New-ShopifyHmac -Secret $WebhookSecret -Payload $signedPayload
  $signedWebhook = Invoke-HttpRequest -Method POST -Uri "$base/api/webhooks/orders/create" -Headers @{
    "Content-Type" = "application/json"
    "X-Shopify-Hmac-Sha256" = $signature
  } -Body $signedPayload

  if ($signedWebhook.StatusCode -eq 200 -and $signedWebhook.Body -match "no_valid_items") {
    Write-Pass "POST /api/webhooks/orders/create signed -> 200 (no_valid_items)"
  } else {
    Write-Fail "Unexpected signed webhook response: $($signedWebhook.StatusCode) body=$($signedWebhook.Body)"
  }
}

Write-Host "`nSummary: passes=$script:Passes warnings=$script:Warnings failures=$script:Failures" -ForegroundColor Cyan
if ($script:Failures -gt 0) {
  exit 1
}
exit 0
