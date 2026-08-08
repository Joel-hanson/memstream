"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getEnableProgress } from "@/components/enable-flow";
import { previewFlow } from "@/components/memory-flow";
import { Spinner } from "@/components/ui/spinner";
import { consoleFetch } from "@/lib/console-fetch";
import { isUsableDatabaseUrl } from "@/lib/connect-url";
import { suggestProfileId } from "@/lib/utils";
import {
  defaultConnect,
  type ConnectConfig,
  type JobStatus,
  type PipelineStatus,
  type ProfileDraft,
  type ProfileInfo,
  type MemstreamRun,
} from "@/lib/types";
import {
  type BusyAction,
  type Modal,
  ConnectModal,
  ConfigureModal,
  ConsoleAlerts,
  ConsoleHeaderBar,
  DeleteRunDialog,
  EnableLogCard,
  EnableModal,
  EnableResources,
  FlowPrimaryCta,
  LivePanel,
  RunSummaryCard,
  RunsSheet,
  SetupLogDialog,
  SetupWizard,
  jobFromRun,
  pickPrimaryRun,
  readStoredEnableJobId,
  runProfileLabel,
  storeEnableJobId,
} from "@/features/console";

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

  const hideFlowFooter =
    job?.status === "succeeded" || watching || hasMemory;

  const flowFooter = hideFlowFooter ? null : (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      <span className="text-[0.65rem] text-muted-foreground">
        Click a node to act
      </span>
      <FlowPrimaryCta
        job={job}
        watching={watching}
        hasMemory={hasMemory}
        credentialsSet={credentialsSet}
        profileReady={profileReady}
        canEnable={canEnable}
        isBusy={isBusy}
        busy={busy}
        onEnable={() => void onEnable()}
        onOpenConnect={() => setModal("connect")}
        onOpenConfigure={() => setModal("configure")}
        onOpenEnable={() => setModal("enable")}
      />
    </div>
  );

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

  return (
    <div className="flex min-h-screen flex-col">
      <ConsoleHeaderBar
        watching={watching}
        showProof={showProof}
        jobFailed={job?.status === "failed"}
        canEnable={canEnable}
        isBusy={isBusy}
        busy={busy}
        runsCount={runs.length}
        onRetryEnable={() => void onEnable()}
        onOpenRuns={() => openRunsSheet("all")}
        onOpenConfigure={() => setModal("configure")}
        onNewMemstream={onNewMemstream}
      />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
        {booting ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
            <Spinner className="size-6" />
            <p className="text-xs">Loading Memstream…</p>
          </div>
        ) : null}

        {!booting && showProof && (activeRun || job) ? (
          <RunSummaryCard
            activeRun={activeRun}
            job={job}
            profileLabel={profileLabel}
            tables={tables}
            runsCount={runs.length}
            busy={busy}
            onOpenRuns={() => openRunsSheet("all")}
            onRequestDelete={requestDeleteRun}
          />
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

        {!booting ? (
          <ConsoleAlerts
            apiHint={apiHint}
            notice={notice}
            error={error}
            busy={busy}
            onRetryProfiles={() => void loadProfiles({ track: true })}
            onDismissNotice={() => setNotice(null)}
          />
        ) : null}

        {!booting && !showProof ? (
          <SetupWizard
            setupStep={setupStep}
            credentialsSet={credentialsSet}
            profileReady={profileReady}
            resumeRun={resumeRun}
            runsCount={runs.length}
            mcpCopied={mcpCopied}
            onOpenConnect={() => setModal("connect")}
            onOpenConfigure={() => setModal("configure")}
            onOpenEnable={() => setModal("enable")}
            onPrimary={() => {
              setNotice(null);
              if (setupStep === 1) setModal("connect");
              else if (setupStep === 2) setModal("configure");
              else setModal("enable");
            }}
            onCopyMcp={() => void copyMcpConfig()}
            onSelectResume={selectRun}
            onOpenRuns={() => openRunsSheet("all")}
          />
        ) : null}

        {!booting &&
        job &&
        (job.status === "running" ||
          job.status === "queued" ||
          job.status === "failed") ? (
          <EnableLogCard job={job} />
        ) : null}

        {!booting && showProof && !jobInFlight ? (
          <LivePanel
            profileLabel={profileLabel}
            tables={tables}
            workerStamp={workerStamp}
            busy={busy}
            watching={watching}
            pipeline={pipeline}
            recentChunks={recentChunks}
            recentTables={recentTables}
            metrics={metrics}
            hasSetupLog={hasSetupLog}
            wiringOpen={wiringOpen}
            onToggleWiring={() => setWiringOpen((o) => !o)}
            flowSources={flowSources}
            flowCore={flowCore}
            flowBindings={flowBindings}
            flowFooter={flowFooter}
            askCopied={askCopied}
            mcpCopied={mcpCopied}
            onRefresh={() => void refreshPipeline({ track: true })}
            onOpenSetupLog={() => setSetupLogOpen(true)}
            onStartWatch={() => startWatch()}
            onCopyAsk={() => void copyAskPrompt()}
            onCopyMcp={() => void copyMcpConfig()}
            onNodeClick={onFlowNodeClick}
          />
        ) : null}
      </main>

      <ConnectModal
        open={modal === "connect"}
        onOpenChange={(open) => setModal(open ? "connect" : null)}
        connect={connect}
        updateConnect={updateConnect}
        hasStoredUrl={hasStoredUrl}
        urlHint={urlHint}
        bucketSet={bucketSet}
        credentialsSet={credentialsSet}
        busy={busy}
        isBusy={isBusy}
        onSave={() => void onSaveConnect()}
      />

      <ConfigureModal
        open={modal === "configure"}
        onOpenChange={(open) => setModal(open ? "configure" : null)}
        configMode={configMode}
        onConfigModeChange={(mode) => {
          setConfigMode(mode);
          setDraft(null);
          setSaveIdTouched(false);
        }}
        profiles={profiles}
        profilePath={profilePath}
        onProfilePathChange={(v) => {
          setProfilePath(v);
          setDraft(null);
          void syncTables(v);
        }}
        tables={tables}
        draft={draft}
        ruleEnabled={ruleEnabled}
        onToggleRule={(name, enabled) =>
          setRuleEnabled((m) => ({ ...m, [name]: enabled }))
        }
        onChangeRuleTemplate={onChangeRuleTemplate}
        application={application}
        onApplicationChange={(next) => {
          setApplication(next);
          if (!saveIdTouched) setSaveId(suggestProfileId(next));
        }}
        saveId={saveId}
        onSaveIdChange={(value) => {
          setSaveIdTouched(true);
          setSaveId(value.toLowerCase().replace(/[^a-z0-9_-]/g, "-"));
        }}
        credentialsSet={credentialsSet}
        busy={busy}
        isBusy={isBusy}
        onBack={() => setModal("connect")}
        onPropose={() => void onPropose()}
        onLoadTemplate={() => void onLoadTemplate()}
        onSelectTemplateAsIs={() => void onSelectTemplateAsIs()}
        onSaveProfile={() => void onSaveProfile()}
      />

      <SetupLogDialog
        open={setupLogOpen}
        onOpenChange={setSetupLogOpen}
        lines={setupLogLines}
        deploy={deploy}
      />

      <EnableModal
        open={modal === "enable"}
        onOpenChange={(open) => setModal(open ? "enable" : null)}
        enableProgress={enableProgress}
        job={job}
        tables={tables}
        onTablesChange={setTables}
        bucket={connect.bucket}
        prefix={connect.prefix}
        deploy={deploy}
        onDeployChange={setDeploy}
        stackName={stackName}
        onStackNameChange={setStackName}
        workerCompute={workerCompute}
        onWorkerComputeChange={setWorkerCompute}
        enableAdvanced={enableAdvanced}
        onToggleAdvanced={() => setEnableAdvanced((v) => !v)}
        profileLabel={profileLabel}
        credentialsSet={credentialsSet}
        bucketSet={bucketSet}
        canEnable={canEnable}
        busy={busy}
        isBusy={isBusy}
        onNodeClick={onFlowNodeClick}
        onAbandon={() => void abandonEnable()}
        onBack={() => setModal("configure")}
        onEnable={() => void onEnable()}
        onClose={() => setModal(null)}
      />

      <RunsSheet
        open={runsSheetOpen}
        onOpenChange={setRunsSheetOpen}
        runs={runs}
        filteredRuns={filteredRuns}
        runsFilter={runsFilter}
        onFilterChange={setRunsFilter}
        activeRunId={activeRunId}
        canEnable={canEnable}
        isBusy={isBusy}
        busy={busy}
        onSelectRun={selectRun}
        onEnable={(run) => void onEnable(run)}
        onRequestDelete={requestDeleteRun}
        onNewMemstream={onNewMemstream}
      />

      <DeleteRunDialog
        target={deleteTarget}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteRun()}
      />
    </div>
  );
}
