import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { AgentStatusProvider } from "./context/AgentStatusContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* HashRouter (not BrowserRouter) because this app is served from the local
        filesystem (file://) in production, not from an HTTP origin with real routes. */}
    <HashRouter>
      <AuthProvider>
        <AgentStatusProvider>
          <App />
        </AgentStatusProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
