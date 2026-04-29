import { logger } from '@enxoval/observability';
import { getKafkaTopic } from '../config';
import { nextCid } from '@enxoval/observability';
import { kafka } from '../kafka';

const producer = kafka.producer();

export async function connect(): Promise<void> {
  await producer.connect();
  logger.info('producer: connected');
}

export async function disconnect(): Promise<void> {
  await producer.disconnect();
  logger.info('producer: disconnected');
}

export async function publish<T extends Record<string, unknown>>(
  name: string,
  message: T,
): Promise<void> {
  const topic = getKafkaTopic(name);
  const cid = message['cid'] ? nextCid(message['cid'] as string) : undefined;
  logger.info({ cid, topic, name, eventId: message['eventId'] }, 'producer: message published');
  await producer.send({
    topic,
    messages: [{ value: JSON.stringify({ ...message, cid }) }],
  });
}

export async function publishRaw(topic: string, message: unknown): Promise<void> {
  await producer.send({
    topic,
    messages: [{ value: JSON.stringify(message) }],
  });
}
