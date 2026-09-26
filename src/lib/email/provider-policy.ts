export type ApiKeyEnvironment = "live" | "test";

/** Test keys are a hard simulation boundary, independent of configured credentials. */
export function apiKeyForcesSimulation(env: ApiKeyEnvironment | undefined): boolean {
  return env === "test";
}
