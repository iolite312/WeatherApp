import { setTimeout as sleep } from 'node:timers/promises';
import type { DequeuedMessageItem } from '@azure/storage-queue';
import { getQueue, logger, poisonQueueName } from '@weatherapp/shared';

const MIN_IDLE_DELAY_MS = 500;
const MAX_IDLE_DELAY_MS = 10_000;
const RETRY_BACKOFF_SECONDS = 15;

export interface QueueConsumerOptions<T> {
  queueName: string;
  handle: (message: T) => Promise<void>;
  /** Called once a message failed on its last attempt, right before it is moved to the poison queue. */
  onGiveUp?: (message: T, error: unknown) => Promise<void>;
  /** How many messages to receive, and process concurrently, per poll (max 32). */
  batchSize?: number;
  /** How long a received message stays invisible to other workers while it is being processed. */
  visibilityTimeoutSeconds?: number;
  maxAttempts?: number;
}

/**
 * Polls a Storage Queue: receives a batch of messages, runs the handler for each one and deletes the message once
 * the handler succeeded. A failed message is made visible again after a back-off, and after `maxAttempts` it is
 * moved to `<queue>-poison` so it can't block the queue forever.
 */
export class QueueConsumer<T> {
  private readonly queue;
  private readonly poisonQueue;
  private readonly log;
  private running = false;
  private loop: Promise<void> | undefined;

  constructor(private readonly options: QueueConsumerOptions<T>) {
    this.queue = getQueue(options.queueName);
    this.poisonQueue = getQueue(poisonQueueName(options.queueName));
    this.log = logger.child({ queue: options.queueName });
  }

  start(): void {
    this.running = true;
    this.loop = this.run();
    this.log.info('Consumer started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.log.info('Consumer stopped');
  }

  private async run(): Promise<void> {
    let idleDelay = MIN_IDLE_DELAY_MS;

    while (this.running) {
      try {
        const { receivedMessageItems } = await this.queue.receiveMessages({
          numberOfMessages: this.options.batchSize ?? 1,
          visibilityTimeout: this.options.visibilityTimeoutSeconds ?? 60,
        });

        if (receivedMessageItems.length === 0) {
          await sleep(idleDelay);
          idleDelay = Math.min(idleDelay * 2, MAX_IDLE_DELAY_MS);
          continue;
        }

        idleDelay = MIN_IDLE_DELAY_MS;
        await Promise.all(receivedMessageItems.map((item) => this.process(item)));
      } catch (err) {
        this.log.error({ err }, 'Polling failed');
        await sleep(MAX_IDLE_DELAY_MS);
      }
    }
  }

  private async process(item: DequeuedMessageItem): Promise<void> {
    const log = this.log.child({ messageId: item.messageId, attempt: item.dequeueCount });

    let message: T;
    try {
      message = JSON.parse(item.messageText) as T;
    } catch {
      log.error({ messageText: item.messageText }, 'Message is not valid JSON, moving it to the poison queue');
      await this.moveToPoisonQueue(item);
      return;
    }

    try {
      await this.options.handle(message);
      await this.queue.deleteMessage(item.messageId, item.popReceipt);
      log.debug('Message processed');
    } catch (err) {
      if (item.dequeueCount >= (this.options.maxAttempts ?? 5)) {
        log.error({ err }, 'Message failed on its last attempt, moving it to the poison queue');
        await this.options.onGiveUp?.(message, err).catch((giveUpErr) => {
          log.error({ err: giveUpErr }, 'onGiveUp handler failed');
        });
        await this.moveToPoisonQueue(item);
        return;
      }

      const backoff = RETRY_BACKOFF_SECONDS * item.dequeueCount;
      log.warn({ err }, `Message failed, retrying in ${backoff}s`);
      await this.queue.updateMessage(item.messageId, item.popReceipt, undefined, backoff).catch((updateErr) => {
        // Not fatal: the message becomes visible again anyway once its visibility timeout expires.
        log.warn({ err: updateErr }, 'Could not set retry back-off');
      });
    }
  }

  private async moveToPoisonQueue(item: DequeuedMessageItem): Promise<void> {
    try {
      await this.poisonQueue.sendMessage(item.messageText);
      await this.queue.deleteMessage(item.messageId, item.popReceipt);
    } catch (err) {
      this.log.error({ err, messageId: item.messageId }, 'Could not move message to the poison queue');
    }
  }
}
