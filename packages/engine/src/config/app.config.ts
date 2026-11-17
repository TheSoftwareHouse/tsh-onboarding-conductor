import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

import { validateClientWebhookUrl } from '../utils/client-webhook-url/client-webhook-url.validator';
import { validateAdminPanelOrigin } from '../utils/admin-panel/admin-panel.validator';
import { parseConnectorCallbackUnsignedTypes } from './connector-callback-unsigned-types.config';
import { parseConnectorMocks } from './connector-mocks.config';
import { NodeEnv, parseEnvironmentName } from './environment.config';
import { isEncryptionKeyConfigured, parseEncryptionKey } from './encryption.config';
import { parseHttpConnectorSecrets } from './http-connector-secrets.config';

export enum AppMode {
  ALL = 'all',
  API_ONLY = 'api-only',
  WORKER_ONLY = 'worker-only',
}

export enum StorageDriver {
  S3 = 's3',
}

const CLIENT_WEBHOOK_TIMEOUT_MS_DEFAULT = 5000;
const CLIENT_WEBHOOK_TIMEOUT_MS_MIN = 100;
const CLIENT_WEBHOOK_TIMEOUT_MS_MAX = 30000;
const OTP_SMS_TIMEOUT_MS_DEFAULT = 10000;
const OTP_SMS_TIMEOUT_MS_MIN = 100;
const OTP_SMS_TIMEOUT_MS_MAX = 30000;
const OTP_DATABASE_POOL_SIZE_DEFAULT = 5;
const OTP_DATABASE_POOL_SIZE_MIN = 1;
const OTP_DATABASE_POOL_SIZE_MAX = 50;

const SMTP_TIMEOUT_MS_DEFAULT = 5000;
const SMTP_TIMEOUT_MS_MIN = 100;
const SMTP_TIMEOUT_MS_MAX = 30000;
const SMTP_PORT_MIN = 1;
const SMTP_PORT_MAX = 65535;

const WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_DEFAULT = 1000;
const WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_MIN = 100;

const WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_DEFAULT = 25;
const WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MIN = 1;
const WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MAX = 1000;

const WEBHOOK_OUTBOX_WORKER_LEASE_MS_DEFAULT = 60000;
const WEBHOOK_OUTBOX_WORKER_LEASE_MS_MIN = 1000;
const WEBHOOK_OUTBOX_WORKER_LEASE_GRACE_MS = 5000;

const ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS_DEFAULT = 15000;
const ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS_MIN = 1000;

const ENCRYPTION_SWEEP_POLL_INTERVAL_MS_DEFAULT = 5000;
const ENCRYPTION_SWEEP_POLL_INTERVAL_MS_MIN = 500;

const ENCRYPTION_SWEEP_BATCH_SIZE_DEFAULT = 100;
const ENCRYPTION_SWEEP_BATCH_SIZE_MIN = 1;
const ENCRYPTION_SWEEP_BATCH_SIZE_MAX = 1000;

const ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS_DEFAULT = 60000;
const ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS_MIN = 1000;

const HTTP_CONNECTOR_TIMEOUT_MS_DEFAULT = 5000;
const HTTP_CONNECTOR_TIMEOUT_MS_MIN = 100;
const HTTP_CONNECTOR_TIMEOUT_MS_MAX = 30000;

const HTTP_CONNECTOR_SECRETS_DEFAULT = '{}';

const SUMSUB_TIMEOUT_MS_DEFAULT = 10000;
const SUMSUB_TIMEOUT_MS_MIN = 100;
const SUMSUB_TIMEOUT_MS_MAX = 30000;

const VERIFF_TIMEOUT_MS_DEFAULT = 10000;
const VERIFF_TIMEOUT_MS_MIN = 100;
const VERIFF_TIMEOUT_MS_MAX = 30000;

const CONNECTOR_CALLBACK_UNSIGNED_TYPES_DEFAULT = '';

const BETTER_AUTH_SECRET_MIN_LENGTH = 32;
const BETTER_AUTH_HTTP_PROTOCOLS = ['http:', 'https:'];
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONNECTOR_MOCKS_DEFAULT = '';

