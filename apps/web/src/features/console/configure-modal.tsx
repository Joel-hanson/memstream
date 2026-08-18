"use client";

import { RiDatabase2Line } from "@remixicon/react";
import { RuleDraftList } from "@/components/rule-draft-list";
import { TermHint } from "@/components/term-hint";
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
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProfileDraft, ProfileInfo } from "@/lib/types";
import type { ProfileVersionInfo } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/utils";
import type { BusyAction, ConfigMode } from "./types";

export function ConfigureModal({
  open,
  onOpenChange,
  configMode,
  onConfigModeChange,
  profiles,
  profilePath,
  onProfilePathChange,
  tables,
  draft,
  ruleEnabled,
  onToggleRule,
  onChangeRuleTemplate,
  application,
  onApplicationChange,
  saveId,
  onSaveIdChange,
  credentialsSet,
  busy,
  isBusy,
  onBack,
  onPropose,
  onLoadTemplate,
  onSelectTemplateAsIs,
  onSaveProfile,
  profileVersions,
  onRestoreVersion,
  scanError,
  tablesScanned,
  schema,
  onAddRule,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configMode: ConfigMode;
  onConfigModeChange: (mode: ConfigMode) => void;
  profiles: ProfileInfo[];
  profilePath: string;
  onProfilePathChange: (path: string) => void;
  tables: string;
  draft: ProfileDraft | null;
  ruleEnabled: Record<string, boolean>;
  onToggleRule: (name: string, enabled: boolean) => void;
  onChangeRuleTemplate: (name: string, template: string) => void;
  application: string;
  onApplicationChange: (value: string) => void;
  saveId: string;
  onSaveIdChange: (value: string) => void;
  credentialsSet: boolean;
  busy: BusyAction;
  isBusy: boolean;
  onBack: () => void;
  onPropose: () => void;
  onLoadTemplate: () => void;
  onSelectTemplateAsIs: () => void;
  onSaveProfile: () => void;
  profileVersions: ProfileVersionInfo[];
  onRestoreVersion: (version: number) => void;
  scanError?: string | null;
  tablesScanned?: string[];
  schema?: Record<string, string[]>;
  onAddRule?: (table: string, column: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Configure</DialogTitle>
          <DialogDescription>
            Start from a template, or scan your schema and add a rule for any table or column.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={configMode}
          onValueChange={(v) => onConfigModeChange(v as ConfigMode)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="template">Template</TabsTrigger>
            <TabsTrigger value="discover">From database</TabsTrigger>
          </TabsList>
          <TabsContent
            value="template"
            className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
              <FieldGroup>
                <Field>
                  <FieldLabel>
                    <TermHint hint="Profiles live in the Memstream Cockroach DB (seeded from profiles/). Saving updates the DB so EC2 and workers use the same rules.">
                      Memory profile
                    </TermHint>
                  </FieldLabel>
                  <Select
                    value={profilePath}
                    onValueChange={onProfilePathChange}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select profile" />
                    </SelectTrigger>
                    <SelectContent position="popper" align="start">
                      {profiles.map((p) => (
                        <SelectItem key={p.path} value={p.path}>
                          {p.id} ({p.application})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Watched tables:{" "}
                    <span className="font-mono text-foreground">
                      {tables || "-"}
                    </span>
                  </FieldDescription>
                </Field>
                {profileVersions.length > 0 ? (
                  <Field>
                    <FieldLabel>
                      <TermHint hint="Each save that changes YAML keeps the previous snapshot (up to 20). Restore reloads that version as the current profile.">
                        Version history
                      </TermHint>
                    </FieldLabel>
                    <ul className="divide-y border text-xs">
                      {profileVersions.map((v) => (
                        <li
                          key={v.version}
                          className="flex items-center justify-between gap-2 px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">
                              v{v.version}
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                {v.source}
                              </span>
                            </p>
                            <p className="truncate text-muted-foreground">
                              {formatRelativeTime(v.created_at)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={isBusy}
                            onClick={() => onRestoreVersion(v.version)}
                          >
                            {busy === "restore-profile" ? (
                              <Spinner />
                            ) : null}
                            Restore
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Field>
                ) : null}
                {draft ? (
                  <>
                    <RuleDraftList
                      rules={draft.rules || []}
                      ruleEnabled={ruleEnabled}
                      onToggle={onToggleRule}
                      onChangeTemplate={onChangeRuleTemplate}
                    />
                    <Field>
                      <FieldLabel htmlFor="saveIdTemplate">
                        <TermHint hint="Saves into the Memstream Cockroach DB under this id. Reuse an id to overwrite, or pick a new id to keep the template.">
                          Save as profile id
                        </TermHint>
                      </FieldLabel>
                      <Input
                        id="saveIdTemplate"
                        value={saveId}
                        onChange={(e) => onSaveIdChange(e.target.value)}
                      />
                      <FieldDescription>
                        Saved as{" "}
                        <span className="font-mono text-foreground">
                          profiles/{saveId || "-"}.yaml
                        </span>
                      </FieldDescription>
                    </Field>
                  </>
                ) : null}
              </FieldGroup>
            </div>
            <DialogFooter className="mt-4 shrink-0 border-t pt-4">
              <Button type="button" variant="outline" onClick={onBack}>
                Back
              </Button>
              {draft ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={onSelectTemplateAsIs}
                  >
                    Use without edits
                  </Button>
                  <Button
                    type="button"
                    disabled={isBusy}
                    onClick={onSaveProfile}
                  >
                    {busy === "save-profile" ? <Spinner /> : null}
                    {busy === "save-profile" ? "Saving…" : "Save & continue"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isBusy}
                    onClick={onLoadTemplate}
                  >
                    {busy === "load-profile" ? <Spinner /> : null}
                    {busy === "load-profile" ? "Loading…" : "Review & edit"}
                  </Button>
                  <Button type="button" onClick={onSelectTemplateAsIs}>
                    Use template
                  </Button>
                </>
              )}
            </DialogFooter>
          </TabsContent>
          <TabsContent
            value="discover"
            className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
              <FieldGroup>
                {draft ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <Field className="min-w-0 flex-1">
                      <FieldLabel htmlFor="application-draft">
                        Application name
                      </FieldLabel>
                      <Input
                        id="application-draft"
                        value={application}
                        onChange={(e) => onApplicationChange(e.target.value)}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isBusy || !credentialsSet}
                      onClick={onPropose}
                    >
                      {busy === "propose" ? <Spinner /> : null}
                      {busy === "propose" ? "Scanning…" : "Re-scan"}
                    </Button>
                  </div>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="application">
                      Application name
                    </FieldLabel>
                    <Input
                      id="application"
                      value={application}
                      onChange={(e) => onApplicationChange(e.target.value)}
                    />
                    <FieldDescription>
                      Label on the profile. Also suggests the save id.
                    </FieldDescription>
                  </Field>
                )}
                {!draft ? (
                  <Button
                    type="button"
                    disabled={isBusy || !credentialsSet}
                    onClick={onPropose}
                  >
                    {busy === "propose" ? <Spinner /> : <RiDatabase2Line />}
                    {busy === "propose" ? "Scanning…" : "Propose from schema"}
                  </Button>
                ) : null}
                {scanError ? (
                  <p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {scanError}
                  </p>
                ) : null}
                {draft ? (
                  <>
                    <RuleDraftList
                      rules={draft.rules || []}
                      ruleEnabled={ruleEnabled}
                      onToggle={onToggleRule}
                      onChangeTemplate={onChangeRuleTemplate}
                      schema={schema}
                      onAddRule={onAddRule}
                      emptyHint={
                        tablesScanned?.length
                          ? `Scanned ${tablesScanned.join(", ")}. Use Add rule on a table to watch a column.`
                          : undefined
                      }
                    />
                    <Field>
                      <FieldLabel htmlFor="saveId">
                        <TermHint hint="Short id stored in Memstream DB (and shown as profiles/<id>.yaml in the list).">
                          Save as profile id
                        </TermHint>
                      </FieldLabel>
                      <Input
                        id="saveId"
                        value={saveId}
                        onChange={(e) => onSaveIdChange(e.target.value)}
                      />
                      <FieldDescription>
                        Saved as{" "}
                        <span className="font-mono text-foreground">
                          profiles/{saveId || "-"}.yaml
                        </span>
                      </FieldDescription>
                    </Field>
                  </>
                ) : null}
              </FieldGroup>
            </div>
            <DialogFooter className="mt-4 shrink-0 border-t pt-4">
              <Button type="button" variant="outline" onClick={onBack}>
                Back
              </Button>
                  <Button
                    type="button"
                    disabled={
                      isBusy ||
                      !draft ||
                      !(draft.rules || []).some(
                        (r) => ruleEnabled[r.name] !== false,
                      )
                    }
                    onClick={onSaveProfile}
                  >
                {busy === "save-profile" ? <Spinner /> : null}
                {busy === "save-profile" ? "Saving…" : "Save & continue"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
