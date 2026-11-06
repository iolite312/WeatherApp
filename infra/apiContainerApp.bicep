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
param minReplicas int

@secure()
param accessToken string

var targetPort = 3000

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource api 'Microsoft.App/containerApps@2024-03-01' = {
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
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
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
        {
          name: 'access-token'
          value: accessToken
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'PORT', value: string(targetPort) }
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'ACCESS_TOKEN', secretRef: 'access-token' }
            { name: 'START_QUEUE_NAME', value: startQueueName }
            { name: 'IMAGE_QUEUE_NAME', value: imageQueueName }
            { name: 'JOBS_TABLE_NAME', value: jobsTableName }
            { name: 'IMAGE_CONTAINER_NAME', value: imageContainerName }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: targetPort }
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: targetPort }
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 3
        rules: [
          {
            name: 'http-requests'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output fqdn string = api.properties.configuration.ingress.fqdn