const WEBHOOK_OUTBOX_QUEUE_NAME_DEFAULT = 'webhook-outbox';
const WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_DEFAULT = 4;
const WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MIN = 1;
const WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MAX = 32;

export class AppConfig {
  @IsEnum(AppMode)
  @IsOptional()
  @Type(() => String)
  MODE: AppMode = AppMode.ALL;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  PORT: number = 3000;

  /**
   * Required: `production` turns on every production-only rule (`config/environment.config.ts`),
   * and `test` marks a test run, the only one `CONNECTOR_MOCKS` applies to.
   */
  @IsEnum(NodeEnv)
  @Type(() => String)
  NODE_ENV!: NodeEnv;

  /** Which environment this deployment is — `dev`, `staging`, `pre-prod`, `prod` — shown to operators. */
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  ENVIRONMENT_NAME!: string;

  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  ADMIN_PANEL_ORIGIN!: string;

  /**
   * Where the admin panel's `vite build` output sits. Unset resolves to `packages/admin-panel/dist`
   * relative to the engine's own code, which is where both this repository and the engine image put
   * it; a directory without an `index.html` simply means no panel is served.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  ADMIN_PANEL_DIST_DIR?: string;

  /**
   * The admin panel's own settings. They keep their `VITE_` names because the panel merges them
   * over the values Vite inlined under those exact keys at build time. The engine never reads them
   * itself — it renders them into the `/config.js` the panel loads (see
   * `src/admin-panel/admin-panel-runtime-config.ts`) — but they are declared here so the panel's
   * half of the image has one documented configuration surface rather than an undeclared one.
   *
   * `VITE_ENGINE_API_BASE_URL` is the one with a default worth knowing: leaving it unset makes the
   * panel call this engine at a relative base URL, which is correct for every deployment that
   * serves both from this image. Set it only to point the panel at a different engine.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_ENGINE_API_BASE_URL?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_AUTH_ENABLED?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  ADMIN_AUTH_ENABLED: boolean = true;

  /** better-auth's signing and encryption secret. Required with `ADMIN_AUTH_ENABLED=true`; never rendered into the panel. */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  BETTER_AUTH_SECRET?: string;

  /** The engine's own absolute http(s) URL, the base better-auth builds cookies and redirects from. */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  BETTER_AUTH_URL?: string;

  /** SMTP URL of the mail server carrying invitations and password resets, e.g. `smtp://mailhog:1025`. */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_SMTP_URL?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_MAIL_FROM?: string;

  /** The seed superadmin's credentials; set both or neither. The seed runs only while no superadmin exists. */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_SUPERADMIN_EMAIL?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_SUPERADMIN_PASSWORD?: string;

  /** Whether a superadmin with a password must enroll TOTP; `false` makes it optional for them only. */
  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  AUTH_SUPERADMIN_TWO_FACTOR_REQUIRED: boolean = true;

  /** The Microsoft sign-in triple; set all three or none. The secret never reaches the panel. */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_MICROSOFT_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_MICROSOFT_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AUTH_MICROSOFT_TENANT_ID?: string;

  // Optional override for the `users/` workflow scope. Built-in and fixture
  // workflows ship with the application and are not configurable.
  @IsString()
  @IsOptional()
  WORKFLOWS_USERS_DIR?: string;

  // Optional override for the `users/` email template scope. Built-in and
  // fixture templates ship with the application and are not configurable.
  @IsString()
  @IsOptional()
  EMAIL_TEMPLATES_USERS_DIR?: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  REDIS_URL!: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_ENABLED: boolean = false;

  @IsString()
  @IsOptional()
  @Type(() => String)
  SMTP_HOST?: string;

  @IsInt()
  @Min(SMTP_PORT_MIN)
  @Max(SMTP_PORT_MAX)
  @IsOptional()
  @Type(() => Number)
  SMTP_PORT?: number;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_SECURE: boolean = false;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_STARTTLS: boolean = false;

  /**
   * Opt-in escape hatch for unencrypted SMTP. Only a local development or CI sink
   * (a MailHog container, for example) should ever set it.
   */
  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  SMTP_ALLOW_INSECURE: boolean = false;

  @IsString()
  @IsEmail()
  @IsOptional()
  @Type(() => String)
  SMTP_FROM?: string;

