import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['src/testing/contract.test.ts', 'generated/tests/**/*.test.ts'], passWithNoTests: false } });
