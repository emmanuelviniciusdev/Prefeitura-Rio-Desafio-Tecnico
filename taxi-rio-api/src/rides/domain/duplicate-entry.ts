import { QueryFailedError } from 'typeorm';

export function isDuplicateEntry(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }

  return (
    hasDuplicateCode(error.driverError) ||
    error.message.includes('Duplicate entry')
  );
}

function hasDuplicateCode(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const code = 'code' in value ? value.code : undefined;
  const errno = 'errno' in value ? value.errno : undefined;
  return code === 'ER_DUP_ENTRY' || errno === 1062;
}
