import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function exampleJwtPrivateKey(): string {
  const contents = readFileSync(join(__dirname, '../.env.example'), 'utf8');
  const match = /^JWT_PRIVATE_KEY="(.*)"$/m.exec(contents);
  if (!match?.[1]) {
    throw new Error('JWT_PRIVATE_KEY is missing from .env.example');
  }

  return match[1];
}

export function useExampleJwtEnv(): void {
  process.env.JWT_PRIVATE_KEY = exampleJwtPrivateKey();
  process.env.JWT_EXPIRES_IN_SECONDS = '3600';
}
