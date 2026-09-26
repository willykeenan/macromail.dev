export interface Sdk {
  lang: string;
  pkg: string;
  install: string;
  snippet: string;
}

/**
 * MacroMail has no published language SDKs. Agents and apps call REST v1
 * or the MCP endpoint over HTTP with a Bearer API key.
 */
export const sdks: Sdk[] = [];
