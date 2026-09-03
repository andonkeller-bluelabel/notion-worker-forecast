import { worker } from "./worker.js";
import "./webhooks/rebuildForecast.js";
import "./webhooks/setupForecastPivots.js";

export default worker;
