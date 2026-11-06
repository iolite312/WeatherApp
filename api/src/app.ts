import { logger } from '@weatherapp/shared';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi.js';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';

export function createApp() {
  const app = express();

  // Container Apps terminates TLS in front of us; trust it so req.protocol reports https in generated links.
  app.set('trust proxy', true);

  app.use(helmet());
  app.use(express.json());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/', (_req, res) => res.redirect('/docs'));
  app.use('/health', healthRouter);
  app.use('/api/jobs', jobsRouter);
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'Weather Image API' }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    req.log.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
