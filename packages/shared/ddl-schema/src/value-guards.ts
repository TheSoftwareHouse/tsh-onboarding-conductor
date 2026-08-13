export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const isInteger = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value);
};

export const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value);
};

export const isJsonCompatibleValue = (value: unknown): boolean => {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (isFiniteNumber(value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonCompatibleValue(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).every((entry) => isJsonCompatibleValue(entry));
  }

  return false;
};
