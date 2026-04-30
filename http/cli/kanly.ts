import { readdirSync, existsSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { readFileSync } from 'node:fs';

type FieldDescriptor =
  | { type: string }
  | { type: 'literal'; values: string[] };

type WireMeta = {
  path?: string;
  method?: string;
  topic?: string;
};

type WireFields = {
  _meta?: WireMeta;
  [field: string]: FieldDescriptor | WireMeta | undefined;
};

function getFields(wire: WireFields): Record<string, FieldDescriptor> {
  const { _meta: _ignored, ...rest } = wire;
  return rest as Record<string, FieldDescriptor>;
}

type Contracts = {
  wire_in: Record<string, WireFields>;
  wire_out: Record<string, WireFields>;
};

const cwd = process.cwd();
const port = process.env.PORT ?? '3000';
const localDir = process.env.KANLY_LOCAL_DIR;

const SERVICE_URLS: Record<string, string | undefined> = {
  atreides: process.env.ATREIDES_URL,
  persona: process.env.PERSONA_URL,
  odyssey: process.env.ODYSSEY_URL,
  janus: process.env.JANUS_URL,
  imperium: process.env.IMPERIUM_URL,
};

async function fetchContracts(url: string): Promise<Contracts> {
  const res = await fetch(`${url}/contracts`);
  if (!res.ok) throw new Error(`GET ${url}/contracts returned ${res.status}`);
  return res.json() as Promise<Contracts>;
}

function loadLocalPartnerContracts(partner: string): Contracts | null {
  if (!localDir) return null;
  const path = join(localDir, partner, 'contracts.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as Contracts;
}

function loadLocalContracts(): Contracts {
  const path = resolve(cwd, 'dist', 'contracts.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as Contracts;
}

function discoverHttpPartners(): string[] {
  const dir = resolve(cwd, 'src', 'diplomat', 'http-client');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => basename(f, '.ts'));
}

function discoverKafkaTopics(): string[] {
  const file = resolve(cwd, 'src', 'diplomat', 'consumer', 'index.ts');
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf-8');
  const matches = [...content.matchAll(/subscribe\(['"]([^'"]+)['"]/g)];
  return matches.map((m) => m[1]);
}

function toWireOutName(wireInName: string): string {
  return wireInName.replace(/WireIn$/, 'WireOut');
}

function formatDescriptor(d: FieldDescriptor): string {
  if (d.type === 'literal' && 'values' in d) return d.values.map((v: string) => `"${v}"`).join(' | ');
  return d.type;
}

function formatContract(fields: WireFields): string {
  const entries = Object.entries(fields)
    .filter(([k]) => k !== '_meta')
    .map(([k, v]) => `${k}: ${formatDescriptor(v as FieldDescriptor)}`)
    .join(', ');
  return `{ ${entries} }`;
}

function formatMeta(meta?: WireMeta): string {
  if (!meta) return '';
  if (meta.topic) return ` [topic: ${meta.topic}]`;
  if (meta.path) return ` [${meta.method ?? 'HTTP'} ${meta.path}]`;
  return '';
}

function loadServiceName(): string {
  const pkgPath = resolve(cwd, 'package.json');
  if (!existsSync(pkgPath)) return 'unknown';
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
  return pkg.name ?? 'unknown';
}

function validate(
  localContracts: Contracts,
  partnerContracts: Contracts,
  consumerName: string,
  producerName: string,
): string[] {
  const errors: string[] = [];

  for (const [name, fields] of Object.entries(localContracts.wire_in)) {
    const outName = toWireOutName(name);
    const partnerOut = partnerContracts.wire_out[outName];

    if (!partnerOut) continue;

    const meta = fields._meta ?? partnerOut._meta;
    const metaLabel = formatMeta(meta as WireMeta | undefined);
    const consumerFields = getFields(fields);
    const producerFields = getFields(partnerOut);

    console.log(`\nkanly: validating ${outName}${metaLabel}`);
    console.log(`  consumer (${consumerName}): ${formatContract(fields)}`);
    console.log(`  producer (${producerName}): ${formatContract(partnerOut)}`);

    for (const [field, descriptor] of Object.entries(consumerFields)) {
      if (!(field in producerFields)) {
        errors.push(
          `[${producerName} → ${consumerName}]${metaLabel} ${outName}.${field} — field missing in producer (${consumerName} expects ${formatDescriptor(descriptor)})`,
        );
        continue;
      }
      const producerField = producerFields[field];
      if (producerField.type !== descriptor.type) {
        errors.push(
          `[${producerName} → ${consumerName}]${metaLabel} ${outName}.${field} — ${producerName} sends "${formatDescriptor(producerField)}", ${consumerName} expects "${formatDescriptor(descriptor)}"`,
        );
      }
    }
  }

  return errors;
}

async function run(): Promise<void> {
  const localPath = resolve(cwd, 'dist', 'contracts.json');
  if (!existsSync(localPath)) {
    console.log('kanly: no contracts.json found — skipping');
    process.exit(0);
  }

  const serviceName = loadServiceName();
  const local = loadLocalContracts();
  const httpPartners = discoverHttpPartners();
  const kafkaTopics = discoverKafkaTopics();

  if (httpPartners.length === 0 && kafkaTopics.length === 0) {
    console.log('kanly: no integrations found — skipping');
    process.exit(0);
  }

  if (httpPartners.length > 0) {
    console.log(`kanly: HTTP partners: [${httpPartners.join(', ')}]`);
  }
  if (kafkaTopics.length > 0) {
    console.log(`kanly: Kafka topics: [${kafkaTopics.join(', ')}]`);
    for (const topic of kafkaTopics) {
      console.log(`kanly: validating topic ${topic} on ${serviceName}`);
    }
  }

  const allErrors: string[] = [];

  for (const partner of httpPartners) {
    const local_partner = loadLocalPartnerContracts(partner);
    if (local_partner) {
      const errors = validate(local, local_partner, serviceName, partner);
      allErrors.push(...errors);
      continue;
    }
    const url = SERVICE_URLS[partner];
    if (!url) {
      console.warn(`kanly: no URL configured for "${partner}" — skipping`);
      continue;
    }
    const partnerContracts = await fetchContracts(url);
    const errors = validate(local, partnerContracts, serviceName, partner);
    allErrors.push(...errors);
  }

  if (allErrors.length > 0) {
    console.error('\nkanly: contract violations found:\n');
    for (const err of allErrors) console.error(`  ✗ ${err}`);
    process.exit(1);
  }

  console.log('kanly: all contracts compatible ✓');
  process.exit(0);
}

run().catch((err) => {
  console.error('kanly: unexpected error:', err);
  process.exit(1);
});
