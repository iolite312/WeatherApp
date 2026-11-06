#!/usr/bin/env bash
# Provisions all Azure resources with Bicep, builds and publishes the container images and deploys the API and worker.
# Run from anywhere: ./infra/deploy.sh   (settings are read from .env, see .env.example)
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

APP_NAME="${APP_NAME:-weatherapp}"
REGION="${REGION:-westeurope}"
RESOURCE_GROUP="${RESOURCE_GROUP:-$APP_NAME}"
API_MIN_REPLICAS="${API_MIN_REPLICAS:-0}"
STATION_LIMIT="${STATION_LIMIT:-50}"
USE_ACR_BUILD="${USE_ACR_BUILD:-false}"
IMAGE_TAG="$(date +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# --- Prerequisites -----------------------------------------------------------------------------------------------
command -v az >/dev/null || fail "The Azure CLI (az) is required: https://learn.microsoft.com/cli/azure/install-azure-cli"
if [[ "$USE_ACR_BUILD" != "true" ]]; then
  command -v docker >/dev/null || fail "Docker is required (or set USE_ACR_BUILD=true to build in Azure)"
fi
az account show >/dev/null 2>&1 || fail "Not logged in to Azure, run 'az login' first"

if [[ -z "${ACCESS_TOKEN:-}" ]]; then
  ACCESS_TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  touch .env
  if grep -q '^ACCESS_TOKEN=' .env; then
    sed -i.bak "s/^ACCESS_TOKEN=.*/ACCESS_TOKEN=$ACCESS_TOKEN/" .env && rm -f .env.bak
  else
    echo "ACCESS_TOKEN=$ACCESS_TOKEN" >>.env
  fi
  echo "Generated a new ACCESS_TOKEN and saved it to .env"
fi

echo "Subscription:   $(az account show --query name -o tsv)"
echo "Resource group: $RESOURCE_GROUP ($REGION)"
echo "Image tag:      $IMAGE_TAG"

step "Registering resource providers (only slow the first time)"
for namespace in Microsoft.App Microsoft.ContainerRegistry Microsoft.ManagedIdentity Microsoft.OperationalInsights Microsoft.Storage; do
  az provider register --namespace "$namespace" --wait --output none
done

step "Creating resource group"
az group create --name "$RESOURCE_GROUP" --location "$REGION" --tags "app=$APP_NAME" --output none

deploy_bicep() {
  local deployment_name="$1" deploy_apps="$2"
  az deployment group create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$deployment_name" \
    --template-file infra/main.bicep \
    --parameters \
      appName="$APP_NAME" \
      deployApps="$deploy_apps" \
      imageTag="$IMAGE_TAG" \
      accessToken="$ACCESS_TOKEN" \
      apiMinReplicas="$API_MIN_REPLICAS" \
      stationLimit="$STATION_LIMIT" \
    --output none
}

deployment_output() {
  az deployment group show --resource-group "$RESOURCE_GROUP" --name "$1" --query "properties.outputs.$2.value" -o tsv
}

# --- 1. Infrastructure: storage (blob, queues, table), registry and Container Apps environment ---------------------
step "Deploying infrastructure (Bicep)"
deploy_bicep infrastructure false
REGISTRY_NAME="$(deployment_output infrastructure registryName)"
REGISTRY_SERVER="$(deployment_output infrastructure registryLoginServer)"

# --- 2. Build and publish the container images ---------------------------------------------------------------------
step "Building and pushing images to $REGISTRY_SERVER"
if [[ "$USE_ACR_BUILD" != "true" ]]; then
  az acr login --name "$REGISTRY_NAME" --output none
fi
for service in api worker; do
  image="weather-$service:$IMAGE_TAG"
  if [[ "$USE_ACR_BUILD" == "true" ]]; then
    az acr build --registry "$REGISTRY_NAME" --image "$image" --file "$service/Dockerfile" --platform linux/amd64 . --output none
  else
    docker build --platform linux/amd64 --file "$service/Dockerfile" --tag "$REGISTRY_SERVER/$image" .
    docker push "$REGISTRY_SERVER/$image"
  fi
done

# --- 3. Deploy the API and worker container apps ---------------------------------------------------------------------
step "Deploying container apps (Bicep)"
deploy_bicep apps true
API_URL="$(deployment_output apps apiUrl)"

step "Done"
cat <<EOF
API:           $API_URL
Swagger UI:    $API_URL/docs
Access token:  $ACCESS_TOKEN

Start a job:
  curl -X POST -H "Authorization: Bearer $ACCESS_TOKEN" $API_URL/api/jobs
EOF
