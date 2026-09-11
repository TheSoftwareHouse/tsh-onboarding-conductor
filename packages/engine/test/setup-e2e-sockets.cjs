const http = require('node:http');
const https = require('node:https');

// Supertest sends through Node's global agents, which keep sockets pooled by host and port after
// a response and, on Node 24, do so by default. `--runInBand` puts every suite in one process and
// one module registry for those agents, so a socket left over from the application a finished
// suite closed outlives it. Handed back to the next suite the moment the operating system reissues
// that ephemeral port, it carries the request to a peer that is no longer there, which arrives as
// `Parse Error: Expected HTTP/, RTSP/ or ICE/` rather than as a connection failure. Emptying the
// pools between files keeps every suite's connections to itself.
//
// Registered here rather than in `setup-e2e-env.cjs`, which runs before the test framework exists
// and so cannot install a hook.
afterAll(() => {
  http.globalAgent.destroy();
  https.globalAgent.destroy();
});
