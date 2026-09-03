import { worker } from "./worker.js";
import "./webhooks/rebuildForecast.js";
import "./webhooks/setupForecastPivots.js";
import "./webhooks/renderForecastViews.js";

export default worker;
