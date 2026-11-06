import { BlobSASPermissions } from '@azure/storage-blob';
import { config } from '../config.js';
import { getImageContainer } from './clients.js';

export function imageBlobName(jobId: string, stationId: number): string {
  return `${jobId}/${stationId}.jpg`;
}

export async function uploadImage(blobName: string, data: Buffer): Promise<void> {
  await getImageContainer()
    .getBlockBlobClient(blobName)
    .uploadData(data, {
      blobHTTPHeaders: { blobContentType: 'image/jpeg', blobCacheControl: 'public, max-age=86400' },
    });
}

export interface SignedImageUrl {
  url: string;
  expiresAt: string;
}

/** Creates a read-only SAS link, so the container itself can stay private. */
export async function getImageSasUrl(blobName: string): Promise<SignedImageUrl> {
  const expiresOn = new Date(Date.now() + config.sasExpiryMinutes * 60 * 1000);
  const sasUrl = await getImageContainer()
    .getBlockBlobClient(blobName)
    .generateSasUrl({ permissions: BlobSASPermissions.parse('r'), expiresOn });

  return { url: withPublicBaseUrl(sasUrl), expiresAt: expiresOn.toISOString() };
}

function withPublicBaseUrl(sasUrl: string): string {
  if (!config.blobPublicBaseUrl) {
    return sasUrl;
  }

  const url = new URL(sasUrl);
  const containerPath = url.pathname.slice(url.pathname.indexOf(`/${config.imageContainerName}/`));
  return `${config.blobPublicBaseUrl.replace(/\/$/, '')}${containerPath}${url.search}`;
}
