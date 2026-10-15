// Overwritten by the container's entrypoint at start-up with the process environment's
// VITE_* values. Served as-is under `pnpm dev` and in a build the entrypoint never touched,
// so window.__ENV__ resolves to an empty object and `import.meta.env` is the only source.
window.__ENV__ = {};
