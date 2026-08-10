/** CloudFormation wait with job heartbeats (AWS SDK waiters can hang silently). */

import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import type { Job } from "./jobs.js";

const SUCCESS = new Set([
  "CREATE_COMPLETE",
  "UPDATE_COMPLETE",
  "IMPORT_COMPLETE",
]);

const FAILURE = new Set([
  "CREATE_FAILED",
  "ROLLBACK_COMPLETE",
  "ROLLBACK_FAILED",
  "UPDATE_FAILED",
  "UPDATE_ROLLBACK_COMPLETE",
  "UPDATE_ROLLBACK_FAILED",
  "DELETE_FAILED",
  "IMPORT_ROLLBACK_COMPLETE",
  "IMPORT_ROLLBACK_FAILED",
]);

export type StackWaitMode = "create" | "update" | "delete";

function log(job: Job | undefined, line: string) {
  if (job) job.append(line);
  else console.log(line);
}

async function describeStatus(
  cfn: CloudFormationClient,
  stackName: string,
): Promise<string | null> {
  try {
    const out = await cfn.send(
      new DescribeStacksCommand({ StackName: stackName }),
    );
    return out.Stacks?.[0]?.StackStatus ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not exist/i.test(msg)) return null;
    throw err;
  }
}

/**
 * Poll stack status until success/failure. Logs every poll so the Enable UI
 * stays alive and abandon can interrupt via job.aborted.
 */
export async function waitForStackSettle(options: {
  client: CloudFormationClient;
  stackName: string;
  mode: StackWaitMode;
  maxWaitSeconds?: number;
  pollSeconds?: number;
  job?: Job;
}): Promise<string> {
  const {
    client,
    stackName,
    mode,
    maxWaitSeconds = 900,
    pollSeconds = 15,
    job,
  } = options;
  const started = Date.now();
  const deadline = started + maxWaitSeconds * 1000;
  let lastLogged: string | null = null;

  while (Date.now() < deadline) {
    if (job?.aborted) {
      throw new Error(job.error || "Enable aborted");
    }

    const status = await describeStatus(client, stackName);

    if (mode === "delete") {
      if (status == null || status === "DELETE_COMPLETE") {
        log(job, `Stack ${stackName} deleted`);
        return "DELETE_COMPLETE";
      }
      if (FAILURE.has(status)) {
        throw new Error(`Stack ${stackName} delete failed (${status})`);
      }
    } else if (status == null) {
      throw new Error(`Stack ${stackName} disappeared while waiting`);
    } else if (SUCCESS.has(status)) {
      if (lastLogged !== status) {
        log(job, `Stack ${stackName} ${status}`);
      }
      return status;
    } else if (FAILURE.has(status)) {
      throw new Error(`Stack ${stackName} failed (${status})`);
    }

    if (status && status !== lastLogged) {
      log(job, `Stack ${stackName} status: ${status}`);
      lastLogged = status;
    } else {
      const elapsed = Math.round((Date.now() - started) / 1000);
      log(
        job,
        `Still waiting on stack ${stackName} (${status || "unknown"}, ${elapsed}s)…`,
      );
    }

    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }

  const finalStatus = await describeStatus(client, stackName);
  throw new Error(
    `Timed out waiting for stack ${stackName}` +
      (finalStatus ? ` (last status ${finalStatus})` : ""),
  );
}
