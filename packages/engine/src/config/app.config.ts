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

import { DEFAULT_SSO_PROVIDER, SsoProvider } from '../auth/sso-provider';
import { validateClientWebhookUrl } from '../utils/client-webhook-url/client-webhook-url.validator';
import { validateAdminPanelOrigin } from '../utils/admin-panel/admin-panel.validator';
import { parseConnectorCallbackSecrets } from './connector-callback-secrets.config';
import { parseConnectorCallbackUnsignedTypes } from './connector-callback-unsigned-types.config';
import { parseConnectorMocks } from './connector-mocks.config';
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
const TWILIO_VERIFY_TIMEOUT_MS_DEFAULT = 10000;
const TWILIO_VERIFY_TIMEOUT_MS_MIN = 100;
const TWILIO_VERIFY_TIMEOUT_MS_MAX = 30000;

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

const HTTP_CONNECTOR_TIMEOUT_MS_DEFAULT = 5000;
const HTTP_CONNECTOR_TIMEOUT_MS_MIN = 100;
const HTTP_CONNECTOR_TIMEOUT_MS_MAX = 30000;

const HTTP_CONNECTOR_SECRETS_DEFAULT = '{}';

const SUMSUB_TIMEOUT_MS_DEFAULT = 10000;
const SUMSUB_TIMEOUT_MS_MIN = 100;
const SUMSUB_TIMEOUT_MS_MAX = 30000;

const CONNECTOR_CALLBACK_SIGNING_SECRETS_DEFAULT = '{}';

const CONNECTOR_CALLBACK_UNSIGNED_TYPES_DEFAULT = '';

const MULTI_TENANT_AUTHORITY_PLACEHOLDERS = ['common', 'organizations', 'consumers'];

const ADMIN_REQUIRED_ROLES_DEFAULT = 'admin';

/**
 * Splits the configured app-role allowlist. A caller needs any one of these roles in its token's
 * `roles` claim to reach the admin endpoints.
 */
export function parseAdminRequiredRoles(value: string | undefined): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role !== '');
}

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

  @IsString()
  @IsOptional()
  NODE_ENV: string = 'development';

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

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_SSO_PROVIDER?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_AZURE_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_AZURE_TENANT_ID?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_AZURE_API_SCOPE?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  VITE_AZURE_REDIRECT_URI?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  ADMIN_AUTH_ENABLED: boolean = true;

  /**
   * Which directory the admin endpoints trust. Only the settings belonging to the selected
   * provider are required; the others are ignored entirely.
   */
  @IsEnum(SsoProvider)
  @IsOptional()
  @Type(() => String)
  @TransformProviderName()
  ADMIN_SSO_PROVIDER: SsoProvider = DEFAULT_SSO_PROVIDER;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AZURE_TENANT_ID?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  AZURE_API_AUDIENCE?: string;

  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  ADMIN_REQUIRED_ROLES: string = ADMIN_REQUIRED_ROLES_DEFAULT;

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
  @Min(TWILIO_VERIFY_TIMEOUT_MS_MIN)
  @Max(TWILIO_VERIFY_TIMEOUT_MS_MAX)
  @IsOptional()
  @Type(() => Number)
  TWILIO_VERIFY_TIMEOUT_MS: number = TWILIO_VERIFY_TIMEOUT_MS_DEFAULT;

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

  @IsString()
  @IsOptional()
  @Type(() => String)
  CONNECTOR_CALLBACK_SIGNING_SECRETS: string = CONNECTOR_CALLBACK_SIGNING_SECRETS_DEFAULT;

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
  STORAGE_S3_ENDPOINT: string = 'http://minio:9000';

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

  validatedConfig.CLIENT_WEBHOOK_BASE_URL = validateClientWebhookUrl(
    validatedConfig.CLIENT_WEBHOOK_BASE_URL,
    validatedConfig.NODE_ENV,
  );

  validatedConfig.ADMIN_PANEL_ORIGIN = validateAdminPanelOrigin(validatedConfig.ADMIN_PANEL_ORIGIN);

  parseHttpConnectorSecrets(validatedConfig.HTTP_CONNECTOR_SECRETS);

  parseConnectorCallbackSecrets(validatedConfig.CONNECTOR_CALLBACK_SIGNING_SECRETS);

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

  if (validatedConfig.ADMIN_AUTH_ENABLED) {
    // Each provider demands its own settings, so only the selected one's are checked. A provider
    // added later gets its own branch here and leaves the rules below untouched.
    if (validatedConfig.ADMIN_SSO_PROVIDER === SsoProvider.AZURE) {
      const tenantId = validatedConfig.AZURE_TENANT_ID?.trim();
      if (!tenantId) {
        throw new Error('AZURE_TENANT_ID is required when ADMIN_AUTH_ENABLED=true');
      }

      // The accepted issuer is derived from the tenant id, so a multi-tenant placeholder would
      // widen the trust boundary to every Entra directory instead of pinning it to ours.
      if (MULTI_TENANT_AUTHORITY_PLACEHOLDERS.includes(tenantId.toLowerCase())) {
        throw new Error(
          `AZURE_TENANT_ID must be a concrete directory (tenant) id, not '${tenantId}'`,
        );
      }

      const audience = validatedConfig.AZURE_API_AUDIENCE?.trim();
      if (!audience) {
        throw new Error('AZURE_API_AUDIENCE is required when ADMIN_AUTH_ENABLED=true');
      }

      validatedConfig.AZURE_TENANT_ID = tenantId;
      validatedConfig.AZURE_API_AUDIENCE = audience;
    }

    const requiredRoles = parseAdminRequiredRoles(validatedConfig.ADMIN_REQUIRED_ROLES);
    if (requiredRoles.length === 0) {
      throw new Error(
        'ADMIN_REQUIRED_ROLES must name at least one Entra app role when ADMIN_AUTH_ENABLED=true',
      );
    }

    validatedConfig.ADMIN_REQUIRED_ROLES = requiredRoles.join(',');
  } else if (validatedConfig.NODE_ENV === 'production') {
    // The flag is a local escape hatch, and `.env.dist` ships it as false so a fresh clone runs
    // without an Entra tenant. That file sits on the engine's env search path, so a deployment
    // started without explicit environment variables would silently pick it up and serve
    // onboarding data with no credential demanded. Refusing to start makes that omission loud
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

/**
 * Provider names are matched case-insensitively, the same way the admin panel reads
 * `VITE_SSO_PROVIDER`, so the two sides cannot be configured with the same value yet disagree
 * about whether it is valid.
 */
function TransformProviderName() {
  return Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));
}

function TransformTrimString() {
  return Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }

    return value;
  });
}
