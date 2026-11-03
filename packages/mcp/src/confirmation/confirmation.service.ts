import { createHmac, timingSafeEqual } from 'node:crypto';
import { CallerIdentity, getIdentityId } from '../request-context/request-context';
import { MILLISECONDS_PER_MINUTE } from '../time.constants';
import { ToolError } from '../tools/tool-error';

/** The argument a write tool accepts on its second call; never part of what a token binds. */
export const CONFIRMATION_TOKEN_ARGUMENT = 'confirmationToken';
export const CONFIRMATION_TTL_MINUTES = 5;
export const CONFIRMATION_TTL_MILLISECONDS = CONFIRMATION_TTL_MINUTES * MILLISECONDS_PER_MINUTE;
/** Domain-separation label: the confirmation key is not the key that pseudonyms are made with. */
const CONFIRMATION_KEY_LABEL = 'confirmation';
const TOKEN_SEPARATOR = '.';
const MAC_ENCODING = 'base64url';
/** A SHA-256 digest is 32 bytes, which is 43 unpadded base64url characters. */
const MAC_LENGTH = 43;
/** The one accepted form: digits, the separator, the unpadded base64url MAC. */
const TOKEN_FORMAT = new RegExp(`^(\\d+)\\${TOKEN_SEPARATOR}([A-Za-z0-9_-]{${MAC_LENGTH}})$`);

export type ToolArguments = Record<string, unknown>;

export class ConfirmationError extends ToolError {}

/**
 * Issues and redeems the single-use tokens that stand between a write tool's preview and its
 * effect. A token binds the caller, the tool and the arguments of the preview, so a call that
 * changes any of them, or comes from someone else, is refused. Used tokens are remembered in memory
 * until they would have expired anyway.
 */
export class ConfirmationService {
  private readonly key: Buffer;
  private readonly usedTokens = new Map<string, number>();

  constructor(
    maskingKey: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createHmac('sha256', maskingKey).update(CONFIRMATION_KEY_LABEL).digest();
  }

  /** The token a preview hands back; valid for five minutes, once. */
  issue(identity: CallerIdentity, tool: string, args: ToolArguments): string {
    const expiresAt = this.now() + CONFIRMATION_TTL_MILLISECONDS;

    return `${expiresAt}${TOKEN_SEPARATOR}${this.sign(identity, tool, args, expiresAt)}`;
  }

  /** Accepts the token once for exactly this caller, tool and arguments, or throws. */
  consume(identity: CallerIdentity, tool: string, args: ToolArguments, token: unknown): void {
    this.pruneUsedTokens();
    const mismatch = new ConfirmationError(
      'The confirmation token does not match this call: it was issued for a different analyst, ' +
        'tool or arguments, or it is malformed. Call the tool again without a token to get a new preview.',
    );

    if (typeof token !== 'string') {
      throw mismatch;
    }

    const parts = TOKEN_FORMAT.exec(token);
    const expiresAt = parts ? Number(parts[1]) : Number.NaN;

    if (!parts || !Number.isSafeInteger(expiresAt)) {
      throw mismatch;
    }

    const mac = Buffer.from(parts[2], MAC_ENCODING);
    const expectedMac = this.sign(identity, tool, args, expiresAt);
    const expected = Buffer.from(expectedMac, MAC_ENCODING);

    if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
      throw mismatch;
    }

    if (this.now() >= expiresAt) {
      throw new ConfirmationError(
        `The confirmation token expired (tokens last ${CONFIRMATION_TTL_MINUTES} minutes). ` +
          'Call the tool again without a token to get a new preview.',
      );
    }

    const canonicalToken = `${expiresAt}${TOKEN_SEPARATOR}${expectedMac}`;

    if (this.usedTokens.has(canonicalToken)) {
      throw new ConfirmationError(
        'The confirmation token was already used. Call the tool again without a token to get a new preview.',
      );
    }

    this.usedTokens.set(canonicalToken, expiresAt);
  }

  private sign(identity: CallerIdentity, tool: string, args: ToolArguments, expiresAt: number) {
    const bound = Object.fromEntries(
      Object.entries(args).filter(([name]) => name !== CONFIRMATION_TOKEN_ARGUMENT),
    );
    const payload = JSON.stringify([getIdentityId(identity), tool, canonicalise(bound), expiresAt]);

    return createHmac('sha256', this.key).update(payload).digest(MAC_ENCODING);
  }

  private pruneUsedTokens(): void {
    const now = this.now();

    for (const [token, expiresAt] of this.usedTokens) {
      if (now >= expiresAt) {
        this.usedTokens.delete(token);
      }
    }
  }
}

/** The same value with every object's keys sorted, recursively, so key order never matters. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, nested]) => [key, canonicalise(nested)]),
    );
  }

  return value;
}
