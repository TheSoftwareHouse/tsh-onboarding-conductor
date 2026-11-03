import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { paths } from '@tsh/openapi';
import { RequestContext } from '../request-context/request-context';
import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_SECOND } from '../time.constants';
import { EngineError } from './engine-error';

const ENGINE_REQUEST_TIMEOUT_MS = 30 * MILLISECONDS_PER_SECOND;
const ENGINE_STREAM_TIMEOUT_MS = 5 * MILLISECONDS_PER_MINUTE;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_NO_CONTENT = 204;
const HTTP_SERVICE_UNAVAILABLE = 503;

type Method = 'get' | 'post';
type PathsFor<M extends Method> = {
  [P in keyof paths]: paths[P][M] extends undefined ? never : P;
}[keyof paths];
type OperationOf<P extends keyof paths, M extends Method> = NonNullable<paths[P][M]>;

type PathParamsOf<O> = O extends { parameters: { path: infer X } } ? X : never;
type QueryOf<O> = O extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;
type BodyOf<O> = O extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : never;
type JsonContent<R> = R extends { content: { 'application/json': infer B } } ? B : never;
type ResponseOf<O> = O extends { responses: infer R }
  ? JsonContent<R[Extract<keyof R, 200 | 201>]>
  : never;

type Slot<K extends string, V> = [V] extends [never] ? { [P in K]?: never } : { [P in K]: V };

/** The path parameters, query and body an operation declares; a part it lacks is not accepted. */
export type EngineRequest<O> = Slot<'path', PathParamsOf<O>> &
  Slot<'body', BodyOf<O>> & { query?: QueryOf<O> };

/** The request is optional exactly when the operation declares nothing required. */
type RequestArgs<O> =
  Record<never, never> extends EngineRequest<O>
    ? [request?: EngineRequest<O>]
    : [request: EngineRequest<O>];

interface UntypedRequest {
  path?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: unknown;
}

/** The engine's admin API over HTTP, typed from its OpenAPI document, called as the analyst. */
@Injectable()
export class EngineClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('MCP_ENGINE_BASE_URL').replace(/\/+$/, '');
  }

  async request<M extends Method, P extends PathsFor<M>>(
    method: M,
    path: P,
    context: RequestContext,
    ...args: RequestArgs<OperationOf<P, M>>
  ): Promise<ResponseOf<OperationOf<P, M>>> {
    const response = await this.send(
      method,
      path,
      context,
      args[0] as UntypedRequest | undefined,
      ENGINE_REQUEST_TIMEOUT_MS,
    );
    const text = await response.text();

    if (response.status === HTTP_NO_CONTENT || text === '') {
      return undefined as ResponseOf<OperationOf<P, M>>;
    }

    return JSON.parse(text) as ResponseOf<OperationOf<P, M>>;
  }

  /** The response body of a GET as it arrives, for exports too large to hold as one string. */
  async openStream<P extends PathsFor<'get'>>(
    path: P,
    context: RequestContext,
    ...args: RequestArgs<OperationOf<P, 'get'>>
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.send(
      'get',
      path,
      context,
      args[0] as UntypedRequest | undefined,
      ENGINE_STREAM_TIMEOUT_MS,
    );

    if (response.body === null) {
      throw new EngineError('The engine answered without a body.', response.status);
    }

    return response.body;
  }

  private async send(
    method: Method,
    path: string,
    context: RequestContext,
    request: UntypedRequest = {},
    timeoutMs: number,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json, text/csv' };
    if (context.engineToken) {
      headers.Authorization = `Bearer ${context.engineToken}`;
    }
    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(this.buildUrl(path, request), {
      method: method.toUpperCase(),
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => {
      throw new EngineError('The engine could not be reached. Try again shortly.');
    });

    if (!response.ok) {
      throw await this.mapFailure(response);
    }

    return response;
  }

  private buildUrl(path: string, request: UntypedRequest): string {
    const resolvedPath = path.replace(/\{(\w+)\}/g, (_, name: string) =>
      encodeURIComponent(String(request.path?.[name])),
    );
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) {
        query.append(name, String(value));
      }
    }
    const queryString = query.toString();

    return `${this.baseUrl}${resolvedPath}${queryString === '' ? '' : `?${queryString}`}`;
  }

  private async mapFailure(response: Response): Promise<EngineError> {
    const text = await response.text();
    const body = parseBody(text);
    const detail = describeBody(body);
    const code = typeof body?.code === 'string' ? body.code : undefined;
    const { status } = response;

    switch (status) {
      case HTTP_UNAUTHORIZED:
        return new EngineError(
          'The engine rejected the analyst credentials (401). The session may have expired; sign in again.',
          status,
          code,
          body,
        );
      case HTTP_FORBIDDEN:
        return new EngineError(
          'The engine refused access (403): the signed-in account does not hold the role this action needs.',
          status,
          code,
          body,
        );
      case HTTP_NOT_FOUND:
        return new EngineError(`Not found (404)${detail}`, status, code, body);
      case HTTP_SERVICE_UNAVAILABLE:
        return new EngineError(
          `The engine's admin API is unavailable (503)${detail}`,
          status,
          code,
          body,
        );
      default:
        return new EngineError(
          `The engine answered ${status}${code ? ` ${code}` : ''}${detail}`,
          status,
          code,
          body,
        );
    }
  }
}

function parseBody(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function describeBody(body: Record<string, unknown> | undefined): string {
  const message = body?.message;
  const text = Array.isArray(message) ? message.join('; ') : message;

  return typeof text === 'string' && text !== '' ? `: ${text}` : '.';
}
