// Controlador thin del Panel (dashboard).
import * as dashboard from '../services/dashboard.service.js';

export async function getDashboard(_req, res, next) {
  try {
    res.json(await dashboard.getDashboard());
  } catch (err) {
    next(err);
  }
}
