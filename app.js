/*
 * GIS Viktorīna – game logic.
 *
 * Two roles:
 *   host   – the moderator (usually on the projector). Their browser IS the room:
 *            it keeps every player's answers and sends the current state to all players.
 *            The moderator screen never shows the correct answer before the reveal.
 *   player – joins the room by code; a question opens when the moderator picks it.
 *
 * Round flow:  board -> question (players answer once) -> reveal (answer chart for
 * everyone, correct option highlighted) -> board ...
 * The reveal starts when every connected player has answered, or when the moderator
 * presses "Rādīt rezultātus". Money is only added at the reveal, so nobody can tell
 * early who was right.
 *
 * Moderator and players share the room through Firebase Realtime Database
 * (settings in firebase-config.js).
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LETTERS = "ABCDEFGH";
  const PASSWORD = "0102";   // casual lock only – visible in the page source
  const ROOM_CODE = "LBTU";  // the room always uses this code
  const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  // ?slot=x keeps a separate saved state per tab (handy for testing several players in one browser)
  const SLOT = new URLSearchParams(location.search).get("slot") || "";
  const key = (name) => "gis-" + name + (SLOT ? "-" + SLOT : "") + "-v" + QUESTIONS_VERSION;
  const store = {
    get(name) { try { return JSON.parse(localStorage.getItem(key(name))); } catch (e) { return null; } },
    set(name, v) { try { localStorage.setItem(key(name), JSON.stringify(v)); } catch (e) {} },
    del(name) { try { localStorage.removeItem(key(name)); } catch (e) {} },
  };

  // ---- questions ----
  const byId = {};
  CATEGORIES.forEach((cat, c) =>
    cat.questions.forEach((q, i) => { byId[c + "-" + i] = { ...q, cat: cat.title, level: i }; })
  );
  const TOTAL = Object.keys(byId).length;
  const euro = (n) => n + " €";

  // ---- small DOM helpers ----
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }
  function lockScroll(on) { document.body.style.overflow = on ? "hidden" : ""; }
  function randomId(n) {
    let s = "";
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    for (let i = 0; i < n; i++) s += ID_CHARS[a[i] % ID_CHARS.length];
    return s;
  }

  // ---- password dialog ----
  let pwHandler = null;
  function askPassword({ title, text, ok, danger, onOk }) {
    $("pwTitle").textContent = title;
    $("pwText").textContent = text;
    $("pwOk").textContent = ok;
    $("pwOk").classList.toggle("danger", !!danger);
    $("pwInput").value = "";
    $("pwErr").textContent = "";
    pwHandler = onOk;
    $("pw").classList.add("show");
    lockScroll(true);
    $("pwInput").focus();
  }
  function closePw() {
    $("pw").classList.remove("show");
    pwHandler = null;
    if (!anyOverlayOpen()) lockScroll(false);
  }
  $("pwCancel").addEventListener("click", closePw);
  $("pwForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("pwInput").value !== PASSWORD) {
      $("pwErr").textContent = "Nepareiza parole.";
      $("pwInput").value = "";
      $("pwInput").focus();
      return;
    }
    const h = pwHandler;
    closePw();
    if (h) h();
  });
  function anyOverlayOpen() {
    return ["question", "result", "pw"].some((id) => $(id).classList.contains("show"));
  }

  // ======================================================================
  //  Shared rendering
  // ======================================================================
  let mode = null; // 'host' | 'player'

  function amountEl(points) {
    const s = el("span", "amount", points + " ");
    s.appendChild(el("small", null, "€"));
    return s;
  }

  // tileInfo(id) -> { kind: 'open'|'done', mark, symbol, word, live }
  function renderBoard(tileInfo, onPick) {
    const board = $("board");
    board.innerHTML = "";
    CATEGORIES.forEach((cat, c) => {
      const col = el("section", "col");
      const h = el("h2", "cat");
      h.appendChild(el("span", cat.short ? "t-long" : null, cat.title));
      if (cat.short) h.appendChild(el("span", "t-short", cat.short));
      col.appendChild(h);
      cat.questions.forEach((q, row) => {
        const id = c + "-" + row;
        const info = tileInfo(id);
        let t;
        if (info.kind === "done") {
          t = el("div", "tile done");
          t.appendChild(amountEl(q.points));
          const m = el("span", "mark " + info.mark, info.symbol);
          m.appendChild(el("span", "word", " " + info.word));
          t.appendChild(m);
          t.setAttribute("role", "img");
          t.setAttribute("aria-label", `${cat.title}, ${euro(q.points)} – ${info.word.toLowerCase()}`);
        } else {
          t = el(info.clickable ? "button" : "div", "tile" + (info.live ? " live" : ""));
          if (info.clickable) {
            t.type = "button";
            t.addEventListener("click", () => onPick(id));
          } else {
            t.setAttribute("role", "img");
          }
          t.appendChild(amountEl(q.points));
          const dots = el("span", "dots");
          dots.setAttribute("aria-hidden", "true");
          for (let k = 0; k < 5; k++) dots.appendChild(el("i", k <= row ? "on" : ""));
          t.appendChild(dots);
          t.setAttribute("aria-label", `${cat.title}, ${euro(q.points)}, grūtība ${row + 1} no 5`);
        }
        col.appendChild(t);
      });
      board.appendChild(col);
    });
  }

  function renderLeaderboard(rows) {
    const lb = $("lb");
    lb.innerHTML = "";
    rows.forEach((r, i) => {
      const li = el("li", r.me ? "me" : "");
      li.appendChild(el("span", "pos", String(i + 1)));
      const nm = el("span", "nm");
      const dot = el("i", r.online ? "" : "off");
      dot.title = r.online ? "Tiešsaistē" : "Nav savienots";
      nm.appendChild(dot);
      nm.appendChild(el("span", null, r.name + (r.me ? " (tu)" : "")));
      li.appendChild(nm);
      li.appendChild(el("span", "sc", euro(r.score)));
      lb.appendChild(li);
    });
    $("lbEmpty").hidden = rows.length > 0;
  }

  function renderPct(last) {
    $("pctPanel").hidden = !last;
    if (!last) return;
    const q = byId[last.qid];
    $("pctQ").textContent = q ? `${q.cat} · ${euro(q.points)}` : "";
    $("pctBig").textContent = last.pct == null ? "—" : last.pct + "%";
    $("pctBar").style.width = (last.pct || 0) + "%";
    $("pctSub").textContent = last.total
      ? `atbildēja pareizi (${last.correct} no ${last.total} istabā)`
      : "istabā nebija neviena spēlētāja";
  }

  // ---- Latvia map (for "put a point on the map" questions) ----
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const e = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }
  function project([lat, lon]) {
    return [(lon - LV_MAP.lon0) * LV_MAP.cos * LV_MAP.kx, (LV_MAP.lat0 - lat) * LV_MAP.kx];
  }
  function unproject(x, y) {
    return [LV_MAP.lat0 - y / LV_MAP.kx, LV_MAP.lon0 + x / (LV_MAP.cos * LV_MAP.kx)];
  }
  function distKm([la1, lo1], [la2, lo2]) {
    const r = Math.PI / 180, dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
    const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }
  function makeMapSvg() {
    const svg = svgEl("svg", { viewBox: `0 0 ${LV_MAP.w} ${LV_MAP.h}`, role: "img", "aria-label": "Latvijas karte" });
    svg.appendChild(svgEl("rect", { x: 0, y: 0, width: LV_MAP.w, height: LV_MAP.h, class: "lv-sea" }));
    svg.appendChild(svgEl("path", { d: LV_MAP.neighbors, class: "lv-nb" }));
    svg.appendChild(svgEl("path", { d: LV_MAP.latvia, class: "lv" }));
    return svg;
  }
  function mapDot(svg, point, cls, r) {
    const [x, y] = project(point);
    const c = svgEl("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: r || 9, class: "lv-dot " + cls });
    svg.appendChild(c);
    return c;
  }
  function svgPoint(svg, e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return unproject(p.x, p.y).map((v) => Math.round(v * 10000) / 10000);
  }
  // map for answering: tap to place a point, then confirm
  function buildMapInput(box, opts) {
    const wrap = el("div", "mapbox");
    const svg = makeMapSvg();
    wrap.appendChild(svg);
    box.appendChild(wrap);
    let point = opts.pickedPoint || null;
    let marker = null;
    const draw = () => { if (marker) marker.remove(); marker = point ? mapDot(svg, point, "mine", 11) : null; };
    draw();
    if (opts.interactive && !opts.pickedPoint) {
      wrap.classList.add("tappable");
      const btn = el("button", "btn solid map-confirm", "Apstiprināt atzīmi");
      btn.type = "button";
      btn.disabled = true;
      svg.addEventListener("click", (e) => { point = svgPoint(svg, e); draw(); btn.disabled = false; });
      btn.addEventListener("click", () => {
        if (!point) return;
        btn.disabled = true;
        wrap.classList.remove("tappable");
        svg.style.pointerEvents = "none";
        opts.onAnswer(point);
      });
      box.appendChild(btn);
    }
  }
  // map for the reveal: everyone's points, the target and the "correct" circle
  function renderMapReveal(box, qid, reveal, myPoint) {
    const q = byId[qid];
    const wrap = el("div", "mapbox");
    const svg = makeMapSvg();
    const [tx, ty] = project(q.target);
    svg.appendChild(svgEl("circle", { cx: tx, cy: ty, r: (q.radiusKm / 111.32) * LV_MAP.kx, class: "lv-zone" }));
    (reveal.points || []).forEach((pt) => mapDot(svg, pt.p, pt.c ? "ok" : "bad", 7));
    if (myPoint) mapDot(svg, myPoint, "mine", 11);
    const star = svgEl("path", {
      class: "lv-target",
      d: "M0,-16 L4.7,-6.5 L15.2,-4.9 L7.6,2.5 L9.4,12.9 L0,8 L-9.4,12.9 L-7.6,2.5 L-15.2,-4.9 L-4.7,-6.5Z",
      transform: `translate(${tx.toFixed(1)},${ty.toFixed(1)})`,
    });
    svg.appendChild(star);
    wrap.appendChild(svg);
    box.appendChild(wrap);
    const legend = el("div", "map-legend");
    legend.innerHTML = '<span><i class="k-target"></i></span><span><i class="k-ok"></i>pareizi</span><span><i class="k-bad"></i>garām</span>';
    legend.firstChild.appendChild(document.createTextNode(q.place));
    legend.children[1].appendChild(document.createTextNode(` (līdz ${q.radiusKm} km)`));
    box.appendChild(legend);
  }

  // answer distribution: one row per option, correct option highlighted
  function renderChart(box, qid, reveal, myChoice) {
    const q = byId[qid];
    box.innerHTML = "";
    if (q.type === "map") { renderMapReveal(box, qid, reveal, Array.isArray(myChoice) ? myChoice : null); return; }
    const max = Math.max(1, ...reveal.counts);
    q.options.forEach((text, i) => {
      const isCorrect = i === q.answer;
      const row = el("div", "bar-row" + (isCorrect ? " correct" : "") + (i === myChoice ? " mine" : ""));
      row.appendChild(el("span", "letter", LETTERS[i]));
      const txt = el("div", "txt");
      const lbl = el("div", "lbl");
      lbl.appendChild(el("span", null, text));
      const tags = [];
      if (isCorrect) tags.push("✓ PAREIZĀ");
      if (i === myChoice) tags.push("TAVA ATBILDE");
      if (tags.length) lbl.appendChild(el("em", null, tags.join(" · ")));
      txt.appendChild(lbl);
      const track = el("div", "track");
      const bar = el("b");
      bar.style.width = Math.round((reveal.counts[i] / max) * 100) + "%";
      track.appendChild(bar);
      txt.appendChild(track);
      row.appendChild(txt);
      row.appendChild(el("span", "num", String(reveal.counts[i])));
      row.setAttribute("aria-label", `${LETTERS[i]}. ${text}: ${reveal.counts[i]}${isCorrect ? ", pareizā atbilde" : ""}`);
      box.appendChild(row);
    });
  }

  function setConn(state, text) {
    $("conn").className = "conn " + (state || "");
    $("connText").textContent = text;
  }
  function sortRows(rows) {
    return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "lv"));
  }

  // ---- question overlay ----
  // opts: { interactive, onAnswer, picked, note, hostView, reveal }
  let shownQKey = null;
  function showQuestion(id, opts) {
    const q = byId[id];
    $("qCat").textContent = q.cat;
    $("qPts").textContent = euro(q.points);
    $("qText").textContent = q.q;
    const img = $("qImg");
    if (q.image) { img.src = q.image; img.alt = "Attēls jautājumam"; img.hidden = false; }
    else { img.hidden = true; img.removeAttribute("src"); }

    const optsBox = $("qOpts");
    optsBox.innerHTML = "";
    const isMap = q.type === "map";
    $("question").classList.toggle("is-map", isMap);
    const answered = opts.picked != null || !!opts.pickedPoint;
    if (isMap) buildMapInput(optsBox, opts);
    else q.options.forEach((text, i) => {
      const isBtn = !!opts.interactive;
      const b = el(isBtn ? "button" : "div", "opt");
      if (isBtn) {
        b.type = "button";
        if (answered) b.disabled = true;
        else {
          b.addEventListener("click", () => {
            optsBox.querySelectorAll("button").forEach((x) => { x.disabled = true; });
            b.classList.add("picked");
            opts.onAnswer(i);
          }, { once: true });
        }
      }
      if (i === opts.picked) b.classList.add("picked");
      b.appendChild(el("span", "letter", LETTERS[i]));
      b.appendChild(el("span", null, text));
      if (i === opts.picked) b.appendChild(el("span", "tag", "TAVA ATBILDE"));
      optsBox.appendChild(b);
    });

    const chart = $("qChart");
    if (opts.reveal) {
      optsBox.hidden = true;
      chart.hidden = false;
      renderChart(chart, id, opts.reveal, null);
    } else {
      optsBox.hidden = false;
      chart.hidden = true;
    }
    $("qHint").textContent =
      opts.reveal ? (isMap ? "KUR SPĒLĒTĀJI IELIKA PUNKTU" : "KĀ ATBILDĒJA SPĒLĒTĀJI") :
      opts.hostView ? (isMap ? "SPĒLĒTĀJI LIEK PUNKTU KARTĒ" : "ATBILŽU VARIANTI") :
      answered ? (isMap ? "TAVA ATZĪME PIEŅEMTA" : "TAVA ATBILDE PIEŅEMTA") :
      isMap ? "PIESKARIES KARTEI, LAI IELIKTU PUNKTU" : "IZVĒLIES VIENU ATBILDI";
    // at the reveal the moderator screen shows the explanation (if the question has one)
    const note = opts.reveal ? (q.explain || "") : (opts.note || "");
    $("qNote").textContent = note;
    $("qNote").hidden = !note;
    $("qNote").classList.toggle("q-explain", !!opts.reveal);
    $("hostBox").hidden = !opts.hostView;

    const wasOpen = $("question").classList.contains("show");
    $("question").classList.add("show");
    if (!wasOpen) $("question").scrollTop = 0;
    document.body.classList.add("q-open");
    lockScroll(true);
    if (opts.interactive && !answered && !isMap && optsBox.firstChild) optsBox.firstChild.focus({ preventScroll: true });
  }
  function hideQuestion() {
    shownQKey = null;
    $("question").classList.remove("show");
    document.body.classList.remove("q-open");
    if (!anyOverlayOpen()) lockScroll(false);
  }

  // ---- player result overlay (shown at the reveal) ----
  let shownResult = null;
  function showResult(id, a, reveal, sub) {
    const q = byId[id];
    shownResult = id;
    const box = $("result");
    const state = !a ? "neutral" : a.correct ? "correct" : "wrong";
    box.className = "overlay show " + state;
    $("rEyebrow").textContent = q.cat.toUpperCase();
    $("rTitle").textContent = !a ? "Tu neatbildēji" : a.correct ? "Pareizi!" : "Nepareizi!";
    $("rPoints").textContent = (a && a.correct ? "+" : "") + euro(q.points);
    $("rPoints").classList.toggle("missed", !(a && a.correct));
    $("rSub").textContent = sub;
    renderChart($("rChart"), id, reveal, a ? (a.point || a.choice) : null);
    $("rExplain").textContent = q.explain || "";
    box.scrollTop = 0;
    lockScroll(true);
  }
  function hideResult() {
    shownResult = null;
    $("result").className = "overlay";
    if (!anyOverlayOpen()) lockScroll(false);
  }

  // ---- image zoom ----
  $("qImg").addEventListener("click", () => {
    $("zoomImg").src = $("qImg").src;
    $("zoom").classList.add("show");
  });
  $("zoom").addEventListener("click", () => $("zoom").classList.remove("show"));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("zoom").classList.contains("show")) $("zoom").classList.remove("show");
    else if ($("pw").classList.contains("show")) closePw();
  });

  // ---- screens ----
  function showHome() {
    mode = null;
    store.del("mode");
    hideQuestion(); hideResult();
    $("game").hidden = true;
    $("home").hidden = false;
    lockScroll(false);
  }
  function showGame(m) {
    mode = m;
    $("home").hidden = true;
    $("game").hidden = false;
    $("statMoney").hidden = m === "host";
    $("resetBtn").hidden = m !== "host";
    $("modeLabel").textContent = m === "host" ? "MODERATORS · SPĒLES NAUDA" : "SPĒLĒTĀJS · SPĒLES NAUDA";
    $("progressLabel").textContent = m === "host" ? "SPĒLĒTĀJI" : "JAUTĀJUMI";
    $("roomCode").textContent = ROOM_CODE;
  }

  // ======================================================================
  //  Firebase Realtime Database (the room lives at rooms/<ROOM_CODE>)
  //
  //   host            { sid, at }            – which moderator tab has the room open
  //   players/<token> { name, online }       – written by each player
  //   answers/<round>/<token> { choice } | { point } – written once by each player
  //   public          { phase, current, used, last, gameId, board, closed } – written by moderator
  //   private/<token> { score, answers }     – each player's own money and answers, by moderator
  // ======================================================================
  function getDb() {
    if (typeof firebase === "undefined" || typeof FIREBASE_CONFIG === "undefined" || !FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL) return null;
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    return firebase.database();
  }
  const NO_DB = "Savienojuma serveris (Firebase) nav iestatīts. Pārbaudi failu firebase-config.js.";
  // Firebase drops empty objects and may return arrays as objects – normalise what we read back
  const obj = (v) => (v && typeof v === "object" ? v : {});
  const arr = (v) => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);
  function normLast(l) {
    if (!l) return null;
    return { ...l, counts: arr(l.counts), points: arr(l.points) };
  }
  function makeListeners() {
    const list = [];
    return {
      on(ref, ev, fn) { ref.on(ev, fn); list.push([ref, ev, fn]); },
      off() { list.splice(0).forEach(([ref, ev, fn]) => ref.off(ev, fn)); },
    };
  }

  // ======================================================================
  //  HOST (moderator)
  // ======================================================================
  const host = {
    hs: null,            // room state, also kept in localStorage
    room: null,          // Firebase ref rooms/<code>
    sid: randomId(10),   // this tab
    online: new Set(),   // tokens of connected players
    subs: makeListeners(),
    ansRef: null,
    ansFn: null,
    live: false,

    newState() {
      // players[token] = { name, answers: { qid: { choice | point, dist?, correct } } }
      return { code: ROOM_CODE, gameId: randomId(6), phase: "board", current: null, used: {}, players: {}, last: null };
    },
    save() { store.set("host", host.hs); },
    roundKey(qid) { return host.hs.gameId + "_" + qid; },

    open() {
      const saved = store.get("host");
      // keep an unfinished game (same code) so a moderator can continue after closing the tab
      host.hs = saved && saved.code === ROOM_CODE && saved.players && saved.gameId ? saved : host.newState();
      if (!host.hs.used) host.hs.used = {};
      host.save();
      store.set("mode", { mode: "host" });
      host.start();
    },
    start() {
      showGame("host");
      host.connect();
      host.renderAll();
      host.syncOverlay();
    },

    connect() {
      host.subs.off();
      host.stopAnswers();
      const db = getDb();
      if (!db) { setConn("bad", NO_DB); return; }
      setConn("", "Atver istabu…");
      host.room = db.ref("rooms/" + ROOM_CODE);
      host.live = true;
      host.subs.on(db.ref(".info/connected"), "value", (s) => {
        if (s.val() !== true) { setConn("", "Savienojas ar serveri…"); return; }
        const hRef = host.room.child("host");
        hRef.onDisconnect().remove();
        hRef.set({ sid: host.sid, at: firebase.database.ServerValue.TIMESTAMP });
        setConn("ok", "Istaba atvērta");
        host.broadcast();
      });
      // another moderator tab/device took over the room
      host.subs.on(host.room.child("host"), "value", (s) => {
        const v = s.val();
        if (v && v.sid && v.sid !== host.sid && host.live) {
          host.live = false;
          host.subs.off();
          host.stopAnswers();
          setConn("bad", "Istaba tika atvērta citā ierīcē vai cilnē, tāpēc šeit tā ir apturēta. Pārlādē lapu, lai to atvērtu šeit.");
        }
      });
      host.subs.on(host.room.child("players"), "value", (s) => {
        const all = obj(s.val());
        host.online = new Set();
        Object.entries(all).forEach(([tk, p]) => {
          if (!p || typeof p !== "object") return;
          const name = String(p.name || "").trim().slice(0, 20) || "Spēlētājs";
          if (!host.hs.players[tk]) host.hs.players[tk] = { name, answers: {} };
          else host.hs.players[tk].name = name;
          if (p.online) host.online.add(tk);
        });
        host.save();
        if (!host.maybeAutoReveal()) host.broadcast();
      });
      host.listenAnswers();
    },

    // answers arrive only for the question that is open right now
    listenAnswers() {
      host.stopAnswers();
      const hs = host.hs;
      if (!host.room || !host.live || hs.phase !== "question" || !hs.current) return;
      host.ansRef = host.room.child("answers/" + host.roundKey(hs.current));
      host.ansFn = (s) => host.onAnswer(s.key, s.val());
      host.ansRef.on("child_added", host.ansFn);
    },
    stopAnswers() {
      if (host.ansRef && host.ansFn) host.ansRef.off("child_added", host.ansFn);
      host.ansRef = null;
      host.ansFn = null;
    },

    onlineTokens() { return new Set(host.online); },
    score(p) {
      // money counts only for revealed questions
      return Object.entries(obj(p.answers)).reduce(
        (s, [qid, a]) => s + (a.correct && host.hs.used[qid] && byId[qid] ? byId[qid].points : 0), 0);
    },

    onAnswer(token, d) {
      const hs = host.hs;
      const q = byId[hs.current];
      if (!d || typeof d !== "object" || !q || hs.phase !== "question") return;
      if (!hs.players[token]) hs.players[token] = { name: "Spēlētājs", answers: {} };
      const p = hs.players[token];
      if (p.answers[hs.current]) return; // one answer only
      if (q.type === "map") {
        const pt = arr(d.point).map(Number);
        if (pt.length !== 2 || !pt.every(Number.isFinite) || pt[0] < 54 || pt[0] > 59 || pt[1] < 19 || pt[1] > 30) return;
        const dist = Math.round(distKm(pt, q.target) * 10) / 10;
        p.answers[hs.current] = { point: pt, dist, correct: dist <= q.radiusKm };
      } else {
        const choice = Number(d.choice);
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
        p.answers[hs.current] = { choice, correct: choice === q.answer };
      }
      host.save();
      if (!host.maybeAutoReveal()) host.broadcast();
    },

    // reveal by itself once every connected player has answered
    maybeAutoReveal() {
      const hs = host.hs;
      if (hs.phase !== "question") return false;
      const online = [...host.online];
      if (!online.length) return false;
      if (online.every((tk) => hs.players[tk] && hs.players[tk].answers[hs.current])) {
        host.reveal();
        return true;
      }
      return false;
    },

    roundStats() {
      const hs = host.hs;
      const q = byId[hs.current];
      const counts = q && q.options ? q.options.map(() => 0) : [];
      const points = [];
      const inRoom = host.onlineTokens();
      let answered = 0, correct = 0;
      Object.entries(hs.players).forEach(([tk, p]) => {
        const a = hs.current && p.answers[hs.current];
        if (!a) return;
        answered++;
        inRoom.add(tk);
        if (a.point) points.push({ p: a.point, c: a.correct });
        else counts[a.choice] = (counts[a.choice] || 0) + 1;
        if (a.correct) correct++;
      });
      const total = inRoom.size;
      return { qid: hs.current, counts, points, answered, correct, total, pct: total ? Math.round((correct / total) * 100) : null };
    },

    leaderboard() {
      return sortRows(Object.entries(host.hs.players).map(([tk, p]) => ({
        k: tk, name: p.name, score: host.score(p), online: host.online.has(tk),
      })));
    },

    // write the shared state for all players in one update
    broadcast() {
      const hs = host.hs;
      if (host.room && host.live) {
        const upd = {
          public: {
            phase: hs.phase,
            current: hs.current || null,
            used: hs.used,
            last: hs.last || null,
            gameId: hs.gameId,
            board: host.leaderboard(),
            closed: false,
          },
        };
        Object.entries(hs.players).forEach(([tk, p]) => {
          // never tell a player whether the open question is right before the reveal
          const answers = {};
          Object.entries(p.answers).forEach(([qid, a]) => {
            if (hs.used[qid]) answers[qid] = a;
            else answers[qid] = a.point ? { point: a.point } : { choice: a.choice };
          });
          upd["private/" + tk] = { score: host.score(p), answers };
        });
        host.room.update(upd).catch((e) => setConn("bad", "Neizdevās nosūtīt datus: " + e.message));
      }
      host.renderAll();
    },

    renderAll() {
      const hs = host.hs;
      if (!hs || mode !== "host") return;
      renderBoard((id) => {
        if (hs.used[id] && hs.current !== id) return { kind: "done", mark: "neutral", symbol: "●", word: "IZSPĒLĒTS" };
        return { kind: "open", clickable: hs.phase === "board", live: hs.current === id };
      }, host.pick);
      $("progress").textContent = `${host.online.size} / ${Object.keys(hs.players).length}`;
      renderLeaderboard(host.leaderboard());
      renderPct(hs.last);
      $("statusText").textContent =
        hs.phase === "question" ? "Jautājums atvērts spēlētājiem." :
        hs.phase === "reveal" ? "Rāda rezultātus." :
        `Spēlētāji pievienojas ar kodu ${ROOM_CODE}. Izvēlies jautājumu – tas automātiski atvērsies visiem.`;
      if (hs.phase === "question") {
        const s = host.roundStats();
        $("liveAnswered").textContent = `${s.answered} / ${s.total}`;
      }
    },

    // keep the moderator's overlay in step with the phase
    syncOverlay() {
      const hs = host.hs;
      if (hs.phase === "question" && hs.current) {
        showQuestion(hs.current, { hostView: true });
        $("livePctBox").hidden = true;
        $("endQBtn").textContent = "Rādīt rezultātus";
        host.renderAll();
      } else if (hs.phase === "reveal" && hs.current && hs.last) {
        showQuestion(hs.current, { hostView: true, reveal: hs.last });
        $("liveAnswered").textContent = `${hs.last.answered} / ${hs.last.total}`;
        $("livePct").textContent = hs.last.pct == null ? "—" : hs.last.pct + "%";
        $("livePctBox").hidden = false;
        $("endQBtn").textContent = "Nākamais jautājums";
      } else {
        hideQuestion();
      }
    },

    pick(id) {
      const hs = host.hs;
      if (hs.phase !== "board" || hs.used[id]) return;
      hs.phase = "question";
      hs.current = id;
      host.save();
      host.broadcast();
      host.listenAnswers();
      host.syncOverlay();
    },
    reveal() {
      const hs = host.hs;
      if (hs.phase !== "question") return;
      host.stopAnswers();
      hs.last = host.roundStats();
      hs.used[hs.current] = true;
      hs.phase = "reveal";
      host.save();
      host.broadcast();
      host.syncOverlay();
    },
    next() {
      const hs = host.hs;
      if (hs.phase !== "reveal") return;
      hs.phase = "board";
      hs.current = null;
      host.save();
      host.broadcast();
      host.syncOverlay();
    },
    reset() {
      const hs = host.hs;
      host.stopAnswers();
      // players who are not connected right now are removed from the room
      Object.keys(hs.players).forEach((tk) => {
        if (host.online.has(tk)) { hs.players[tk].answers = {}; return; }
        delete hs.players[tk];
        if (host.room && host.live) {
          host.room.child("players/" + tk).remove().catch(() => {});
          host.room.child("private/" + tk).remove().catch(() => {});
        }
      });
      hs.gameId = randomId(6); // new answer slots, so everyone can answer again
      hs.used = {};
      hs.last = null;
      hs.phase = "board";
      hs.current = null;
      host.save();
      host.broadcast();
      host.syncOverlay();
    },
    leave() {
      if (host.room && host.live) {
        host.room.child("public/closed").set(true);
        host.room.child("host").remove();
      }
      host.live = false;
      host.subs.off();
      host.stopAnswers();
      host.hs = null;
      showHome();
    },
  };
  $("endQBtn").addEventListener("click", () => {
    if (!host.hs) return;
    if (host.hs.phase === "question") host.reveal();
    else if (host.hs.phase === "reveal") host.next();
  });

  // ======================================================================
  //  PLAYER
  // ======================================================================
  const player = {
    session: null,   // { name, token }
    room: null,
    subs: makeListeners(),
    pub: null,       // rooms/<code>/public
    priv: null,      // rooms/<code>/private/<token>
    st: null,        // combined state used for drawing
    joined: false,
    hostOnline: false,

    start(session, fresh) {
      player.session = session;
      player.joined = !fresh;
      player.st = null;
      player.pub = null;
      player.priv = null;
      store.set("player", session);
      store.set("mode", { mode: "player" });
      showGame("player");
      $("score").textContent = "0";
      $("progress").textContent = `0 / ${TOTAL}`;
      renderLeaderboard([]);
      renderPct(null);
      player.renderBoard();
      player.connect();
    },

    connect() {
      player.subs.off();
      const db = getDb();
      if (!db) { player.fail(NO_DB); return; }
      setConn("", player.joined ? "Atjauno savienojumu…" : "Pievienojas istabai…");
      $("statusText").textContent = "";
      const token = player.session.token;
      player.room = db.ref("rooms/" + ROOM_CODE);
      const me = player.room.child("players/" + token);
      player.subs.on(db.ref(".info/connected"), "value", (s) => {
        if (s.val() !== true) { setConn("bad", "Nav savienojuma ar serveri. Atjauno…"); return; }
        me.onDisconnect().update({ online: false });
        me.set({ name: player.session.name, online: true });
        player.showConn();
      });
      player.subs.on(player.room.child("host"), "value", (s) => {
        player.hostOnline = !!s.val();
        if (!player.hostOnline && !player.joined) {
          player.fail("Istaba vēl nav atvērta. Pagaidi, kamēr moderators to atver, un mēģini vēlreiz.");
          return;
        }
        if (player.hostOnline) player.joined = true;
        player.showConn();
        player.update();
      });
      player.subs.on(player.room.child("public"), "value", (s) => { player.pub = s.val(); player.update(); });
      player.subs.on(player.room.child("private/" + token), "value", (s) => { player.priv = s.val(); player.update(); });
    },
    showConn() {
      if (mode !== "player") return;
      if (!player.joined) return;
      if (player.hostOnline) setConn("ok", "Savienots ar istabu");
      else setConn("bad", "Moderators šobrīd nav tiešsaistē. Gaidi…");
    },
    fail(msg) {
      player.cleanup();
      store.del("player");
      showHome();
      $("joinErr").textContent = msg;
    },
    cleanup() {
      player.subs.off();
      if (player.room && player.session) {
        const me = player.room.child("players/" + player.session.token);
        me.update({ online: false }).catch(() => {});
        me.onDisconnect().cancel();
      }
      player.room = null;
    },

    update() {
      const pub = player.pub;
      if (!pub || !player.joined || mode !== "player") return;
      if (pub.closed && !player.hostOnline) {
        player.cleanup();
        store.del("player");
        showHome();
        toast("Moderators slēdza istabu.");
        return;
      }
      const token = player.session.token;
      const priv = obj(player.priv);
      const last = normLast(pub.last);
      const st = {
        phase: pub.phase || "board",
        current: pub.current || null,
        used: obj(pub.used),
        last,
        reveal: pub.phase === "reveal" ? last : null,
        gameId: pub.gameId,
        board: arr(pub.board).map((r) => ({ ...r, me: r.k === token })),
        me: { score: priv.score || 0, answers: obj(priv.answers) },
      };
      player.st = st;
      player.apply(st);
    },

    renderBoard() {
      const st = player.st;
      renderBoard((id) => {
        if (st && st.used[id] && !(st.phase === "reveal" && st.current === id)) {
          const a = st.me.answers[id];
          if (a && "correct" in a) return { kind: "done", mark: a.correct ? "ok" : "bad", symbol: a.correct ? "✓" : "✕", word: a.correct ? "IEGŪTS" : "ZAUDĒTS" };
          return { kind: "done", mark: "neutral", symbol: "–", word: "NEATBILDĒTS" };
        }
        return { kind: "open", clickable: false, live: !!st && st.current === id };
      }, () => {});
    },

    apply(st) {
      $("score").textContent = st.me.score;
      $("progress").textContent = `${Object.keys(st.used).length} / ${TOTAL}`;
      renderLeaderboard(st.board);
      renderPct(st.last);
      player.renderBoard();
      $("statusText").textContent =
        st.phase === "question" ? "Jautājums atvērts – atbildi!" :
        st.phase === "reveal" ? "Rāda rezultātus." :
        "Gaidi, kamēr moderators izvēlēsies nākamo jautājumu.";

      const id = st.current;
      if (st.phase === "question" && id && byId[id]) {
        hideResult();
        const a = st.me.answers[id];
        const pt = a && a.point ? arr(a.point) : null;
        const k = id + ":" + (a ? (pt ? pt.join(",") : a.choice) : "-");
        if (shownQKey !== k) {
          shownQKey = k;
          showQuestion(id, a ? {
            interactive: true,
            picked: pt ? null : a.choice,
            pickedPoint: pt,
            note: "Atbilde pieņemta. Rezultāti parādīsies, kad visi būs atbildējuši.",
          } : {
            interactive: true,
            note: "Tev ir viens mēģinājums.",
            onAnswer: (choice) => player.answer(id, choice),
          });
        }
      } else if (st.phase === "reveal" && id && byId[id] && st.reveal) {
        const a = st.me.answers[id];
        const res = a && "correct" in a ? { ...a, point: a.point ? arr(a.point) : undefined } : null;
        // public and private data can arrive a moment apart: if this player answered but the
        // result is not here yet, keep waiting instead of showing "Tu neatbildēji"
        const rk = id + ":" + (res ? res.correct : "none") + ":" + st.me.score;
        if (a && !res) {
          // wait for the private update
        } else if (shownResult !== id || player.resultKey !== rk) {
          if (shownQKey) hideQuestion();
          player.resultKey = rk;
          const dist = res && res.point ? `Tava atzīme: ${String(res.dist).replace(".", ",")} km no mērķa. ` : "";
          showResult(id, res, st.reveal, `${dist}Kontā tagad: ${euro(st.me.score)}`);
        }
      } else {
        hideQuestion();
        hideResult();
      }
    },

    // value = option index, or [lat, lon] for map questions
    answer(id, value) {
      const st = player.st;
      if (!player.room || !st || !st.gameId) return;
      const ref = player.room.child(`answers/${st.gameId}_${id}/${player.session.token}`);
      $("qNote").textContent = "Atbilde tiek nosūtīta…";
      $("qNote").hidden = false;
      ref.set(Array.isArray(value) ? { point: value } : { choice: value })
        .then(() => { if (shownQKey && shownQKey.endsWith(":-")) { $("qNote").textContent = "Atbilde nosūtīta. Gaidi rezultātus."; } })
        .catch((e) => {
          if (String(e && e.code).toUpperCase().includes("PERMISSION")) {
            $("qNote").textContent = "Uz šo jautājumu tu jau esi atbildējis.";
            return;
          }
          shownQKey = null; // redraw the question so the player can try again
          if (player.st) player.apply(player.st);
          $("qNote").textContent = "Neizdevās nosūtīt atbildi. Pārbaudi internetu un mēģini vēlreiz.";
          $("qNote").hidden = false;
        });
    },

    leave() {
      player.cleanup();
      store.del("player");
      showHome();
    },
  };

  // ======================================================================
  //  Wiring
  // ======================================================================
  $("resetBtn").addEventListener("click", () => {
    if (mode !== "host") return;
    askPassword({
      title: "Sākt no jauna",
      text: "Visiem spēlētājiem nauda tiks nodzēsta un visi jautājumi atkal būs pieejami.",
      ok: "Sākt no jauna", danger: true, onOk: host.reset,
    });
  });
  $("leaveBtn").addEventListener("click", () => {
    if (mode === "player") {
      if (confirm("Iziet no istabas? Tava nauda paliks saglabāta, ja pievienosies atkal no šīs ierīces.")) player.leave();
    } else if (mode === "host") {
      if (confirm("Slēgt istabu? Spēlētāji tiks atvienoti. Spēles gaita saglabāsies, un istabu varēs atvērt atkal.")) host.leave();
    }
  });

  $("hostBtn").addEventListener("click", () => {
    $("hostErr").textContent = "";
    askPassword({ title: "Moderators", text: "Ievadi moderatora paroli, lai atvērtu istabu.", ok: "Atvērt istabu", onOk: host.open });
  });
  $("joinCode").addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  $("joinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("joinName").value.trim().slice(0, 20);
    const code = $("joinCode").value.trim().toUpperCase();
    $("joinErr").textContent = "";
    if (!name) { $("joinErr").textContent = "Ievadi savu vārdu."; return; }
    if (code !== ROOM_CODE) { $("joinErr").textContent = "Nepareizs istabas kods."; return; }
    const old = store.get("player");
    // the same device keeps the same token, so the money survives re-joining
    const token = old && old.token ? old.token : randomId(16);
    store.set("lastName", name);
    player.start({ name, token }, true);
  });

  // ---- start: resume whatever this device was doing ----
  const lastName = store.get("lastName");
  if (lastName) $("joinName").value = lastName;
  const urlCode = new URLSearchParams(location.search).get("room");
  if (urlCode) $("joinCode").value = urlCode.toUpperCase().slice(0, 4);

  const saved = store.get("mode");
  if (saved && saved.mode === "host" && store.get("host")) host.open();
  else if (saved && saved.mode === "player" && store.get("player")) player.start(store.get("player"), false);
  else showHome();
})();
