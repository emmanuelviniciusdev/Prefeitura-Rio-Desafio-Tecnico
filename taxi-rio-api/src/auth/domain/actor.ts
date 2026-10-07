export const ACTORS = ['passageiro', 'motorista'] as const;

export type Actor = (typeof ACTORS)[number];

export function isActor(value: unknown): value is Actor {
  return value === 'passageiro' || value === 'motorista';
}
