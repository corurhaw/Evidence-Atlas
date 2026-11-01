import { db, ws, json, error, requireAuth } from '@appdeploy/sdk';

const SUBSCRIPTIONS_TABLE = 'entity_subscriptions';

export type SubscriptionRecord = {
  id: string;
  user_id?: string;
  entity_type: string;
  entity_id: string;
  connection_id: string;
  created_at: number;
};

async function listSubscriptions(): Promise<SubscriptionRecord[]> {
  const all: SubscriptionRecord[] = [];
  let cursor: string | undefined = undefined;
  for (let page = 0; page < 50; page++) {
    const data = await db.list<SubscriptionRecord>(SUBSCRIPTIONS_TABLE, {
      limit: 1000,
      ...(cursor ? { nextToken: cursor } : {}),
    });
    all.push(...data.items);
    if (!data.nextToken) break;
    cursor = data.nextToken;
  }
  return all;
}

export async function removeSubscriptionsByConnection(connectionId: string) {
  const items = await listSubscriptions();
  const matchIds = items
    .filter(item => item.connection_id === connectionId)
    .map(item => item.id);
  if (matchIds.length > 0) {
    await db.delete(SUBSCRIPTIONS_TABLE, matchIds);
  }
}

export async function addSubscription(
  entityType: string,
  entityId: string,
  connectionId: string,
  userId?: string
) {
  await db.add(SUBSCRIPTIONS_TABLE, [
    {
      ...(userId ? { user_id: userId } : {}),
      entity_type: entityType,
      entity_id: entityId,
      connection_id: connectionId,
      created_at: Date.now(),
    },
  ]);
}

export async function removeSubscriptions(
  entityType: string,
  entityId: string,
  connectionId: string,
  userId?: string
) {
  const items = await listSubscriptions();
  const matchIds = items
    .filter(
      item =>
        (!userId || item.user_id === userId) &&
        item.entity_type === entityType &&
        item.entity_id === entityId &&
        item.connection_id === connectionId
    )
    .map(item => item.id);
  if (matchIds.length > 0) {
    await db.delete(SUBSCRIPTIONS_TABLE, matchIds);
  }
}

export async function notifySubscribers(
  entityType: string,
  entityId: string,
  payload: unknown,
  excludeConnectionId?: string,
  userId?: string
) {
  const items = await listSubscriptions();
  const targets = items
    .filter(
      item =>
        (!userId || item.user_id === userId) &&
        item.entity_type === entityType &&
        item.entity_id === entityId
    )
    .map(item => item.connection_id)
    .filter(id => id !== excludeConnectionId);
  const targetConnectionIds = Array.from(new Set(targets));

  if (targetConnectionIds.length === 0) {
    return;
  }

  await ws.send(targetConnectionIds, {
    v: 1,
    type: 'entity.update',
    payload: {
      entity_type: entityType,
      entity_id: entityId,
      data: payload,
    },
  });
}

export const realtimeSubscriptionRoutes = {
  'POST /api/subscriptions': [
    requireAuth(),
    async (ctx: { user?: { userId: string }; body?: unknown }) => {
      const { entity_type, entity_id, connection_id } = (ctx.body ||
        {}) as Record<string, string>;
      if (!entity_type || !entity_id || !connection_id) {
        return error('entity_type, entity_id, connection_id are required');
      }
      await addSubscription(
        entity_type,
        entity_id,
        connection_id,
        ctx.user!.userId
      );
      return json({ ok: true });
    },
  ],

  'POST /api/subscriptions/remove': [
    requireAuth(),
    async (ctx: { user?: { userId: string }; body?: unknown }) => {
      const { entity_type, entity_id, connection_id } = (ctx.body ||
        {}) as Record<string, string>;
      if (!entity_type || !entity_id || !connection_id) {
        return error('entity_type, entity_id, connection_id are required');
      }
      await removeSubscriptions(
        entity_type,
        entity_id,
        connection_id,
        ctx.user!.userId
      );
      return json({ ok: true });
    },
  ],
};
