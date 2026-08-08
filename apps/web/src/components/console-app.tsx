"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RiAddLine,
  RiArrowDownSLine,
  RiCheckLine,
  RiDatabase2Line,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFlashlightLine,
  RiPlugLine,
  RiRefreshLine,
  RiSettings3Line,
} from "@remixicon/react";
import { MemstreamMark } from "@/components/memstream-mark";
import {
  MemoryFlow,
  previewFlow,
} from "@/components/memory-flow";
import { EnableResources } from "@/components/enable-resources";
import { getEnableProgress } from "@/components/enable-flow";
import { RuleDraftList } from "@/components/rule-draft-list";
import { TermHint } from "@/components/term-hint";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { consoleFetch } from "@/lib/console-fetch";
import { isUsableDatabaseUrl } from "@/lib/connect-url";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn, formatRelativeTime, suggestProfileId } from "@/lib/utils";
import {
  LogLines,
  MemoryChunkList,
} from "@/components/log-list";
import {
  defaultConnect,
  type ConnectConfig,
  type JobStatus,
  type PipelineStatus,
  type ProfileDraft,
  type ProfileInfo,
  type MemstreamRun,
} from "@/lib/types";

type Modal = "connect" | "configure" | "enable" | null;
type BusyAction =
  | "connect"
  | "propose"
  | "load-profile"
  | "save-profile"
  | "enable"
  | "refresh"
  | "profiles"
  | "delete"
  | null;

function Advanced({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        onClick={onToggle}
      >
        Advanced
        <RiArrowDownSLine
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? <div className="space-y-3 border-t p-3">{children}</div> : null}
    </div>
  );
}

const ENABLE_JOB_STORAGE_KEY = "memstream.enableJobId";

function readStoredEnableJobId(): string | null {
  try {
    return sessionStorage.getItem(ENABLE_JOB_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeEnableJobId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ENABLE_JOB_STORAGE_KEY, id);
    else sessionStorage.removeItem(ENABLE_JOB_STORAGE_KEY);
  } catch {
    /* private mode / SSR */
  }
}

function jobFromRun(run: MemstreamRun): JobStatus {
  return {
    id: run.job_id || run.id,
    kind: "enable",
    status: run.status,
    log: run.log || [],
    steps: [],
    result: {
      ...(run.shop_url ? { shop_url: run.shop_url } : {}),
      run_id: run.id,
    },
    error: run.error,
    live: false,
  };
}

function pickPrimaryRun(runs: MemstreamRun[]): MemstreamRun | undefined {
  // Prefer in-flight enable so a reload mid-enable doesn't jump to an older Live run.
  return (
    runs.find((r) => r.status === "running" || r.status === "queued") ||
    runs.find((r) => r.status === "succeeded") ||
    runs[0]
  );
}

