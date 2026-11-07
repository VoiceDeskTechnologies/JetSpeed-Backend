import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { optionalAuth, requireAdmin } from './middleware/auth';
import { errorHandler, notFound } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { requestLogger } from './middleware/requestLogger';
import { healthRouter } from './routes/health';
import { packagesRouter } from './routes/packages';
import { resourceRouter } from './routes/resourceRoutes';
import { paymentReceiptRouter } from './routes/paymentReceipt';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);
app.use(rateLimiter);
app.use(optionalAuth);
app.use('/health', healthRouter);
app.use('/api/v1/health', healthRouter);
app.use('/api/v1/payment-receipts', paymentReceiptRouter);
app.use('/api/v1/packages', packagesRouter);
for (const resource of ['prealerts', 'invoices', 'payments', 'deliveries', 'admin']) {
  app.use(`/api/v1/${resource}`, resource === 'admin' ? requireAdmin : (_req, _res, next) => next(), resourceRouter(resource));
}
app.use(notFound);
app.use(errorHandler);
