"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  consoleApi,
  type PublicConnection,
} from "@/lib/api-client";
import { isUsableDatabaseUrl } from "@/lib/connect-url";
import type { ConnectConfig } from "@/lib/types";
import type { BusyAction } from "./types";

type CloudCluster = { id: string; name: string; state?: string };
type CloudSqlUser = { name: string };

type CloudLoading = {
  clusters: boolean;
  users: boolean;
  databases: boolean;
  preview: boolean;
  save: boolean;
};

const idleCloudLoading: CloudLoading = {
  clusters: false,
  users: false,
  databases: false,
  preview: false,
  save: false,
};

/** Prefer app DB names over empty defaults when the Cloud API lists databases. */
function pickDefaultDatabase(dbs: string[], current: string): string {
  if (current && dbs.includes(current)) return current;
  for (const prefer of ["application", "demo", "defaultdb"]) {
    if (dbs.includes(prefer)) return prefer;
  }
  return dbs[0] || current || "defaultdb";
}

function LoadingSection({ label }: { label: string }) {
  return (
    <div
      className="flex h-8 items-center gap-2 border border-dashed border-border bg-muted/40 px-2.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-3.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

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
  connectionId,
  orgId,
  onSave,
  onCloudConnected,
  onReuseWorkspace,
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
  connectionId: string | null;
  orgId?: string | null;
  onSave: () => void;
  onCloudConnected: (connection: PublicConnection, tables: string[]) => void;
  onReuseWorkspace: (connection: PublicConnection) => void;
}) {
  const [mode, setMode] = useState<"url" | "cloud">("url");
  const [apiKey, setApiKey] = useState("");
  const [clusters, setClusters] = useState<CloudCluster[]>([]);
  const [clusterId, setClusterId] = useState("");
  const [users, setUsers] = useState<CloudSqlUser[]>([]);
  const [sqlUser, setSqlUser] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("defaultdb");
  const [databases, setDatabases] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Record<string, boolean>>(
    {},
  );
  const [loading, setLoading] = useState<CloudLoading>(idleCloudLoading);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [clustersLoaded, setClustersLoaded] = useState(false);
  const [clusterStatus, setClusterStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<PublicConnection[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [reuseError, setReuseError] = useState<string | null>(null);

  const setLoad = (patch: Partial<CloudLoading>) =>
    setLoading((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    if (!open) return;
    setCloudError(null);
    setReuseError(null);
    let cancelled = false;
    setSavedLoading(true);
    void consoleApi.connection.list().then((result) => {
      if (cancelled) return;
      setSavedLoading(false);
      if (result.ok) {
        setSaved(result.value.connections || []);
      } else {
        setSaved([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  useEffect(() => {
    if (!open) return;
    setCloudError(null);
  }, [open, mode]);

  const onActivateSaved = async (id: string) => {
    setActivatingId(id);
    setReuseError(null);
    try {
      const result = await consoleApi.connection.activate(
        id,
        orgId || undefined,
      );
      if (!result.ok) {
        setReuseError(result.error.message || "Could not reuse workspace");
        return;
      }
      const connection = result.value.connection;
      if (!connection) {
        setReuseError("Could not reuse workspace");
        return;
      }
      onReuseWorkspace(connection);
    } finally {
      setActivatingId(null);
    }
  };

  const loadClusters = async () => {
    if (!apiKey.trim()) {
      setCloudError("Paste a Cockroach Cloud API key (service account)");
      return;
    }
    setLoad({ clusters: true });
    setCloudError(null);
    setClusterStatus(null);
    try {
      const result = await consoleApi.cockroachCloud.listClusters(apiKey.trim());
      if (!result.ok) {
        setClustersLoaded(false);
        setClusters([]);
        setCloudError(result.error.message || "Could not list clusters");
        return;
      }
      const list = result.value.clusters || [];
      setClusters(list);
      setClustersLoaded(true);
      if (!list.length) {
        setClusterStatus(
          "No clusters for this API key. Use a service-account secret with Cluster Admin or Cluster Developer role (Cloud Console → Access → Service Accounts).",
        );
        setClusterId("");
        setUsers([]);
        setSqlUser("");
        setDatabases([]);
        return;
      }
      setClusterStatus(
        list.length === 1
          ? `Found 1 cluster: ${list[0]!.name}`
          : `Found ${list.length} clusters — pick one below`,
      );
      if (list.length === 1) {
        setClusterId(list[0]!.id);
        setLoad({ clusters: false });
        await loadClusterDetails(list[0]!.id);
      } else if (!list.some((c) => c.id === clusterId)) {
        setClusterId("");
        setUsers([]);
        setSqlUser("");
        setDatabases([]);
      }
    } finally {
      setLoad({ clusters: false });
    }
  };

  const loadUsers = async (id: string) => {
    if (!apiKey.trim() || !id) return;
    setLoad({ users: true });
    try {
      const result = await consoleApi.cockroachCloud.listSqlUsers(
        apiKey.trim(),
        id,
      );
      if (!result.ok) {
        setCloudError(result.error.message || "Could not list SQL users");
        return;
      }
      const list = result.value.users || [];
      setUsers(list);
      if (list.length === 1) setSqlUser(list[0]!.name);
      else if (!list.some((u) => u.name === sqlUser)) setSqlUser("");
    } finally {
      setLoad({ users: false });
    }
  };

  const loadDatabases = async (id: string) => {
    if (!apiKey.trim() || !id) return;
    setLoad({ databases: true });
    try {
      const result = await consoleApi.cockroachCloud.listDatabases(
        apiKey.trim(),
        id,
      );
      if (!result.ok) {
        setCloudError(result.error.message || "Could not list databases");
        setDatabases([]);
        return;
      }
      const list = result.value.databases || [];
      setDatabases(list);
      setTables([]);
      setSelectedTables({});
      if (list.length) {
        setDatabase((prev) => pickDefaultDatabase(list, prev));
      }
    } finally {
      setLoad({ databases: false });
    }
  };

  const loadClusterDetails = async (id: string) => {
    if (!apiKey.trim() || !id) return;
    setCloudError(null);
    await Promise.all([loadUsers(id), loadDatabases(id)]);
  };

  const onPreview = async () => {
    if (!apiKey.trim() || !clusterId || !sqlUser || !password) {
      setCloudError("API key, cluster, SQL user, and password are required");
      return;
    }
    setLoad({ preview: true });
    setCloudError(null);
    try {
      const result = await consoleApi.cockroachCloud.preview({
        api_key: apiKey.trim(),
        cluster_id: clusterId,
        database: database.trim() || "defaultdb",
        sql_user: sqlUser,
        password,
      });
      if (!result.ok) {
        setCloudError(result.error.message || "Could not preview schema");
        return;
      }
      const dbs = result.value.databases || [];
      const found = result.value.tables || [];
      if (dbs.length) setDatabases(dbs);
      setTables(found);
      setSelectedTables(
        Object.fromEntries(found.map((t) => [t, true] as const)),
      );
    } finally {
      setLoad({ preview: false });
    }
  };

  const onCloudSave = async () => {
    if (!credentialsSet) return;
    if (!apiKey.trim() || !clusterId || !sqlUser || !password) {
      setCloudError("API key, cluster, SQL user, and password are required");
      return;
    }
    setLoad({ save: true });
    setCloudError(null);
    try {
      const picked = tables.filter((t) => selectedTables[t] !== false);
      if (tables.length > 0 && picked.length === 0) {
        setCloudError("Select at least one table, or clear the preview and continue");
        return;
      }
      const result = await consoleApi.cockroachCloud.save({
        api_key: apiKey.trim(),
        cluster_id: clusterId,
        database: database.trim() || "defaultdb",
        sql_user: sqlUser,
        password,
        bucket: connect.bucket,
        region: connect.region,
        prefix: connect.prefix,
        id: connectionId || undefined,
        org_id: orgId || undefined,
      });
      if (!result.ok) {
        setCloudError(result.error.message || "Could not save connection");
        return;
      }
      const connection = result.value.connection;
      if (!connection) {
        setCloudError("Could not save connection");
        return;
      }
      onCloudConnected(connection, picked);
      setPassword("");
      setApiKey("");
    } finally {
      setLoad({ save: false });
    }
  };

  const cloudWorking =
    loading.clusters ||
    loading.users ||
    loading.databases ||
    loading.preview ||
    loading.save;
  const canPreview =
    Boolean(apiKey.trim() && clusterId && sqlUser && password) && !cloudWorking;
  const canCloudSave = credentialsSet && canPreview;
  const showClusterFields = clustersLoaded && clusters.length > 0;
  const showUserField =
    showClusterFields && (loading.users || users.length > 0 || Boolean(sqlUser));
  const showDatabaseField = showClusterFields;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect</DialogTitle>
          <DialogDescription>
            Connect the customer application database. Prefer{" "}
            <span className="font-medium text-foreground">
              Use demo workspace
            </span>{" "}
            when available, reuse a saved workspace, or paste a URL / use
            Cockroach Cloud.
          </DialogDescription>
        </DialogHeader>

        {savedLoading || saved.length > 0 ? (
          <div className="space-y-2 border-b border-border pb-4">
            <p className="text-xs font-medium text-foreground">
              Saved workspaces
            </p>
            <p className="text-xs text-muted-foreground">
              Reuse a prior connection (including Cockroach Cloud) without
              pasting the API key again.
            </p>
            {savedLoading ? (
              <LoadingSection label="Loading saved workspaces…" />
            ) : (
              <ul className="max-h-36 space-y-1.5 overflow-y-auto">
                {saved.map((c) => {
                  const id = c.id;
                  const active = Boolean(c.is_active) || id === connectionId;
                  const label =
                    c.name === "demo"
                      ? "Demo workspace"
                      : c.name || "Workspace";
                  const detail =
                    c.database_url_hint ||
                    (c.database_label ? `…/${c.database_label}` : "");
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        disabled={isBusy || activatingId !== null}
                        onClick={() => void onActivateSaved(id)}
                        className="flex w-full items-center justify-between gap-2 border border-border bg-muted/30 px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted/60 disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">
                            {label}
                            {active ? (
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                (active)
                              </span>
                            ) : null}
                          </span>
                          {detail ? (
                            <span className="block truncate font-mono text-muted-foreground">
                              {detail}
                            </span>
                          ) : null}
                        </span>
                        {activatingId === id ? (
                          <Spinner className="size-3.5 shrink-0" />
                        ) : (
                          <span className="shrink-0 text-muted-foreground">
                            Use
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {reuseError ? (
              <p className="text-xs text-destructive">{reuseError}</p>
            ) : null}
          </div>
        ) : null}

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v === "cloud" ? "cloud" : "url")}
        >
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="url">Paste URL</TabsTrigger>
            <TabsTrigger value="cloud">Cockroach Cloud</TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="mt-4">
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
                    Stored encrypted. Customer application DB—not the Memstream
                    platform URL.
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
                    Prefills from <span className="font-mono">AWS_REGION</span>{" "}
                    in .env.
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
            <DialogFooter className="mt-4">
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
          </TabsContent>

          <TabsContent value="cloud" className="mt-4">
            <FieldSet>
              <FieldGroup>
                <p className="text-xs text-muted-foreground">
                  Customer Cockroach Cloud org → pick cluster → pick{" "}
                  <span className="font-medium text-foreground">
                    application database
                  </span>{" "}
                  (not the Memstream platform DB).
                </p>
                <Field>
                  <FieldLabel htmlFor="cloud_api_key">
                    Cloud API key
                  </FieldLabel>
                  <Input
                    id="cloud_api_key"
                    type="password"
                    autoComplete="off"
                    placeholder="Service account secret key"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    disabled={cloudWorking}
                  />
                  <FieldDescription>
                    Cloud Console → Access → Service Accounts. Key stays in
                    this session; SQL URL is stored encrypted. After the first
                    save, reuse it from Saved workspaces above.
                  </FieldDescription>
                </Field>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-fit"
                    disabled={!apiKey.trim() || cloudWorking}
                    onClick={() => void loadClusters()}
                  >
                    {loading.clusters ? <Spinner /> : null}
                    {loading.clusters ? "Loading clusters…" : "Load clusters"}
                  </Button>
                  {cloudError ? (
                    <p className="text-xs text-destructive">{cloudError}</p>
                  ) : null}
                  {clusterStatus && !loading.clusters ? (
                    <p className="text-xs text-muted-foreground">{clusterStatus}</p>
                  ) : null}
                </div>

                {loading.clusters ? (
                  <LoadingSection label="Loading clusters…" />
                ) : null}

                {showClusterFields ? (
                  <Field>
                    <FieldLabel>Cluster</FieldLabel>
                    <Select
                      value={clusterId || undefined}
                      disabled={loading.users || loading.databases}
                      onValueChange={(id) => {
                        setClusterId(id);
                        setTables([]);
                        setDatabases([]);
                        setSelectedTables({});
                        void loadClusterDetails(id);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select a cluster…" />
                      </SelectTrigger>
                      <SelectContent position="popper" align="start">
                        {clusters.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                            {c.state ? ` (${c.state})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}

                {showDatabaseField ? (
                  <Field>
                    <FieldLabel>Application database</FieldLabel>
                    <FieldDescription>
                      Customer app DB on this cluster (e.g. application).
                    </FieldDescription>
                    {loading.databases ? (
                      <LoadingSection label="Loading databases…" />
                    ) : databases.length ? (
                      <Select
                        value={database || undefined}
                        onValueChange={(value) => {
                          setDatabase(value);
                          setTables([]);
                          setSelectedTables({});
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a database…" />
                        </SelectTrigger>
                        <SelectContent position="popper" align="start">
                          {databases.map((d) => (
                            <SelectItem key={d} value={d}>
                              {d}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="cloud_database"
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        placeholder="Select a cluster to list databases…"
                      />
                    )}
                  </Field>
                ) : null}

                {showUserField ? (
                  <Field>
                    <FieldLabel htmlFor="cloud_sql_user">SQL user</FieldLabel>
                    {loading.users ? (
                      <LoadingSection label="Loading SQL users…" />
                    ) : users.length ? (
                      <Select
                        value={sqlUser || undefined}
                        onValueChange={setSqlUser}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a user…" />
                        </SelectTrigger>
                        <SelectContent position="popper" align="start">
                          {users.map((u) => (
                            <SelectItem key={u.name} value={u.name}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="cloud_sql_user"
                        value={sqlUser}
                        onChange={(e) => setSqlUser(e.target.value)}
                        placeholder="SQL username"
                      />
                    )}
                  </Field>
                ) : null}

                {showClusterFields ? (
                  <Field>
                    <FieldLabel htmlFor="cloud_password">SQL password</FieldLabel>
                    <Input
                      id="cloud_password"
                      type="password"
                      autoComplete="off"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password for the SQL user"
                      disabled={loading.users || loading.databases}
                    />
                  </Field>
                ) : null}

                {showClusterFields ? (
                  <Field>
                    <FieldLabel htmlFor="cloud_region">AWS region</FieldLabel>
                    <Input
                      id="cloud_region"
                      value={connect.region}
                      onChange={(e) =>
                        updateConnect({ region: e.target.value })
                      }
                    />
                  </Field>
                ) : null}

                {showClusterFields ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit"
                      disabled={!canPreview}
                      onClick={() => void onPreview()}
                    >
                      {loading.preview ? <Spinner /> : null}
                      {loading.preview ? "Previewing…" : "Preview tables"}
                    </Button>
                    {loading.preview ? (
                      <LoadingSection label="Reading public tables…" />
                    ) : null}
                  </div>
                ) : null}

                {!loading.preview && tables.length ? (
                  <Field>
                    <FieldLabel>Accessible public tables</FieldLabel>
                    <FieldDescription>
                      Tables to propose memory rules for (refine in Configure).
                    </FieldDescription>
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto border border-border p-2">
                      {tables.map((t) => (
                        <label
                          key={t}
                          className="flex cursor-pointer items-center gap-2 text-xs"
                        >
                          <Checkbox
                            checked={selectedTables[t] !== false}
                            onCheckedChange={(checked) =>
                              setSelectedTables((prev) => ({
                                ...prev,
                                [t]: checked === true,
                              }))
                            }
                          />
                          <span>{t}</span>
                        </label>
                      ))}
                    </div>
                  </Field>
                ) : null}

                {!bucketSet ? (
                  <p className="text-xs text-destructive">
                    Set CDC_S3_BUCKET in .env (ops), then refresh. Required for
                    Enable.
                  </p>
                ) : null}
              </FieldGroup>
            </FieldSet>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                disabled={!canCloudSave || isBusy}
                onClick={() => void onCloudSave()}
              >
                {loading.save ? <Spinner /> : null}
                {loading.save ? "Saving…" : "Continue"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