function runProfileLabel(run: MemstreamRun): string {
  return (
    run.profile_path
      ?.replace(/^profiles\//, "")
      .replace(/\.yaml$/, "") || "profile"
  );
}

function runStatusLabel(status: string): string {
  if (status === "succeeded") return "Live";
  if (status === "running" || status === "queued") return "Enabling…";
  if (status === "failed") return "Failed";
  return status;
}

export function ConsoleApp() {
  const [modal, setModal] = useState<Modal>(null);
  const [connect, setConnect] = useState<ConnectConfig>(defaultConnect);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profilePath, setProfilePath] = useState("profiles/commerce.yaml");
  const [tables, setTables] = useState("orders,stock");
  const [deploy, setDeploy] = useState(true);
  const [workerCompute, setWorkerCompute] = useState<"ec2" | "lambda">("ec2");
  const [stackName, setStackName] = useState("memstream-demo");
  const [configMode, setConfigMode] = useState<"template" | "discover">(
    "template",
  );
  const [application, setApplication] = useState("discovered-app");
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [ruleEnabled, setRuleEnabled] = useState<Record<string, boolean>>({});
  const [saveId, setSaveId] = useState(() => suggestProfileId("discovered-app"));
  const [saveIdTouched, setSaveIdTouched] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [apiHint, setApiHint] = useState<string | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [watching, setWatching] = useState(false);
  const [enableAdvanced, setEnableAdvanced] = useState(false);
  const [runs, setRuns] = useState<MemstreamRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [hasStoredUrl, setHasStoredUrl] = useState(false);
  const [urlHint, setUrlHint] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MemstreamRun | null>(null);
  const [runsSheetOpen, setRunsSheetOpen] = useState(false);
  const [runsFilter, setRunsFilter] = useState<"all" | "live" | "failed">(
    "all",
  );
  const [wiringOpen, setWiringOpen] = useState(false);
  const [setupLogOpen, setSetupLogOpen] = useState(false);
  const [askCopied, setAskCopied] = useState(false);
  const [mcpCopied, setMcpCopied] = useState(false);
  const [pendingResumeJobId, setPendingResumeJobId] = useState<string | null>(
    null,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isBusy = busy !== null;

  const updateConnect = (patch: Partial<ConnectConfig>) =>
    setConnect((c) => ({ ...c, ...patch }));

  const credentialsSet =
    hasStoredUrl || isUsableDatabaseUrl(connect.database_url);
  const bucketSet = connect.bucket.trim().length >= 3;
  const canEnable = credentialsSet && Boolean(profilePath) && bucketSet;
  const profileLabel =
    profiles.find((p) => p.path === profilePath)?.id ||
    profilePath.replace(/^profiles\//, "").replace(/\.yaml$/, "") ||
    "-";

  const loadProfiles = useCallback(async (opts?: { track?: boolean }) => {
    if (opts?.track) setBusy("profiles");
    try {
      const res = await consoleFetch("/api/profiles");
      const data = await res.json();
      if (!res.ok) {
        setApiHint(
          data.detail ||
            "API unreachable. Is `make web` running?",
        );
        return;
      }
      setApiHint(null);
      const list = (data.profiles || []) as ProfileInfo[];
      setProfiles(list);
      if (list.length && !list.some((p) => p.path === profilePath)) {
        setProfilePath(list[0].path);
      }
    } catch {
      setApiHint("API unreachable. Is `make web` running?");
    } finally {
      if (opts?.track) {
        setBusy((current) => (current === "profiles" ? null : current));
      }
    }
  }, [profilePath]);

  const syncTables = useCallback(async (path: string) => {
    if (!path) return;
    const res = await consoleFetch(
      `/api/profiles/tables?path=${encodeURIComponent(path)}`,
    );
    if (!res.ok) return;
    const data = await res.json();
    if (data.tables) setTables(data.tables);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadProfiles().then(() => {
          void syncTables(profilePath);
        });
        try {
          const res = await consoleFetch("/api/defaults");
          if (res.ok) {
            const d = (await res.json()) as {
              has_url?: boolean;
              database_url_hint?: string;
              bucket?: string;
              region?: string;
              prefix?: string;
              connection_id?: string | null;
              platform_configured?: boolean;
              worker_compute?: "ec2" | "lambda";
              source?: string;
            };
            if (d.connection_id) setConnectionId(d.connection_id);
            if (d.has_url) {
              setHasStoredUrl(true);
              setUrlHint(d.database_url_hint || d.connection_id || "saved");
            }
            if (d.worker_compute === "lambda" || d.worker_compute === "ec2") {
              setWorkerCompute(d.worker_compute);
            }
            if (d.platform_configured === false) {
              setApiHint(
                (prev) =>
                  prev ||
                  "Set MEMSTREAM_DATABASE_URL in .env (platform DB) to store connections and run history.",
              );
            }
            setConnect((c) => ({
              database_url: isUsableDatabaseUrl(c.database_url)
                ? c.database_url
                : "",
              bucket: c.bucket || d.bucket || "",
              region: c.region || d.region || "us-east-1",
              prefix: c.prefix || d.prefix || "cdc/",
            }));
          }
        } catch {
          /* ignore prefill failures */
        }

        try {
          const res = await consoleFetch("/api/runs");
          if (!res.ok) return;
          const data = (await res.json()) as {
            configured?: boolean;
            runs?: MemstreamRun[];
            detail?: string;
          };
          if (!data.configured) {
            setApiHint(
              (prev) =>
                prev ||
                "Set MEMSTREAM_DATABASE_URL in .env (platform DB) to store connections and run history.",
            );
          }
          if (data.detail && data.configured) {
            setApiHint((prev) => prev || `Memstream DB: ${data.detail}`);
          }
          const list = data.runs || [];
          setRuns(list);
          const run = pickPrimaryRun(list);
          const storedJobId = readStoredEnableJobId();
          if (!run) {
            if (storedJobId) setPendingResumeJobId(storedJobId);
            return;
          }
          // Prefer Live / in-progress over failed history on boot.
          setActiveRunId(run.id);
          if (run.connection_id) setConnectionId(run.connection_id);
          if (run.profile_path) setProfilePath(run.profile_path);
          if (run.tables) setTables(run.tables);
          if (run.stack_name) setStackName(run.stack_name);
          if (run.bucket || run.region || run.prefix) {
            setConnect((c) => ({
              ...c,
              bucket: c.bucket || run.bucket || "",
              region: c.region || run.region || "us-east-1",
              prefix: c.prefix || run.prefix || "cdc/",
            }));
          }
          setProfileReady(true);
          setJob(jobFromRun(run));
          setWatching(run.status === "succeeded");
          if (run.status === "running" || run.status === "queued") {
            const resumeJobId = run.job_id || storedJobId;
            if (resumeJobId) {
              storeEnableJobId(resumeJobId);
              setPendingResumeJobId(resumeJobId);
            }
          }
        } catch {
          /* ignore run hydrate failures */
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (watchRef.current) clearInterval(watchRef.current);
    };
  }, []);

  const refreshPipeline = useCallback(async (opts?: { track?: boolean }) => {
    if (!credentialsSet) return;
    if (opts?.track) setBusy("refresh");
    try {
      const res = await consoleFetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: connectionId || undefined,
          database_url: isUsableDatabaseUrl(connect.database_url)
            ? connect.database_url
            : undefined,
          bucket: connect.bucket,
          region: connect.region,
          prefix: connect.prefix,
          profile_path: profilePath,
          tables,
          stack_name: stackName,
        }),
      });
      const data = await res.json();
      if (res.ok) setPipeline(data as PipelineStatus);
    } finally {
      if (opts?.track) {
        setBusy((current) => (current === "refresh" ? null : current));
      }
    }
  }, [connect, credentialsSet, profilePath, tables, stackName, connectionId]);

  useEffect(() => {
    if (!watching || !credentialsSet) return;
    if (watchRef.current) return;
    void refreshPipeline();
    watchRef.current = setInterval(() => {
      void refreshPipeline();
    }, 4000);
  }, [watching, credentialsSet, refreshPipeline]);

  const startWatch = useCallback(() => {
    setWatching(true);
    void refreshPipeline();
    if (watchRef.current) clearInterval(watchRef.current);
    watchRef.current = setInterval(() => {
      void refreshPipeline();
    }, 4000);
  }, [refreshPipeline]);

  const pollJob = useCallback(
    (id: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      storeEnableJobId(id);
      let staleTicks = 0;
      let abandoning = false;

      const markInterrupted = async (data: JobStatus) => {
        if (abandoning) return;
        abandoning = true;
        const message =
          "Enable interrupted. The console reloaded or the server restarted while enable was running. Retry Enable.";
        const runId = data.result?.run_id;
        if (runId) {
          try {
            await consoleFetch(`/api/runs/${runId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "failed", error: message }),
            });
          } catch {
            /* ignore */
          }
        }
        if (pollRef.current) clearInterval(pollRef.current);
        storeEnableJobId(null);
        setBusy(null);
        setJob({
          ...data,
          status: "failed",
          error: message,
          log: [...(data.log || []), `ERROR: ${message}`],
          live: false,
        });
        try {
          const runsRes = await consoleFetch("/api/runs");
          if (runsRes.ok) {
            const body = (await runsRes.json()) as { runs?: MemstreamRun[] };
            setRuns(body.runs || []);
          }
        } catch {
          /* ignore */
        }
      };

      const tick = async () => {
        const res = await consoleFetch(`/api/jobs/${id}`);
        if (!res.ok) {
          staleTicks += 1;
          // Hard miss: no in-memory job and no persisted run.
          if (staleTicks >= 8) {
            await markInterrupted({
              id,
              kind: "enable",
              status: "failed",
              log: [],
              error: null,
              live: false,
            });
          }
          return;
        }
        staleTicks = 0;
        const data = (await res.json()) as JobStatus & {
          result?: { shop_url?: string; run_id?: string } | null;
        };
        setJob(data);
        if (data.result?.run_id) setActiveRunId(String(data.result.run_id));
        void refreshPipeline();

        if (data.status === "succeeded" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          storeEnableJobId(null);
          setBusy(null);
          try {
            const runsRes = await consoleFetch("/api/runs");
            if (runsRes.ok) {
              const body = (await runsRes.json()) as { runs?: MemstreamRun[] };
              setRuns(body.runs || []);
            }
          } catch {
            /* ignore */
          }
        }
      };
      void tick();
      pollRef.current = setInterval(() => {
        void tick();
      }, 1500);
    },
    [refreshPipeline],
  );

  useEffect(() => {
    if (!pendingResumeJobId || booting) return;
    pollJob(pendingResumeJobId);
    setPendingResumeJobId(null);
  }, [pendingResumeJobId, booting, pollJob]);

  const abandonEnable = useCallback(async () => {
    const runId = job?.result?.run_id || activeRunId;
    const message =
      "Enable interrupted. The console reloaded or the server restarted while enable was running. Retry Enable.";
    if (pollRef.current) clearInterval(pollRef.current);
    storeEnableJobId(null);
    setBusy(null);
    if (runId) {
      try {
        await consoleFetch(`/api/runs/${runId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "failed", error: message }),
        });
      } catch {
        /* ignore */
      }
    }
    setJob((prev) =>
      prev
        ? {
            ...prev,
            status: "failed",
            error: message,
            log: [...(prev.log || []), `ERROR: ${message}`],
            live: false,
          }
        : prev,
    );
    try {
      const runsRes = await consoleFetch("/api/runs");
      if (runsRes.ok) {
        const body = (await runsRes.json()) as { runs?: MemstreamRun[] };
        setRuns(body.runs || []);
      }
    } catch {
      /* ignore */
    }
  }, [job?.result?.run_id, activeRunId]);

  const selectRun = useCallback(
    (run: MemstreamRun) => {
      setActiveRunId(run.id);
      setConnectionId(run.connection_id || null);
      if (run.profile_path) setProfilePath(run.profile_path);
      if (run.tables) setTables(run.tables);
      if (run.stack_name) setStackName(run.stack_name);
      if (run.bucket || run.region || run.prefix) {
        setConnect((c) => ({
          ...c,
          bucket: run.bucket || c.bucket,
          region: run.region || c.region,
          prefix: run.prefix || c.prefix,
        }));
      }
      setProfileReady(true);
      setJob(jobFromRun(run));
      if (run.status === "succeeded") setWatching(true);
      else setWatching(false);
      if (
        (run.status === "running" || run.status === "queued") &&
        run.job_id
      ) {
        pollJob(run.job_id);
      }
    },
    [pollJob],
  );

  const resetToSetup = useCallback(
    (opts?: { clearUrl?: boolean; openConnect?: boolean }) => {
      if (pollRef.current) clearInterval(pollRef.current);
      storeEnableJobId(null);
      setPendingResumeJobId(null);
      setConnectionId(null);
      setActiveRunId(null);
      setJob(null);
      setPipeline(null);
      setWatching(false);
      setProfileReady(false);
      setDraft(null);
      setError(null);
      setConnect((c) => ({
        ...defaultConnect,
        database_url: opts?.clearUrl ? "" : c.database_url,
        bucket: c.bucket,
        region: c.region || "us-east-1",
        prefix: c.prefix || "cdc/",
      }));
      setProfilePath("profiles/commerce.yaml");
      setTables("orders,stock");
      setRunsSheetOpen(false);
      if (opts?.openConnect) setModal("connect");
      else setModal(null);
    },
    [],
  );

  const onNewMemstream = useCallback(() => {
    setNotice(null);
    resetToSetup({ clearUrl: true, openConnect: true });
  }, [resetToSetup]);

  const requestDeleteRun = useCallback(
    (run: MemstreamRun, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setDeleteTarget(run);
    },
    [],
  );

  const confirmDeleteRun = useCallback(async () => {
    const run = deleteTarget;
    if (!run) return;
    setBusy("delete");
    setError(null);
    setNotice(null);
    try {
      const res = await consoleFetch(`/api/runs/${run.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Could not delete");
        return;
      }
      setDeleteTarget(null);
      const next = runs.filter((r) => r.id !== run.id);
      setRuns(next);
      setRunsSheetOpen(false);

      if (next.length === 0) {
        // Leave the Live view: go back to the setup wizard with a clear next step.
        resetToSetup({ clearUrl: false, openConnect: false });
        setNotice(
          "Memstream deleted. Configure and Enable again when you want a new one.",
        );
        return;
      }

      if (activeRunId === run.id) {
        const preferred = pickPrimaryRun(next);
        if (preferred) {
          selectRun(preferred);
          setNotice(`Switched to ${runProfileLabel(preferred)}.`);
        } else {
          resetToSetup({ clearUrl: false, openConnect: false });
          setNotice("Memstream deleted.");
        }
      } else {
        setNotice("Memstream deleted.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  }, [deleteTarget, runs, activeRunId, selectRun, resetToSetup]);

  const applyDraft = useCallback(
    (profile: ProfileDraft, idHint?: string, opts?: { touchId?: boolean }) => {
      setDraft(profile);
      const enabled: Record<string, boolean> = {};
      for (const rule of profile.rules || []) {
        enabled[rule.name] = true;
      }
      setRuleEnabled(enabled);
      if (profile.application) setApplication(profile.application);
      if (idHint) {
        setSaveId(idHint);
        setSaveIdTouched(opts?.touchId ?? true);
      }
    },
    [],
  );

  const onPropose = async () => {
    setBusy("propose");
    setError(null);
    try {
      const res = await consoleFetch("/api/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: connectionId || undefined,
          database_url: isUsableDatabaseUrl(connect.database_url)
            ? connect.database_url
            : undefined,
          application,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Propose failed");
        return;
      }
      const idHint = saveIdTouched
        ? saveId
        : suggestProfileId(application);
      applyDraft(data.profile as ProfileDraft, idHint, {
        touchId: saveIdTouched,
      });
    } finally {
      setBusy(null);
    }
  };

  const onLoadTemplate = async () => {
    setBusy("load-profile");
    setError(null);
    try {
      const res = await consoleFetch(
        `/api/profiles/load?path=${encodeURIComponent(profilePath)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Could not load profile");
        return;
      }
      const id =
        profilePath
          .split("/")
          .pop()
          ?.replace(/\.yaml$/, "") || "profile";
      applyDraft(data.profile as ProfileDraft, id, { touchId: true });
      await syncTables(profilePath);
    } finally {
      setBusy(null);
    }
  };

  const onChangeRuleTemplate = (name: string, template: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        rules: (prev.rules || []).map((r) =>
          r.name === name ? { ...r, chunk_template: template } : r,
        ),
      };
    });
  };

  const onSaveProfile = async () => {
    if (!draft) {
      setError("Propose or load a profile first");
      return;
    }
    setBusy("save-profile");
    setError(null);
    try {
      const enabledRules = (draft.rules || []).filter(
        (r) => ruleEnabled[r.name] !== false,
      );
      const tablesFromRules = [
        ...new Set(enabledRules.map((r) => r.table).filter(Boolean)),
      ];
      const profile: ProfileDraft = {
        ...draft,
        application,
        changefeed: {
          ...draft.changefeed,
          tables: tablesFromRules.length
            ? tablesFromRules
            : draft.changefeed?.tables || [],
        },
        rules: enabledRules,
      };
      const res = await consoleFetch("/api/profiles/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: saveId, profile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Save failed");
        return;
      }
      setProfilePath(data.path || `profiles/${saveId}.yaml`);
      if (data.tables) setTables(data.tables);
      await loadProfiles();
      setProfileReady(true);
      setModal("enable");
    } finally {
      setBusy(null);
    }
  };

  const onSelectTemplateAsIs = async () => {
    await syncTables(profilePath);
    setProfileReady(true);
    setModal("enable");
  };

  const onSaveConnect = async () => {
    if (!credentialsSet) return;
    // Already stored and no new URL pasted — continue without re-sending secrets.
    if (hasStoredUrl && !isUsableDatabaseUrl(connect.database_url)) {
      setModal("configure");
      return;
    }
    setBusy("connect");
    setError(null);
    try {
      const res = await consoleFetch("/api/connection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...connect,
          id: connectionId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Could not save connection");
        return;
      }
      if (data.connection?.id) setConnectionId(String(data.connection.id));
      setHasStoredUrl(true);
      if (data.connection?.database_url_hint) {
        setUrlHint(String(data.connection.database_url_hint));
      }
      setConnect((c) => ({ ...c, database_url: "" }));
      setModal("configure");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save connection");
    } finally {
      setBusy(null);
    }
  };

  const onEnable = async (fromRun?: MemstreamRun) => {
    if (fromRun) selectRun(fromRun);
    setBusy("enable");
    setError(null);
    setJob(null);
    try {
      const res = await consoleFetch("/api/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: connectionId || fromRun?.connection_id || undefined,
          database_url: isUsableDatabaseUrl(connect.database_url)
            ? connect.database_url
            : undefined,
          bucket: fromRun?.bucket || connect.bucket,
          region: fromRun?.region || connect.region,
          prefix: fromRun?.prefix || connect.prefix,
          profile_path: fromRun?.profile_path || profilePath,
          tables: fromRun?.tables || tables,
          deploy,
          worker_compute: workerCompute,
          stack_name: fromRun?.stack_name || stackName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "Enable failed");
        setBusy(null);
        return;
      }
      setModal("enable");
      startWatch();
      pollJob(data.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enable failed");
      setBusy(null);
    }
  };

  const metrics = pipeline?.metrics;
  const hasMemory = (metrics?.chunks ?? 0) > 0 || (pipeline?.recent || []).length > 0;

  const recentChunks = pipeline?.recent || [];
  const recentTables = [
    ...new Set(recentChunks.map((c) => c.table_name).filter(Boolean)),
  ];

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) ?? null,
    [runs, activeRunId],
  );

  /** Anatomy / Live only for a real selected run, or enable in flight. */
  const showProof =
    Boolean(activeRun) ||
    job?.status === "running" ||
    job?.status === "queued" ||
    // Keep Live while /api/runs catches up after enable succeeds
    (Boolean(activeRunId) && job?.status === "succeeded");
  const resumeRun = useMemo(() => pickPrimaryRun(runs), [runs]);
  const filteredRuns = useMemo(() => {
    if (runsFilter === "live") {
      return runs.filter(
        (r) =>
          r.status === "succeeded" ||
          r.status === "running" ||
          r.status === "queued",
      );
    }
    if (runsFilter === "failed") {
      return runs.filter((r) => r.status === "failed");
    }
    return runs;
  }, [runs, runsFilter]);

  const openRunsSheet = useCallback((filter: "all" | "live" | "failed" = "all") => {
    setRunsFilter(filter);
    setRunsSheetOpen(true);
  }, []);

  const flowPreview = useMemo(
    () =>
      previewFlow({
        connected: credentialsSet,
        profileReady,
        tables,
        bucket: connect.bucket,
        prefix: connect.prefix,
        profileLabel,
        deploy,
        stackName,
      }),
    [
      credentialsSet,
      profileReady,
      tables,
      connect.bucket,
      connect.prefix,
      profileLabel,
      deploy,
      stackName,
    ],
  );

  const flowSources = pipeline?.sources?.length
    ? pipeline.sources
    : flowPreview.sources;
  const flowCore = pipeline?.core?.label ? pipeline.core : flowPreview.core;
  const flowBindings = (
    pipeline?.bindings?.length ? pipeline.bindings : flowPreview.bindings
  ).filter((b) => b.id !== "shop");

  const workerStamp = deploy
    ? `AWS · ${activeRun?.stack_name || stackName || "cloud"}`
    : "Local worker";

  const setupLogLines =
    (job?.log && job.log.length > 0 ? job.log : null) ||
    activeRun?.log ||
    [];
  const hasSetupLog = setupLogLines.length > 0;

  const setupStep: 1 | 2 | 3 = !credentialsSet
    ? 1
    : !profileReady
      ? 2
      : 3;

  const onFlowNodeClick = useCallback(
    (node: { id?: string; href?: string }) => {
      const id = node.id;
      if (!id) return;
      if (id === "cockroach") {
        setModal("connect");
        return;
      }
      if (id === "tables" || id === "changefeed") {
        if (!credentialsSet) {
          setModal("connect");
          return;
        }
        setModal("configure");
        return;
      }
      if (
        id === "worker" ||
        id === "s3" ||
        id === "bedrock" ||
        id === "vectors"
      ) {
        if (!canEnable) {
          if (!credentialsSet) setModal("connect");
          else if (!profileReady) setModal("configure");
          return;
        }
        if (job?.status === "failed") {
          void onEnable();
          return;
        }
        setModal("enable");
      }
    },
    // onEnable is stable enough for click handling; listed via job/busy state
    [credentialsSet, canEnable, profileReady, job?.status],
  );

  const flowPrimaryCta = (() => {
    if (job?.status === "running" || job?.status === "queued") {
      return (
        <span className="text-xs text-muted-foreground">
          Enable in progress…
        </span>
      );
    }
    if (job?.status === "failed") {
      return (
        <Button
          type="button"
          size="sm"
          disabled={!canEnable || isBusy}
          onClick={() => void onEnable()}
        >
          {busy === "enable" ? <Spinner /> : <RiFlashlightLine />}
          {busy === "enable" ? "Starting…" : "Retry enable"}
        </Button>
      );
    }
    if (job?.status === "succeeded" || watching || hasMemory) {
      return null;
    }
    if (!credentialsSet) {
      return (
        <Button type="button" size="sm" onClick={() => setModal("connect")}>
          <RiPlugLine />
          Connect cluster
        </Button>
      );
    }
    if (!profileReady) {
      return (
        <Button type="button" size="sm" onClick={() => setModal("configure")}>
          <RiSettings3Line />
          Configure
        </Button>
      );
    }
    return (
      <Button
        type="button"
        size="sm"
        disabled={!canEnable || isBusy}
        onClick={() => setModal("enable")}
      >
        <RiFlashlightLine />
        Enable
      </Button>
    );
  })();

  const flowFooter = flowPrimaryCta ? (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="text-[0.65rem] text-muted-foreground">
        Click a node to act
      </span>
      {flowPrimaryCta}
    </div>
  ) : null;

  const jobInFlight =
    job?.status === "running" ||
    job?.status === "queued" ||
    job?.status === "failed";

  const enableProgress = useMemo(
    () =>
      getEnableProgress(job, {
        tables,
        bucket: connect.bucket,
        prefix: connect.prefix,
        deploy,
        stackName,
      }),
    [job, tables, connect.bucket, connect.prefix, deploy, stackName],
  );

  const copyAskPrompt = useCallback(async () => {
    const sample =
      recentChunks[0]?.body || "What happened recently with orders?";
    const prompt = `Call search_memory with: ${sample.slice(0, 120)}`;
    try {
      await navigator.clipboard.writeText(prompt);
      setAskCopied(true);
      window.setTimeout(() => setAskCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [recentChunks]);

  const copyMcpConfig = useCallback(async () => {
    setError(null);
    try {
      const res = await consoleFetch("/api/mcp-config");
      const data = (await res.json()) as {
        json?: string;
        ready?: boolean;
        detail?: string;
      };
      if (!res.ok) {
        setError(data.detail || "Could not build MCP config");
        return;
      }
      if (!data.json) {
        setError("Could not build MCP config");
        return;
      }
      await navigator.clipboard.writeText(data.json);
      setMcpCopied(true);
      window.setTimeout(() => setMcpCopied(false), 2000);
      if (!data.ready && data.detail) {
        setNotice(data.detail);
      } else {
        setNotice(
          data.detail ||
            "HTTP Memstream MCP URL copied. Paste into Cursor Settings → MCP (keep make web running).",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not copy MCP config",
      );
    }
  }, []);

  const primarySetup =
    setupStep === 1
      ? {
          label: "Connect cluster",
          action: () => {
            setNotice(null);
            setModal("connect" as Modal);
          },
          icon: RiPlugLine,
        }
      : setupStep === 2
        ? {
            label: "Configure",
            action: () => {
              setNotice(null);
              setModal("configure" as Modal);
            },
            icon: RiSettings3Line,
          }
        : {
            label: "Enable",
            action: () => {
              setNotice(null);
              setModal("enable" as Modal);
            },
            icon: RiFlashlightLine,
          };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center bg-primary text-primary-foreground">
              <MemstreamMark className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-medium">Memstream</div>
              <div className="hidden text-xs text-muted-foreground sm:block">
                Agent memory on CockroachDB
              </div>
            </div>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            {watching ? (
              <Badge variant="secondary" className="gap-1.5">
                <span className="size-1.5 animate-pulse-dot rounded-full bg-foreground" />
                Watching
              </Badge>
            ) : null}
            {showProof ? (
              <>
                {job?.status === "failed" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={!canEnable || isBusy}
                    onClick={() => void onEnable()}
                  >
                    {busy === "enable" ? <Spinner /> : <RiFlashlightLine />}
                    {busy === "enable" ? "Starting…" : "Retry enable"}
                  </Button>
                ) : null}
                {runs.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openRunsSheet("all")}
                  >
                    All
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setModal("configure")}
                >
                  Configure
                </Button>
                {runs.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onNewMemstream()}
                  >
                    <RiAddLine />
                    New
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        {booting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Spinner className="size-6" />
            <p className="text-xs">Loading Memstream…</p>
          </div>
        ) : null}

        {!booting && showProof && (activeRun || job) ? (
          <Card size="sm">
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <CardTitle className="truncate">
                  {activeRun
                    ? runProfileLabel(activeRun)
                    : profileLabel}
                </CardTitle>
                <CardDescription className="truncate">
                  {activeRun?.tables || tables || "No tables yet"}
                  {activeRun?.created_at
                    ? ` · ${formatRelativeTime(activeRun.created_at)}`
                    : ""}
                </CardDescription>
                {activeRun?.app_database_label ? (
                  <p className="truncate font-mono text-[0.65rem] text-muted-foreground">
                    {activeRun.app_database_label}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {runs.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => openRunsSheet("all")}
                  >
                    All ({runs.length})
                  </Button>
                ) : null}
                <Badge
                  variant={
                    (activeRun?.status || job?.status) === "succeeded"
                      ? "secondary"
                      : (activeRun?.status || job?.status) === "failed"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {runStatusLabel(activeRun?.status || job?.status || "…")}
                </Badge>
                {activeRun ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={busy === "delete"}
                    aria-label="Delete Memstream flow"
                    onClick={(e) => requestDeleteRun(activeRun, e)}
                  >
                    <RiDeleteBinLine className="size-4" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
          </Card>
        ) : null}

        {!booting && showProof && jobInFlight && job ? (
          <EnableResources
            job={job}
            tables={tables}
            bucket={connect.bucket}
            prefix={connect.prefix}
            deploy={deploy}
            stackName={stackName}
            onNodeClick={onFlowNodeClick}
            footer={flowFooter}
            onAbandon={() => void abandonEnable()}
          />
        ) : null}

        {!booting && apiHint ? (
          <div className="flex items-start justify-between gap-3 border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <p>
              <span className="text-foreground">API offline.</span> {apiHint}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy === "profiles"}
              onClick={() => void loadProfiles({ track: true })}
            >
              {busy === "profiles" ? <Spinner /> : null}
              Retry
            </Button>
          </div>
        ) : null}

        {!booting && notice ? (
          <div className="flex items-start justify-between gap-3 border bg-muted/30 px-3 py-2 text-xs">
            <p>{notice}</p>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setNotice(null)}
            >
              Dismiss
            </Button>
          </div>
        ) : null}

        {!booting && error ? (
          <Alert variant="destructive">
            <AlertTitle>Action failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!booting && !showProof ? (
          <div className="flex max-w-lg flex-col gap-6 pt-6 sm:pt-10">
            <div className="space-y-2">
              <h1 className="text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                Index Cockroach writes so agents can search them
              </h1>
              <p className="text-sm text-muted-foreground">
                {setupStep === 1
                  ? "Connect your Cockroach cluster."
                  : setupStep === 2
                    ? "Pick which tables Memstream should watch."
                    : "Enable Memstream on those tables."}
              </p>
            </div>

            <div className="space-y-4">
              <ol className="space-y-0 border">
                {(
                  [
                    {
                      n: 1 as const,
                      title: "Connect",
                      detail: "Cockroach application database",
                      done: credentialsSet,
                      open: () => setModal("connect"),
                    },
                    {
                      n: 2 as const,
                      title: "Configure",
                      detail: "Tables and memory rules",
                      done: profileReady,
                      open: () => setModal("configure"),
                    },
                    {
                      n: 3 as const,
                      title: "Enable",
                      detail: "Start indexing writes",
                      done: false,
                      open: () => setModal("enable"),
                    },
                  ] as const
                ).map((step, i, arr) => {
                  const current = setupStep === step.n;
                  const locked =
                    (step.n === 2 && !credentialsSet) ||
                    (step.n === 3 && !profileReady);
                  return (
                    <li key={step.n}>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={step.open}
                        className={cn(
                          "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                          i < arr.length - 1 && "border-b",
                          current && "bg-muted/40",
                          locked
                            ? "cursor-not-allowed"
                            : "cursor-pointer hover:bg-muted/50",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-5 shrink-0 items-center justify-center border text-[0.65rem] tabular-nums",
                            step.done || current
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {step.done ? (
                            <RiCheckLine className="size-3" />
                          ) : (
                            step.n
                          )}
                        </span>
                        <span className="min-w-0">
                          <span
                            className={cn(
                              "block text-sm font-medium",
                              locked && "text-muted-foreground",
                            )}
                          >
                            {step.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {locked && step.n === 2
                              ? "Connect first"
                              : locked && step.n === 3
                                ? "Configure first"
                                : step.detail}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={primarySetup.action}>
                  <primarySetup.icon />
                  {primarySetup.label}
                </Button>
                {setupStep > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setModal("connect")}
                  >
                    Edit connection
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void copyMcpConfig()}
                >
                  {mcpCopied ? <RiCheckLine /> : <RiFileCopyLine />}
                  {mcpCopied ? "Copied MCP" : "Copy Memstream MCP"}
                </Button>
              </div>

              {resumeRun ? (
                <p className="text-xs text-muted-foreground">
                  Or{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2 hover:text-foreground"
                    onClick={() => selectRun(resumeRun)}
                  >
                    continue with {runProfileLabel(resumeRun)}
                  </button>
                  {runs.length > 1 ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:text-foreground"
                        onClick={() => openRunsSheet("all")}
                      >
                        see all ({runs.length})
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {!booting &&
        job &&
        (job.status === "running" ||
          job.status === "queued" ||
          job.status === "failed") ? (
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <div>
                <CardTitle>
                  {job.status === "failed" ? "Enable failed" : "Enable log"}
                </CardTitle>
                <CardDescription>
                  {job.status === "failed"
                    ? "Fix the issue below, then retry"
                    : "Enable is running. This is the next step."}
                </CardDescription>
              </div>
              <Badge
                variant={
                  job.status === "failed" ? "destructive" : "outline"
                }
              >
                {runStatusLabel(job.status)}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {job.error || job.status === "failed" ? (
                <div className="border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {job.error || "Enable failed"}
                  {/AccessDenied|CreateStack|DescribeStacks|cloudformation/i.test(
                    (job.log || []).join("\n") + (job.error || ""),
                  ) ? (
                    <p className="mt-1 text-muted-foreground">
                      Memory worker needs CloudFormation permission. Attach{" "}
                      <span className="font-mono text-foreground">
                        infra/deployer-policy.json
                      </span>{" "}
                      to your AWS user, or turn off “Start memory worker in the
                      cloud” and run the worker locally.
                    </p>
                  ) : null}
                </div>
              ) : null}
              <LogLines
                lines={job.log || []}
                empty="Waiting for enable output…"
                maxHeightClass="max-h-48"
              />
            </CardContent>
          </Card>
        ) : null}

        {!booting && showProof && !jobInFlight ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-sm font-medium">
                  {recentChunks.length ? "Memory chunks" : "Live"}
                </h1>
                <p className="text-xs text-muted-foreground">
                  <TermHint hint="YAML that lists which tables to watch, when a write should become a chunk, and how that chunk is worded.">
                    Profile
                  </TermHint>{" "}
                  <span className="font-mono text-foreground">{profileLabel}</span>
                  {tables ? (
                    <>
                      {" "}
                      · tables{" "}
                      <span className="font-mono text-foreground">{tables}</span>
                    </>
                  ) : null}
                  {" · "}
                  <span className="text-foreground">{workerStamp}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy === "refresh"}
                  onClick={() => void refreshPipeline({ track: true })}
                >
                  {busy === "refresh" ? (
                    <Spinner />
                  ) : (
                    <RiRefreshLine />
                  )}
                  {busy === "refresh" ? "Refreshing…" : "Refresh"}
                </Button>
                {hasSetupLog ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSetupLogOpen(true)}
                  >
                    Setup log
                  </Button>
                ) : null}
                {!watching ? (
                  <Button type="button" size="sm" onClick={() => startWatch()}>
                    Watch
                  </Button>
                ) : null}
              </div>
            </div>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>
                    {pipeline?.db_error
                      ? "Recent memory"
                      : recentChunks.length
                        ? "Recent memory"
                        : "No chunks yet"}
                  </CardTitle>
                  <CardDescription>
                    {pipeline?.db_error
                      ? pipeline.db_error
                      : recentChunks.length
                        ? `${recentChunks.length} chunk${
                            recentChunks.length === 1 ? "" : "s"
                          }${
                            recentTables.length
                              ? ` from ${recentTables.slice(0, 3).join(", ")}`
                              : ""
                          }`
                        : watching
                          ? "Waiting for a write on a watched table"
                          : "After Enable, new writes show up here"}
                  </CardDescription>
                </div>
                {busy === "refresh" || (watching && !pipeline) ? (
                  <Spinner className="text-muted-foreground" />
                ) : null}
              </CardHeader>
              <CardContent className="space-y-3">
                <MemoryChunkList
                  chunks={recentChunks}
                  empty={
                    watching && !pipeline
                      ? "Loading pipeline…"
                      : watching
                        ? "Write to a watched table (or use the demo shop)."
                        : "Enable Memstream, then write to a watched table."
                  }
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyAskPrompt()}
                  >
                    {askCopied ? <RiCheckLine /> : <RiFileCopyLine />}
                    {askCopied ? "Copied" : "Copy ask for Cursor"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyMcpConfig()}
                  >
                    {mcpCopied ? <RiCheckLine /> : <RiFileCopyLine />}
                    {mcpCopied ? "Copied" : "Copy Memstream MCP"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Ask in Cursor with{" "}
                    <TermHint hint="Cursor calls this app's /api/mcp endpoint, which runs search_memory against your chunks.">
                      <span className="font-mono">search_memory</span>
                    </TermHint>
                    . Copy Memstream MCP pastes that HTTP URL.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  label: (
                    <TermHint hint="Rows in agent_memory_chunks. Each row is one rule match on a write.">
                      Memory chunks
                    </TermHint>
                  ),
                  key: "chunks",
                  value:
                    watching && !pipeline ? (
                      <Spinner className="size-5 text-muted-foreground" />
                    ) : (
                      (metrics?.chunks ?? "-")
                    ),
                  sub: metrics?.latest_at
                    ? `last ${metrics.latest_at}`
                    : "in agent memory",
                },
                {
                  label: (
                    <TermHint hint="Count of distinct rule names that produced chunks (for example order_status_change).">
                      Rules firing
                    </TermHint>
                  ),
                  key: "rules",
                  value:
                    watching && !pipeline ? (
                      <Spinner className="size-5 text-muted-foreground" />
                    ) : (
                      (metrics?.by_rule || []).length || "-"
                    ),
                  sub:
                    (metrics?.by_rule || [])
                      .slice(0, 2)
                      .map((r) => `${r.rule}×${r.count}`)
                      .join(" · ") || "by rule_name",
                },
              ].map((m) => (
                <Card key={m.key} size="sm">
                  <CardHeader>
                    <CardDescription>{m.label}</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">
                      {m.value}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.sub}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="border">
              <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                onClick={() => setWiringOpen((o) => !o)}
                aria-expanded={wiringOpen}
              >
                <span>
                  Pipeline
                  <span className="ml-2 text-foreground/80">{workerStamp}</span>
                </span>
                <RiArrowDownSLine
                  className={cn(
                    "size-4 transition-transform",
                    wiringOpen && "rotate-180",
                  )}
                />
              </button>
              {wiringOpen ? (
                <div className="border-t">
                  <MemoryFlow
                    sources={flowSources}
                    core={flowCore}
                    bindings={flowBindings}
                    activeId={null}
                    title="This Memstream"
                    subtitle="Click a node for the related action"
                    showPath={false}
                    onNodeClick={onFlowNodeClick}
                    footer={flowFooter}
                    className="border-0"
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </main>

      {/* Connect */}
      <Dialog
        open={modal === "connect"}
        onOpenChange={(open) => setModal(open ? "connect" : null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Connect</DialogTitle>
            <DialogDescription>
              Connect a Cockroach application database. For a different app,
              use <span className="font-medium text-foreground">New Memstream</span>{" "}
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
              onClick={() => setModal(null)}
            >
              Close
            </Button>
            <Button
              type="button"
              disabled={!credentialsSet || isBusy}
              onClick={() => void onSaveConnect()}
            >
              {busy === "connect" ? <Spinner /> : null}
              {busy === "connect" ? "Saving…" : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Configure */}
      <Dialog
        open={modal === "configure"}
        onOpenChange={(open) => setModal(open ? "configure" : null)}
      >
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Configure</DialogTitle>
            <DialogDescription>
              Start from a template, or scan your schema and edit the rules.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={configMode}
            onValueChange={(v) => {
              setConfigMode(v as "template" | "discover");
              setDraft(null);
              setSaveIdTouched(false);
            }}
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
                      onValueChange={(v) => {
                        setProfilePath(v);
                        setDraft(null);
                        void syncTables(v);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select profile" />
                      </SelectTrigger>
                      <SelectContent>
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
                  {draft ? (
                    <>
                      <RuleDraftList
                        rules={draft.rules || []}
                        ruleEnabled={ruleEnabled}
                        onToggle={(name, enabled) =>
                          setRuleEnabled((m) => ({ ...m, [name]: enabled }))
                        }
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
                          onChange={(e) => {
                            setSaveIdTouched(true);
                            setSaveId(
                              e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9_-]/g, "-"),
                            );
                          }}
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModal("connect")}
                >
                  Back
                </Button>
                {draft ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void onSelectTemplateAsIs()}
                    >
                      Use without edits
                    </Button>
                    <Button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void onSaveProfile()}
                    >
                      {busy === "save-profile" ? <Spinner /> : null}
                      {busy === "save-profile"
                        ? "Saving…"
                        : "Save & continue"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => void onLoadTemplate()}
                    >
                      {busy === "load-profile" ? <Spinner /> : null}
                      {busy === "load-profile"
                        ? "Loading…"
                        : "Review & edit"}
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void onSelectTemplateAsIs()}
                    >
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
                          onChange={(e) => {
                            const next = e.target.value;
                            setApplication(next);
                            if (!saveIdTouched) {
                              setSaveId(suggestProfileId(next));
                            }
                          }}
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isBusy || !credentialsSet}
                        onClick={() => void onPropose()}
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
                        onChange={(e) => {
                          const next = e.target.value;
                          setApplication(next);
                          if (!saveIdTouched) {
                            setSaveId(suggestProfileId(next));
                          }
                        }}
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
                      onClick={() => void onPropose()}
                    >
                      {busy === "propose" ? (
                        <Spinner />
                      ) : (
                        <RiDatabase2Line />
                      )}
                      {busy === "propose" ? "Scanning…" : "Propose from schema"}
                    </Button>
                  ) : null}
                  {draft ? (
                    <>
                      <RuleDraftList
                        rules={draft.rules || []}
                        ruleEnabled={ruleEnabled}
                        onToggle={(name, enabled) =>
                          setRuleEnabled((m) => ({ ...m, [name]: enabled }))
                        }
                        onChangeTemplate={onChangeRuleTemplate}
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
                          onChange={(e) => {
                            setSaveIdTouched(true);
                            setSaveId(
                              e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9_-]/g, "-"),
                            );
                          }}
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModal("connect")}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={isBusy || !draft}
                  onClick={() => void onSaveProfile()}
                >
                  {busy === "save-profile" ? <Spinner /> : null}
                  {busy === "save-profile" ? "Saving…" : "Save & continue"}
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Setup log (post-enable transcript) */}
      <Dialog open={setupLogOpen} onOpenChange={setSetupLogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Setup log</DialogTitle>
            <DialogDescription>
              What ran when Memstream was enabled — schema, change streams, and
              the {deploy ? "AWS memory worker" : "local worker"}.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            <LogLines
              lines={setupLogLines}
              empty="No setup output saved for this run."
              maxHeightClass="max-h-[min(24rem,60vh)]"
            />
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" onClick={() => setSetupLogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enable */}
      <Dialog
        open={modal === "enable"}
        onOpenChange={(open) => setModal(open ? "enable" : null)}
      >
        <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-hidden sm:max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>
              {enableProgress.phase === "running"
                ? "Enabling Memstream"
                : enableProgress.phase === "succeeded"
                  ? "Memstream is enabled"
                  : enableProgress.phase === "failed"
                    ? "Enable failed"
                    : "Enable"}
            </DialogTitle>
            <DialogDescription>
              {enableProgress.phase === "running"
                ? `Step ${enableProgress.stepNumber} of ${enableProgress.total}${
                    enableProgress.current
                      ? `: ${enableProgress.current.label}`
                      : ""
                  }`
                : enableProgress.phase === "succeeded"
                  ? "Ship an order in the shop, then ask from Cursor."
                  : enableProgress.phase === "failed"
                    ? enableProgress.headline
                    : "Start indexing writes for your watched tables."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto">
            <EnableResources
              job={job}
              tables={tables}
              bucket={connect.bucket}
              prefix={connect.prefix}
              deploy={deploy}
              stackName={stackName}
              onNodeClick={onFlowNodeClick}
              onAbandon={() => void abandonEnable()}
            />

            {enableProgress.phase === "idle" ? (
              <div className="space-y-3 border bg-muted/20 p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <TermHint
                    className="text-muted-foreground"
                    hint="Profile YAML applied when indexing change events."
                  >
                    Profile
                  </TermHint>
                  <span className="font-mono">{profileLabel}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <TermHint
                    className="text-muted-foreground"
                    hint="App tables included in the Cockroach changefeed for this profile."
                  >
                    Tables
                  </TermHint>
                  <span className="font-mono">{tables || "-"}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Cluster</span>
                  <span className="font-mono">
                    {credentialsSet ? "connected" : "missing URL"}
                  </span>
                </div>
                {!bucketSet ? (
                  <p className="text-muted-foreground">
                    Set <span className="font-mono">CDC_S3_BUCKET</span> in{" "}
                    <span className="font-mono">.env</span>, then refresh.
                    Required to enable.
                  </p>
                ) : null}
              </div>
            ) : null}

            {job?.log?.length &&
            (enableProgress.phase === "failed" ||
              enableProgress.phase === "succeeded") ? (
              <LogLines lines={job.log} maxHeightClass="max-h-48" />
            ) : null}

            {enableProgress.phase === "idle" ? (
              <Advanced
                open={enableAdvanced}
                onToggle={() => setEnableAdvanced((v) => !v)}
              >
                <Field>
                  <FieldLabel htmlFor="tables">
                    <TermHint hint="App tables included in the changefeed for this profile.">
                      Watched tables
                    </TermHint>
                  </FieldLabel>
                  <Input
                    id="tables"
                    value={tables}
                    onChange={(e) => setTables(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="stackName">
                    <TermHint hint="CloudFormation stack name for the optional cloud worker.">
                      Stack name
                    </TermHint>
                  </FieldLabel>
                  <Input
                    id="stackName"
                    value={stackName}
                    onChange={(e) => setStackName(e.target.value)}
                  />
                </Field>
                <Field orientation="horizontal">
                  <Checkbox
                    id="deploy"
                    checked={deploy}
                    onCheckedChange={(v) => setDeploy(v === true)}
                  />
                  <FieldLabel htmlFor="deploy" className="font-normal">
                    Start memory worker in the cloud
                  </FieldLabel>
                </Field>
                {deploy ? (
                  <Field>
                    <FieldLabel htmlFor="workerCompute">
                      <TermHint hint="EC2 uses the on-box watcher when Enable runs on the demo host; Lambda deploys a separate S3-triggered function.">
                        Worker compute
                      </TermHint>
                    </FieldLabel>
                    <select
                      id="workerCompute"
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                      value={workerCompute}
                      onChange={(e) =>
                        setWorkerCompute(
                          e.target.value === "lambda" ? "lambda" : "ec2",
                        )
                      }
                    >
                      <option value="ec2">EC2 (memstream-watch)</option>
                      <option value="lambda">Lambda</option>
                    </select>
                  </Field>
                ) : null}
              </Advanced>
            ) : null}
          </div>

          <DialogFooter className="shrink-0">
            {enableProgress.phase === "succeeded" ? (
              <>
                <Button type="button" onClick={() => setModal(null)}>
                  Back to Live
                </Button>
              </>
            ) : enableProgress.phase === "failed" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModal(null)}
                >
                  Close
                </Button>
                <Button
                  type="button"
                  disabled={isBusy || !canEnable}
                  onClick={() => void onEnable()}
                >
                  {busy === "enable" ? <Spinner /> : null}
                  {busy === "enable" ? "Retrying…" : "Retry"}
                </Button>
              </>
            ) : enableProgress.phase === "running" ? (
              <Button type="button" variant="outline" disabled>
                <Spinner />
                Enabling…
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setModal("configure")}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={isBusy || !canEnable}
                  onClick={() => void onEnable()}
                >
                  {busy === "enable" ? <Spinner /> : null}
                  {busy === "enable" ? "Starting…" : "Enable"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={runsSheetOpen} onOpenChange={setRunsSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>All Memstreams</SheetTitle>
            <SheetDescription>
              Open a run on the home screen
            </SheetDescription>
          </SheetHeader>
          <div className="flex gap-1 border-b px-4 pb-3">
            {(
              [
                { id: "all" as const, label: "All" },
                { id: "live" as const, label: "Live" },
                { id: "failed" as const, label: "Failed" },
              ] as const
            ).map((f) => (
              <Button
                key={f.id}
                type="button"
                size="xs"
                variant={runsFilter === f.id ? "outline" : "ghost"}
                onClick={() => setRunsFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <ScrollArea className="min-h-0 flex-1 px-4">
            {filteredRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-xs text-muted-foreground">
                  {runs.length === 0
                    ? "No Memstreams yet."
                    : "No Memstreams in this filter."}
                </p>
                {runs.length === 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setRunsSheetOpen(false);
                      onNewMemstream();
                    }}
                  >
                    <RiAddLine />
                    New Memstream
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y border">
                {filteredRuns.map((run) => {
                  const active = run.id === activeRunId;
                  const profile = runProfileLabel(run);
                  const when = formatRelativeTime(run.created_at);
                  const errHint =
                    run.status === "failed"
                      ? (run.error || run.log?.slice(-1)[0] || "")
                          .replace(/\s+/g, " ")
                          .slice(0, 90)
                      : "";
                  return (
                    <li key={run.id} className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => {
                          selectRun(run);
                          setRunsSheetOpen(false);
                        }}
                        className={cn(
                          "min-w-0 flex-1 px-3 py-2.5 text-left transition-colors",
                          active ? "bg-muted/50" : "hover:bg-muted/30",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium">{profile}</span>
                          <Badge
                            variant={
                              run.status === "succeeded"
                                ? "secondary"
                                : run.status === "failed"
                                  ? "destructive"
                                  : "outline"
                            }
                          >
                            {runStatusLabel(run.status)}
                          </Badge>
                          {active ? (
                            <span className="text-[0.65rem] text-muted-foreground">
                              current
                            </span>
                          ) : null}
                          {when ? (
                            <span className="text-[0.65rem] text-muted-foreground">
                              {when}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">
                          {errHint || run.tables}
                        </p>
                        {run.app_database_label ? (
                          <p className="mt-0.5 truncate font-mono text-[0.6rem] text-muted-foreground">
                            {run.app_database_label}
                          </p>
                        ) : null}
                      </button>
                      {run.status === "failed" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="m-1 shrink-0"
                          disabled={!canEnable || isBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            setRunsSheetOpen(false);
                            void onEnable(run);
                          }}
                        >
                          Retry
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="m-1 shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={busy === "delete"}
                        aria-label="Delete Memstream"
                        onClick={(e) => requestDeleteRun(run, e)}
                      >
                        <RiDeleteBinLine className="size-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRunsSheetOpen(false);
                onNewMemstream();
              }}
            >
              <RiAddLine />
              New Memstream
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && busy !== "delete") setDeleteTarget(null);
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
                {deleteTarget?.app_database_label ||
                  deleteTarget?.profile_path ||
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
                void confirmDeleteRun();
              }}
            >
              {busy === "delete" ? <Spinner /> : null}
              {busy === "delete" ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
