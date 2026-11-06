export type JobStatus = 'queued' | 'fetching' | 'processing' | 'completed' | 'failed';

export type StationStatus = 'pending' | 'completed' | 'failed';

export interface JobProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

export interface StationRecord {
  stationId: number;
  stationName: string;
  status: StationStatus;
  blobName?: string;
  error?: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  progress: JobProgress;
  stations: StationRecord[];
}
