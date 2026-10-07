export const ACTORS = ['passageiro', 'motorista'] as const;

export type Actor = (typeof ACTORS)[number];

export const ACTOR_USER_IDS: Record<Actor, string> = {
  passageiro: 'e1c6c6d8-08d2-46ce-a670-4be04e1be1cb',
  motorista: '2bd66a43-5cdf-4e6a-8ad0-fbfa6b6bc6b0',
};

export function isActor(value: unknown): value is Actor {
  return value === 'passageiro' || value === 'motorista';
}

export function userIdForActor(actor: Actor): string {
  return ACTOR_USER_IDS[actor];
}
