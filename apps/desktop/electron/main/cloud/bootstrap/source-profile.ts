/**
 * [INPUT]: Depends on an unpackaged Electron identity port and Node filesystem/path primitives.
 * [OUTPUT]: Selects a fixed source-development profile without touching installed Bottega data.
 * [POS]: Production-source bootstrap before Store construction and the single-instance lock.
 */
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DEV_PRODUCT_NAME = "Bottega Source Dev";
const SOURCE_DEV_APP_ID = "com.jimmywong.bottega.sourcedev";

export function configureSourceDevelopment(app: {
  isPackaged: boolean;
  getPath(name: "appData"): string;
  setPath(name: "userData" | "sessionData", value: string): void;
  setName(name: string): void;
  setAppUserModelId(id: string): void;
}) {
  if (app.isPackaged) return;
  const directory = join(app.getPath("appData"), SOURCE_DEV_PRODUCT_NAME);
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error("Source development profile cannot follow symbolic links");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const userData = realpathSync(directory);
  app.setName(SOURCE_DEV_PRODUCT_NAME);
  app.setAppUserModelId(SOURCE_DEV_APP_ID);
  app.setPath("userData", userData);
  app.setPath("sessionData", userData);
  return userData;
}
