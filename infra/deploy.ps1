# Provisions all Azure resources with Bicep, builds and publishes the container images and deploys the API and worker.
# PowerShell version of deploy.sh. Run from anywhere: .\infra\deploy.ps1   (settings are read from .env, see .env.example)
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')
$envFile = Join-Path (Get-Location) '.env'

function Write-Step([string]$Message) {
  Write-Host ''
  Write-Host "==> $Message" -ForegroundColor Blue
}

function Stop-WithError([string]$Message) {
  Write-Host $Message -ForegroundColor Red
  exit 1
}

# Runs a native command (az, docker) and stops the script when it fails, like `set -e` does in bash.
# Deliberately not an advanced function: that would try to bind arguments such as --output as its own parameters.
function Invoke-Native {
  $command, $arguments = $args
  & $command @arguments
  if ($LASTEXITCODE -ne 0) {
    Stop-WithError "'$command $($arguments -join ' ')' failed with exit code $LASTEXITCODE"
  }
}

function Test-CommandSuccess([scriptblock]$Command) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Command *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previous
  }
}

# --- Settings from .env ----------------------------------------------------------------------------------------------
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $value = $Matches[2] -replace '^"(.*)"$', '$1' -replace "^'(.*)'$", '$1'
      Set-Item -Path "Env:$($Matches[1])" -Value $value
    }
  }
}

function Get-Setting([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrEmpty($value)) { return $Default }
  return $value
}

$AppName = Get-Setting 'APP_NAME' 'weatherapp'
$Region = Get-Setting 'REGION' 'westeurope'
$ResourceGroup = Get-Setting 'RESOURCE_GROUP' $AppName
$ApiMinReplicas = Get-Setting 'API_MIN_REPLICAS' '0'
$StationLimit = Get-Setting 'STATION_LIMIT' '50'
$UseAcrBuild = (Get-Setting 'USE_ACR_BUILD' 'false') -eq 'true'
$AccessToken = Get-Setting 'ACCESS_TOKEN' ''

$commit = 'local'
if (Test-CommandSuccess { git rev-parse --short HEAD }) {
  $commit = (git rev-parse --short HEAD).Trim()
}
$ImageTag = "$(Get-Date -Format 'yyyyMMddHHmmss')-$commit"

# --- Prerequisites ---------------------------------------------------------------------------------------------------
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Stop-WithError 'The Azure CLI (az) is required: https://learn.microsoft.com/cli/azure/install-azure-cli'
}
if (-not $UseAcrBuild -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Stop-WithError 'Docker is required (or set USE_ACR_BUILD=true to build in Azure)'
}
if (-not (Test-CommandSuccess { az account show })) {
  Stop-WithError "Not logged in to Azure, run 'az login' first"
}

if ([string]::IsNullOrEmpty($AccessToken)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $AccessToken = -join ($bytes | ForEach-Object { $_.ToString('x2') })

  $lines = @()
  if (Test-Path $envFile) { $lines = @(Get-Content $envFile) }
  if ($lines -match '^ACCESS_TOKEN=') {
    $lines = $lines -replace '^ACCESS_TOKEN=.*$', "ACCESS_TOKEN=$AccessToken"
  } else {
    $lines += "ACCESS_TOKEN=$AccessToken"
  }
  # Written without a BOM and with LF line endings, so the file keeps working for deploy.sh and docker compose.
  [System.IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
  Write-Host 'Generated a new ACCESS_TOKEN and saved it to .env'
}

Write-Host "Subscription:   $((az account show --query name -o tsv).Trim())"
Write-Host "Resource group: $ResourceGroup ($Region)"
Write-Host "Image tag:      $ImageTag"

Write-Step 'Registering resource providers (only slow the first time)'
foreach ($namespace in 'Microsoft.App', 'Microsoft.ContainerRegistry', 'Microsoft.ManagedIdentity', 'Microsoft.OperationalInsights', 'Microsoft.Storage') {
  Invoke-Native az provider register --namespace $namespace --wait --output none
}

Write-Step 'Creating resource group'
Invoke-Native az group create --name $ResourceGroup --location $Region --tags "app=$AppName" --output none

function Invoke-BicepDeployment([string]$DeploymentName, [string]$DeployApps) {
  Invoke-Native az deployment group create `
    --resource-group $ResourceGroup `
    --name $DeploymentName `
    --template-file infra/main.bicep `
    --parameters `
    "appName=$AppName" `
    "deployApps=$DeployApps" `
    "imageTag=$ImageTag" `
    "accessToken=$AccessToken" `
    "apiMinReplicas=$ApiMinReplicas" `
    "stationLimit=$StationLimit" `
    --output none
}

function Get-DeploymentOutput([string]$DeploymentName, [string]$OutputName) {
  $value = az deployment group show --resource-group $ResourceGroup --name $DeploymentName `
    --query "properties.outputs.$OutputName.value" -o tsv
  if ($LASTEXITCODE -ne 0) { Stop-WithError "Could not read output '$OutputName' of deployment '$DeploymentName'" }
  return "$value".Trim()
}

# --- 1. Infrastructure: storage (blob, queues, table), registry and Container Apps environment -----------------------
Write-Step 'Deploying infrastructure (Bicep)'
Invoke-BicepDeployment 'infrastructure' 'false'
$RegistryName = Get-DeploymentOutput 'infrastructure' 'registryName'
$RegistryServer = Get-DeploymentOutput 'infrastructure' 'registryLoginServer'

# --- 2. Build and publish the container images -----------------------------------------------------------------------
Write-Step "Building and pushing images to $RegistryServer"
if (-not $UseAcrBuild) {
  Invoke-Native az acr login --name $RegistryName --output none
}
foreach ($service in 'api', 'worker') {
  $image = "weather-${service}:$ImageTag"
  if ($UseAcrBuild) {
    Invoke-Native az acr build --registry $RegistryName --image $image --file "$service/Dockerfile" --platform linux/amd64 . --output none
  } else {
    Invoke-Native docker build --platform linux/amd64 --file "$service/Dockerfile" --tag "$RegistryServer/$image" .
    Invoke-Native docker push "$RegistryServer/$image"
  }
}

# --- 3. Deploy the API and worker container apps -----------------------------------------------------------------------
Write-Step 'Deploying container apps (Bicep)'
Invoke-BicepDeployment 'apps' 'true'
$ApiUrl = Get-DeploymentOutput 'apps' 'apiUrl'

Write-Step 'Done'
Write-Host @"
API:           $ApiUrl
Swagger UI:    $ApiUrl/docs
Access token:  $AccessToken

Start a job:
  curl.exe -X POST -H "Authorization: Bearer $AccessToken" $ApiUrl/api/jobs
  Invoke-RestMethod -Method Post -Headers @{ Authorization = 'Bearer $AccessToken' } $ApiUrl/api/jobs
"@
