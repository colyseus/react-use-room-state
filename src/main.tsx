import "./polyfill";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ColyseusProvider } from "./colyseus/ColyseusProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColyseusProvider>
      <App />
    </ColyseusProvider>
  </StrictMode>,
);
