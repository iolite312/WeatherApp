import { createHash, timingSafeEqual } from 'node:crypto';
import { logger } from '@weatherapp/shared';
import type { NextFunction, Request, Response } from 'express';

const accessToken = process.env.ACCESS_TOKEN ?? '';

if (!accessToken) {
  logger.warn('ACCESS_TOKEN is not set, bearer authentication is disabled');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Simple bearer token check against ACCESS_TOKEN, compared in constant time. */
export function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  if (!accessToken) {
    next();
    return;
  }

  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token || !timingSafeEqual(digest(token), digest(accessToken))) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
