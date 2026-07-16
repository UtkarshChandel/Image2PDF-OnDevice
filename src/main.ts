import "./styles/app.css";
import { createAppController } from "./app-controller";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("The Image to PDF app root is missing.");

const app = createAppController(root);
window.addEventListener("pagehide", () => app.destroy(), { once: true });
