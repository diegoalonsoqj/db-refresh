// Controladores thin de post-scripts por instancia.
import * as postScripts from '../services/postScripts.service.js';

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

export const list = wrap(async (req, res) =>
  res.json(await postScripts.listForInstance(req.params.id)));
export const create = wrap(async (req, res) =>
  res.status(201).json(await postScripts.create(req.params.id, req.body)));
export const update = wrap(async (req, res) =>
  res.json(await postScripts.update(req.params.id, req.params.scriptId, req.body)));
export const remove = wrap(async (req, res) => {
  await postScripts.remove(req.params.id, req.params.scriptId);
  res.status(204).end();
});
