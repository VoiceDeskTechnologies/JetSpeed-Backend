import { Request, Response } from 'express';
import { create, find, list } from '../services/store';

export const listResource = (resource: string) => (_req: Request, res: Response) => res.json({ data: list(resource) });
export const getResource = (resource: string) => (req: Request, res: Response) => {
  const record = find(resource, 'id', req.params.id);
  return record ? res.json({ data: record }) : res.status(404).json({ error: 'Not found' });
};
export const createResource = (resource: string) => (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'JSON body required' });
  res.status(201).json({ data: create(resource, req.body) });
};
