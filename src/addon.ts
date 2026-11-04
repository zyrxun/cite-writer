import { config } from "../package.json";
import { ColumnOptions } from "zotero-plugin-toolkit";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { SearchSession, createSearchSession } from "./modules/searchSession";
import { WritingPane } from "./modules/writingPane";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    prefs?: {
      window: Window;
      columns: Array<ColumnOptions>;
      rows: Array<{ [dataKey: string]: string }>;
    };
    /** Cite Writer state: one pane per main window + shared search session. */
    citeWriter: {
      session: SearchSession;
      panes: Map<Window, WritingPane>;
      /** Zotero notifier observer id (unregistered on shutdown). */
      observerID?: string;
    };
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: object;

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      citeWriter: {
        session: createSearchSession(),
        panes: new Map(),
      },
    };
    this.hooks = hooks;
    this.api = {};
  }
}

export default Addon;
