import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { openWritingTab, WritingPane } from "./modules/writingPane";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerNotifier();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  // Mark initialized as true to confirm plugin loading status
  // outside of the plugin (e.g. scaffold testing process)
  addon.data.initialized = true;
}

/** Invalidate the cached corpus whenever the library changes. */
function registerNotifier(): void {
  addon.data.citeWriter.observerID = Zotero.Notifier.registerObserver(
    { notify: () => addon.data.citeWriter.session.invalidate() },
    ["item"],
    "citeWriter",
  );
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  // Create ztoolkit for every window
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  const pane = new WritingPane(win);
  addon.data.citeWriter.panes.set(win, pane);
  openWritingTab(win, addon.data.citeWriter.session, pane);

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: 3000,
  })
    .createLine({
      text: getString("startup-finish"),
      type: "default",
      progress: 100,
    })
    .show();
  popupWin.startCloseTimer(3000);
}

async function onMainWindowUnload(win: Window): Promise<void> {
  const pane = addon.data.citeWriter.panes.get(win);
  if (pane) {
    pane.destroy();
    addon.data.citeWriter.panes.delete(win);
  }
  // Remove the Writing tab so it is not restored as an empty tab.
  const tabs = (win as unknown as { Zotero_Tabs?: _ZoteroTypes.Zotero_Tabs })
    .Zotero_Tabs;
  tabs?.close(`${addon.data.config.addonRef}-tab`);
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  for (const [win, pane] of addon.data.citeWriter.panes) {
    pane.destroy();
    addon.data.citeWriter.panes.delete(win);
  }
  if (addon.data.citeWriter.observerID) {
    Zotero.Notifier.unregisterObserver(addon.data.citeWriter.observerID);
  }
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  event: string,
  type: string,
  ids: Array<string | number>,
  extraData: { [key: string]: any },
) {
  ztoolkit.log("notify", event, type, ids, extraData);
}

/**
 * Preference UI events.
 * @param type event type
 * @param data event data
 */
async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

// Add your hooks here. For element click, etc.
// Keep in mind hooks only do dispatch. Don't add code that does real jobs in hooks.
// Otherwise the code would be hard to read and maintain.

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
