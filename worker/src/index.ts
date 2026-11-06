import { config, ensureStorage, type ImageJobMessage, logger, type StartJobMessage } from '@weatherapp/shared';
import { failImageJob, handleImageJob } from './handlers/generateImage.js';
import { failStartJob, handleStartJob } from './handlers/startJob.js';
import { QueueConsumer } from './queueConsumer.js';

await ensureStorage();

const consumers = [
  new QueueConsumer<StartJobMessage>({
    queueName: config.startQueueName,
    handle: handleStartJob,
    onGiveUp: failStartJob,
    batchSize: 4,
    visibilityTimeoutSeconds: 120,
  }),
  new QueueConsumer<ImageJobMessage>({
    queueName: config.imageQueueName,
    handle: handleImageJob,
    onGiveUp: failImageJob,
    batchSize: Number(process.env.IMAGE_CONCURRENCY ?? 8),
    visibilityTimeoutSeconds: 120,
  }),
];

for (const consumer of consumers) {
  consumer.start();
}

async function shutdown(signal: string) {
  logger.info(`${signal} received, finishing in-flight messages`);
  await Promise.all(consumers.map((consumer) => consumer.stop()));
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
