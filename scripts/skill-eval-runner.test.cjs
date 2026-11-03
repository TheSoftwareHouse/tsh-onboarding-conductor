const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildClaudeArgs } = require('./skill-eval-runner.cjs');

const flagValues = (args, flag) =>
  args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));

describe('buildClaudeArgs', () => {
  it('asks for no MCP configuration and no plugin unless the golden set names one', () => {
    const args = buildClaudeArgs({ prompt: 'p', strictMcpConfig: true });

    assert.ok(args.includes('--strict-mcp-config'));
    assert.deepEqual(flagValues(args, '--mcp-config'), []);
    assert.deepEqual(flagValues(args, '--plugin-dir'), []);
  });

  it('passes the golden set MCP configuration beside --strict-mcp-config, and the plugin to load', () => {
    const args = buildClaudeArgs({
      prompt: 'p',
      strictMcpConfig: true,
      mcpConfig: '/repo/plugins/analyst/.mcp.json',
      pluginDirs: ['/sandbox/plugins/analyst'],
    });

    assert.ok(args.includes('--strict-mcp-config'));
    assert.deepEqual(flagValues(args, '--mcp-config'), ['/repo/plugins/analyst/.mcp.json']);
    assert.deepEqual(flagValues(args, '--plugin-dir'), ['/sandbox/plugins/analyst']);
  });

  it('repeats --plugin-dir for each plugin', () => {
    const args = buildClaudeArgs({ prompt: 'p', pluginDirs: ['/a', '/b'] });

    assert.deepEqual(flagValues(args, '--plugin-dir'), ['/a', '/b']);
  });

  it('keeps the flags every run has, and the judge call flags', () => {
    const args = buildClaudeArgs({
      prompt: 'p',
      model: 'haiku',
      tools: [],
      systemPrompt: 's',
      disableSkills: true,
    });

    assert.deepEqual(args.slice(0, 2), ['-p', 'p']);
    assert.deepEqual(flagValues(args, '--permission-mode'), ['bypassPermissions']);
    assert.deepEqual(flagValues(args, '--model'), ['haiku']);
    assert.deepEqual(flagValues(args, '--tools'), ['']);
    assert.ok(args.includes('--disable-slash-commands'));
    assert.ok(!args.includes('--strict-mcp-config'));
  });
});
