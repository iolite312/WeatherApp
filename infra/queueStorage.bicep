param storageAccountName string

@description('Queue that starts a job: the worker fetches all weather stations and fans out one image job each.')
param startQueueName string

@description('Queue with one message per station: the worker fetches a photo, draws the weather on it and stores it.')
param imageQueueName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

// Each work queue gets a "-poison" queue that receives messages that kept failing.
var queueNames = [
  startQueueName
  '${startQueueName}-poison'
  imageQueueName
  '${imageQueueName}-poison'
]

resource queues 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = [
  for name in queueNames: {
    parent: queueService
    name: name
  }
]
