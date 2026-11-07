/**
 * [INPUT]: Depends on main-verified compiled module URLs and the public SDK HostApi.
 * [OUTPUT]: Generates a package-host entry with prepare/activate/drain/dispose and cancellable tool/service calls whose host requests share the same lifetime.
 * [POS]: Plugin process bootstrap; package module loading is deferred until explicit prepare.
 */
export function pluginBootstrap(entries: readonly string[]) {
  return `const entries = ${JSON.stringify([...new Set(entries)])};
export function activate(host) {
  const modules = new Map(), runtimes = new Map(), calls = new Map();
  let context, phase = "prepare";
  const apiFor = (invocationId, serviceCallId) => ({ ...host, call: (operation, input, refs = []) => host.call(operation, { invocationId, serviceCallId, input }, refs) });
  const runLife = async (method, next) => { phase = next; for (const value of runtimes.values()) if (typeof value?.[method] === "function") await value[method]({ ...context, signal: new AbortController().signal, api: apiFor() }); return { phase }; };
  return {
    "plugin.prepare": async input => {
      context = input;
      for (const entry of entries) { const module = await import(entry); modules.set(entry, module);
        runtimes.set(entry, typeof module.prepare === "function" ? await module.prepare(apiFor(), { ...context, signal: new AbortController().signal }) : module); }
      for (const tool of input.tools ?? []) {
        const runtime = runtimes.get(tool.entry), module = modules.get(tool.entry);
        if (typeof (runtime?.tools?.[tool.method] ?? runtime?.[tool.method] ?? module?.[tool.method]) !== "function") throw new Error("Plugin tool method unavailable during preparation: " + tool.method);
      }
      return { prepared: true };
    },
    "plugin.activate": () => runLife("activate", "active"),
    "plugin.drain": () => runLife("drain", "drain"),
    "plugin.dispose": async () => { for (const controller of calls.values()) controller.abort(new Error("Plugin disposed")); return runLife("dispose", "drain"); },
    "plugin.cancel": input => { calls.get(input.invocationId)?.abort(new Error("Plugin tool cancelled")); return { cancelled: true }; },
    "plugin.surface": async input => {
      if (phase !== "active") throw new Error("Plugin is not active");
      if (["prepare", "activate", "drain", "dispose"].includes(input.method)) throw new Error("Lifecycle methods are host-owned");
      for (const runtime of runtimes.values()) {
        const method = runtime?.methods?.[input.method] ?? runtime?.[input.method];
        if (typeof method !== "function") continue;
        const controller = new AbortController(); calls.set(input.callId, controller);
        try { return await method(input.input, { ...context, signal: controller.signal, api: apiFor(undefined, input.callId) }); }
        finally { calls.delete(input.callId); }
      }
      throw new Error("Plugin service method unavailable: " + input.method);
    },
    "plugin.invoke": async input => {
      if (phase !== "active") throw new Error("Plugin is not active");
      const runtime = runtimes.get(input.entry), module = modules.get(input.entry);
      const method = runtime?.tools?.[input.method] ?? runtime?.[input.method] ?? module?.[input.method];
      if (typeof method !== "function") throw new Error("Plugin tool method unavailable: " + input.method);
      const controller = new AbortController(); calls.set(input.invocationId, controller);
      try { return await method(input.args, { ...context, signal: controller.signal, invocationId: input.invocationId, api: apiFor(input.invocationId) }); }
      finally { calls.delete(input.invocationId); }
    }
  };
}
`;
}
