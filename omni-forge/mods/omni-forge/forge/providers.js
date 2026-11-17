// Picks the provider for a repo: { kind: "github" | "gitlab", host, path }, using herdr's exec.
import { exec } from "herdr";
import { gitlabProvider } from "./gitlab.js";
import { githubProvider } from "./github.js";

export function providerFor({ kind, host, path }) {
  return kind === "github" ? githubProvider(exec, { host, path }) : gitlabProvider(exec, { host, path });
}
