import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const cwd = process.cwd();

function loadSchemas(dir: string): Record<string, Record<string, unknown>> {
  if (!existsSync(dir)) return {};
  const result: Record<string, Record<string, unknown>> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const mod = require(join(dir, file)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      if (value && typeof value === 'object' && typeof (value as { describe?: unknown }).describe === 'function') {
        result[name] = (value as { describe: () => Record<string, unknown> }).describe();
      }
    }
  }
  return result;
}

const distWire = resolve(cwd, 'dist', 'src', 'wire');

const contracts = {
  wire_in: loadSchemas(join(distWire, 'in')),
  wire_out: loadSchemas(join(distWire, 'out')),
};

const output = resolve(cwd, 'dist', 'contracts.json');
writeFileSync(output, JSON.stringify(contracts, null, 2));
console.log(`contracts generated → ${output}`);
