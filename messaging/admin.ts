import { kafka } from './kafka';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface ServiceConfig {
  kafka_topics?: Record<string, { topic: string }>;
  feature_flags?: Record<string, boolean>;
}

export async function ensureTopics(): Promise<void> {
  const configPath = resolve(process.cwd(), 'config.json');
  if (!existsSync(configPath)) return;

  const config: ServiceConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const kafka_topics = config.kafka_topics ?? {};

  const admin = kafka.admin();
  await admin.connect();

  const existing = new Set(await admin.listTopics());
  const toCreate = Object.values(kafka_topics)
    .map(({ topic }) => topic)
    .filter((topic) => !existing.has(topic));

  if (toCreate.length > 0) {
    await admin.createTopics({
      topics: toCreate.map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
    });
  }

  await admin.disconnect();
}
