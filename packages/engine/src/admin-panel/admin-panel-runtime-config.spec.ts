import { SAME_ORIGIN_API_BASE_URL, renderAdminPanelConfig } from './admin-panel-runtime-config';

function parseRenderedConfig(script: string): Record<string, string> {
  const body = script.replace(/^window\.__ENV__ = /, '').replace(/;\n$/, '');

  return JSON.parse(body) as Record<string, string>;
}

describe('renderAdminPanelConfig', () => {
  it('assigns the parsed object to window.__ENV__', () => {
    expect(renderAdminPanelConfig({})).toMatch(/^window\.__ENV__ = \{/);
    expect(renderAdminPanelConfig({})).toMatch(/\};\n$/);
  });

  it('points the panel at this engine by default', () => {
    expect(parseRenderedConfig(renderAdminPanelConfig({}))).toEqual({
      VITE_ENGINE_API_BASE_URL: SAME_ORIGIN_API_BASE_URL,
    });
  });

  it('lets a configured base URL point the panel at a different engine', () => {
    expect(
      parseRenderedConfig(
        renderAdminPanelConfig({ VITE_ENGINE_API_BASE_URL: 'https://engine.example.com' }),
      ).VITE_ENGINE_API_BASE_URL,
    ).toBe('https://engine.example.com');
  });

  it('omits unset, empty and blank keys so the panel falls back to its build-time value', () => {
    expect(
      parseRenderedConfig(
        renderAdminPanelConfig({ VITE_AUTH_ENABLED: '', VITE_SSO_PROVIDER: '   ' }),
      ),
    ).toEqual({ VITE_ENGINE_API_BASE_URL: SAME_ORIGIN_API_BASE_URL });
  });

  it('trims the values it does write', () => {
    expect(
      parseRenderedConfig(renderAdminPanelConfig({ VITE_AUTH_ENABLED: ' false ' }))
        .VITE_AUTH_ENABLED,
    ).toBe('false');
  });

  it('escapes quotes, backslashes and line breaks rather than breaking out of the literal', () => {
    const value = 'a"b\\c\nd';

    expect(
      parseRenderedConfig(renderAdminPanelConfig({ VITE_AZURE_CLIENT_ID: value }))
        .VITE_AZURE_CLIENT_ID,
    ).toBe(value);
  });

  it('escapes < so the body stays inert if it is ever inlined into HTML', () => {
    const script = renderAdminPanelConfig({ VITE_AZURE_CLIENT_ID: '</script><script>' });

    expect(script).not.toContain('</script>');
    expect(parseRenderedConfig(script).VITE_AZURE_CLIENT_ID).toBe('</script><script>');
  });
});
