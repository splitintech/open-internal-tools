import type { AgentConfig, DomainConfig } from "./types.ts";

export function resolveDomain(
  input: string,
  domains: DomainConfig[],
): DomainConfig | null {
  const needle = input.trim().toLowerCase().replace(/^#/, "");
  if (!needle) return null;
  return (
    domains.find((d) => d.id.toLowerCase() === needle) ??
    domains.find((d) => d.channel.replace(/^#/, "").toLowerCase() === needle) ??
    domains.find((d) =>
      d.keywords.some((k) => k.toLowerCase() === needle || needle.includes(k.toLowerCase())),
    ) ??
    null
  );
}

export function domainForRepo(
  repoFullName: string,
  domains: DomainConfig[],
): DomainConfig | null {
  const repo = repoFullName.trim().toLowerCase();
  return (
    domains.find((d) => d.repos.some((r) => r.toLowerCase() === repo)) ?? null
  );
}

export function findAgent(
  handleOrId: string,
  agents: AgentConfig[],
): AgentConfig | null {
  const needle = handleOrId.trim().replace(/^@/, "").toLowerCase();
  if (!needle) return null;
  return (
    agents.find((a) => a.handle.toLowerCase() === needle) ??
    agents.find((a) => a.slack_user_id && a.slack_user_id.toUpperCase() === needle.toUpperCase()) ??
    agents.find((a) => a.mention.replace(/^@/, "").toLowerCase() === needle) ??
    null
  );
}

export function mentionMarkup(agent: AgentConfig): string {
  if (agent.slack_user_id) return `<@${agent.slack_user_id}>`;
  return agent.mention.startsWith("@") ? agent.mention : `@${agent.mention}`;
}

export function channelName(domain: DomainConfig): string {
  return domain.channel.startsWith("#") ? domain.channel.slice(1) : domain.channel;
}
