export {};

declare global {
  interface Window {
    electronAPI: {
      getAgentStatus: () => Promise<any>;
      getPrinters: () => Promise<any>;
      getActiveJobs: () => Promise<any>;
    };
  }
}