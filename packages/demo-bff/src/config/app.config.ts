import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { plainToInstance, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

const URL_OPTIONS = { require_tld: false, require_protocol: true, protocols: ['http', 'https'] };

/**
 * Every setting the BFF reads. There are no defaults on purpose: a missing variable fails at
 * startup instead of quietly pointing the service somewhere else. `.env.dist` and
 * `docker-compose.yml` supply the demo values.
 */
export class AppConfig {
  /** Base URL of the engine's public API, for example `http://engine:3000`. */
  @IsUrl(URL_OPTIONS)
  ENGINE_BASE_URL: string;

  /**
   * Budget for one engine call. `POST /submit` runs the connector chain inline, so this must
   * cover the slowest configured chain; 60000 is the skill's starting point.
   */
  @IsInt()
  @Min(1000)
  @Max(300000)
  @Type(() => Number)
  ENGINE_REQUEST_TIMEOUT_MS: number;

  @IsInt()
  @Min(1)
  @Max(65535)
  @Type(() => Number)
  DEMO_BFF_PORT: number;

  /** The one browser origin CORS allows. */
  @IsUrl(URL_OPTIONS)
  DEMO_WEB_ORIGIN: string;

  /** Id of the workflow every session starts. */
  @IsString()
  @IsNotEmpty()
  BNPL_WORKFLOW_ID: string;

  /**
   * Origin that replaces the host of a presigned upload URL, which the engine signs against its
   * own storage endpoint (`http://garage:3900` under Compose).
   */
  @IsUrl(URL_OPTIONS)
  UPLOAD_PUBLIC_HOST: string;

  /**
   * Only `test` opens the test-only `GET /v1/bnpl/sessions/:token/onboarding` route. Optional on
   * purpose: the Compose service never sets it, so it stays closed there.
   */
  @IsOptional()
  @IsString()
  NODE_ENV: string = 'development';

  /**
   * Directory holding the persona JSON files and their README. A relative path resolves against
   * the repository root, so `.env` can say `./packages/demo-bff/personas` whatever the process's
   * working directory is.
   */
  @IsString()
  @IsNotEmpty()
  PERSONAS_DIR: string;
}

/**
 * The nearest ancestor of this file holding `pnpm-workspace.yaml`: the repository root on a
 * checkout and `/app` in the image. Falls back to the working directory when neither exists.
 */
export function findRepoRoot(from: string = __dirname): string {
  let dir = from;
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
}

export function validateConfig(config: Record<string, unknown>): AppConfig {
  const validated = plainToInstance(AppConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  if (!isAbsolute(validated.PERSONAS_DIR)) {
    validated.PERSONAS_DIR = resolve(findRepoRoot(), validated.PERSONAS_DIR);
  }

  return validated;
}
