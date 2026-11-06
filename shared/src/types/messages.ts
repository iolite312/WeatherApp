/** Message on the start queue: kicks off a job by fetching all weather stations. */
export interface StartJobMessage {
  jobId: string;
  requestedAt: string;
}

/** The subset of a Buienradar station measurement the image job needs. */
export interface StationSnapshot {
  stationId: number;
  stationName: string;
  region: string;
  measuredAt: string;
  description: string;
  iconUrl?: string;
  temperature?: number;
  feelTemperature?: number;
  windDirection?: string;
  windSpeedBft?: number;
  humidity?: number;
  airPressure?: number;
  precipitation?: number;
}

/** Message on the image queue: one per station, fanned out by the start job. */
export interface ImageJobMessage {
  jobId: string;
  station: StationSnapshot;
}
