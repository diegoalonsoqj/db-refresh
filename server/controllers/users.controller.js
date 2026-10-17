// Controladores thin de gestión de usuarios (admin) + auditoría.
import * as users from '../services/users.service.js';
import { AUDIT_SORTS, listAudit } from '../data/repositories/audit.repo.js';
import { parseListQuery } from '../lib/listQuery.js';

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

export const list = wrap(async (req, res) => res.json(await users.listUsers(req.query)));
export const create = wrap(async (req, res) => res.status(201).json(await users.createUser(req.body, req.user)));
export const update = wrap(async (req, res) => res.json(await users.updateUser(req.params.id, req.body, req.user)));
export const resetPassword = wrap(async (req, res) => {
  await users.resetPassword(req.params.id, req.body?.password);
  res.json({ ok: true });
});
export const remove = wrap(async (req, res) => {
  await users.deleteUser(req.params.id, req.user);
  res.status(204).end();
});

// GET /api/audit (admin)
export const audit = wrap(async (req, res) => res.json(await listAudit(parseListQuery(req.query, {
  sorts: AUDIT_SORTS,
  filters: { action: 'text', entity: 'text', user: 'text', from: 'date', to: 'date' },
}))));
