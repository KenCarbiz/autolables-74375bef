// Synthetic dealer pages for the proposed price-stack reader. The markup
// follows common dealer-platform structures (a detail page with a pricing
// sidebar, a spec table and a similar-vehicle carousel; an inventory list that
// prints the VIN under the price; separate mobile and desktop copies of one
// widget). VINs, stock numbers, labels and amounts are made up.

export type Row = [string, string];

export const TARGET_VIN = "5XTEST0000000A001";
export const OTHER_VIN = "5XTEST0000000C003";
export const OTHER_VIN_2 = "5XTEST0000000D004";
export const DEALER_LABEL = "Northgate Price";

export const stack = (rows: Row[], footnote = "") => `
  <div class="price-stack">
    <ul class="price-lines">
      ${rows.map(([l, v]) => `<li class="price-line"><span class="label">${l}</span> <span class="value">${v}</span></li>`).join("\n      ")}
    </ul>
    ${footnote ? `<p class="price-disclaimer"><small>${footnote}</small></p>` : ""}
  </div>`;

const card = (vin: string, rows: Row[]) => `
      <div class="vehicle-card" data-vin="${vin}">
        <a class="title" href="/viewdetails/new/${vin.toLowerCase()}/2027-suv">2027 Example SUV</a>
        ${stack(rows)}
      </div>`;

const shell = (main: string, footer: string, vin = TARGET_VIN) => `<!doctype html>
<html><head>
  <title>2027 Example SUV | Example Motors</title>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Car","vehicleIdentificationNumber":"${vin}","offers":{"@type":"Offer","price":"0"}}</script>
  <style>.d-none{display:none}</style>
</head><body>
  <header class="site-header"><nav><a href="/new">New Inventory</a> <a href="/used">Used Inventory</a> <a href="/specials">Specials</a></nav></header>
  ${main}
  <footer class="site-footer"><div class="disclaimer"><p>${footer}</p></div><p>Example Motors, 1 Example Way</p></footer>
</body></html>`;

export const vdpPage = (widget: string, footer: string) => shell(`
  <main class="vdp">
    <div class="vdp-title"><h1>2027 Example SUV Luxe</h1><span class="stock">Stock: T0001</span></div>
    <div class="vdp-content">
      <div class="gallery"><img src="/img/1.jpg" alt="Front"></div>
      <aside class="vdp-pricing">${widget}</aside>
      <table class="specs">
        <tr><td>VIN</td><td>${TARGET_VIN}</td></tr>
        <tr><td>Stock</td><td>T0001</td></tr>
        <tr><td>Exterior</td><td>Black</td></tr>
      </table>
    </div>
    <section class="similar-vehicles"><h2>Similar Vehicles</h2>${card(OTHER_VIN, [
      ["MSRP", "$52,000"], ["Dealer Discount", "-$2,000"], [DEALER_LABEL, "$50,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$50,895"],
    ])}
    </section>
  </main>`, footer);

// Each card prints its VIN BELOW its price, so the next card's stack sits
// between this VIN and the next one in the text.
const srpCard = (vin: string, rows: Row[]) => `
    <div class="srp-card">
      <h3>2027 Example SUV</h3>
      ${stack(rows)}
      <div class="srp-meta"><span>VIN: ${vin}</span> <span>Stock: T${vin.slice(-4)}</span></div>
    </div>`;
export const SRP_VIN_BELOW_PRICE = shell(`
  <main class="srp">
    <div class="srp-list">
      ${srpCard(OTHER_VIN, [[DEALER_LABEL, "$50,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$50,895"]])}
      ${srpCard(OTHER_VIN_2, [[DEALER_LABEL, "$40,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$40,895"]])}
    </div>
  </main>`, "Prices subject to change.", OTHER_VIN);

export const duplicateWidgetsPage = (mobile: string, desktop: string) => shell(`
  <main class="vdp">
    <div class="vdp-content">
      <div class="d-md-none mobile-pricing">${mobile}</div>
      <div class="d-none d-md-block desktop-pricing">${desktop}</div>
      <table class="specs"><tr><td>VIN</td><td>${TARGET_VIN}</td></tr></table>
    </div>
  </main>`, "Prices subject to change.");

export const usedPageSinglePrice = shell(`
  <main class="vdp">
    <div class="vdp-content">
      <div class="vdp-pricing"><div class="price"><span class="label">Selling Price</span> <span class="value">$24,500</span></div></div>
      <table class="specs"><tr><td>VIN</td><td>${TARGET_VIN}</td></tr></table>
    </div>
  </main>`, "Prices subject to change.");

export const usedPageWithFee = shell(`
  <main class="vdp">
    <div class="vdp-content">
      <div class="vdp-pricing">${stack([["Internet Price", "$24,500"], ["Conveyance Fee", "+$895"]])}</div>
      <table class="specs"><tr><td>VIN</td><td>${TARGET_VIN}</td></tr></table>
    </div>
  </main>`, "Prices subject to change.");

export const cpoPage = shell(`
  <main class="srp">
    <div class="vehicle-card certified" data-vin="${TARGET_VIN}">
      <a class="title">2024 Example SUV Certified Pre-Owned</a>
      ${stack([[DEALER_LABEL, "$42,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$42,895"]])}
    </div>
  </main>`, "Prices subject to change.");
