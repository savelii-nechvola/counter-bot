import type { DatabaseSync } from "node:sqlite";

export type Migration = {
  name: string;
  migrate: (db: DatabaseSync) => void;
};
