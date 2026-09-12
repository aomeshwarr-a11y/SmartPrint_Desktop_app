import {
  IpcCommands,
  type AgentRestartResult,
  type AuthorizePrinterRequest,
  type ExportDiagnosticsResponse,
  type GetLogsResponse,
  type PairDeviceConfirmRequest,
  type PairDeviceConfirmResponse,
  type PairDeviceCreateRequest,
  type PairDeviceCreateResponse,
  type PrinterInfo,
  type PrintJobRecord,
  type PrintTestPageRequest,
  type ServiceStatusDto,
  type UpdateSettingsRequest,
} from "@shared/index";

/**
 * Every function here is a thin, typed call to `window.smartprinter.callAgent`, which
 * itself is the only bridge the sandboxed renderer has to the outside world (see
 * electron/preload.ts). Pages should always go through this module rather than calling
 * `window.smartprinter` directly, so the full set of agent operations the UI uses stays
 * visible in one file.
 */

export async function getServiceStatus(): Promise<ServiceStatusDto> {
  return window.smartprinter.callAgent<ServiceStatusDto>(IpcCommands.GetServiceStatus);
}

export async function getPrinters(): Promise<PrinterInfo[]> {
  return window.smartprinter.callAgent<PrinterInfo[]>(IpcCommands.GetPrinters);
}

export async function authorizePrinter(request: AuthorizePrinterRequest): Promise<void> {
  await window.smartprinter.callAgent(IpcCommands.AuthorizePrinter, request);
}

export async function getJobs(): Promise<PrintJobRecord[]> {
  return window.smartprinter.callAgent<PrintJobRecord[]>(IpcCommands.GetJobs);
}

export async function getQueue(): Promise<PrintJobRecord[]> {
  return window.smartprinter.callAgent<PrintJobRecord[]>(IpcCommands.GetQueue);
}

export async function getSettings(): Promise<Record<string, string | null>> {
  return window.smartprinter.callAgent<Record<string, string | null>>(IpcCommands.GetSettings);
}

export async function updateSettings(request: UpdateSettingsRequest): Promise<Record<string, string | null>> {
  return window.smartprinter.callAgent(IpcCommands.UpdateSettings, request);
}

export async function pairDeviceCreate(request: PairDeviceCreateRequest): Promise<PairDeviceCreateResponse> {
  return window.smartprinter.callAgent(IpcCommands.PairDeviceCreate, request);
}

export async function pairDeviceConfirm(request: PairDeviceConfirmRequest): Promise<PairDeviceConfirmResponse> {
  return window.smartprinter.callAgent(IpcCommands.PairDeviceConfirm, request);
}

export async function unpairDevice(): Promise<void> {
  await window.smartprinter.callAgent(IpcCommands.UnpairDevice);
}

export async function restartAgent(): Promise<AgentRestartResult> {
  return window.smartprinter.restartAgent();
}

export async function restartService(): Promise<AgentRestartResult> {
  return restartAgent();
}

export async function getLogs(): Promise<GetLogsResponse> {
  return window.smartprinter.callAgent<GetLogsResponse>(IpcCommands.GetLogs);
}

export async function exportDiagnostics(): Promise<ExportDiagnosticsResponse> {
  return window.smartprinter.callAgent<ExportDiagnosticsResponse>(IpcCommands.ExportDiagnostics);
}

export async function printTestPage(request: PrintTestPageRequest): Promise<void> {
  await window.smartprinter.callAgent(IpcCommands.PrintTestPage, request);
}
