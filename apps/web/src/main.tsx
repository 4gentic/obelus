import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { startPwa } from "./pwa/registerPwa";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");

startPwa();

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