  @IsInt()
  @Min(SMTP_TIMEOUT_MS_MIN)
  @Max(SMTP_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  SMTP_TIMEOUT_MS: number = SMTP_TIMEOUT_MS_DEFAULT;

  @IsString()
  @IsOptional()
  CLIENT_WEBHOOK_BASE_URL?: string;

  @IsInt()
  @Min(CLIENT_WEBHOOK_TIMEOUT_MS_MIN)
  @Max(CLIENT_WEBHOOK_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  CLIENT_WEBHOOK_TIMEOUT_MS: number = CLIENT_WEBHOOK_TIMEOUT_MS_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS: number = WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MIN)
  @Max(WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_MAX)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_WORKER_BATCH_SIZE: number = WEBHOOK_OUTBOX_WORKER_BATCH_SIZE_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_WORKER_LEASE_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_WORKER_LEASE_MS: number = WEBHOOK_OUTBOX_WORKER_LEASE_MS_DEFAULT;

  @IsString()
  @IsOptional()
  @Type(() => String)
  WEBHOOK_OUTBOX_QUEUE_NAME: string = WEBHOOK_OUTBOX_QUEUE_NAME_DEFAULT;

  @IsInt()
  @Min(WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MIN)
  @Max(WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_MAX)
  @IsOptional()
  @Type(() => Number)
  WEBHOOK_OUTBOX_QUEUE_CONCURRENCY: number = WEBHOOK_OUTBOX_QUEUE_CONCURRENCY_DEFAULT;

  @IsInt()
  @Min(OTP_SMS_TIMEOUT_MS_MIN)
  @Max(OTP_SMS_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  OTP_SMS_TIMEOUT_MS: number = OTP_SMS_TIMEOUT_MS_DEFAULT;

  /** Connections in the OTP challenges' own pool, opened beside the main one (`OtpChallengesConnection`). */
  @IsInt()
  @Min(OTP_DATABASE_POOL_SIZE_MIN)
  @Max(OTP_DATABASE_POOL_SIZE_MAX)
  @IsOptional()
  @Type(() => Number)
  OTP_DATABASE_POOL_SIZE: number = OTP_DATABASE_POOL_SIZE_DEFAULT;

  @IsInt()
  @Min(HTTP_CONNECTOR_TIMEOUT_MS_MIN)
  @Max(HTTP_CONNECTOR_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  HTTP_CONNECTOR_TIMEOUT_MS: number = HTTP_CONNECTOR_TIMEOUT_MS_DEFAULT;

  /**
   * `http_request`'s secrets, as a JSON object of `{"<alias>": {"<key>": "<value>"}}`. Unlike a
   * dedicated connector's credentials, these are named by workflow JSON rather than by an adapter,
   * so they stay deployment configuration rather than operator-supplied settings.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  HTTP_CONNECTOR_SECRETS: string = HTTP_CONNECTOR_SECRETS_DEFAULT;

  /**
   * `appToken` and `secretKey` are operator-provided connector settings configured through the
   * admin API, not environment variables — the `connectors` table is the only source.
   * SUMSUB_BASE_URL and SUMSUB_TIMEOUT_MS stay here because they are deployment settings, not
   * credentials.
   */
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  SUMSUB_BASE_URL: string = 'https://api.sumsub.com';

  @IsInt()
  @Min(SUMSUB_TIMEOUT_MS_MIN)
  @Max(SUMSUB_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  SUMSUB_TIMEOUT_MS: number = SUMSUB_TIMEOUT_MS_DEFAULT;

  /**
   * `apiKey` and `sharedSecretKey` are operator-provided connector settings configured through the
   * admin API, not environment variables — the `connectors` table is the only source.
   * VERIFF_BASE_URL and VERIFF_TIMEOUT_MS stay here because they are deployment settings, not
   * credentials.
   */
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  VERIFF_BASE_URL: string = 'https://stationapi.veriff.com';

  @IsInt()
  @Min(VERIFF_TIMEOUT_MS_MIN)
  @Max(VERIFF_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  VERIFF_TIMEOUT_MS: number = VERIFF_TIMEOUT_MS_DEFAULT;

  @IsString()
  @IsOptional()
  @Type(() => String)
  CONNECTOR_CALLBACK_UNSIGNED_TYPES: string = CONNECTOR_CALLBACK_UNSIGNED_TYPES_DEFAULT;

  /**
   * `<connector type>:<mock connector type>` pairs putting a fixture in a real connector's
   * place, so e2e runs need no third-party credentials. Kept in `.env` like any other
   * setting; only a NODE_ENV=test run applies them, every other environment ignores them.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  CONNECTOR_MOCKS: string = CONNECTOR_MOCKS_DEFAULT;

  @IsEnum(StorageDriver)
  @IsOptional()
  @Type(() => String)
  STORAGE_DRIVER: StorageDriver = StorageDriver.S3;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_BUCKET: string = 'orchestrator-files';

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_REGION: string = 'us-east-1';

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_ENDPOINT: string = 'http://garage:3900';

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  STORAGE_S3_FORCE_PATH_STYLE: boolean = true;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_ACCESS_KEY_ID!: string;

  @IsString()
  @IsNotEmpty()
  STORAGE_S3_SECRET_ACCESS_KEY!: string;

  /**
   * The key-encryption key: a base64-encoded 32-byte AES-256-GCM key that wraps every data key
   * `encryption_keys` ever holds. Optional at boot — a deployment that never turns encryption on
   * needs none — but required before encryption can be turned on or a data key rotated from the
   * admin panel (`PATCH /v1/admin/encryption`, `POST /v1/admin/encryption/keys`), and required at
   * boot once `encryption_keys` holds any row, since without it that data is unreadable. When
   * present it must be valid, checked in `validateConfig()` below. Losing it makes every wrapped
   * data key, and every row any of them encrypted, unrecoverable; there is no escrow or recovery
   * path. Never logged, echoed or defaulted.
   */
  @IsString()
  @IsOptional()
  @Type(() => String)
  ENCRYPTION_KEY?: string;

  /**
   * How often `EncryptionKeyRingService` re-reads `encryption_keys` in the background. This is
   * what makes a change on one process reach the others promptly: `engine` and `engine-worker`
   * run as separate containers, so the process serving reads is never the one running the sweep,
   * and the ring's on-miss reload alone would otherwise mean a burst of failed reads after every
   * change, until each process happened to take a miss and self-heal.
   *
   * Also the length of the grace window every key-ring change gets (`EncryptionAdminService`):
   * an incoming key's `activatedAt` and an outgoing key's `deletedAt` are set to `now + this`
   * rather than `now`, so every replica has a full interval to learn of the change before any
   * write depends on it.
   */
  @IsInt()
  @Min(ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS: number = ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS_DEFAULT;

  /**
   * How often `EncryptionSweepService` polls for onboarding contexts not yet in the target state —
   * still plaintext while encryption is on, still encrypted while it is off. A row on a superseded
   * key is not swept: rotation is lazy, and it migrates when it is next written. Applies
   * to `MODE=worker-only` and `MODE=all`; `MODE=api-only` starts no sweep at all.
   */
  @IsInt()
  @Min(ENCRYPTION_SWEEP_POLL_INTERVAL_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  ENCRYPTION_SWEEP_POLL_INTERVAL_MS: number = ENCRYPTION_SWEEP_POLL_INTERVAL_MS_DEFAULT;

  /**
   * How many onboarding rows one sweep tick claims and moves at a time. Bounded so a single tick's
   * transaction — which holds `FOR UPDATE SKIP LOCKED` row locks for its duration — stays short
   * enough to never meaningfully contend with a live onboarding write.
   */
  @IsInt()
  @Min(ENCRYPTION_SWEEP_BATCH_SIZE_MIN)
  @Max(ENCRYPTION_SWEEP_BATCH_SIZE_MAX)
  @IsOptional()
  @Type(() => Number)
  ENCRYPTION_SWEEP_BATCH_SIZE: number = ENCRYPTION_SWEEP_BATCH_SIZE_DEFAULT;

  /**
   * How often `EncryptionKeyRotationService` asks whether the active key's automatic-rotation
   * schedule has come due. Not the schedule itself — that is chosen per key from the admin panel,
   * in units of days and weeks — only how promptly the engine notices one, so the default is
   * coarse. Applies to `MODE=worker-only` and `MODE=all`; `MODE=api-only` schedules nothing.
   */
  @IsInt()
  @Min(ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS_MIN)
  @IsOptional()
  @Type(() => Number)
  ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS: number =
    ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS_DEFAULT;
}

export function validateConfig(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(AppConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (validatedConfig.WORKFLOWS_USERS_DIR !== undefined) {
    if (
      typeof validatedConfig.WORKFLOWS_USERS_DIR !== 'string' ||
      validatedConfig.WORKFLOWS_USERS_DIR.trim() === ''
    ) {
      throw new Error('WORKFLOWS_USERS_DIR must be a non-empty string when set');
    }

    validatedConfig.WORKFLOWS_USERS_DIR = validatedConfig.WORKFLOWS_USERS_DIR.trim();
  }

  if (validatedConfig.EMAIL_TEMPLATES_USERS_DIR !== undefined) {
    if (
      typeof validatedConfig.EMAIL_TEMPLATES_USERS_DIR !== 'string' ||
      validatedConfig.EMAIL_TEMPLATES_USERS_DIR.trim() === ''
    ) {
      throw new Error('EMAIL_TEMPLATES_USERS_DIR must be a non-empty string when set');
    }

    validatedConfig.EMAIL_TEMPLATES_USERS_DIR = validatedConfig.EMAIL_TEMPLATES_USERS_DIR.trim();
  }

  if (
    typeof validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME !== 'string' ||
    validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME.trim() === ''
  ) {
    throw new Error('WEBHOOK_OUTBOX_QUEUE_NAME must be a non-empty string');
  }

  validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME = validatedConfig.WEBHOOK_OUTBOX_QUEUE_NAME.trim();

  validatedConfig.ENVIRONMENT_NAME = parseEnvironmentName(validatedConfig.ENVIRONMENT_NAME);

  validatedConfig.CLIENT_WEBHOOK_BASE_URL = validateClientWebhookUrl(
    validatedConfig.CLIENT_WEBHOOK_BASE_URL,
    validatedConfig.NODE_ENV,
  );

  validatedConfig.ADMIN_PANEL_ORIGIN = validateAdminPanelOrigin(validatedConfig.ADMIN_PANEL_ORIGIN);

  parseHttpConnectorSecrets(validatedConfig.HTTP_CONNECTOR_SECRETS);

  parseConnectorCallbackUnsignedTypes(validatedConfig.CONNECTOR_CALLBACK_UNSIGNED_TYPES);

  // Parsed here so a malformed pair fails startup wherever it is configured, even though only
  // a test run puts the mocks it names in front of a real connector.
  parseConnectorMocks(validatedConfig.CONNECTOR_MOCKS);

  if (validatedConfig.SMTP_ENABLED) {
    const smtpHost = validatedConfig.SMTP_HOST?.trim();
    if (!smtpHost) {
      throw new Error('SMTP_HOST is required when SMTP_ENABLED=true');
    }

    if (
      typeof validatedConfig.SMTP_PORT !== 'number' ||
      !Number.isInteger(validatedConfig.SMTP_PORT)
    ) {
      throw new Error('SMTP_PORT is required when SMTP_ENABLED=true');
    }

    if (typeof validatedConfig.SMTP_FROM !== 'string' || validatedConfig.SMTP_FROM.trim() === '') {
      throw new Error('SMTP_FROM is required when SMTP_ENABLED=true');
    }

    if (
      typeof validatedConfig.SMTP_TIMEOUT_MS !== 'number' ||
      !Number.isInteger(validatedConfig.SMTP_TIMEOUT_MS)
    ) {
      throw new Error('SMTP_TIMEOUT_MS is required when SMTP_ENABLED=true');
    }

    if (validatedConfig.SMTP_SECURE && validatedConfig.SMTP_STARTTLS) {
      throw new Error('SMTP_SECURE and SMTP_STARTTLS cannot both be true');
    }

    if (
      !validatedConfig.SMTP_SECURE &&
      !validatedConfig.SMTP_STARTTLS &&
      !validatedConfig.SMTP_ALLOW_INSECURE
    ) {
      throw new Error('SMTP_SECURE=false and SMTP_STARTTLS=false require SMTP_ALLOW_INSECURE=true');
    }
  }

  if (isEncryptionKeyConfigured(validatedConfig.ENCRYPTION_KEY)) {
    // A configured key must be usable: a typo found here, at boot, names the exact problem
    // (non-base64, wrong length) rather than surfacing as a failed wrap the first time an
    // operator turns encryption on.
    parseEncryptionKey(validatedConfig.ENCRYPTION_KEY);
  }

  validateBetterAuthConfig(validatedConfig);

  if (!validatedConfig.ADMIN_AUTH_ENABLED && validatedConfig.NODE_ENV === NodeEnv.PRODUCTION) {
    // The flag is a local escape hatch, and `.env.dist` ships it as false so a fresh clone runs
    // without a better-auth setup. A production `.env` copied from that sample would silently carry it
    // over and serve onboarding data with no credential demanded. Refusing to start makes that omission loud
    // rather than leaving an `auth.access_unauthenticated` row as the only trace.
    throw new Error(
      'ADMIN_AUTH_ENABLED=false is a local-only escape hatch and cannot be used when NODE_ENV=production',
    );
  }

  if (
    validatedConfig.WEBHOOK_OUTBOX_WORKER_LEASE_MS <
    validatedConfig.CLIENT_WEBHOOK_TIMEOUT_MS + WEBHOOK_OUTBOX_WORKER_LEASE_GRACE_MS
  ) {
    throw new Error(
      'WEBHOOK_OUTBOX_WORKER_LEASE_MS must be at least CLIENT_WEBHOOK_TIMEOUT_MS + 5000 ms',
    );
  }

  return validatedConfig;
}

/**
 * Blank counts as unset: Compose forwards an unset `.env` entry as an empty string. The partial
 * pair and triple are refused even while admin auth is off, so a typo surfaces where it is written
 * rather than the day auth is switched on.
 */
function validateBetterAuthConfig(config: AppConfig): void {
  if (config.ADMIN_AUTH_ENABLED) {
    for (const name of [
      'BETTER_AUTH_SECRET',
      'BETTER_AUTH_URL',
      'AUTH_SMTP_URL',
      'AUTH_MAIL_FROM',
    ] as const) {
      if (!config[name]) {
        throw new Error(`${name} is required when ADMIN_AUTH_ENABLED=true`);
      }
    }

    if (config.BETTER_AUTH_SECRET!.length < BETTER_AUTH_SECRET_MIN_LENGTH) {
      throw new Error(
        `BETTER_AUTH_SECRET must be at least ${BETTER_AUTH_SECRET_MIN_LENGTH} characters`,
      );
    }

    if (!isAbsoluteHttpUrl(config.BETTER_AUTH_URL!)) {
      throw new Error('BETTER_AUTH_URL must be an absolute http(s) URL');
    }
  }

  if (Boolean(config.AUTH_SUPERADMIN_EMAIL) !== Boolean(config.AUTH_SUPERADMIN_PASSWORD)) {
    throw new Error('AUTH_SUPERADMIN_EMAIL and AUTH_SUPERADMIN_PASSWORD must be set together');
  }

  const microsoft = [
    config.AUTH_MICROSOFT_CLIENT_ID,
    config.AUTH_MICROSOFT_CLIENT_SECRET,
    config.AUTH_MICROSOFT_TENANT_ID,
  ];

  if (microsoft.some(Boolean) && !microsoft.every(Boolean)) {
    throw new Error(
      'AUTH_MICROSOFT_CLIENT_ID, AUTH_MICROSOFT_CLIENT_SECRET and AUTH_MICROSOFT_TENANT_ID must be set together',
    );
  }

  // `common`, `organizations` and `consumers` fail here too: only a concrete directory pins the
  // accepted issuer to ours.
  if (config.AUTH_MICROSOFT_TENANT_ID && !GUID_PATTERN.test(config.AUTH_MICROSOFT_TENANT_ID)) {
    throw new Error('AUTH_MICROSOFT_TENANT_ID must be a concrete tenant GUID');
  }
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    return BETTER_AUTH_HTTP_PROTOCOLS.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function TransformBooleanString() {
  return Transform(({ value }) => {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return true;
      }
      if (normalized === 'false') {
        return false;
      }
    }

    return value;
  });
}

function TransformTrimString() {
  return Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }

    return value;
  });
}
