export type Modal = "connect" | "configure" | "enable" | null;

export type BusyAction =
  | "connect"
  | "propose"
  | "load-profile"
  | "save-profile"
  | "enable"
  | "refresh"
  | "profiles"
  | "delete"
  | null;

export type RunsFilter = "all" | "live" | "failed";

export type ConfigMode = "template" | "discover";

export type WorkerCompute = "ec2" | "lambda";
