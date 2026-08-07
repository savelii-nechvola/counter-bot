import type { Migration } from "./types.js";

export const _001Initial: Migration = {
  name: "001_initial",
  migrate: (_) => console.log("done _001Initial"),
};
