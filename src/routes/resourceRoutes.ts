import { Router } from 'express';
import { createResource, getResource, listResource } from '../controllers/resourceController';
import { requireAuth } from '../middleware/auth';

export const resourceRouter = (resource: string) => {
  const router = Router();
  router.get('/', listResource(resource));
  router.get('/:id', getResource(resource));
  router.post('/', requireAuth, createResource(resource));
  return router;
};
