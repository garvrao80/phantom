import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import App from "./App";
import { BackendPage } from "./pages/BackendPage";
import "./styles.css";

// Two screens: the control room (default) and "Your backend" at #/backend.
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    if (hash !== "#/backend") document.title = "Phantom · Control room";
  }, [hash]);
  return hash === "#/backend" ? <BackendPage /> : <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
