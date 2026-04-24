import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModel } from "../navigator/aliases.js";
import { navigatorFetch, navigatorJSON } from "../navigator/client.js";
import { isModelAllowed } from "../navigator/modelsCache.js";
import {
  applyThinkingEffort,
  buildDecisionRequiredText,
  resolveThinkingEffort,
} from "../navigator/thinking.js";

export function registerInferenceTools(server: McpServer): void {
  // ── Chat completions ───────────────────────────────────────────────────────

  server.tool(
    "navigator_chat",
    "Send a chat completion request to UF NaviGator (OpenAI-compatible). Accepts an alias or exact model ID. Returns the assistant message content.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias (e.g. 'latest_anthropic', 'gpt-4o')"),
      messages: z
        .array(
          z.object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          }),
        )
        .describe("Conversation messages"),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .describe("Sampling temperature (0–2)"),
      max_tokens: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum tokens to generate"),
      stream: z
        .boolean()
        .optional()
        .default(false)
        .describe("Stream the response (returns full text when done)"),
      thinking_effort: z
        .string()
        .optional()
        .describe(
          "Reasoning/thinking effort level (optional). Resolution order: " +
            "(1) this explicit value, if set; (2) the per-model default in " +
            "{configDir}/model_configs/{model}.json; (3) status-quo seed for " +
            "gpt-5.X / opus-4.7 / gemini-3.X; (4) otherwise the call returns " +
            "THINKING_EFFORT_DECISION_REQUIRED and DOES NOT hit the gateway — " +
            "configure via navigator_manage_thinking_defaults. " +
            "Allowed values depend on the model (see the per-model file). " +
            "Pass \"not_applicable\" to skip the effort field entirely for one call.",
        ),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      if (!isModelAllowed(resolvedModel)) {
        return { content: [{ type: "text", text: `Model "${resolvedModel}" is not in the allowlist. Run navigator_list_models to see available models.` }] };
      }

      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: args.messages,
      };
      if (args.temperature !== undefined) body.temperature = args.temperature;
      if (args.max_tokens !== undefined) body.max_tokens = args.max_tokens;

      const resolution = resolveThinkingEffort(resolvedModel, args.thinking_effort);
      if (resolution.kind === "prompt") {
        return {
          content: [
            { type: "text", text: buildDecisionRequiredText(resolution) },
          ],
        };
      }
      if (resolution.kind === "apply") {
        try {
          applyThinkingEffort(body, resolution.effort, resolution.field);
        } catch (e) {
          return {
            content: [{ type: "text", text: (e as Error).message }],
          };
        }
      }
      // resolution.kind === "skip" → leave body as-is.

      if (args.stream) {
        body.stream = true;
        const resp = await navigatorFetch(
          "/chat/completions",
          { method: "POST", body: JSON.stringify(body) },
          resolvedModel,
        );
        const text = await resp.text();
        // Collect all SSE data lines and extract content delta chunks
        const chunks: string[] = [];
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") break;
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) chunks.push(delta);
          } catch {
            // Skip malformed lines
          }
        }
        return {
          content: [{ type: "text", text: chunks.join("") }],
        };
      }

      const result = await navigatorJSON<{
        choices: Array<{ message: { role: string; content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        model?: string;
      }>(
        "/chat/completions",
        { method: "POST", body: JSON.stringify(body) },
        resolvedModel,
      );

      const assistantMsg = result.choices?.[0]?.message?.content ?? "";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content: assistantMsg,
                model: result.model ?? resolvedModel,
                usage: result.usage,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── Embeddings ─────────────────────────────────────────────────────────────

  server.tool(
    "navigator_embeddings",
    "Generate embeddings for text input using a UF NaviGator embedding model.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias for the embedding model"),
      input: z
        .union([z.string(), z.array(z.string())])
        .describe("Text string or array of strings to embed"),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      if (!isModelAllowed(resolvedModel)) {
        return { content: [{ type: "text", text: `Model "${resolvedModel}" is not in the allowlist. Run navigator_list_models to see available models.` }] };
      }

      const result = await navigatorJSON<{
        data: Array<{ embedding: number[]; index: number }>;
        usage?: unknown;
        model?: string;
      }>(
        "/embeddings",
        {
          method: "POST",
          body: JSON.stringify({ model: resolvedModel, input: args.input }),
        },
        resolvedModel,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                model: result.model ?? resolvedModel,
                count: result.data?.length ?? 0,
                dimensions: result.data?.[0]?.embedding?.length ?? 0,
                usage: result.usage,
                embeddings: result.data?.map((d) => ({
                  index: d.index,
                  embedding: [...d.embedding.slice(0, 8), "..."] as unknown[],  // truncate for display
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── Image generation ───────────────────────────────────────────────────────

  server.tool(
    "navigator_image_generate",
    "Generate images using a UF NaviGator image generation model (e.g. DALL-E compatible).",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias for the image generation model"),
      prompt: z.string().describe("Image generation prompt"),
      n: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(1)
        .describe("Number of images to generate"),
      size: z
        .enum(["256x256", "512x512", "1024x1024", "1024x1792", "1792x1024"])
        .optional()
        .default("1024x1024")
        .describe("Image size"),
      quality: z
        .enum(["standard", "hd"])
        .optional()
        .default("standard")
        .describe("Image quality"),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      if (!isModelAllowed(resolvedModel)) {
        return { content: [{ type: "text", text: `Model "${resolvedModel}" is not in the allowlist. Run navigator_list_models to see available models.` }] };
      }

      const result = await navigatorJSON<{
        data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
        created?: number;
      }>(
        "/images/generations",
        {
          method: "POST",
          body: JSON.stringify({
            model: resolvedModel,
            prompt: args.prompt,
            n: args.n,
            size: args.size,
            quality: args.quality,
          }),
        },
        resolvedModel,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  // ── Speech to text (Whisper) ───────────────────────────────────────────────

  server.tool(
    "navigator_speech_to_text",
    "Transcribe audio using a UF NaviGator Whisper-compatible speech-to-text model. Audio must be provided as base64-encoded bytes.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias for the STT model (e.g. 'whisper-1')"),
      audio_base64: z
        .string()
        .describe("Base64-encoded audio file content"),
      filename: z
        .string()
        .regex(/^[^\r\n"\\]+$/, "Filename must not contain newlines, quotes, or backslashes")
        .describe(
          "Original filename including extension (e.g. 'audio.mp3') — used to set MIME type",
        ),
      language: z
        .string()
        .optional()
        .describe("Optional language code (e.g. 'en')"),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      if (!isModelAllowed(resolvedModel)) {
        return { content: [{ type: "text", text: `Model "${resolvedModel}" is not in the allowlist. Run navigator_list_models to see available models.` }] };
      }

      // Build a multipart/form-data body manually
      const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
      const audioBytes = Buffer.from(args.audio_base64, "base64");

      const bodyParts: Buffer[] = [];
      const addField = (name: string, value: string): void => {
        bodyParts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
          ),
        );
      };

      addField("model", resolvedModel);
      if (args.language) addField("language", args.language);

      bodyParts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${args.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
      );
      bodyParts.push(audioBytes);
      bodyParts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const formBody = Buffer.concat(bodyParts);

      const resp = await navigatorFetch(
        "/audio/transcriptions",
        {
          method: "POST",
          body: formBody as unknown as string,
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
        },
        resolvedModel,
      );

      const result = await resp.json() as { text: string };
      return {
        content: [{ type: "text", text: result.text ?? JSON.stringify(result) }],
      };
    },
  );

  // ── Text to speech (Kokoro) ────────────────────────────────────────────────

  server.tool(
    "navigator_text_to_speech",
    "Convert text to speech using a UF NaviGator TTS model (e.g. Kokoro). Returns base64-encoded audio.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias for the TTS model (e.g. 'kokoro')"),
      input: z.string().describe("Text to convert to speech"),
      voice: z
        .string()
        .optional()
        .default("alloy")
        .describe("Voice to use (model-dependent)"),
      speed: z
        .number()
        .min(0.25)
        .max(4.0)
        .optional()
        .default(1.0)
        .describe("Speech speed multiplier"),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      if (!isModelAllowed(resolvedModel)) {
        return { content: [{ type: "text", text: `Model "${resolvedModel}" is not in the allowlist. Run navigator_list_models to see available models.` }] };
      }

      const resp = await navigatorFetch(
        "/audio/speech",
        {
          method: "POST",
          body: JSON.stringify({
            model: resolvedModel,
            input: args.input,
            voice: args.voice,
            speed: args.speed,
          }),
        },
        resolvedModel,
      );

      const buffer = await resp.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const contentType = resp.headers.get("content-type") ?? "audio/mpeg";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                content_type: contentType,
                audio_base64: base64,
                byte_length: buffer.byteLength,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
