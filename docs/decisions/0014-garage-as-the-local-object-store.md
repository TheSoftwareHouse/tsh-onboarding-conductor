# 0014. Garage as the local and CI object store

- **Status:** Accepted
- **Date:** 2026-09-15
- **Tags:** infrastructure, storage, docker, ci
- **Supersedes:** —
- **Superseded by:** —

## Decision

Garage `v2.4.1` (`dxflrs/garage:v2.4.1`) replaces MinIO as the local and CI S3-compatible
object store, as a **single** Compose service running
`garage server --single-node --default-bucket` — no bootstrap sidecar.

`--single-node --default-bucket` accepts `GARAGE_DEFAULT_BUCKET`,
`GARAGE_DEFAULT_ACCESS_KEY` and `GARAGE_DEFAULT_SECRET_KEY` and creates the layout, the
access key and the bucket on boot, idempotently across restarts on a persisted volume.
This is a hard requirement rather than a convenience: `dxflrs/garage:v2.4.1` is
**distroless** — the image contains the static `/garage` binary and nothing else, no
`/bin/sh` — so the guarded shell script `minio-init` used to assign a layout, import a
key and create a bucket cannot run inside it, and there is no interpreter available to
read `garage status`, branch on it, or chain the individual commands, each of which
fails on a second run (`layout apply` → `Invalid new layout version`, `key import` →
`KeyAlreadyExists`, `bucket create` → `BucketAlreadyExists`). `--single-node
--default-bucket` removes the problem instead of working around it.

Production storage is unaffected. The engine reaches object storage only through the
`STORAGE_S3_*` environment variables consumed by
`packages/engine/src/storage/s3-object-storage.service.ts`, which is endpoint-agnostic.
A deployment against real S3 never involved MinIO and is untouched by this decision.

## Context

MinIO's community edition moved to source-only distribution — no pre-compiled binaries
or images, relicensed AGPLv3 — and `minio/minio` and `minio/mc` were withdrawn from
Docker Hub. Verified 2026-09-15: `docker manifest inspect docker.io/minio/minio:latest`
returns `denied`, and the Docker Hub API returns 404 for both repositories. This broke
`pnpm stack:up`, `pnpm test:e2e` and the CI e2e job outright — there was no image left to
pull.

Garage was probed at planning time, driven single-node through the engine's own
`@aws-sdk/client-s3@3.1090.0` with the exact call sequence
`S3ObjectStorageService` uses:

| Operation the engine performs                        | Garage     |
| ---------------------------------------------------- | ---------- |
| `createPresignedPost` + browser-style multipart POST | PASS (204) |
| POST policy rejects an oversized body                | PASS (400) |
| POST policy rejects a `Content-Type` mismatch        | PASS (400) |
| `HeadObject` (size + ETag)                           | PASS       |
| Ranged `GetObject` + `If-Match`                      | PASS       |
| `CopyObject` staged → final                          | PASS       |
| `DeleteObject`                                       | PASS       |
| `readObject` of final + `If-Match`, bytes identical  | PASS       |

Garage is a drop-in for every operation the engine performs; no adapter change was
required or made.

## Alternatives

| Option                             | Why not                                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LocalStack                         | Highest-fidelity S3 emulation available, but its image is roughly 1 GB — paid in full on every CI run for parity the engine's narrow call sequence does not need                                                                  |
| SeaweedFS                          | An additional distributed-storage system with its own operational model, adopted for a single-node local/CI store that needs none of that complexity                                                                              |
| Adobe S3Mock                       | Accepts presigned URLs without validating signature, expiry or POST policy conditions — this would silently void what `onboardings.e2e-spec.ts`'s upload-ticket scenario exists to prove                                          |
| Pin `quay.io/minio/minio` (frozen) | Still resolves today (verified: multi-arch manifest, last community tag `RELEASE.2025-09-07T16-13-09Z`) but is frozen and unmaintained, and sits on a registry MinIO could clear next — kept as a documented fallback, not chosen |

## Consequences

**The web console is gone.** MinIO published an authenticated console on host port 9001
in every local stack; Garage ships an admin API, not a UI, and publishes no console at
all. `MINIO_CONSOLE_PORT` and the `localhost:9001` line in `README.md` both disappear
rather than being renamed.

**Dev credentials changed everywhere they were written.** Garage rejects a secret
shorter than 16 characters — `minioadmin` fails outright — so the `minioadmin` /
`minioadmin` pair was replaced with new sample values in `.env.dist`,
`docker-compose.yml`, `.github/workflows/ci.yml`, the two manual KYC test scripts, and
four e2e spec files that set `STORAGE_S3_*` in `process.env`
(`admin-auth.e2e-spec.ts`, `admin-auth-disabled.e2e-spec.ts`,
`admin-auth-audit-persistence.e2e-spec.ts`, `connector-settings.e2e-spec.ts`). These
remain sample values for local/CI use, never production secrets.

**The port moved to 3900**, in-network and host-side, replacing MinIO's 9000 rather than
keeping a MinIO-shaped number in the config with nothing behind it.

**The image is distroless**, which is the reason no init container exists: there is no
shell to branch on `garage status` output or chain the layout/key/bucket commands, each
of which is not safely re-runnable on its own. `garage server --single-node
--default-bucket` does the whole job on boot and is a no-op when the layout, key and
bucket already exist.

Production storage carries none of this. The engine's `STORAGE_S3_*` contract and
`S3ObjectStorageService` are endpoint-agnostic, so a deployment against real S3 never
pointed at MinIO and is unaffected by this decision.
