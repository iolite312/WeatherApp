import { ensureStorage, logger } from '@weatherapp/shared';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);

await ensureStorage();

const server = createApp().listen(port, () => {
  logger.info(`API listening on port ${port}`);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server');
  server.close(() => process.exit(0));
});
