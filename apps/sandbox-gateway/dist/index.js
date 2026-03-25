import express from "express";
import { ALL_EVENT_TYPES } from "@lixeta/models";
const app = express();
const PORT = 3000;
console.log("Imported from @lixeta/models:", ALL_EVENT_TYPES);
app.get("/health", (_req, res) => {
    res.json({ status: "ok", eventTypes: ALL_EVENT_TYPES.length });
});
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
