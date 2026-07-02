// Controladores thin: traducen HTTP <-> servicios. Sin lógica de negocio.
import * as restoreService from '../services/restore.service.js';
import * as backupService from '../services/backup.service.js';
import { getEventsSince } from '../data/repositories/jobs.repo.js';
import { subscribe } from '../jobs/progress.js';

export async function listBackups(req, res, next) {
  try {
    const { instanceId, bucketPath } = req.query;
    const files = await backupService.listBackups(instanceId, bucketPath);
    res.json({ files });
  } catch (err) {
    next(err);
  }
}

export async function launchRestore(req, res, next) {
  try {
    const job = await restoreService.launchRestore({
      instanceId: req.body.instanceId,
      bucketId: req.body.bucketId,
      bucketPath: req.body.bucketPath,
      mapping: req.body.mapping,
      requestedBy: req.user?.id ?? null,
    });
    res.status(202).json({ jobId: job.id, status: job.status, items: job.items });
  } catch (err) {
    next(err);
  }
}

export async function listJobs(_req, res, next) {
  try {
    const jobs = await restoreService.listJobs();
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
}

export async function getJob(req, res, next) {
  try {
    const job = await restoreService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job no encontrado' });
    res.json(job);
  } catch (err) {
    next(err);
  }
}

// SSE: progreso en vivo. Reenvía histórico (Last-Event-ID) + eventos nuevos.
export async function streamJob(req, res, next) {
  try {
    const jobId = req.params.id;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = (event) => {
      res.write(`id: ${event.id}\n`);
      res.write(`event: ${event.level}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 1) reproducir eventos ya ocurridos (reconexión)
    const lastId = Number.parseInt(req.headers['last-event-id'] ?? '0', 10) || 0;
    const backlog = await getEventsSince(jobId, lastId);
    backlog.forEach(send);

    // 2) suscribirse a los nuevos
    const unsubscribe = subscribe(jobId, send);

    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);

    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
}
