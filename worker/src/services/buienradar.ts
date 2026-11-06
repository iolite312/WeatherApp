import type { StationSnapshot } from '@weatherapp/shared';

const FEED_URL = 'https://data.buienradar.nl/2.0/feed/json';

/** The fields of a Buienradar station measurement we use. Measurements a station doesn't report are omitted. */
interface StationMeasurement {
  stationid: number;
  stationname: string;
  regio: string;
  timestamp: string;
  weatherdescription: string;
  fullIconUrl?: string;
  temperature?: number;
  feeltemperature?: number;
  winddirection?: string;
  windspeedBft?: number;
  humidity?: number;
  airpressure?: number;
  precipitation?: number;
}

interface BuienradarFeed {
  actual: {
    stationmeasurements: StationMeasurement[];
  };
}

export async function fetchStations(): Promise<StationSnapshot[]> {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`Buienradar responded with ${res.status} ${res.statusText}`);
  }

  const feed = (await res.json()) as BuienradarFeed;

  return feed.actual.stationmeasurements.map((station) => ({
    stationId: station.stationid,
    stationName: station.stationname.replace(/^Meetstation\s+/i, ''),
    region: station.regio,
    measuredAt: station.timestamp,
    description: station.weatherdescription,
    iconUrl: station.fullIconUrl,
    temperature: station.temperature,
    feelTemperature: station.feeltemperature,
    windDirection: station.winddirection,
    windSpeedBft: station.windspeedBft,
    humidity: station.humidity,
    airPressure: station.airpressure,
    precipitation: station.precipitation,
  }));
}
