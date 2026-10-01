import { describe, expect, it } from "vitest";
import {
  applyAccess,
  canAccessAssistant,
  extractIdentity,
  filterAssistants,
  isLocalhostHost,
  type Config,
} from "@/app/api/config/access";

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${body}.sig`;
}

const config: Config = {
  assistants: [
    { value: "open", label: "Open" },
    { value: "latam", label: "Latam", aiGroups: ["latam"] },
    { value: "ru", label: "RU", aiGroups: ["ru"] },
  ],
};

describe("extractIdentity", () => {
  it("reads groups, email, and name from a bearer token", () => {
    const identity = extractIdentity(
      `Bearer ${jwt({
        "ai-groups": ["latam", 1],
        email: "a@b.c",
        name: "Ann",
      })}`
    );
    expect(identity).toEqual({
      authenticated: true,
      groups: ["latam"],
      email: "a@b.c",
      name: "Ann",
    });
  });

  it("stays anonymous for a missing or undecodable token", () => {
    expect(extractIdentity(null).authenticated).toBe(false);
    expect(extractIdentity("Bearer ").authenticated).toBe(false);
    expect(extractIdentity("Bearer not-a-jwt").authenticated).toBe(false);
    expect(extractIdentity(`Bearer ${jwt({ email: "" })}`).groups).toBeNull();
  });
});

describe("assistant filtering", () => {
  it("keeps assistants the caller shares a group with, plus ungrouped ones", () => {
    expect(canAccessAssistant(["latam"], undefined)).toBe(true);
    expect(canAccessAssistant(["latam"], [])).toBe(true);
    expect(canAccessAssistant(["other"], ["latam"])).toBe(false);
    expect(
      filterAssistants(config, ["latam"]).assistants?.map((a) => a.value)
    ).toEqual(["open", "latam"]);
    expect(filterAssistants(config, null)).toBe(config);
    expect(filterAssistants(config, [])).toBe(config);
    expect(filterAssistants({}, ["latam"])).toEqual({});
  });

  it("bypasses the group filter on localhost but still reports access", () => {
    expect(isLocalhostHost(null)).toBe(false);
    expect(isLocalhostHost("localhost:3000")).toBe(true);
    expect(isLocalhostHost("127.0.0.1:3000")).toBe(true);
    // `host.split(":")` cannot see an IPv6 address, so `::1` does not match.
    expect(isLocalhostHost("[::1]:3000")).toBe(false);
    expect(isLocalhostHost("::1")).toBe(false);
    expect(isLocalhostHost("deep-agent-ui.example")).toBe(false);

    const identity = extractIdentity(
      `Bearer ${jwt({ "ai-groups": ["latam"], email: "a@b.c", name: "Ann" })}`
    );
    const gated = applyAccess(config, identity);
    expect(gated.body.assistants?.map((a) => a.value)).toEqual([
      "open",
      "latam",
    ]);
    expect(gated.body._access).toMatchObject({
      authenticated: true,
      userGroups: ["latam"],
      totalAssistants: 3,
      visibleAssistants: 2,
    });

    const local = applyAccess(config, identity, { bypassFilter: true });
    expect(local.body.assistants).toHaveLength(3);
    expect(local.body._access.visibleAssistants).toBe(3);
    expect(local.body._access.userGroups).toEqual(["latam"]);
  });
});
