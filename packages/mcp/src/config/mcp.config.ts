import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  DEVELOPMENT = 'development',
  PRODUCTION = 'production',
  TEST = 'test',
}

const MCP_PORT_DEFAULT = 3100;
const PORT_MIN = 1;
const PORT_MAX = 65535;
const MCP_REQUIRED_SCOPE_DEFAULT = 'Mcp.Access';
const MCP_MASKING_PASS_FIELDS_DEFAULT = 'country,nationality';
const MASKING_KEY_MIN_BYTES = 32;

const URL_OPTIONS = { require_protocol: true, require_tld: false };
const HTTPS_PROTOCOL = 'https:';

export class McpConfig {
  /** `production` forbids `MCP_AUTH_ENABLED=false`. */
  @IsEnum(NodeEnv)
  @Type(() => String)
  NODE_ENV!: NodeEnv;

  @IsInt()
  @Min(PORT_MIN)
  @Max(PORT_MAX)
  @IsOptional()
  @Type(() => Number)
  MCP_PORT: number = MCP_PORT_DEFAULT;

  /** The URL clients use; published as the resource in the protected-resource metadata. */
  @IsUrl(URL_OPTIONS)
  @Type(() => String)
  MCP_PUBLIC_URL!: string;

  @IsUrl(URL_OPTIONS)
  @Type(() => String)
  MCP_ENGINE_BASE_URL!: string;

  /** Off means no token checks and no token to the engine; a local-development switch only. */
  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  MCP_AUTH_ENABLED: boolean = true;

  @ValidateIf((config: McpConfig) => config.MCP_AUTH_ENABLED)
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  MCP_AZURE_TENANT_ID?: string;

  @ValidateIf((config: McpConfig) => config.MCP_AUTH_ENABLED)
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  MCP_AZURE_CLIENT_ID?: string;

  @ValidateIf((config: McpConfig) => config.MCP_AUTH_ENABLED)
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  MCP_AZURE_CLIENT_SECRET?: string;

  /**
   * The client id the sign-in relay hands to MCP clients; unset (or blank) means
   * `MCP_AZURE_CLIENT_ID`. A separate public-client app registration is the production choice.
   */
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @Type(() => String)
  @TransformBlankToUndefined()
  MCP_PUBLIC_CLIENT_ID?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  MCP_REQUIRED_SCOPE: string = MCP_REQUIRED_SCOPE_DEFAULT;

  /** Scope requested on-behalf-of, for example `api://<engine-app>/.default`. */
  @ValidateIf((config: McpConfig) => config.MCP_AUTH_ENABLED)
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  @TransformTrimString()
  MCP_ENGINE_SCOPE?: string;

  /** HMAC key for pseudonyms and write-tool confirmation tokens. */
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  MCP_MASKING_KEY!: string;

  /** Comma-separated field names that pass in clear. */
  @IsString()
  @IsOptional()
  @Type(() => String)
  @TransformTrimString()
  MCP_MASKING_PASS_FIELDS: string = MCP_MASKING_PASS_FIELDS_DEFAULT;

  @IsBoolean()
  @IsOptional()
  @Type(() => String)
  @TransformBooleanString()
  MCP_WRITE_TOOLS_ENABLED: boolean = false;
}

export function validateConfig(config: Record<string, unknown>): McpConfig {
  const validatedConfig = plainToInstance(McpConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (Buffer.byteLength(validatedConfig.MCP_MASKING_KEY, 'utf8') < MASKING_KEY_MIN_BYTES) {
    throw new Error(`MCP_MASKING_KEY must be at least ${MASKING_KEY_MIN_BYTES} bytes`);
  }

  if (!validatedConfig.MCP_AUTH_ENABLED && validatedConfig.NODE_ENV === NodeEnv.PRODUCTION) {
    // The flag is a local escape hatch. A production `.env` copied from the sample would
    // otherwise serve onboarding data with no credential demanded.
    throw new Error(
      'MCP_AUTH_ENABLED=false is a local-only escape hatch and cannot be used when NODE_ENV=production',
    );
  }

  if (
    validatedConfig.MCP_AUTH_ENABLED &&
    validatedConfig.NODE_ENV === NodeEnv.PRODUCTION &&
    new URL(validatedConfig.MCP_PUBLIC_URL).protocol !== HTTPS_PROTOCOL
  ) {
    // MCP_PUBLIC_URL is the sign-in relay's issuer: authorization codes and refresh tokens pass
    // through it, so outside local development it must not be plain HTTP.
    throw new Error('MCP_PUBLIC_URL must use https when NODE_ENV=production');
  }

  return validatedConfig;
}

function TransformBooleanString() {
  return Transform(({ value }) => {
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
  return Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
}

/** Compose passes an unset variable as an empty string; that must mean "not configured". */
function TransformBlankToUndefined() {
  return Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value));
}
