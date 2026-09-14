/**
 * Shared TypeScript contracts for the SmartPrinter desktop app.
 *
 * These types mirror services/desktop-agent/SmartPrinter.Agent/Ipc/IpcModels.cs field
 * for field. If you change one side, change the other - there is no code generation step
 * in this project, so keeping them in sync is a manual (but small) discipline.
 */

// ---------------- IPC command names ----------------

export const IpcCommands = {
  GetServiceStatus: "GetServiceStatus",
  GetPrinters: "GetPrinters",
  AuthorizePrinter: "AuthorizePrinter",
  GetJobs: "GetJobs",
  GetJob: "GetJob",
  GetQueue: "GetQueue",
  GetSettings: "GetSettings",
  UpdateSettings: "UpdateSettings",
  PairDeviceCreate: "PairDeviceCreate",
  PairDeviceConfirm: "PairDeviceConfirm",
  UnpairDevice: "UnpairDevice",
  RestartService: "RestartService",
  GetLogs: "GetLogs",
  ExportDiagnostics: "ExportDiagnostics",
  PrintTestPage: "PrintTestPage",
} as const;

export type IpcCommand = (typeof IpcCommands)[keyof typeof IpcCommands];

// ---------------- Envelope ----------------

export interface IpcRequest<TPayload = unknown> {
  id: string;
  command: IpcCommand;
  payload?: TPayload;
}

export interface IpcResponse<TData = unknown> {
  id: string;
  success: boolean;
  data?: TData;
  error?: string;
}

// ---------------- Domain models ----------------

export type PrinterAvailability =
  | "Unknown"
  | "Ready"
  | "Offline"
  | "Error"
  | "PaperJam"
  | "PaperOut"
  | "Busy";

export interface PrinterInfo {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  availability: PrinterAvailability;
  supportsColor: boolean;
  supportsDuplex: boolean;
  fingerprint: string;
  connectionType?: "USB" | "Bluetooth" | "Network (Wi-Fi / LAN)" | "Virtual" | "Windows Printer" | string;
  isAuthorized?: boolean;
}

export type LocalJobStatus =
  | "queued"
  | "claimed"
  | "downloading"
  | "downloaded"
  | "printing"
  | "completed"
  | "failed"
  | "cancelled";

export interface PrintJobRecord {
  printJobId: string;
  idempotencyKey: string;
  printerId: string;
  printerName?: string;
  storagePath: string;
  status: LocalJobStatus;
  optionsJson: string;
  localFilePath?: string;
  spoolerJobId?: number;
  retryCount: number;
  lastError?: string;
  claimedAt?: string;
  downloadedAt?: string;
  printedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceStatusDto {
  isPaired: boolean;
  agentId?: string;
  branchId?: string;
  deviceId?: string;
  shopId?: string;
  realtimeConnected: boolean;
  mockCloudMode: boolean;
  agentVersion: string;
  queuedJobCount: number;
}

// ---------------- Per-command payload/response shapes ----------------

export interface AuthorizePrinterRequest {
  printerName: string;
  authorized: boolean;
}

export interface UpdateSettingsRequest {
  settings: Record<string, string | null>;
}

export interface PairDeviceCreateRequest {
  ownerAccessToken?: string;
  branchId?: string;
}

export interface PairDeviceCreateResponse {
  pairingCode: string;
  expiresAt: string;
  requestId?: string;
  branchId?: string;
}

export interface PairDeviceConfirmRequest {
  pairingCode: string;
}

export interface PairDeviceConfirmResponse {
  agentId?: string;
  branchId?: string;
  deviceId?: string;
  shopId?: string;
}

export interface PrintTestPageRequest {
  printerName: string;
}

export interface GetJobRequest {
  printJobId: string;
}

export interface ExportDiagnosticsResponse {
  bundlePath: string;
}

export interface GetLogsResponse {
  file?: string;
  lines: string[];
}

export interface AgentRestartResult {
  success: boolean;
  pid?: number;
  status: "running" | "stopped" | "error";
  error?: string;
}

// ---------------- Agent Health & Connection Lifecycle ----------------

export type AgentConnectionState =
  | "starting"
  | "online"
  | "offline"
  | "restarting"
  | "error";

export interface AgentHealthStatus {
  state: AgentConnectionState;
  serviceStatus: ServiceStatusDto | null;
  error?: string;
  lastChecked?: string;
}

export const AgentIpcEvents = {
  StatusChanged: "agent:status-changed",
} as const;

