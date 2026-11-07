import { Router } from 'express';
import { find, list } from '../services/store';
export const packagesRouter = Router();
packagesRouter.get('/', (_req, res) => res.json({ data: list('packages') }));
packagesRouter.get('/tracking/:trackingNumber', (req, res) => {
  const pkg = find('packages', 'tracking_number', req.params.trackingNumber);
  res.json({ data: pkg ?? { tracking_number: req.params.trackingNumber, status: 'label_created', events: [] } });
});
packagesRouter.get('/:trackingNumber', (req, res) => {
  const pkg = find('packages', 'tracking_number', req.params.trackingNumber);
  res.json({ data: pkg ?? { tracking_number: req.params.trackingNumber, status: 'label_created', events: [] } });
});
