"use client";

import { useState } from "react";
import { RiFileCopyLine, RiCheckLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { OrgInfo } from "@/lib/api-client";
import { copyToClipboard } from "@/lib/utils";
import type { BusyAction } from "./types";

export function OrgDialog({
  open,
  onOpenChange,
  org,
  orgs,
  inviteCode,
  busy,
  isBusy,
  onboarding = false,
  onCreate,
  onInvite,
  onSelect,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  org: OrgInfo | null;
  orgs: OrgInfo[];
  inviteCode: string | null;
  busy: BusyAction;
  isBusy: boolean;
  /** First-run: must create/select before continuing. */
  onboarding?: boolean;
  onCreate: (name: string) => void;
  onInvite: () => void;
  /** Kept for API compatibility; join-with-invite UI is temporarily hidden. */
  onJoin?: (code: string) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (onboarding && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        showCloseButton={!onboarding}
        onPointerDownOutside={onboarding ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={onboarding ? (e) => e.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {onboarding ? "Create your organization" : "Organization"}
          </DialogTitle>
          <DialogDescription>
            {onboarding
              ? "Name your team to get started. Workspaces and Connect are scoped to this org — then you can enable live memory."
              : "Create an org or share an invite code. Workspaces (Connect) are tagged with the active org."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!onboarding ? (
            <div className="border bg-muted/20 px-3 py-2 text-xs">
              <p className="text-muted-foreground">Active org</p>
              <p className="font-medium text-foreground">
                {org ? `${org.name} · ${org.id}` : "None (local / unscoped)"}
              </p>
              {org ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="mt-1 px-0"
                  onClick={onClear}
                >
                  Clear org context
                </Button>
              ) : null}
            </div>
          ) : null}

          {orgs.length > 0 ? (
            <Field>
              <FieldLabel>
                {onboarding ? "Choose an existing org" : "Known orgs"}
              </FieldLabel>
              <ul className="divide-y border text-xs">
                {orgs.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-center justify-between gap-2 px-2.5 py-2"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-foreground">
                        {o.name}
                      </span>
                      <span className="ml-1 text-muted-foreground">{o.id}</span>
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={org?.id === o.id}
                      onClick={() => onSelect(o.id)}
                    >
                      {org?.id === o.id ? "Active" : onboarding ? "Continue" : "Use"}
                    </Button>
                  </li>
                ))}
              </ul>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="orgName">
              {onboarding && orgs.length === 0
                ? "Organization name"
                : "Create org"}
            </FieldLabel>
            <div className="flex gap-2">
              <Input
                id="orgName"
                placeholder="Acme"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={onboarding}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim() && !isBusy) {
                    e.preventDefault();
                    onCreate(name.trim());
                  }
                }}
              />
              <Button
                type="button"
                disabled={isBusy || !name.trim()}
                onClick={() => onCreate(name.trim())}
              >
                {busy === "org" ? <Spinner /> : null}
                {onboarding ? "Create & continue" : "Create"}
              </Button>
            </div>
          </Field>

          {org && !onboarding ? (
            <Field>
              <FieldLabel>Invite</FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isBusy}
                  onClick={onInvite}
                >
                  {busy === "org" ? <Spinner /> : null}
                  New invite code
                </Button>
                {inviteCode ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await copyToClipboard(inviteCode);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    {copied ? <RiCheckLine /> : <RiFileCopyLine />}
                    {inviteCode}
                  </Button>
                ) : null}
              </div>
            </Field>
          ) : null}
        </div>

        {!onboarding ? (
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
