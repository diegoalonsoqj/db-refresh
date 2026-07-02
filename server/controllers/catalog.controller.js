// Controladores thin del catálogo (proyectos, instancias, buckets, N:N).
import * as catalog from '../services/catalog.service.js';

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

// --- Proyectos ---
export const listProjects = wrap(async (_req, res) => res.json(await catalog.listProjects()));
export const getProject = wrap(async (req, res) => res.json(await catalog.getProject(req.params.id)));
export const createProject = wrap(async (req, res) => res.status(201).json(await catalog.createProject(req.body)));
export const updateProject = wrap(async (req, res) => res.json(await catalog.updateProject(req.params.id, req.body)));
export const deleteProject = wrap(async (req, res) => {
  await catalog.deleteProject(req.params.id);
  res.status(204).end();
});

// --- Instancias ---
export const listInstances = wrap(async (_req, res) => res.json(await catalog.listInstances()));
export const getInstance = wrap(async (req, res) => res.json(await catalog.getInstance(req.params.id)));
export const createInstance = wrap(async (req, res) => res.status(201).json(await catalog.createInstance(req.body)));
export const updateInstance = wrap(async (req, res) => res.json(await catalog.updateInstance(req.params.id, req.body)));
export const deleteInstance = wrap(async (req, res) => {
  await catalog.deleteInstance(req.params.id);
  res.status(204).end();
});

// --- Buckets ---
export const listBuckets = wrap(async (_req, res) => res.json(await catalog.listBuckets()));
export const getBucket = wrap(async (req, res) => res.json(await catalog.getBucket(req.params.id)));
export const createBucket = wrap(async (req, res) => res.status(201).json(await catalog.createBucket(req.body)));
export const updateBucket = wrap(async (req, res) => res.json(await catalog.updateBucket(req.params.id, req.body)));
export const deleteBucket = wrap(async (req, res) => {
  await catalog.deleteBucket(req.params.id);
  res.status(204).end();
});

// --- N:N instancia <-> bucket ---
export const listInstanceBuckets = wrap(async (req, res) =>
  res.json(await catalog.listInstanceBuckets(req.params.id)));
export const linkBucket = wrap(async (req, res) =>
  res.status(201).json(await catalog.linkBucket(req.params.id, req.body)));
export const unlinkBucket = wrap(async (req, res) => {
  await catalog.unlinkBucket(req.params.id, req.params.bucketId);
  res.status(204).end();
});
