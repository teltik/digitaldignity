// Digital Dignity coverage checker
// Data: FCC National Broadband Map (BDC), June 30 2026 filing, H3 hexagons.
//   5G  = 5G-NR at 7/1 Mbps or better
//   LTE = 4G LTE at 5/1 Mbps or better
// coverage/us-{5g|lte}-{1|2|3}.bin : national overview cells (H3 res 5) by coverage share (1 light, 2 partial, 3 most)
// coverage/sXX.bin, coverage/sXX-lte.bin : per state cells (compacted, res 4 to 8), XX = state FIPS
// coverage/index.json : bounding box per state FIPS [minLat, minLng, maxLat, maxLng]
// Every .bin file is a list of uint64 H3 ids, little endian.
// Address suggestions: Photon (komoot). Fallback geocoder: OpenStreetMap Nominatim.
(function () {
  "use strict";

  var STATES = {Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",Delaware:"DE","District of Columbia":"DC",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY","Puerto Rico":"PR","United States Virgin Islands":"VI"};
  var C5G = "#0e6b63", CLTE = "#7fb9b1";
  var EMPTY = { type: "FeatureCollection", features: [] };

  var mapEl = document.getElementById("cov-map");
  if (!mapEl) return;
  var form = document.getElementById("cov-search");
  var input = document.getElementById("cov-q");
  var goBtn = document.getElementById("cov-go");
  var result = document.getElementById("cov-result");
  var loading = document.getElementById("cov-loading");

  var map, marker, before, stateIndex = null, stateCache = {}, pending = {}, drawToken = 0;

  // ---------- data ----------
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

  function getIndex() {
    if (stateIndex) return Promise.resolve(stateIndex);
    return fetch("coverage/index.json").then(function (r) { return r.json(); }).then(function (j) { stateIndex = j; return j; });
  }

  function prep(cells) {
    return { cells: cells, set: new Set(cells), centers: cells.map(function (c) { return h3.cellToLatLng(c); }) };
  }

  function loadState(fips) {
    if (stateCache[fips]) return Promise.resolve(stateCache[fips]);
    if (pending[fips]) return pending[fips];
    pending[fips] = Promise.all([load("coverage/s" + fips + ".bin"), load("coverage/s" + fips + "-lte.bin")]).then(function (r) {
      stateCache[fips] = { g5: prep(r[0]), lte: prep(r[1]) };
      delete pending[fips];
      return stateCache[fips];
    });
    return pending[fips];
  }

  // States whose coverage box touches a lat/lng box, with a margin.
  function statesIn(s, w, n, e, pad) {
    var out = [];
    for (var f in stateIndex) {
      var b = stateIndex[f];
      if (b[0] - pad <= n && b[2] + pad >= s && b[1] - pad <= e && b[3] + pad >= w) out.push(f);
    }
    return out;
  }

  function hit(layer, lat, lng) {
    for (var r = 8; r >= 4; r--) {
      if (layer.set.has(h3.latLngToCell(lat, lng, r))) return true;
    }
    return false;
  }

  // ---------- map ----------
  function toFeatures(cells, props, out) {
    out = out || [];
    for (var i = 0; i < cells.length; i++) {
      out.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [h3.cellToBoundary(cells[i], true)] } });
    }
    return out;
  }

  function addInView(layer, b, out, cap) {
    for (var i = 0; i < layer.cells.length && out.length < cap; i++) {
      var c = layer.centers[i];
      if (c[0] > b.getSouth() - 0.3 && c[0] < b.getNorth() + 0.3 && c[1] > b.getWest() - 0.3 && c[1] < b.getEast() + 0.3) out.push(layer.cells[i]);
    }
  }

  function setOverviewDim(dim) {
    map.setPaintProperty("overview-5g", "fill-opacity", ["*", dim, ["match", ["get", "l"], 1, 0.3, 2, 0.55, 0.75]]);
    map.setPaintProperty("overview-lte", "fill-opacity", ["*", dim, ["match", ["get", "l"], 1, 0.35, 2, 0.55, 0.7]]);
  }

  // Zoomed in: draw detailed cells for every state in view, across state lines.
  function refreshDetail() {
    if (!map || !map.getSource("detail-5g") || !stateIndex) return;
    var token = ++drawToken;
    if (map.getZoom() < 6.5) {
      map.getSource("detail-5g").setData(EMPTY);
      map.getSource("detail-lte").setData(EMPTY);
      setOverviewDim(1);
      return;
    }
    var b = map.getBounds();
    var list = statesIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), 0.5);
    Promise.all(list.map(loadState)).then(function (sts) {
      if (token !== drawToken) return;
      var g5 = [], lte = [];
      sts.forEach(function (st) { addInView(st.g5, b, g5, 30000); addInView(st.lte, b, lte, 30000); });
      map.getSource("detail-5g").setData({ type: "FeatureCollection", features: toFeatures(g5, {}) });
      map.getSource("detail-lte").setData({ type: "FeatureCollection", features: toFeatures(lte, {}) });
      setOverviewDim(0.15);
    });
  }

  function loadOverview(kind) {
    return Promise.all([1, 2, 3].map(function (l) { return load("coverage/us-" + kind + "-" + l + ".bin"); })).then(function (lv) {
      var feats = [];
      lv.forEach(function (cells, i) { toFeatures(cells, { l: i + 1 }, feats); });
      return { type: "FeatureCollection", features: feats };
    });
  }

  function addFill(id, color) {
    map.addSource(id, { type: "geojson", data: EMPTY });
    map.addLayer({ id: id, type: "fill", source: id, paint: { "fill-color": color, "fill-opacity": 0.6, "fill-antialias": false } }, before);
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
      attributionControl: { compact: true, customAttribution: "Coverage: FCC National Broadband Map · Search: Photon, Nominatim" }
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", function () {
      before = (map.getStyle().layers.find(function (l) { return l.type === "symbol"; }) || {}).id;
      addFill("overview-lte", CLTE);
      addFill("overview-5g", C5G);
      addFill("detail-lte", CLTE);
      addFill("detail-5g", C5G);
      Promise.all([loadOverview("lte"), loadOverview("5g"), getIndex()]).then(function (r) {
        map.getSource("overview-lte").setData(r[0]);
        map.getSource("overview-5g").setData(r[1]);
        setOverviewDim(1);
        refreshDetail();
        loading.hidden = true;
      }).catch(function () {
        loading.textContent = "The coverage map could not load. Try refreshing the page.";
      });
    });
    map.on("moveend", refreshDetail);
  }

  function start() {
    if (map || typeof maplibregl === "undefined" || typeof h3 === "undefined") return;
    initMap();
  }

  // ---------- address suggestions ----------
  var list = document.createElement("ul");
  list.className = "cov-suggest";
  list.id = "cov-suggest";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  form.appendChild(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", "cov-suggest");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  var suggestions = [], active = -1, picked = null, typeTimer = null, reqId = 0;

  // Mailing city the way people write it. New York City addresses use the borough
  // (Brooklyn, Bronx, Staten Island) or, in Queens, the neighborhood (Astoria, Flushing).
  function mailCity(city, borough, hood) {
    if (city === "New York" || city === "New York City" || city === "City of New York") {
      var b = (borough || "").replace(/^The /, "").replace(/ County$/, "");
      if (b === "Kings") b = "Brooklyn";
      if (b === "Richmond") b = "Staten Island";
      if (b === "Brooklyn" || b === "Bronx" || b === "Staten Island") return b;
      if (b === "Queens") return hood || "Queens";
      return "New York";
    }
    return city;
  }

  function photonLabel(p) {
    var line1 = [p.housenumber, p.street].filter(Boolean).join(" ") || p.name || "";
    var city = mailCity(p.city || p.town || p.village || "", p.district, p.locality) || p.county || "";
    var st = STATES[p.state] || p.state || "";
    var tail = [city, [st, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return { main: line1 || city, sub: line1 ? tail : [st, p.postcode].filter(Boolean).join(" "), state: STATES[p.state] || "" };
  }

  function fetchSuggestions(q) {
    var id = ++reqId;
    var url = "https://photon.komoot.io/api/?limit=8&lang=en&lat=39.8&lon=-98.6&q=" + encodeURIComponent(q);
    fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (id !== reqId) return;
      var seen = {};
      suggestions = (j.features || []).filter(function (f) {
        var p = f.properties || {};
        return (p.countrycode === "US" || p.countrycode === "PR" || p.countrycode === "VI") && STATES[p.state];
      }).map(function (f) {
        var l = photonLabel(f.properties);
        return { label: l, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], state: l.state, text: l.main + (l.sub ? ", " + l.sub : "") };
      }).filter(function (s) {
        if (seen[s.text]) return false;
        seen[s.text] = 1;
        return true;
      }).slice(0, 5);
      renderSuggestions();
    }).catch(function () {});
  }

  function renderSuggestions() {
    list.innerHTML = "";
    active = -1;
    suggestions.forEach(function (s, i) {
      var li = document.createElement("li");
      li.id = "cov-opt-" + i;
      li.setAttribute("role", "option");
      li.innerHTML = "<strong></strong><span></span>";
      li.firstChild.textContent = s.label.main;
      li.lastChild.textContent = s.label.sub;
      li.addEventListener("mousedown", function (e) { e.preventDefault(); choose(i); });
      list.appendChild(li);
    });
    var open = suggestions.length > 0 && document.activeElement === input;
    list.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function highlight(i) {
    active = i;
    [].forEach.call(list.children, function (li, k) { li.classList.toggle("on", k === i); });
    if (i >= 0) input.setAttribute("aria-activedescendant", "cov-opt-" + i);
    else input.removeAttribute("aria-activedescendant");
  }

  function closeList() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function choose(i) {
    var s = suggestions[i];
    if (!s) return;
    input.value = s.text;
    picked = s;
    closeList();
    check({ lat: s.lat, lng: s.lng, state: s.state, label: s.text });
  }

  input.addEventListener("input", function () {
    picked = null;
    var q = input.value.trim();
    clearTimeout(typeTimer);
    if (!map) start();
    if (q.length < 3) { suggestions = []; renderSuggestions(); return; }
    typeTimer = setTimeout(function () { fetchSuggestions(q); }, 220);
  });
  input.addEventListener("keydown", function (e) {
    if (list.hidden || !suggestions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); highlight((active + 1) % suggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight((active - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape") { closeList(); }
  });
  input.addEventListener("blur", function () { setTimeout(closeList, 120); });
  input.addEventListener("focus", function () { if (suggestions.length && !picked) renderSuggestions(); });

  // ---------- fallback geocoder ----------
  function nominatim(params) {
    var url = "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&addressdetails=1&limit=1&" + params;
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("geocode");
      return r.json();
    }).then(function (rows) {
      if (!rows.length) return null;
      var a = rows[0].address || {};
      var iso = a["ISO3166-2-lvl4"] || "";
      var st = iso.replace("US-", "");
      var line1 = [a.house_number, a.road].filter(Boolean).join(" ");
      var city = mailCity(a.city || a.town || a.village || a.hamlet || "", a.suburb || a.borough || a.city_district || a.county, a.neighbourhood || a.quarter) || a.county || "";
      var label = [line1, city, [st, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      return { lat: +rows[0].lat, lng: +rows[0].lon, label: label || rows[0].display_name.split(",").slice(0, 3).join(","), state: st };
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

  // ---------- result ----------
  function show(kind, html) {
    result.className = "cov-result " + kind;
    result.innerHTML = html;
    result.hidden = false;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; });
  }

  function check(place) {
    if (!map) start();
    goBtn.disabled = true;
    goBtn.textContent = "Checking";
    return getIndex().then(function () {
      if (!place.lat) throw new Error("notfound");
      // Check every state whose coverage reaches this point, so border addresses are handled.
      var list = statesIn(place.lat, place.lng, place.lat, place.lng, 0.3);
      var inUS = !place.state || Object.keys(STATES).some(function (k) { return STATES[k] === place.state; });
      if (!list.length && !inUS) throw new Error("outside");
      return Promise.all(list.map(loadState)).then(function (sts) {
        var g5 = sts.some(function (st) { return hit(st.g5, place.lat, place.lng); });
        var lte = !g5 && sts.some(function (st) { return hit(st.lte, place.lat, place.lng); });
        var where = escapeHtml(place.label);
        if (g5) {
          show("yes", "<div><strong>Good news. 5G home internet is available near " + where + ".</strong>We confirm your exact address before anything ships. <a href=\"#contact\" data-reason=\"join\">Become a member</a></div>");
        } else if (lte) {
          show("yes", "<div><strong>Good news. 4G LTE home internet is available near " + where + ".</strong>5G is not mapped there yet, but our 4G LTE routers work at this location. We confirm your exact address before anything ships. <a href=\"#contact\" data-reason=\"join\">Become a member</a></div>");
        } else {
          show("no", "<div><strong>We do not see coverage at " + where + " yet.</strong>Coverage changes often and the map is an estimate. <a href=\"#contact\">Send us your address</a> and we will check it for you.</div>");
        }
        var color = g5 ? C5G : lte ? "#3f8f86" : "#c77700";
        var go = function () {
          if (marker) marker.remove();
          marker = new maplibregl.Marker({ color: color }).setLngLat([place.lng, place.lat]).addTo(map);
          map.flyTo({ center: [place.lng, place.lat], zoom: 10.5, speed: 1.6 });
        };
        if (map.loaded()) go(); else map.once("load", go);
      });
    }).catch(function (err) {
      if (err.message === "notfound") show("err", "We could not find that address. Pick one of the suggestions, or add the city and state.");
      else if (err.message === "outside") show("err", "This checker covers addresses in the United States, Puerto Rico and the US Virgin Islands.");
      else show("err", "Something went wrong while checking. Please try again in a moment.");
    }).finally(function () {
      goBtn.disabled = false;
      goBtn.textContent = "Check coverage";
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) { show("err", "Type a street address or zip code to check coverage."); input.focus(); return; }
    closeList();
    if (picked && picked.text === q) { check({ lat: picked.lat, lng: picked.lng, state: picked.state, label: picked.text }); return; }
    if (active >= 0 && suggestions[active]) { choose(active); return; }
    goBtn.disabled = true;
    goBtn.textContent = "Checking";
    geocode(q).then(function (place) {
      check(place || {});
    }).catch(function () {
      show("err", "Something went wrong while checking. Please try again in a moment.");
      goBtn.disabled = false;
      goBtn.textContent = "Check coverage";
    });
  });

  // Start the map only when the section is near the screen.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) { io.disconnect(); start(); }
    }, { rootMargin: "400px" });
    io.observe(mapEl);
  } else {
    start();
  }
})();
