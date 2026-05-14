export const EMBED_DEPLOYMENT_URL = "https://deep-research-agent.svoi.ru/";
//todo: move constants to .env config
/*process.env.NEXT_PUBLIC_EMBED_DEPLOYMENT_URL || "";*/
export const EMBED_ASSISTANT_ID = "mt_chat";

/** LLM id for embed; override with NEXT_PUBLIC_EMBED_LLM_MODEL at build if needed. */
export const EMBED_LLM_MODEL =
  process.env.NEXT_PUBLIC_EMBED_LLM_MODEL?.trim() || "litellm:openai/gemma-4-26B-A4B-it-AWQ-4bit";
