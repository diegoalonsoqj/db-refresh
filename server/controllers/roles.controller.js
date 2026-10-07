// Controladores thin de roles y permisos.
import * as roles from '../services/roles.service.js';

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

export const listPermissions = wrap(async (_req, res) => res.json(await roles.listPermissions()));
export const listRoles = wrap(async (_req, res) => res.json(await roles.listRoles()));
export const createRole = wrap(async (req, res) => res.status(201).json(await roles.createRole(req.body)));
export const updateRole = wrap(async (req, res) => res.json(await roles.updateRole(req.params.id, req.body)));
export const deleteRole = wrap(async (req, res) => {
  await roles.deleteRole(req.params.id);
  res.status(204).end();
});
