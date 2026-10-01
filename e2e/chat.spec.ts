import { expect, test } from "@playwright/test";
import { askFormThread, installFakeLangGraph } from "./fixtures/fakeLangGraph";

test.beforeEach(async ({ page }) => {
  await installFakeLangGraph(page, [
    {
      thread_id: "thread-history",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      status: "idle",
      metadata: { graph_id: "chat", thread_name: "Earlier thread" },
      values: {
        messages: [
          { type: "human", id: "h-old", content: "earlier question" },
          { type: "ai", id: "ai-old", content: "earlier answer" },
        ],
      },
    },
    {
      thread_id: "thread-foreign",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-03T00:00:00.000Z",
      status: "idle",
      metadata: { graph_id: "secret_agent", thread_name: "Foreign thread" },
      values: { messages: [] },
    },
    askFormThread(),
  ]);
});

test("sends a message, shows the streamed reply, and lists the thread", async ({
  page,
}) => {
  await page.goto("/?sidebar=1");
  await expect(page.getByPlaceholder("Write your message...")).toBeVisible();

  await page.getByPlaceholder("Write your message...").fill("hello agent");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator("#chat").getByText("hello agent")).toBeVisible();
  await expect(
    page.locator("#chat").getByText("Hello from the agent")
  ).toBeVisible();
  await expect(page).toHaveURL(/threadId=/);
  await expect(page).toHaveURL(/assistantId=chat/);
  await expect(page.getByRole("button", { name: /hello agent/ })).toBeVisible();
});

test("loads another thread of the same agent and refuses a foreign one", async ({
  page,
}) => {
  await page.goto("/?assistantId=chat&sidebar=1");
  await page.getByRole("button", { name: /Earlier thread/ }).click();
  await expect(page.locator("#chat").getByText("earlier answer")).toBeVisible();
  await expect(page).toHaveURL(/threadId=thread-history/);
  await expect(page).toHaveURL(/assistantId=chat/);

  await page.goto("/?assistantId=chat&threadId=thread-foreign&sidebar=1");
  await expect(page.getByText(/нет доступа/)).toBeVisible();
  await expect(page).toHaveURL(/assistantId=chat/);
  await expect(page).not.toHaveURL(/threadId=thread-foreign/);
});

test("renders an ask form once and submits it as a human message", async ({
  page,
}) => {
  await page.goto("/?assistantId=chat&threadId=thread-form&sidebar=1");
  await expect(
    page.getByText("confirm [[app]]").or(page.getByText("confirm"))
  ).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(1);

  const stream = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().includes("/runs/stream")
  );
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("mcp-ui-send-message", {
        detail: { text: "form answer" },
      })
    );
  });
  const request = await stream;
  const body = request.postDataJSON() as {
    input?: { messages?: Array<{ content?: unknown }> };
    command?: { resume?: unknown };
  };
  expect(body.command?.resume).toBeUndefined();
  expect(JSON.stringify(body.input?.messages ?? [])).toContain("form answer");
});
