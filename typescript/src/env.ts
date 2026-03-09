type EnvBag = Record<string, string | undefined>;

function getProcessEnv(): EnvBag | undefined {
  const maybeProcess = (globalThis as typeof globalThis & {
    process?: { env?: EnvBag };
  }).process;
  return maybeProcess?.env;
}

export function readPositiveIntEnv(name: string): number | undefined {
  const raw = getProcessEnv()?.[name];
  if (!raw) return undefined;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
