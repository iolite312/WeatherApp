import { TableClient } from '@azure/data-tables';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { QueueClient } from '@azure/storage-queue';
import { config, poisonQueueName } from '../config.js';

let containerClient: ContainerClient | undefined;
let tableClient: TableClient | undefined;
const queueClients = new Map<string, QueueClient>();

export function getImageContainer(): ContainerClient {
  containerClient ??= BlobServiceClient.fromConnectionString(config.storageConnectionString).getContainerClient(
    config.imageContainerName,
  );
  return containerClient;
}

export function getJobsTable(): TableClient {
  // allowInsecureConnection is only relevant for Azurite (http); Azure always uses https.
  tableClient ??= TableClient.fromConnectionString(config.storageConnectionString, config.jobsTableName, {
    allowInsecureConnection: true,
  });
  return tableClient;
}

export function getQueue(queueName: string): QueueClient {
  let client = queueClients.get(queueName);
  if (!client) {
    client = new QueueClient(config.storageConnectionString, queueName);
    queueClients.set(queueName, client);
  }
  return client;
}

/**
 * Creates the container, table and queues if they don't exist yet. In Azure the Bicep template already created
 * them, so this is a no-op there; locally it bootstraps a fresh Azurite instance.
 */
export async function ensureStorage(): Promise<void> {
  const queues = [config.startQueueName, config.imageQueueName].flatMap((name) => [name, poisonQueueName(name)]);

  await Promise.all([
    getImageContainer().createIfNotExists(),
    getJobsTable().createTable(),
    ...queues.map((name) => getQueue(name).createIfNotExists()),
  ]);
}
