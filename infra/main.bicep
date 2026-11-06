// Deploys the complete Weather Image app into the current resource group.
//
// infra/deploy.sh runs this template twice:
//   1. deployApps=false: storage (blob, queues, table), container registry and Container Apps environment
//   2. deployApps=true:  the API and worker container apps, after their images have been pushed to the registry

@description('Name of the app, used as prefix for every resource. Lowercase letters, digits and hyphens.')
@minLength(3)
@maxLength(20)
param appName string

param location string = resourceGroup().location

@description('Deploy the container apps. Requires the images to be present in the registry.')
param deployApps bool = true

@description('Tag of the weather-api and weather-worker images in the registry.')
param imageTag string = 'latest'

@description('Bearer token required to start a job.')
@secure()
param accessToken string

@description('API replicas kept running when idle. 0 saves cost but adds a cold start to the first request.')
@minValue(0)
param apiMinReplicas int = 0

@description('Maximum number of weather stations per job.')
param stationLimit int = 50

param startQueueName string = 'start-jobs'
param imageQueueName string = 'image-jobs'
param jobsTableName string = 'jobs'
param imageContainerName string = 'images'

var tags = {
  app: appName
}

// Storage account and registry names must be globally unique and alphanumeric.
var alphanumericName = toLower(replace(appName, '-', ''))
var suffix = uniqueString(resourceGroup().id)
var storageAccountName = '${take(alphanumericName, 11)}${suffix}'
var registryName = '${alphanumericName}${suffix}'

module storageAccount './storageAccount.bicep' = {
  name: 'storageAccount'
  params: {
    location: location
    tags: tags
    storageAccountName: storageAccountName
  }
}

module blobStorage './blobStorage.bicep' = {
  name: 'blobStorage'
  params: {
    storageAccountName: storageAccount.outputs.name
    imageContainerName: imageContainerName
  }
}

module queueStorage './queueStorage.bicep' = {
  name: 'queueStorage'
  params: {
    storageAccountName: storageAccount.outputs.name
    startQueueName: startQueueName
    imageQueueName: imageQueueName
  }
}

module tableStorage './tableStorage.bicep' = {
  name: 'tableStorage'
  params: {
    storageAccountName: storageAccount.outputs.name
    jobsTableName: jobsTableName
  }
}

module containerRegistry './containerRegistry.bicep' = {
  name: 'containerRegistry'
  params: {
    location: location
    tags: tags
    registryName: registryName
    pullIdentityName: '${appName}-pull'
  }
}

module containerAppsEnvironment './containerAppsEnvironment.bicep' = {
  name: 'containerAppsEnvironment'
  params: {
    location: location
    tags: tags
    environmentName: '${appName}-env'
    logAnalyticsName: '${appName}-logs'
  }
}

module apiContainerApp './apiContainerApp.bicep' = if (deployApps) {
  name: 'apiContainerApp'
  params: {
    location: location
    tags: tags
    appName: '${appName}-api'
    environmentId: containerAppsEnvironment.outputs.id
    registryLoginServer: containerRegistry.outputs.loginServer
    pullIdentityId: containerRegistry.outputs.pullIdentityId
    image: '${containerRegistry.outputs.loginServer}/weather-api:${imageTag}'
    storageAccountName: storageAccount.outputs.name
    startQueueName: startQueueName
    imageQueueName: imageQueueName
    jobsTableName: jobsTableName
    imageContainerName: imageContainerName
    minReplicas: apiMinReplicas
    accessToken: accessToken
  }
  dependsOn: [
    blobStorage
    queueStorage
    tableStorage
  ]
}

module workerContainerApp './workerContainerApp.bicep' = if (deployApps) {
  name: 'workerContainerApp'
  params: {
    location: location
    tags: tags
    appName: '${appName}-worker'
    environmentId: containerAppsEnvironment.outputs.id
    registryLoginServer: containerRegistry.outputs.loginServer
    pullIdentityId: containerRegistry.outputs.pullIdentityId
    image: '${containerRegistry.outputs.loginServer}/weather-worker:${imageTag}'
    storageAccountName: storageAccount.outputs.name
    startQueueName: startQueueName
    imageQueueName: imageQueueName
    jobsTableName: jobsTableName
    imageContainerName: imageContainerName
    stationLimit: stationLimit
  }
  dependsOn: [
    blobStorage
    queueStorage
    tableStorage
  ]
}

output registryName string = containerRegistry.outputs.name
output registryLoginServer string = containerRegistry.outputs.loginServer
output storageAccountName string = storageAccount.outputs.name
output apiUrl string = deployApps ? 'https://${apiContainerApp!.outputs.fqdn}' : ''
