// Digital Dignity coverage checker
// Data: FCC National Broadband Map (BDC), June 30 2026 filing, H3 hexagons.
//   5G  = 5G-NR at 7/1 Mbps or better
//   LTE = 4G LTE at 5/1 Mbps or better
// coverage/us-{5g|lte}-{1|2|3}.bin : national overview cells (H3 res 5) by coverage share (1 light, 2 partial, 3 most)
// coverage/sXX.bin, coverage/sXX-lte.bin : per state cells (compacted, res 4 to 8), XX = state FIPS
// Every file is a list of uint64 H3 ids, little endian.
(function () {
  "use strict";

  var STATE_FIPS = {AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56",PR:"72",VI:"78"};
  var C5G = "#0e6b63", CLTE = "#7fb9b1";
  var EMPTY = { type: "FeatureCollection", features: [] };

  var mapEl = document.getElementById("cov-map");
  if (!mapEl) return;
  var form = document.getElementById("cov-search");
  var input = document.getElementById("cov-q");
  var goBtn = document.getElementById("cov-go");
  var result = document.getElementById("cov-result");
  var loading = document.getElementById("cov-loading");

  var map, marker, stateCache = {}, currentState = null, before;

  function readCells(buf) {
    var dv = new DataView(buf), out = [];
    for (var i = 0; i + 8 <= buf.byteLength; i += 8) {
      var lo = dv.getUint32(i, true), hi = dv.getUint32(i + 4, true);
      out.push(hi.toString(16) + lo.toString(16).padStart(8, "0"));
    }
    return out;
  }

  // Missing file means no coverage there, not an error.
  function load(path) {
    return fetch(path).then(function (r) {
      if (r.status === 404) return new ArrayBuffer(0);
      if (!r.ok) throw new Error("load");
      return r.arrayBuffer();
    }).then(readCells);
  }

  function toFeatures(cells, props, out) {
    out = out || [];
    for (var i = 0; i < cells.length; i++) {
      out.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [h3.cellToBoundary(cells[i], true)] } });
    }
    return out;
  }

  function show(kind, html) {
    result.className = "cov-result " + kind;
    result.innerHTML = html;
    result.hidden = false;
  }

  function prep(cells) {
    return { cells: cells, set: new Set(cells), centers: cells.map(function (c) { return h3.cellToLatLng(c); }) };
  }

  function loadState(fips) {
    if (stateCache[fips]) return Promise.resolve(stateCache[fips]);
    return Promise.all([load("coverage/s" + fips + ".bin"), load("coverage/s" + fips + "-lte.bin")]).then(function (r) {
      stateCache[fips] = { g5: prep(r[0]), lte: prep(r[1]) };
      return stateCache[fips];
    });
  }

  function hit(layer, lat, lng) {
    for (var r = 8; r >= 4; r--) {
      if (layer.set.has(h3.latLngToCell(lat, lng, r))) return true;
    }
    return false;
  }

  function inView(layer, b) {
    var pick = [];
    for (var i = 0; i < layer.cells.length && pick.length < 20000; i++) {
      var c = layer.centers[i];
      if (c[0] > b.getSouth() - 0.3 && c[0] < b.getNorth() + 0.3 && c[1] > b.getWest() - 0.3 && c[1] < b.getEast() + 0.3) pick.push(layer.cells[i]);
    }
    return pick;
  }

  // Detailed cells for the searched state replace the overview once zoomed in.
  function refreshDetail() {
    if (!map || !map.getSource("detail-5g")) return;
    var st = currentState && stateCache[currentState];
    var close = map.getZoom() >= 6.5 && st;
    map.getSource("detail-5g").setData(close ? { type: "FeatureCollection", features: toFeatures(inView(st.g5, map.getBounds()), {}) } : EMPTY);
    map.getSource("detail-lte").setData(close ? { type: "FeatureCollection", features: toFeatures(inView(st.lte, map.getBounds()), {}) } : EMPTY);
    var dim = close ? 0.15 : 1;
    map.setPaintProperty("overview-5g", "fill-opacity", ["*", dim, ["match", ["get", "l"], 1, 0.3, 2, 0.55, 0.75]]);
    map.setPaintProperty("overview-lte", "fill-opacity", ["*", dim, ["match", ["get", "l"], 1, 0.35, 2, 0.55, 0.7]]);
  }

  function loadOverview(kind) {
    return Promise.all([1, 2, 3].map(function (l) { return load("coverage/us-" + kind + "-" + l + ".bin"); })).then(function (lv) {
      var feats = [];
      lv.forEach(function (cells, i) { toFeatures(cells, { l: i + 1 }, feats); });
      return { type: "FeatureCollection", features: feats };
    });
  }

  function addFill(id, color, opacity) {
    map.addSource(id, { type: "geojson", data: EMPTY });
    map.addLayer({ id: id, type: "fill", source: id, paint: { "fill-color": color, "fill-opacity": opacity, "fill-antialias": false } }, before);
  }

  function initMap() {
    map = new maplibregl.Map({
      container: mapEl,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-96.5, 38.6],
      zoom: 3.2,
      minZoom: 2.5,
      maxZoom: 13,
      cooperativeGestures: true,
      attributionControl: { compact: true, customAttribution: "Coverage: FCC National Broadband Map" }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", function () {
      before = (map.getStyle().layers.find(function (l) { return l.type === "symbol"; }) || {}).id;
      addFill("overview-lte", CLTE, 0.6);
      addFill("overview-5g", C5G, 0.6);
      addFill("detail-lte", CLTE, 0.6);
      addFill("detail-5g", C5G, 0.6);
      Promise.all([loadOverview("lte"), loadOverview("5g")]).then(function (r) {
        map.getSource("overview-lte").setData(r[0]);
        map.getSource("overview-5g").setData(r[1]);
        refreshDetail();
        loading.hidden = true;
      }).catch(function () {
        loading.textContent = "The coverage map could not load. Try refreshing the page.";
      });
    });
    map.on("moveend", refreshDetail);
  }

  function nominatim(params) {
    var url = "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&addressdetails=1&limit=1&" + params;
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("geocode");
      return r.json();
    }).then(function (rows) {
      if (!rows.length) return null;
      var a = rows[0].address || {};
      var iso = a["ISO3166-2-lvl4"] || "";
      return { lat: +rows[0].lat, lng: +rows[0].lon, label: rows[0].display_name, state: iso.replace("US-", "") };
    });
  }

  // Try the full text first, then the zip code alone, then the text without the zip.
  function geocode(q) {
    var zip = (q.match(/\b(\d{5})(?:-\d{4})?\b/) || [])[1];
    var tries = ["q=" + encodeURIComponent(q)];
    if (zip) {
      tries.push("postalcode=" + zip);
      var rest = q.replace(/\b\d{5}(?:-\d{4})?\b/, "").replace(/[\s,]+$/, "").trim();
      if (rest) tries.push("q=" + encodeURIComponent(rest));
    }
    var i = 0;
    function next() {
      if (i >= tries.length) return Promise.resolve(null);
      return nominatim(tries[i++]).then(function (place) { return place || next(); });
    }
    return next();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) { show("err", "Type a street address or zip code to check coverage."); input.focus(); return; }
    if (!map) start();
    goBtn.disabled = true;
    goBtn.textContent = "Checking";
    geocode(q).then(function (place) {
      if (!place) throw new Error("notfound");
      var fips = STATE_FIPS[place.state];
      if (!fips) throw new Error("outside");
      return loadState(fips).then(function (st) {
        currentState = fips;
        var g5 = hit(st.g5, place.lat, place.lng);
        var lte = !g5 && hit(st.lte, place.lat, place.lng);
        var where = escapeHtml(place.label.split(",").slice(0, 3).join(","));
        if (g5) {
          show("yes", "<div><strong>Good news. 5G home internet is available near " + where + ".</strong>We confirm your exact address before anything ships. <a href=\"#contact\">Get started</a></div>");
        } else if (lte) {
          show("yes", "<div><strong>Good news. 4G LTE home internet is available near " + where + ".</strong>5G is not mapped there yet, but our 4G LTE routers work at this location. We confirm your exact address before anything ships. <a href=\"#contact\">Get started</a></div>");
        } else {
          show("no", "<div><strong>We do not see coverage at " + where + " yet.</strong>Coverage changes often and the map is an estimate. <a href=\"#contact\">Send us your address</a> and we will check it for you.</div>");
        }
        var color = g5 ? C5G : lte ? "#3f8f86" : "#c77700";
        if (marker) marker.remove();
        marker = new maplibregl.Marker({ color: color }).setLngLat([place.lng, place.lat]).addTo(map);
        map.flyTo({ center: [place.lng, place.lat], zoom: 11, speed: 1.6 });
      });
    }).catch(function (err) {
      if (err.message === "notfound") show("err", "We could not find that address. Try adding the city and state, or use a zip code.");
      else if (err.message === "outside") show("err", "This checker covers addresses in the United States, Puerto Rico and the US Virgin Islands.");
      else show("err", "Something went wrong while checking. Please try again in a moment.");
    }).finally(function () {
      goBtn.disabled = false;
      goBtn.textContent = "Check coverage";
    });
  });

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
  }

  // Start the map only when the section is near the screen.
  function start() {
    if (map || typeof maplibregl === "undefined" || typeof h3 === "undefined") return;
    initMap();
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { io.disconnect(); start(); }
    }, { rootMargin: "400px" });
    io.observe(mapEl);
  } else {
    start();
  }
})();
