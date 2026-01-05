import { chromium } from "playwright";

/* =========================
   queryString → object (SAFE)
========================= */
function queryStringToObject(str) {
  if (!str || typeof str !== "string") return {};

  const obj = {};
  str.split("&").forEach(pair => {
    if (!pair || !pair.includes("=")) return;
    const [k, v] = pair.split("=");
    if (!k) return;
    obj[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return obj;
}

/* =========================
   pick helper (ep_ / ep.)
========================= */
function pick(payload, keys) {
  for (const k of keys) {
    if (payload[k] != null) return payload[k];
  }
  return null;
}

/* =========================
   unique selector
========================= */
function getTrulyUniqueSelector(el) {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();

  const isUnique = sel => {
    try {
      return doc.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };

  if (el.id) {
    const s = `#${CSS.escape(el.id)}`;
    if (isUnique(s)) return s;
  }

  if (el.classList.length) {
    const cls = [...el.classList].map(c => `.${CSS.escape(c)}`).join("");
    const s = `${tag}${cls}`;
    if (isUnique(s)) return s;
  }

  let i = 1;
  let sib = el;
  while ((sib = sib.previousElementSibling)) {
    if (sib.tagName === el.tagName) i++;
  }

  return `${tag}:nth-of-type(${i})`;
}

/* =========================
   GA4 click_event 기다리기
========================= */
function waitForClickEvent(collectedClicks, timeout = 6000) {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      if (collectedClicks.length > 0) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve([...collectedClicks]);
      }
    }, 100);

    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve([]);
    }, timeout);
  });
}

/* =========================
   main
========================= */
export async function analyzePage(url) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const collectedClicks = [];
  const results = [];

  /* =========================
     GA4 request listener
  ========================= */
  page.on("request", req => {
    const reqUrl = req.url();
    if (!reqUrl.includes("google-analytics.com")) return;
    if (!reqUrl.includes("collect")) return;

    try {
      const postData = req.postData();
      let payload = {};

      const urlQuery = reqUrl.split("?")[1];
      if (urlQuery) {
        Object.assign(payload, queryStringToObject(urlQuery));
      }

      if (postData && typeof postData === "string") {
        Object.assign(payload, queryStringToObject(postData));
      }

      if (
        payload.en !== "click_event" &&
        payload.event_name !== "click_event"
      ) return;

      collectedClicks.push({
        time: Date.now(),
        clickData: {
          ep_click_page: pick(payload, [
            "ep.ep_click_page",
            "ep.click_page",
            "ep_click_page"
          ]),
          ep_click_area: pick(payload, [
            "ep.ep_click_area",
            "ep.click_area",
            "ep_click_area"
          ]),
          ep_click_label: pick(payload, [
            "ep.ep_click_label",
            "ep.click_label",
            "ep_click_label"
          ])
        }
      });

      console.log("📡 GA4 click_event", payload);
    } catch {
      // ignore
    }
  });

  /* =========================
     page load
  ========================= */
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  /* =========================
     elements
  ========================= */
  const elements = await page.$$(
    `
    button,
    a,
    [role="button"],
    [event_name],
    [class*="button"]
  `
  );

  console.log("\n==============================");
  console.log("버튼 클릭 GA4 분석 결과");
  console.log("==============================\n");

  for (const el of elements) {
    if (!(await el.isVisible())) continue;

    const selector = await el.evaluate(getTrulyUniqueSelector);
    if (!selector) continue;


    collectedClicks.length = 0;

    try {
      await el.scrollIntoViewIfNeeded();
      await el.click({ force: true });
    } catch {
    }

    const related = await waitForClickEvent(collectedClicks, 6000);

    console.log(`🔘 ${selector}`);

    if (related.length === 0) {
      // console.log("click_event 없음\n");
    } else {
      related.forEach(r => {
        // console.log("click_event");
        // console.log("    ep_click_page :", r.clickData.ep_click_page);
        // console.log("    ep_click_area :", r.clickData.ep_click_area);
        // console.log("    ep_click_label:", r.clickData.ep_click_label);
        // console.log("");
      });
    }

    results.push({
      selector,
      hasClickEvent: related.length > 0,
      events: related.map(r => r.clickData)
    });
  }

  await browser.close();

  /* =========================
     JSON 반환
  ========================= */
  return {
    url,
    analyzedAt: new Date().toISOString(),
    buttonCount: results.length,
    buttons: results
  };
}
