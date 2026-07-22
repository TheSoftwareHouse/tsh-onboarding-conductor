import { isIP } from 'node:net';

export const validateClientWebhookUrl = (
  url: string | undefined,
  nodeEnv: string,
): string | undefined => {
  if (typeof url !== 'string' || url.trim() === '') {
    return undefined;
  }

  const normalizedUrl = url.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('CLIENT_WEBHOOK_BASE_URL must be a valid absolute HTTP(S) URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('CLIENT_WEBHOOK_BASE_URL must use HTTP or HTTPS protocol');
  }

  if (parsedUrl.username !== '' || parsedUrl.password !== '') {
    throw new Error('CLIENT_WEBHOOK_BASE_URL must not include credentials');
  }

  if (parsedUrl.search !== '') {
    throw new Error('CLIENT_WEBHOOK_BASE_URL must not include URL query parameters');
  }

  if (parsedUrl.hash !== '') {
    throw new Error('CLIENT_WEBHOOK_BASE_URL must not include URL fragments');
  }

  const normalizedNodeEnv = nodeEnv.toLowerCase();
  if (normalizedNodeEnv === 'production' && parsedUrl.protocol !== 'https:') {
    throw new Error('CLIENT_WEBHOOK_BASE_URL must use HTTPS in production');
  }

  if (
    parsedUrl.protocol === 'http:' &&
    normalizedNodeEnv !== 'development' &&
    normalizedNodeEnv !== 'test'
  ) {
    throw new Error('CLIENT_WEBHOOK_BASE_URL over HTTP is allowed only in development and test');
  }

  if (parsedUrl.protocol === 'http:' && !isLoopbackHostname(parsedUrl.hostname)) {
    throw new Error('CLIENT_WEBHOOK_BASE_URL over HTTP must target a loopback host');
  }

  if (!parsedUrl.pathname.endsWith('/')) {
    parsedUrl.pathname = `${parsedUrl.pathname}/`;
  }

  return parsedUrl.toString();
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalizedHostname = normalizeHostname(hostname);

  if (normalizedHostname === 'localhost' || normalizedHostname === '::1') {
    return true;
  }

  if (isIP(normalizedHostname) === 4) {
    const [firstOctet] = normalizedHostname.split('.').map(Number);

    return firstOctet === 127;
  }

  return false;
};

const normalizeHostname = (hostname: string): string => {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }

  return hostname;
};
