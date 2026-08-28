// tests/notifications.test.ts
// Integration tests for the notification endpoints.

import { Notification, NotificationType } from '../src/models/Notification';
import request from 'supertest';
import { freshApp, authenticatedAgent } from './helpers';

async function seedNotifications(userId: string, count: number, readCount = 0) {
  const base = Date.now();
  const docs = Array.from({ length: count }, (_, i) => ({
    userId,
    type: NotificationType.SYSTEM,
    title: `Notification ${i + 1}`,
    message: `Message body ${i + 1}`,
    read: i < readCount,
    // Explicit timestamps so the sort order is deterministic.
    createdAt: new Date(base + i),
  }));
  await Notification.insertMany(docs);
}

describe('Notifications', () => {
  it('returns an empty list with empty state', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'empty@royalbeads.test' });
    const res = await agent.get('/api/notifications').expect(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
    expect(res.body.unread).toBe(0);
  });

  it('lists notifications newest first', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app, { email: 'list@royalbeads.test' });
    await seedNotifications(user.id, 3, 1);

    const res = await agent.get('/api/notifications').expect(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.unread).toBe(2);
    // Newest first (insertMany preserves order; createdAt asc). Sort is by
    // createdAt desc, so the last inserted should be first.
    expect(res.body.items[0].title).toBe('Notification 3');
  });

  it('marks a single notification as read', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app, { email: 'mark@royalbeads.test' });
    await seedNotifications(user.id, 2, 0);
    const before = await agent.get('/api/notifications').expect(200);
    const targetId = before.body.items[0].id;

    const res = await agent.patch(`/api/notifications/${targetId}/read`).expect(200);
    expect(res.body.notification.read).toBe(true);

    const after = await agent.get('/api/notifications').expect(200);
    expect(after.body.unread).toBe(1);
  });

  it('marks all notifications as read', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app, { email: 'all@royalbeads.test' });
    await seedNotifications(user.id, 5, 1);

    const res = await agent.patch('/api/notifications/read-all').expect(200);
    expect(res.body.modified).toBe(4);

    const after = await agent.get('/api/notifications').expect(200);
    expect(after.body.unread).toBe(0);
  });

  it('filters unreadOnly', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app, { email: 'filter@royalbeads.test' });
    await seedNotifications(user.id, 4, 2);
    const res = await agent.get('/api/notifications?unreadOnly=true').expect(200);
    expect(res.body.items.every((n: any) => n.read === false)).toBe(true);
    expect(res.body.items).toHaveLength(2);
  });

  it('does not allow user A to mark user B notifications', async () => {
    const app = freshApp();
    const { agent: agentA } = await authenticatedAgent(app, { email: 'isola@royalbeads.test' });
    const { user: userB } = await authenticatedAgent(app, { email: 'isolb@royalbeads.test' });
    await seedNotifications(userB.id, 1, 0);
    const notif = await Notification.findOne({ userId: userB.id });

    await agentA.patch(`/api/notifications/${notif!._id}/read`).expect(404);
  });

  it('blocks unauthenticated access', async () => {
    const app = freshApp();
    await request(app).get('/api/notifications').expect(401);
  });
});
