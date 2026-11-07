/* global chrome */
// KOI//OS Cart: opens each product page on the distributor site in one tab and adds it
// to the cart, using the browser's own login for that site. Nothing is sent anywhere else.

const ALLOWED_HOSTS = [
  "pacificsmoke.com",
  "valordistributions.com",
  "nimbusdistro.ca",
  "globe11.com",
  "gcorecanada.com",
];

function allowed(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    return u.protocol === "https:" && ALLOWED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

function waitForLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Runs inside the distributor's product page. Must be self-contained.
async function addToCart(platform, qty, linkUrl) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const looksLoggedOut = () =>
    /customer\/account\/login|my-account|account\/login/i.test(location.pathname) ||
    !!document.querySelector('form[action*="account/login"] input[type="password"], form.woocommerce-form-login');

  try {
    if (looksLoggedOut()) return { ok: false, message: "Not logged in on this site" };

    if (platform === "shopify") {
      // Use the saved link, not the current address: some sites redirect to another stamp's page.
      const link = new URL(linkUrl, location.href);
      let id = link.searchParams.get("variant");
      if (!id) {
        const handle = link.pathname.match(/\/products\/([^/?#]+)/)?.[1];
        if (handle) {
          const res = await fetch(`/products/${handle}.js`, { headers: { Accept: "application/json" } });
          if (res.ok) {
            const p = await res.json();
            if (p.variants.length > 1) return { ok: false, message: "Link a single flavour (URL with ?variant=…)" };
            id = p.variants[0]?.id;
          }
        }
      }
      if (!id) return { ok: false, message: "No product on this page" };
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ items: [{ id: Number(id), quantity: qty }] }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { ok: false, message: err.description || err.message || `Cart refused (${res.status})` };
      }
      return { ok: true };
    }

    // Don't add whatever page we were redirected to (e.g. the other stamp's version).
    const trim = (x) => x.replace(/\/+$/, "");
    if (trim(new URL(linkUrl, location.href).pathname) !== trim(location.pathname)) {
      return { ok: false, message: "The site opened a different page than the saved link. Check this item." };
    }

    const form =
      platform === "magento"
        ? document.querySelector("#product_addtocart_form")
        : platform === "woocommerce"
          ? document.querySelector("form.cart")
          : document.querySelector('#product_addtocart_form, form.cart, form[action*="/cart/add"], form[action*="cart"]');
    if (!form) return { ok: false, message: "No add-to-cart on this page (logged in? out of stock?)" };

    const options = [...form.querySelectorAll("select")].filter((s) => s.required || /super_attribute|attribute_/.test(s.name));
    if (options.some((s) => !s.value)) return { ok: false, message: "This page needs a flavour picked. Link the single-flavour page." };

    const q = form.querySelector('input[name="qty"], input[name="quantity"], input.qty');
    if (q) {
      q.value = String(qty);
      q.dispatchEvent(new Event("input", { bubbles: true }));
      q.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const btn = form.querySelector('#product-addtocart-button, .single_add_to_cart_button, button[name="add-to-cart"], button[type="submit"], input[type="submit"]');
    if (btn && (btn.disabled || btn.classList.contains("disabled"))) return { ok: false, message: "Out of stock or option not picked" };

    if (platform === "magento" || platform === "woocommerce") {
      // Post the page's own form in the background so the page doesn't navigate mid-run.
      const data = new FormData(form);
      if (platform === "woocommerce" && btn?.name === "add-to-cart" && btn.value) data.set("add-to-cart", btn.value);
      if (q) data.set(q.name || "qty", String(qty));
      const res = await fetch(form.action || location.href, { method: "POST", body: data, credentials: "include" });
      if (!res.ok) return { ok: false, message: `Site refused (${res.status})` };
      const html = await res.text();
      if (/class="[^"]*(woocommerce-error|message-error)/.test(html)) {
        const m = html.match(/(?:woocommerce-error|message-error)[^>]*>([\s\S]{0,300}?)</);
        return { ok: false, message: (m?.[1] || "Site showed an error").replace(/<[^>]+>/g, "").trim() };
      }
      return { ok: true };
    }

    if (!btn) return { ok: false, message: "No add-to-cart button" };
    btn.click();
    await sleep(3000);
    return { ok: true, message: "Clicked add to cart" };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
}

let running = false;

async function fillCart(job, reportTo) {
  const report = (m) => chrome.tabs.sendMessage(reportTo, m).catch(() => {});
  if (running) return report({ type: "DONE", key: job.key, error: "Another cart is still being filled. Wait for it to finish." });
  running = true;
  const results = [];
  let tab;
  try {
    for (let i = 0; i < job.lines.length; i++) {
      const line = job.lines[i];
      let result;
      if (!allowed(line.url)) {
        result = { ok: false, message: "Link isn't on a known distributor site" };
      } else if (!(Number.isInteger(line.qty) && line.qty > 0 && line.qty < 1000)) {
        result = { ok: false, message: "Bad quantity" };
      } else {
        tab = tab ? await chrome.tabs.update(tab.id, { url: line.url }) : await chrome.tabs.create({ url: line.url, active: false });
        await waitForLoad(tab.id);
        try {
          const [out] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: addToCart,
            args: [job.platform, line.qty, line.url],
          });
          result = out?.result ?? { ok: false, message: "No answer from the page" };
        } catch (e) {
          // The page reloading after a click lands here; the item usually went in.
          result = { ok: true, message: "Page reloaded after adding; check the cart" };
        }
      }
      results.push({ variantId: line.variantId, ...result });
      report({ type: "PROGRESS", key: job.key, done: i + 1, total: job.lines.length, variantId: line.variantId, ...result });
    }
    if (job.cartUrl && allowed(job.cartUrl)) {
      if (tab) await chrome.tabs.update(tab.id, { url: job.cartUrl, active: true });
      else await chrome.tabs.create({ url: job.cartUrl, active: true });
    }
    report({ type: "DONE", key: job.key, results });
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m?.type === "FILL_CART" && sender.tab?.id) fillCart(m.job, sender.tab.id);
});
