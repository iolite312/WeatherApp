import { existsSync } from 'node:fs';
import { createCanvas, GlobalFonts, type Image, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { logger, type StationSnapshot } from '@weatherapp/shared';
import type { BackgroundImage } from './imageSource.js';

const WIDTH = 1280;
const HEIGHT = 800;
const MARGIN = 56;

// The worker image installs DejaVu; elsewhere we fall back to whatever sans-serif font the system has.
const FONT_FILES = {
  'WeatherSans-Regular': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'WeatherSans-Bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
};
for (const [family, path] of Object.entries(FONT_FILES)) {
  if (existsSync(path)) {
    GlobalFonts.registerFromPath(path, family);
  }
}
const REGULAR = GlobalFonts.has('WeatherSans-Regular') ? 'WeatherSans-Regular' : 'sans-serif';
const BOLD = GlobalFonts.has('WeatherSans-Bold') ? 'WeatherSans-Bold' : 'sans-serif';

function font(size: number, bold = false): string {
  return bold ? `bold ${size}px ${BOLD}` : `${size}px ${REGULAR}`;
}

function formatNumber(value: number, unit: string, decimals = 0): string {
  return `${value.toFixed(decimals)}${unit}`;
}

function detailParts(station: StationSnapshot): string[] {
  const parts: string[] = [];
  if (station.windDirection && station.windSpeedBft !== undefined) {
    parts.push(`Wind ${station.windDirection} ${station.windSpeedBft} Bft`);
  }
  if (station.humidity !== undefined) {
    parts.push(`Humidity ${formatNumber(station.humidity, '%')}`);
  }
  if (station.airPressure !== undefined) {
    parts.push(formatNumber(station.airPressure, ' hPa'));
  }
  if (station.precipitation !== undefined) {
    parts.push(`Rain ${formatNumber(station.precipitation, ' mm/h', 1)}`);
  }
  return parts;
}

/** Draws text, shrinking the font or cutting it off with an ellipsis so it never exceeds maxWidth. */
function fitText(ctx: SKRSContext2D, text: string, x: number, y: number, maxWidth: number, size: number, bold = false) {
  let fontSize = size;
  ctx.font = font(fontSize, bold);
  while (ctx.measureText(text).width > maxWidth && fontSize > size * 0.7) {
    fontSize -= 2;
    ctx.font = font(fontSize, bold);
  }

  let fitted = text;
  while (ctx.measureText(fitted).width > maxWidth && fitted.length > 1) {
    fitted = `${fitted.slice(0, -2)}…`;
  }
  ctx.fillText(fitted, x, y);
}

function drawCover(ctx: SKRSContext2D, image: Image) {
  const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
}

async function loadIcon(url: string | undefined): Promise<Image | undefined> {
  if (!url) {
    return undefined;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? await loadImage(Buffer.from(await res.arrayBuffer())) : undefined;
  } catch (err) {
    logger.debug({ err, url }, 'Could not load weather icon');
    return undefined;
  }
}

/** Draws the station's current weather onto the background photo and returns it as a JPEG. */
export async function renderWeatherImage(background: BackgroundImage, station: StationSnapshot): Promise<Buffer> {
  const [photo, icon] = await Promise.all([loadImage(background.data), loadIcon(station.iconUrl)]);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  drawCover(ctx, photo);

  // Darken the top and bottom so white text stays readable on any photo.
  const top = ctx.createLinearGradient(0, 0, 0, 160);
  top.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  top.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, WIDTH, 160);

  const bottom = ctx.createLinearGradient(0, HEIGHT * 0.4, 0, HEIGHT);
  bottom.addColorStop(0, 'rgba(0, 0, 0, 0)');
  bottom.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, HEIGHT * 0.4, WIDTH, HEIGHT * 0.6);

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 10;
  ctx.textBaseline = 'alphabetic';
  const contentWidth = WIDTH - MARGIN * 2;

  // Header: region on the left, measurement time on the right.
  ctx.font = font(24, true);
  ctx.textAlign = 'left';
  ctx.fillText(station.region.toUpperCase(), MARGIN, MARGIN + 16);
  ctx.font = font(24);
  ctx.textAlign = 'right';
  ctx.fillText(station.measuredAt.replace('T', ' ').slice(0, 16), WIDTH - MARGIN, MARGIN + 16);
  ctx.textAlign = 'left';

  // Footer, laid out bottom-up.
  let y = HEIGHT - MARGIN;

  ctx.globalAlpha = 0.7;
  ctx.font = font(16);
  ctx.textAlign = 'right';
  ctx.fillText(`${background.credit}  ·  Weather data: Buienradar.nl`, WIDTH - MARGIN, y);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  y -= 44;

  const details = detailParts(station);
  if (details.length > 0) {
    ctx.globalAlpha = 0.9;
    fitText(ctx, details.join('   ·   '), MARGIN, y, contentWidth, 26);
    ctx.globalAlpha = 1;
    y -= 50;
  }

  fitText(ctx, station.description, MARGIN, y, contentWidth, 32);
  y -= 52;

  const temperature = station.temperature !== undefined ? formatNumber(station.temperature, '°', 1) : '–';
  ctx.font = font(140, true);
  ctx.fillText(temperature, MARGIN - 6, y);
  let x = MARGIN + ctx.measureText(temperature).width + 24;

  if (icon) {
    ctx.drawImage(icon, x, y - 112, 112, 112);
    x += 136;
  }
  if (station.feelTemperature !== undefined) {
    ctx.font = font(28);
    ctx.globalAlpha = 0.9;
    ctx.fillText(`Feels like ${formatNumber(station.feelTemperature, '°', 1)}`, x, y - 16);
    ctx.globalAlpha = 1;
  }
  y -= 160;

  fitText(ctx, station.stationName, MARGIN, y, contentWidth, 56, true);

  return canvas.encode('jpeg', 88);
}
