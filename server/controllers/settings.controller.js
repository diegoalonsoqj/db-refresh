// Controladores thin del módulo de settings (AD/LDAP y GCP service account).
// TODO(auth): estas rutas exponen/mutan secretos -> proteger con RBAC admin
// cuando el middleware de auth esté disponible (fase de auth).
import * as settings from '../services/settings.service.js';

export async function getAd(_req, res, next) {
  try {
    res.json(await settings.getAdSettings());
  } catch (err) {
    next(err);
  }
}

export async function putAd(req, res, next) {
  try {
    const result = await settings.updateAdSettings(req.body, req.user?.id ?? null);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function testAd(req, res, next) {
  try {
    res.json(await settings.testAd(req.body));
  } catch (err) {
    next(err);
  }
}

export async function getGcp(_req, res, next) {
  try {
    res.json(await settings.getGcpSettings());
  } catch (err) {
    next(err);
  }
}

export async function putGcp(req, res, next) {
  try {
    const result = await settings.updateGcpServiceAccount(req.body, req.user?.id ?? null);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function testGcp(_req, res, next) {
  try {
    res.json(await settings.testGcp());
  } catch (err) {
    next(err);
  }
}
