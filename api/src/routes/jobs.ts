import { randomUUID } from 'node:crypto';
import {
  config,
  createJob,
  getImageSasUrl,
  getJob,
  type Job,
  type StartJobMessage,
  sendQueueMessage,
} from '@weatherapp/shared';
import { type Request, type Response, Router } from 'express';
import { requireBearerToken } from '../middleware/auth.js';

export const jobsRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function absoluteUrl(req: Request, path: string): string {
  return `${req.protocol}://${req.get('host')}${path}`;
}

function jobLinks(req: Request, jobId: string) {
  return {
    status: absoluteUrl(req, `/api/jobs/${jobId}`),
    images: absoluteUrl(req, `/api/jobs/${jobId}/images`),
  };
}

/** Loads the job from the route parameter, or sends a 400/404 and returns undefined. */
async function findJob(req: Request<{ jobId: string }>, res: Response): Promise<Job | undefined> {
  const { jobId } = req.params;
  if (!UUID_PATTERN.test(jobId)) {
    res.status(400).json({ error: 'Job id must be a UUID' });
    return undefined;
  }

  const job = await getJob(jobId.toLowerCase());
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
  }
  return job;
}

jobsRouter.post('/', requireBearerToken, async (req, res) => {
  const jobId = randomUUID();

  await createJob(jobId);
  await sendQueueMessage(config.startQueueName, {
    jobId,
    requestedAt: new Date().toISOString(),
  } satisfies StartJobMessage);

  const links = jobLinks(req, jobId);
  res.status(202).location(links.status).json({ jobId, status: 'queued', links });
});

jobsRouter.get('/:jobId', async (req, res) => {
  const job = await findJob(req, res);
  if (!job) {
    return;
  }

  res.json({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    progress: job.progress,
    stations: job.stations.map(({ stationId, stationName, status, error }) => ({
      stationId,
      stationName,
      status,
      error: error || undefined,
    })),
    links: jobLinks(req, job.id),
  });
});

jobsRouter.get('/:jobId/images', async (req, res) => {
  const job = await findJob(req, res);
  if (!job) {
    return;
  }

  const finished = job.stations.filter((station) => station.status === 'completed' && station.blobName);
  const images = await Promise.all(
    finished.map(async (station) => ({
      stationId: station.stationId,
      stationName: station.stationName,
      ...(await getImageSasUrl(station.blobName as string)),
    })),
  );

  res.json({ jobId: job.id, status: job.status, progress: job.progress, images });
});

jobsRouter.get('/:jobId/images/:stationId', async (req, res) => {
  const job = await findJob(req, res);
  if (!job) {
    return;
  }

  const station = job.stations.find((s) => String(s.stationId) === req.params.stationId);
  if (!station?.blobName || station.status !== 'completed') {
    res.status(404).json({ error: 'Image not found (yet)' });
    return;
  }

  const { url } = await getImageSasUrl(station.blobName);
  res.redirect(302, url);
});
