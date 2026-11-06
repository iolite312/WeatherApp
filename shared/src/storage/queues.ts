import { getQueue } from './clients.js';

export async function sendQueueMessage(queueName: string, payload: unknown): Promise<void> {
  await getQueue(queueName).sendMessage(JSON.stringify(payload));
}
