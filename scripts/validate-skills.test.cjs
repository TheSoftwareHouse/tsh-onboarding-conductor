const { afterEach, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');

const SCRIPT = resolve(__dirname, 'validate-skills.cjs');

const SKILL = (name, body = '') =>
  `---\nname: ${name}\ndescription: Investigates one onboarding. Use when asked why it is stuck.\n---\n\n# ${name}\n\n${body}\n`;

const AGENT = (name, body = 'You investigate one onboarding using the MCP tools.') =>
  `---\nname: ${name}\ndescription: Delegate here to find out why an onboarding is stuck.\ntools: Read, Grep\nmodel: sonnet\n---\n\n${body}\n`;

/**
 * A throwaway repository the validator is pointed at (`VALIDATE_SKILLS_ROOT`), so the command is
 * exercised end to end — discovery, path arguments, exit status — against a plugin tree the test
 * owns rather than whatever `plugins/` holds in this checkout.
 */
describe('validate-skills over plugins', () => {
  let root;

  const write = (path, contents) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  };

  const validate = (...args) => {
    // `git ls-files` is what the validator resolves citations against, so the files must be staged.
    execFileSync('git', ['add', '-A'], { cwd: root });

    const run = spawnSync('node', [SCRIPT, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VALIDATE_SKILLS_ROOT: root },
    });

    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'validate-skills-'));
    execFileSync('git', ['init', '-q'], { cwd: root });
    write('package.json', JSON.stringify({ scripts: { 'skills:validate': 'x' } }));
    write('docs/guide.md', '# guide\n');
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it('finds a plugin skill and a plugin subagent when given no path', () => {
    write('plugins/analyst/skills/investigating/SKILL.md', SKILL('investigating'));
    write('plugins/analyst/agents/investigator.md', AGENT('investigator'));

    const { status, output } = validate();

    assert.equal(status, 0, output);
    assert.match(output, /ok {4}plugins\/analyst\/skills\/investigating/);
    assert.match(output, /ok {4}plugins\/analyst\/agents\/investigator\.md/);
    assert.match(output, /2\/2 valid/);
  });

  it('takes a plugin directory, a skill directory, a file inside a skill or a subagent file', () => {
    write('plugins/analyst/skills/investigating/SKILL.md', SKILL('investigating'));
    write('plugins/analyst/skills/triaging/SKILL.md', SKILL('triaging'));
    write('plugins/analyst/agents/investigator.md', AGENT('investigator'));

    assert.match(validate('plugins/analyst').output, /3\/3 valid/);
    assert.match(validate('plugins/analyst/skills').output, /2\/2 valid/);
    assert.match(validate('plugins/analyst/skills/triaging').output, /1\/1 valid/);
    assert.match(validate('plugins/analyst/skills/triaging/SKILL.md').output, /1\/1 valid/);
    assert.match(validate('plugins/analyst/agents').output, /1\/1 valid/);
    assert.match(validate('plugins/analyst/agents/investigator.md').output, /1\/1 valid/);
  });

  it('accepts a plugin that ships nothing to validate yet', () => {
    write('plugins/analyst/.claude-plugin/plugin.json', '{}');

    const { status, output } = validate('plugins/analyst');

    assert.equal(status, 0, output);
    assert.match(output, /No skills, subagents or rules found/);
  });

  it('refuses a plugin file that is neither a skill nor a subagent', () => {
    write('plugins/analyst/README.md', '# analyst\n');
    write('plugins/analyst/skills/investigating/SKILL.md', SKILL('investigating'));

    const { status, output } = validate('plugins/analyst/README.md');

    assert.equal(status, 1);
    assert.match(output, /Not a skill, a subagent or a rule/);
  });

  it('applies the skill checks to a plugin skill', () => {
    write('plugins/analyst/skills/investigating/SKILL.md', SKILL('wrong-name'));

    const { status, output } = validate('plugins/analyst');

    assert.equal(status, 1);
    assert.match(output, /does not match directory "investigating"/);
  });

  it('does not mistake an MCP tool name for a cited path', () => {
    write(
      'plugins/analyst/skills/investigating/SKILL.md',
      SKILL(
        'investigating',
        'Call `mcp__conductor__get_onboarding` and `mcp__conductor__list/get.md`, then `get_onboarding_timeline`.',
      ),
    );

    const { status, output } = validate('plugins/analyst');

    assert.equal(status, 0, output);
    assert.doesNotMatch(output, /path does not exist/);
  });

  it('still checks a cited command and a cited path in a plugin skill', () => {
    write(
      'plugins/analyst/skills/investigating/SKILL.md',
      SKILL('investigating', 'Run `pnpm nope`; read `docs/guide.md` and `docs/missing.md`.'),
    );

    const { status, output } = validate('plugins/analyst');

    assert.equal(status, 1);
    assert.match(output, /no root script "nope"/);
    assert.match(output, /path does not exist: docs\/missing\.md/);
    assert.doesNotMatch(output, /docs\/guide\.md/);
  });

  it('lets two plugins each ship a skill of the same name but not one plugin twice', () => {
    write('plugins/analyst/skills/triaging/SKILL.md', SKILL('triaging'));
    write('plugins/auditor/skills/triaging/SKILL.md', SKILL('triaging'));

    assert.equal(validate('plugins').status, 0);

    // A repository skill and a plugin skill of one name do not clash either: the plugin's answers
    // as `analyst:triaging`.
    write('.claude/skills/triaging/SKILL.md', SKILL('triaging'));

    assert.equal(validate().status, 0);
  });

  describe('a subagent', () => {
    it('needs a name and a description', () => {
      write('plugins/analyst/agents/investigator.md', '---\nmodel: sonnet\n---\n\nPrompt.\n');

      const { status, output } = validate('plugins/analyst/agents');

      assert.equal(status, 1);
      assert.match(output, /missing "name"/);
      assert.match(output, /missing "description"/);
    });

    it('needs a lowercase hyphenated name, and warns when it differs from the file', () => {
      write('plugins/analyst/agents/investigator.md', AGENT('Investigator_One'));
      write('plugins/analyst/agents/other.md', AGENT('another'));

      const { status, output } = validate('plugins/analyst/agents');

      assert.equal(status, 1);
      assert.match(output, /name "Investigator_One" must be lowercase/);
      assert.match(
        output,
        /warn {2}plugins\/analyst\/agents\/other\.md {2}frontmatter name "another"/,
      );
    });

    it('needs a prompt body', () => {
      write('plugins/analyst/agents/investigator.md', AGENT('investigator', ''));

      const { status, output } = validate('plugins/analyst/agents');

      assert.equal(status, 1);
      assert.match(output, /no body/);
    });

    it('takes tools as a string or a list and a model as a string', () => {
      write(
        'plugins/analyst/agents/listed.md',
        '---\nname: listed\ndescription: d\ntools:\n  - Read\n  - Grep\nmodel: inherit\n---\n\nPrompt.\n',
      );

      assert.equal(validate('plugins/analyst/agents').status, 0);

      write(
        'plugins/analyst/agents/listed.md',
        '---\nname: listed\ndescription: d\ntools:\nmodel: inherit\n---\n\nPrompt.\n',
      );

      assert.match(validate('plugins/analyst/agents').output, /tools must be a comma-separated/);
    });

    it('warns about an unknown key and about one a plugin agent cannot use, without failing', () => {
      write(
        'plugins/analyst/agents/investigator.md',
        '---\nname: investigator\ndescription: d\ncolour: red\npermissionMode: plan\n---\n\nPrompt.\n',
      );

      const { status, output } = validate('plugins/analyst/agents');

      assert.equal(status, 0, output);
      assert.match(output, /"colour" is not a Claude Code subagent key/);
      assert.match(output, /"permissionMode" is ignored in an agent a plugin ships/);
      assert.equal(validate('plugins/analyst/agents', '--strict').status, 1);
    });

    it('checks the commands and paths its prompt cites, with the file line', () => {
      write(
        'plugins/analyst/agents/investigator.md',
        AGENT('investigator', 'Use `mcp__conductor__get_onboarding`.\nThen run `pnpm nope`.'),
      );

      const { status, output } = validate('plugins/analyst/agents');

      assert.equal(status, 1);
      assert.match(output, /investigator\.md:9: no root script "nope"/);
      assert.doesNotMatch(output, /mcp__conductor/);
    });
  });
});
