const WIDTH = 1280;
const HEIGHT = 800;

export interface BackgroundImage {
  data: Buffer;
  credit: string;
}

/**
 * Fetches a public photo from Lorem Picsum. The seed picks the photo, so every station in a job gets its own image
 * and retrying the same station returns the same photo.
 */
export async function fetchBackgroundImage(seed: string): Promise<BackgroundImage> {
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${WIDTH}/${HEIGHT}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    throw new Error(`Lorem Picsum responded with ${res.status} ${res.statusText}`);
  }

  return { data: Buffer.from(await res.arrayBuffer()), credit: 'Photo: Lorem Picsum' };
}
