import {
  type ImageJobMessage,
  imageBlobName,
  logger,
  markStationCompleted,
  markStationFailed,
  uploadImage,
} from '@weatherapp/shared';
import { renderWeatherImage } from '../services/imageRenderer.js';
import { fetchBackgroundImage } from '../services/imageSource.js';

/** Fan-out job: creates and stores the image for a single station. */
export async function handleImageJob({ jobId, station }: ImageJobMessage): Promise<void> {
  const background = await fetchBackgroundImage(`${jobId}-${station.stationId}`);
  const image = await renderWeatherImage(background, station);

  const blobName = imageBlobName(jobId, station.stationId);
  await uploadImage(blobName, image);
  await markStationCompleted(jobId, station.stationId, blobName);

  logger.info({ jobId, stationId: station.stationId }, `Generated image for ${station.stationName}`);
}

export async function failImageJob({ jobId, station }: ImageJobMessage, error: unknown): Promise<void> {
  await markStationFailed(jobId, station.stationId, error instanceof Error ? error.message : String(error));
}
