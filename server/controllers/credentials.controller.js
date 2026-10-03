// Controladores thin de credenciales SQL (solo admin).
import * as credentials from '../services/credentials.service.js';

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

export const list = wrap(async (_req, res) => res.json(await credentials.listCredentials()));
export const get = wrap(async (req, res) => res.json(await credentials.getCredential(req.params.id)));
export const create = wrap(async (req, res) =>
  res.status(201).json(await credentials.createCredential(req.body, req.user?.id)));
export const update = wrap(async (req, res) =>
  res.json(await credentials.updateCredential(req.params.id, req.body, req.user?.id)));
export const remove = wrap(async (req, res) => {
  await credentials.deleteCredential(req.params.id);
  res.status(204).end();
});
export const test = wrap(async (req, res) => res.json(await credentials.testCredential(req.params.id, req.body)));
export const testInstance = wrap(async (req, res) =>
  res.json(await credentials.testInstanceConnection(req.params.id)));
