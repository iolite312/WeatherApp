import { odata, type TableEntity, type TableEntityResult, type TransactionAction } from '@azure/data-tables';
import type { Job, JobStatus, StationRecord, StationStatus } from '../types/jobs.js';
import { getJobsTable } from './clients.js';

/*
 * Every job lives in its own table partition (PartitionKey = job id):
 *   - one summary row (RowKey "job") holding the overall status
 *   - one row per station (RowKey "station-<id>") holding that station's progress
 * Workers only ever write their own station row, so the fan-out never contends on a shared counter, and a
 * redelivered queue message simply overwrites the same row instead of counting twice.
 */

const JOB_ROW_KEY = 'job';
const STATION_ROW_PREFIX = 'station-';
const TRANSACTION_LIMIT = 100;

interface JobEntity {
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

interface StationEntity {
  stationId: number;
  stationName: string;
  status: StationStatus;
  blobName?: string;
  error?: string;
  updatedAt: string;
}

function stationRowKey(stationId: number): string {
  return `${STATION_ROW_PREFIX}${stationId}`;
}

function now(): string {
  return new Date().toISOString();
}

export async function createJob(jobId: string): Promise<void> {
  const timestamp = now();
  await getJobsTable().createEntity<TableEntity<JobEntity>>({
    partitionKey: jobId,
    rowKey: JOB_ROW_KEY,
    status: 'queued',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function getJob(jobId: string): Promise<Job | undefined> {
  const entities = getJobsTable().listEntities<JobEntity | StationEntity>({
    queryOptions: { filter: odata`PartitionKey eq ${jobId}` },
  });

  let summary: TableEntityResult<JobEntity> | undefined;
  const stations: StationRecord[] = [];

  for await (const entity of entities) {
    if (entity.rowKey === JOB_ROW_KEY) {
      summary = entity as TableEntityResult<JobEntity>;
    } else {
      const station = entity as TableEntityResult<StationEntity>;
      stations.push({
        stationId: station.stationId,
        stationName: station.stationName,
        status: station.status,
        blobName: station.blobName,
        error: station.error,
        updatedAt: station.updatedAt,
      });
    }
  }

  if (!summary) {
    return undefined;
  }

  stations.sort((a, b) => a.stationName.localeCompare(b.stationName));
  const count = (status: StationStatus) => stations.filter((station) => station.status === status).length;

  return {
    id: jobId,
    status: summary.status,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    completedAt: summary.completedAt,
    error: summary.error,
    progress: {
      total: stations.length,
      completed: count('completed'),
      failed: count('failed'),
      pending: count('pending'),
    },
    stations,
  };
}

export async function updateJob(jobId: string, changes: Partial<Omit<JobEntity, 'createdAt'>>): Promise<void> {
  await getJobsTable().updateEntity<TableEntity<Partial<JobEntity>>>(
    { partitionKey: jobId, rowKey: JOB_ROW_KEY, updatedAt: now(), ...changes },
    'Merge',
  );
}

/**
 * Adds a pending row for every station that doesn't have one yet. Existing rows are left alone, so a retried
 * start job doesn't reset stations that were already processed.
 */
export async function registerStations(
  jobId: string,
  stations: Pick<StationEntity, 'stationId' | 'stationName'>[],
): Promise<void> {
  const table = getJobsTable();
  const existing = new Set<string>();
  const rows = table.listEntities({
    queryOptions: { filter: odata`PartitionKey eq ${jobId} and RowKey ne ${JOB_ROW_KEY}`, select: ['RowKey'] },
  });
  for await (const row of rows) {
    existing.add(row.rowKey as string);
  }

  const actions: TransactionAction[] = stations
    .filter((station) => !existing.has(stationRowKey(station.stationId)))
    .map((station) => [
      'create',
      {
        partitionKey: jobId,
        rowKey: stationRowKey(station.stationId),
        stationId: station.stationId,
        stationName: station.stationName,
        status: 'pending',
        updatedAt: now(),
      } satisfies TableEntity<StationEntity>,
    ]);

  for (let i = 0; i < actions.length; i += TRANSACTION_LIMIT) {
    await table.submitTransaction(actions.slice(i, i + TRANSACTION_LIMIT));
  }
}

async function updateStation(jobId: string, stationId: number, changes: Partial<StationEntity>): Promise<void> {
  await getJobsTable().updateEntity<TableEntity<Partial<StationEntity>>>(
    { partitionKey: jobId, rowKey: stationRowKey(stationId), updatedAt: now(), ...changes },
    'Merge',
  );
  await completeJobIfDone(jobId);
}

export function markStationCompleted(jobId: string, stationId: number, blobName: string): Promise<void> {
  return updateStation(jobId, stationId, { status: 'completed', blobName, error: '' });
}

export function markStationFailed(jobId: string, stationId: number, error: string): Promise<void> {
  return updateStation(jobId, stationId, { status: 'failed', error });
}

/**
 * Called after every station update. Each worker writes its own row before reading the partition, so whichever
 * worker finishes last is guaranteed to see every station done. Marking the job completed is idempotent, so it's
 * fine if two workers both see that.
 */
async function completeJobIfDone(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (job?.status !== 'processing' || job.progress.total === 0 || job.progress.pending > 0) {
    return;
  }

  const timestamp = now();
  await updateJob(jobId, {
    status: job.progress.completed > 0 ? 'completed' : 'failed',
    completedAt: timestamp,
    error: job.progress.completed > 0 ? undefined : 'No station images could be generated',
  });
}
