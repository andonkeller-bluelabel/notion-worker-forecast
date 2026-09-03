import { worker } from "./worker.js";
import "./webhooks/rebuildForecast.js";
import "./webhooks/renderForecastViews.js";
import "./webhooks/inspectSheet.js";

export default worker;
