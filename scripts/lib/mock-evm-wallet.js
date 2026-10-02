/**
 * A stand-in browser extension wallet for `pnpm shot --init-script`: an
 * EIP-1193 provider announced through EIP-6963, the way Hana, MetaMask,
 * Rabby and Coinbase announce themselves. A real extension cannot run in
 * Playwright, so a refresh's wallet behaviour is simulated here.
 *
 * Behaviour is read from localStorage `__mock_wallet` (JSON), so one seed
 * drives the first load and the reload:
 *   name, rdns          what the wallet announces (default "Hana", xyz.hana.mock)
 *   address             the account it holds
 *   announceDelayMs     wait before announcing (a slow extension; default 0)
 *   lockedAfterReload   true: after the first load, eth_accounts answers []
 *                       (a locked extension) and signing is refused
 *   absent              true: nothing is ever announced (the extension is gone)
 *   absentAfterReload   true: after the first load nothing is announced
 *   respondDelayMs      wait before each RPC answer (a sleeping service worker)
 *
 * Authorization survives the reload in localStorage `__mock_wallet_authorized`,
 * like an extension's own record of connected sites.
 */
(() => {
  if (window !== window.top) return;
  let config = {};
  try {
    config = JSON.parse(localStorage.getItem("__mock_wallet") ?? "{}") ?? {};
  } catch {}
  const loads = Number(sessionStorage.getItem("__mock_wallet_loads") ?? "0") + 1;
  sessionStorage.setItem("__mock_wallet_loads", String(loads));
  const reloaded = loads > 1;
  if (config.absent || (reloaded && config.absentAfterReload)) return;
  const locked = reloaded && !!config.lockedAfterReload;
  const address = (config.address ?? "0x1111111111111111111111111111111111111111").toLowerCase();
  const name = config.name ?? "Hana";
  const rdns = config.rdns ?? "xyz.hana.mock";
  const authorized = () => localStorage.getItem("__mock_wallet_authorized") === "1";
  const listeners = {};
  let chainId = "0x2105";
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__mockWalletLog = [];

  const provider = {
    isMockWallet: true,
    async request({ method, params }) {
      window.__mockWalletLog.push(method);
      if (config.respondDelayMs) await wait(config.respondDelayMs);
      switch (method) {
        case "eth_accounts":
          return authorized() && !locked ? [address] : [];
        case "eth_requestAccounts":
          if (locked) throw Object.assign(new Error("Wallet is locked"), { code: 4001 });
          localStorage.setItem("__mock_wallet_authorized", "1");
          return [address];
        case "eth_chainId":
          return chainId;
        case "net_version":
          return String(parseInt(chainId, 16));
        case "wallet_switchEthereumChain":
          chainId = params?.[0]?.chainId ?? chainId;
          (listeners.chainChanged ?? []).forEach((fn) => fn(chainId));
          return null;
        case "wallet_requestPermissions":
          localStorage.setItem("__mock_wallet_authorized", "1");
          return [{ parentCapability: "eth_accounts" }];
        case "wallet_getPermissions":
          return authorized() ? [{ parentCapability: "eth_accounts" }] : [];
        case "wallet_revokePermissions":
          localStorage.removeItem("__mock_wallet_authorized");
          return null;
        case "personal_sign":
          if (locked) throw Object.assign(new Error("Wallet is locked"), { code: 4001 });
          throw Object.assign(new Error("The mock wallet does not sign"), { code: 4001 });
        default:
          throw Object.assign(new Error(`mock wallet: ${method} unsupported`), { code: 4200 });
      }
    },
    on(event, fn) {
      (listeners[event] ??= []).push(fn);
      return provider;
    },
    removeListener(event, fn) {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== fn);
      return provider;
    },
  };

  const icon =
    "data:image/svg+xml;base64," +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#888"/></svg>');
  const detail = Object.freeze({
    info: Object.freeze({ uuid: "00000000-0000-4000-8000-000000000001", name, icon, rdns }),
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  const start = () => {
    announce();
    window.addEventListener("eip6963:requestProvider", announce);
  };
  if (config.announceDelayMs) setTimeout(start, config.announceDelayMs);
  else start();
})();
