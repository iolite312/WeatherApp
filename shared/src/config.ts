function readEnv(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function readNumber(name: string, fallback: number): number {
  const value = Number(readEnv(name, String(fallback)));
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return value;
}

export const config = {
  storageConnectionString: readEnv('AZURE_STORAGE_CONNECTION_STRING'),
  startQueueName: readEnv('START_QUEUE_NAME', 'start-jobs'),
  imageQueueName: readEnv('IMAGE_QUEUE_NAME', 'image-jobs'),
  jobsTableName: readEnv('JOBS_TABLE_NAME', 'jobs'),
  imageContainerName: readEnv('IMAGE_CONTAINER_NAME', 'images'),
  /** How long generated SAS links stay valid. */
  sasExpiryMinutes: readNumber('SAS_EXPIRY_MINUTES', 24 * 60),
  /**
   * Overrides the origin of returned blob URLs. Only needed locally, where the containers reach Azurite on
   * `azurite:10000` but a browser on the host needs `localhost:10000`.
   */
  blobPublicBaseUrl: process.env.BLOB_PUBLIC_BASE_URL || undefined,
};

export function poisonQueueName(queueName: string): string {
  return `${queueName}-poison`;
}
