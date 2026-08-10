/** Amazon Bedrock embedder adapter (Titan Text Embeddings V2). */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { resilientBedrock, withResilience } from "./resilience.js";

export type BedrockInvokeClient = {
  send: (command: InvokeModelCommand) => Promise<{
    body?: Uint8Array | { transformToByteArray?: () => Promise<Uint8Array> };
  }>;
};

export class BedrockEmbedder {
  readonly modelId: string;
  readonly region: string;
  readonly dimensions: number;
  private readonly client: BedrockInvokeClient;

  constructor(options: {
    modelId: string;
    region: string;
    dimensions?: number;
    client?: BedrockInvokeClient;
  }) {
    this.modelId = options.modelId;
    this.region = options.region;
    this.dimensions = options.dimensions ?? 1024;
    this.client =
      options.client ??
      new BedrockRuntimeClient({ region: options.region });
  }

  async embed(text: string): Promise<number[]> {
    const cleaned = text.trim();
    if (!cleaned) {
      throw new Error("text to embed must not be empty");
    }

    const body = JSON.stringify({
      inputText: cleaned,
      dimensions: this.dimensions,
      normalize: true,
    });

    const response = await withResilience(resilientBedrock, () =>
      this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          body: Buffer.from(body),
          contentType: "application/json",
          accept: "application/json",
        }),
      ),
    );

    const rawBody = await readBody(response.body);
    const payload = JSON.parse(Buffer.from(rawBody).toString("utf-8")) as {
      embedding?: unknown;
    };
    if (!Array.isArray(payload.embedding)) {
      throw new Error("Bedrock response missing embedding list");
    }
    return payload.embedding.map((v) => Number(v));
  }
}

async function readBody(
  body:
    | Uint8Array
    | { transformToByteArray?: () => Promise<Uint8Array> }
    | undefined,
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body.transformToByteArray === "function") {
    return body.transformToByteArray();
  }
  return new Uint8Array();
}
