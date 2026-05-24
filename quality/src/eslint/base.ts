import type { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';

const FRAMEWORK_IMPORTS = [
  { name: 'typeorm', message: 'Use lib/db instead.' },
  { name: 'kafkajs', message: 'Use lib/messaging instead.' },
  { name: 'fastify', message: 'Use lib/http instead.' },
  { name: 'pino', message: 'Use lib/observability instead.' },
  { name: 'vitest', message: 'Use lib/testing instead.' },
];

const DOMAIN_LAYERS = [
  'src/adapters/**',
  'src/controllers/**',
  'src/logic/**',
  'src/model/**',
  'src/wire/**',
];

export function base(): Linter.Config[] {
  return [
    {
      files: ['src/**/*.ts'],
      languageOptions: {
        parser: tsParser,
        parserOptions: { projectService: true },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      plugins: { '@typescript-eslint': tsPlugin as any },
      rules: {
        'no-restricted-imports':                      ['error', { paths: FRAMEWORK_IMPORTS }],
        '@typescript-eslint/no-explicit-any':         'error',
        '@typescript-eslint/no-unsafe-assignment':    'error',
        '@typescript-eslint/no-unsafe-argument':      'error',
        '@typescript-eslint/no-unsafe-call':          'error',
        '@typescript-eslint/no-unsafe-member-access': 'error',
        '@typescript-eslint/no-unsafe-return':        'error',
      },
    },
    {
      files: ['src/**/*.test.ts', 'tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      files: DOMAIN_LAYERS,
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'FunctionDeclaration',
            message: 'Use fn() or asyncFn() from lib/types instead of function declarations.',
          },
          {
            selector: "VariableDeclarator[init.type='ArrowFunctionExpression']",
            message: 'Use fn() or asyncFn() from lib/types instead of arrow function variables.',
          },
          {
            selector: "VariableDeclarator[init.type='FunctionExpression']",
            message: 'Use fn() or asyncFn() from lib/types instead of function expressions.',
          },
        ],
      },
    },
    prettierConfig,
  ];
}
