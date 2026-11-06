import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from './errors.js';
import type { PushService } from './push.js';

const subscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

const prefsPatch = z
  .object({
    shared: z.boolean().optional(),
    morning: z.boolean().optional(),
    morningTime: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use HH:MM')
      .optional(),
  })
  .strict();

/** /api/push: this device's subscription, the user's preferences, and a test message. */
export function pushRouter(push: PushService | undefined): Router {
  const router = Router();
  const service = () => {
    if (!push) throw new HttpError(503, 'Notifications are not set up on this server');
    return push;
  };

  router.get('/config', async (req, res) => {
    if (!push) return res.json({ enabled: false });
    res.json({
      enabled: true,
      publicKey: push.publicKey,
      devices: await push.deviceCount(req.user!.id),
      prefs: await push.prefs(req.user!.id),
    });
  });

  router.post('/subscribe', async (req, res) => {
    await service().subscribe(req.user!.id, subscription.parse(req.body), req.get('user-agent') ?? '');
    res.status(201).json({ ok: true });
  });

  router.post('/unsubscribe', async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await service().unsubscribe(req.user!.id, endpoint);
    res.json({ ok: true });
  });

  router.patch('/prefs', async (req, res) => {
    res.json(await service().setPrefs(req.user!.id, prefsPatch.parse(req.body)));
  });

  router.post('/test', async (req, res) => {
    const delivered = await service().sendTo([req.user!.id], {
      title: 'Questlog',
      body: 'Notifications are working on this device.',
      url: '/account',
      tag: 'test',
    });
    if (delivered === 0) throw new HttpError(400, 'No device accepted the test. Turn notifications off and on again.');
    res.json({ delivered });
  });

  return router;
}
