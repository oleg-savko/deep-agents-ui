import { NextResponse } from "next/server";
import { headers } from "next/headers";
import fs from "fs";
import path from "path";
import {
  applyAccess,
  emptyConfig,
  extractIdentity,
  isLocalhostHost,
  type Config,
} from "@/app/api/config/access";

export async function GET() {
  const headersList = await headers();
  const authHeader = headersList.get("authorization");

  const identity = extractIdentity(authHeader);
  // Localhost dev: never gate assistants by group, so local testing (e.g. the
  // connectivity banner) is reachable regardless of the token's ai-groups.
  const bypassFilter = isLocalhostHost(headersList.get("host"));

  try {
    const configPath = path.join(process.cwd(), "config", "config.json");

    if (!fs.existsSync(configPath)) {
      const examplePath = path.join(
        process.cwd(),
        "config",
        "config.example.json"
      );
      if (fs.existsSync(examplePath)) {
        const content = fs.readFileSync(examplePath, "utf-8");
        const parsed = JSON.parse(content) as Config;
        return NextResponse.json(
          applyAccess(parsed, identity, { bypassFilter }).body
        );
      }
      return NextResponse.json(
        applyAccess(emptyConfig(), identity, { bypassFilter }).body
      );
    }

    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Config;
    return NextResponse.json(
      applyAccess(parsed, identity, { bypassFilter }).body
    );
  } catch (error) {
    console.error("Error reading config:", error);
    return NextResponse.json(
      applyAccess(emptyConfig(), identity, { bypassFilter }).body,
      { status: 500 }
    );
  }
}
