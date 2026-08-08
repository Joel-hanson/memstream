"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { isUsableDatabaseUrl } from "@/lib/connect-url";
import type { ConnectConfig } from "@/lib/types";
import type { BusyAction } from "./types";

export function ConnectModal({
  open,
  onOpenChange,
  connect,
  updateConnect,
  hasStoredUrl,
  urlHint,
  bucketSet,
  credentialsSet,
  busy,
  isBusy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connect: ConnectConfig;
  updateConnect: (patch: Partial<ConnectConfig>) => void;
  hasStoredUrl: boolean;
  urlHint: string;
  bucketSet: boolean;
  credentialsSet: boolean;
  busy: BusyAction;
  isBusy: boolean;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect</DialogTitle>
          <DialogDescription>
            Connect a Cockroach application database. For a different app, use{" "}
            <span className="font-medium text-foreground">New Memstream</span>{" "}
            first so this creates a separate connection. Change storage uses{" "}
            <span className="font-mono">CDC_S3_BUCKET</span> from{" "}
            <span className="font-mono">.env</span>.
          </DialogDescription>
        </DialogHeader>
        <FieldSet>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="database_url">
                Cockroach DATABASE_URL
              </FieldLabel>
              {hasStoredUrl && !isUsableDatabaseUrl(connect.database_url) ? (
                <FieldDescription>
                  Saved connection:{" "}
                  <span className="font-mono text-foreground">
                    {urlHint || "connected"}
                  </span>
                  . Paste a new URL only to replace it.
                </FieldDescription>
              ) : null}
              <Input
                id="database_url"
                type="password"
                autoComplete="off"
                placeholder={
                  hasStoredUrl
                    ? "Paste to replace saved URL…"
                    : "postgresql://… (sslmode=verify-full)"
                }
                value={connect.database_url}
                onChange={(e) =>
                  updateConnect({ database_url: e.target.value })
                }
              />
              <FieldDescription>
                Stored encrypted in Memstream. App tables and agent memory live
                here.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="region">AWS region</FieldLabel>
              <Input
                id="region"
                value={connect.region}
                onChange={(e) => updateConnect({ region: e.target.value })}
              />
              <FieldDescription>
                Prefills from <span className="font-mono">AWS_REGION</span> in
                .env.
              </FieldDescription>
            </Field>
            {!bucketSet ? (
              <p className="text-xs text-destructive">
                Set <span className="font-mono">CDC_S3_BUCKET</span> in{" "}
                <span className="font-mono">.env</span> (ops), then refresh.
                Required for Enable.
              </p>
            ) : null}
          </FieldGroup>
        </FieldSet>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={!credentialsSet || isBusy}
            onClick={onSave}
          >
            {busy === "connect" ? <Spinner /> : null}
            {busy === "connect" ? "Saving…" : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
