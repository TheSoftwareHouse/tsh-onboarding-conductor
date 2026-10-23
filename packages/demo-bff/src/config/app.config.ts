import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
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
 * The two demo journeys (ADR 0052): the UK one on a simulated bank and a persona document pushed
 * to Algoan, and the KSA one where Lean's widget links a real sandbox bank and the engine exports
 * the data for Algoan. `BNPL_WORKFLOW_ID` names the workflow, `BNPL_JOURNEY` which pages and
 * routes the BFF and the web app run.
 */
export const BNPL_JOURNEYS = ['uk-algoan', 'ksa-lean-algoan'] as const;
export type BnplJourney = (typeof BNPL_JOURNEYS)[number];
export const UK_JOURNEY: BnplJourney = 'uk-algoan';
export const KSA_JOURNEY: BnplJourney = 'ksa-lean-algoan';

/** What the KSA journey cannot run without; checked after validation, only for that journey. */
const KSA_REQUIRED_KEYS = [
  'LEAN_CLIENT_ID',
  'LEAN_CLIENT_SECRET',
  'LEAN_AUTH_BASE_URL',
  'LEAN_API_BASE_URL',
  'DEMO_WEB_PUBLIC_ORIGIN',
] as const;

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

  /** Which journey `BNPL_WORKFLOW_ID` is; the UK one unless said otherwise. */
  @IsOptional()
  @IsIn(BNPL_JOURNEYS)
  BNPL_JOURNEY: BnplJourney = UK_JOURNEY;

  /**
   * Lean's "app token" and secret: the BFF is the host service of Lean's widget on the KSA journey
   * (ADR 0049, 0052) and mints the customer-scoped token with them. Required for that journey
   * only; never logged.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  LEAN_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  LEAN_CLIENT_SECRET?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  LEAN_AUTH_BASE_URL?: string;

  @IsOptional()
  @IsUrl(URL_OPTIONS)
  LEAN_API_BASE_URL?: string;

  /**
   * The HTTPS origin the demo web app is opened on through the tunnel: Lean's mock banks redirect
   * the customer back to it, and it is a second origin CORS allows. KSA journey only.
   */
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  DEMO_WEB_PUBLIC_ORIGIN?: string;

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

  if (validated.BNPL_JOURNEY === KSA_JOURNEY) {
    const absent = KSA_REQUIRED_KEYS.filter((key) => validated[key] === undefined);

    if (absent.length > 0) {
      throw new Error(`BNPL_JOURNEY=${KSA_JOURNEY} needs ${absent.join(', ')}`);
    }
  }

  return validated;
}
