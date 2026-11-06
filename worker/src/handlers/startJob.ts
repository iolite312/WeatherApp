import {
  config,
  getJob,
  type ImageJobMessage,
  logger,
  registerStations,
  type StartJobMessage,
  sendQueueMessage,
  updateJob,
} from '@weatherapp/shared';
import { fetchStations } from '../services/buienradar.js';

const stationLimit = Number(process.env.STATION_LIMIT ?? 50);

/** First job: fetches the weather stations and fans out one image job per station. */
export async function handleStartJob({ jobId }: StartJobMessage): Promise<void> {
  const log = logger.child({ jobId });

  const job = await getJob(jobId);
  if (!job) {
    log.warn('Job does not exist, skipping');
    return;
  }
  if (job.status === 'completed' || job.status === 'failed') {
    log.info(`Job is already ${job.status}, skipping`);
    return;
  }

  await updateJob(jobId, { status: 'fetching' });
  const stations = (await fetchStations()).slice(0, stationLimit);
  if (stations.length === 0) {
    throw new Error('Buienradar returned no weather stations');
  }

  await registerStations(jobId, stations);
  await updateJob(jobId, { status: 'processing' });

  // On a retry, stations that were already finished by an earlier attempt don't need a new image.
  const done = new Set(job.stations.filter((s) => s.status === 'completed').map((s) => s.stationId));
  const todo = stations.filter((station) => !done.has(station.stationId));

  await Promise.all(
    todo.map((station) => sendQueueMessage(config.imageQueueName, { jobId, station } satisfies ImageJobMessage)),
  );
  log.info(`Queued ${todo.length} image jobs`);
}

export async function failStartJob({ jobId }: StartJobMessage, error: unknown): Promise<void> {
  await updateJob(jobId, { status: 'failed', error: error instanceof Error ? error.message : String(error) });
}
