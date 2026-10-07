// Controladores thin de tareas de restore y su programación.
import * as schedule from '../services/schedule.service.js';

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

export const listSchedules = wrap(async (_req, res) => res.json(await schedule.listSchedules()));
export const getSchedule = wrap(async (req, res) => res.json(await schedule.getSchedule(req.params.id)));
export const createSchedule = wrap(async (req, res) =>
  res.status(201).json(await schedule.createSchedule(req.body, req.user?.id ?? null)));
export const updateSchedule = wrap(async (req, res) =>
  res.json(await schedule.updateSchedule(req.params.id, req.body)));
export const deleteSchedule = wrap(async (req, res) => {
  await schedule.deleteSchedule(req.params.id);
  res.status(204).end();
});
export const setTaskSchedule = wrap(async (req, res) =>
  res.json(await schedule.setTaskSchedule(req.params.id, req.body)));
export const previewSchedule = wrap(async (req, res) =>
  res.json(await schedule.previewSchedule(req.params.id)));
export const runSchedule = wrap(async (req, res) => {
  const job = await schedule.runScheduleNow(req.params.id);
  res.status(202).json({ jobId: job.id, status: job.status });
});
