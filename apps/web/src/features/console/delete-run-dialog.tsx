"use client";

import { RiDeleteBinLine } from "@remixicon/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import type { MemstreamRun } from "@/lib/types";
import type { BusyAction } from "./types";

export function DeleteRunDialog({
  target,
  busy,
  onOpenChange,
  onConfirm,
}: {
  target: MemstreamRun | null;
  busy: BusyAction;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open && busy !== "delete") onOpenChange(false);
      }}
    >
      <AlertDialogContent size="default">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <RiDeleteBinLine />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete this Memstream?</AlertDialogTitle>
          <AlertDialogDescription>
            Stops the changefeed (and cloud worker if deployed) for{" "}
            <span className="font-medium text-foreground">
              {target?.app_database_label ||
                target?.profile_path ||
                "this run"}
            </span>
            . Memory chunks in the database are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy === "delete"}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy === "delete"}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy === "delete" ? <Spinner /> : null}
            {busy === "delete" ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
