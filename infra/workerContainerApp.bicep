param location string
param tags object
param appName string
param environmentId string
param registryLoginServer string
param pullIdentityId string
param image string
param storageAccountName string
param startQueueName string
param imageQueueName string
param jobsTableName string
param imageContainerName string
param stationLimit int

@description('Add a replica for every this many messages waiting in a queue.')
param messagesPerReplica int = 10

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

// KEDA scales the worker on the length of both queues, down to zero replicas when there's nothing to do.
var queueScaleRules = [
  for queueName in [startQueueName, imageQueueName]: {
    name: '${queueName}-length'
    azureQueue: {
      queueName: queueName
      queueLength: messagesPerReplica
      auth: [
        {
          secretRef: 'storage-connection-string'
          triggerParameter: 'connection'
        }
      ]
    }
  }
]

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${pullIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: registryLoginServer
          identity: pullIdentityId
        }
      ]
      secrets: [
        {
          name: 'storage-connection-string'
          value: storageConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'START_QUEUE_NAME', value: startQueueName }
            { name: 'IMAGE_QUEUE_NAME', value: imageQueueName }
            { name: 'JOBS_TABLE_NAME', value: jobsTableName }
            { name: 'IMAGE_CONTAINER_NAME', value: imageContainerName }
            { name: 'STATION_LIMIT', value: string(stationLimit) }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 5
        rules: queueScaleRules
      }
    }
  }
}
