import { describe, expect, it } from "vitest";
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { BedrockEmbedder, type BedrockInvokeClient } from "../src/embed-bedrock.js";

class FakeBedrockClient implements BedrockInvokeClient {
  calls: InvokeModelCommand[] = [];

  async send(command: InvokeModelCommand) {
    this.calls.push(command);
    return {
      body: Buffer.from(
        JSON.stringify({ embedding: [0.25, -0.5, 0.75, 0.0] }),
      ),
    };
  }
}

describe("BedrockEmbedder", () => {
  it("parses embedding from invoke_model response", async () => {
    const client = new FakeBedrockClient();
    const embedder = new BedrockEmbedder({
      modelId: "amazon.titan-embed-text-v2:0",
      region: "us-east-1",
      dimensions: 4,
      client,
    });

    const vector = await embedder.embed("Order 100 shipped");
    expect(vector).toEqual([0.25, -0.5, 0.75, 0.0]);
    expect(client.calls).toHaveLength(1);

    const input = client.calls[0]!.input;
    expect(input.modelId).toBe("amazon.titan-embed-text-v2:0");
    const body = JSON.parse(Buffer.from(input.body as Uint8Array).toString("utf-8"));
    expect(body.inputText).toBe("Order 100 shipped");
    expect(body.dimensions).toBe(4);
    expect(body.normalize).toBe(true);
  });

  it("rejects empty text", async () => {
    const embedder = new BedrockEmbedder({
      modelId: "amazon.titan-embed-text-v2:0",
      region: "us-east-1",
      client: new FakeBedrockClient(),
    });
    await expect(embedder.embed("   ")).rejects.toThrow(/empty/);
  });
});
