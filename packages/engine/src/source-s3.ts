/** S3 changefeed event source. */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseCdcPayload, tableFromKey } from "./cdc-parse.js";
import type { ChangeEvent } from "./models.js";
import { ProcessedState, type KeyState } from "./state.js";

export type S3ListClient = {
  send: (
    command: ListObjectsV2Command | GetObjectCommand,
  ) => Promise<Record<string, unknown>>;
};

export class S3EventSource {
  readonly bucket: string;
  readonly prefix: string;
  readonly region: string | undefined;
  readonly state: KeyState;
  private client: S3ListClient | null;
  private pending: string[] = [];

  constructor(options: {
    bucket: string;
    prefix?: string;
    statePath?: string;
    state?: KeyState;
    region?: string;
    client?: S3ListClient;
  }) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? "cdc/";
    this.region = options.region;
    this.state =
      options.state ??
      new ProcessedState(options.statePath ?? ".memstream-s3-state.json");
    this.client = options.client ?? null;
  }

  private clientOrDefault(): S3ListClient {
    if (this.client) return this.client;
    this.client = new S3Client({
      region: this.region || process.env.AWS_REGION || "us-east-1",
    }) as unknown as S3ListClient;
    return this.client;
  }

  async poll(): Promise<ChangeEvent[]> {
    if (this.state.load) await this.state.load();
    const client = this.clientOrDefault();
    const events: ChangeEvent[] = [];
    this.pending = [];
    let continuation: string | undefined;

    while (true) {
      const page = (await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix,
          ContinuationToken: continuation,
        }),
      )) as {
        Contents?: { Key?: string }[];
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };

      for (const item of page.Contents ?? []) {
        const key = item.Key;
        if (!key || key.endsWith("/")) continue;
        if (this.state.seen(key)) continue;

        const obj = (await client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        )) as { Body?: { transformToString?: (enc?: string) => Promise<string> } };

        let text = "";
        if (obj.Body && typeof obj.Body.transformToString === "function") {
          text = await obj.Body.transformToString("utf-8");
        }

        const defaultTable = tableFromKey(key);
        let batch: ChangeEvent[] = [];
        try {
          batch = parseCdcPayload(text, defaultTable);
        } catch (err) {
          console.error(
            `warn: skip s3://${this.bucket}/${key}: ${err instanceof Error ? err.message : err}`,
          );
        }
        events.push(...batch);
        this.pending.push(key);
      }

      if (!page.IsTruncated) break;
      continuation = page.NextContinuationToken;
    }

    return events;
  }

  async ack(): Promise<void> {
    await this.state.markMany(this.pending);
    this.pending = [];
  }
}
