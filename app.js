/*
 * ĢIS Viktorīna – game logic.
 *
 * Three modes:
 *   solo   – one player picks questions alone (progress in localStorage).
 *   host   – the moderator. Their browser IS the room: it keeps every player's
 *            score and answers, and sends the current state to all players.
 *   player – joins a room by code; the question opens when the moderator picks it.
 *
 * Host and players talk directly through PeerJS (WebRTC). The public PeerJS
 * server is only used to find each other; game data goes browser to browser.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LETTERS = "ABCDEFGH";
  const PASSWORD = "0102"; // casual lock only – visible in the page source
  const PEER_PREFIX = "gis-viktorina-v1-";
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  // ?slot=x keeps a separate saved state per tab (handy for testing several players in one browser)
  const SLOT = new URLSearchParams(location.search).get("slot") || "";
  const key = (name) => "gis-" + name + (SLOT ? "-" + SLOT : "") + "-v" + QUESTIONS_VERSION;
  const store = {
    get(name) { try { return JSON.parse(localStorage.getItem(key(name))); } catch (e) { return null; } },
    set(name, v) { try { localStorage.setItem(key(name), JSON.stringify(v)); } catch (e) {} },
    del(name) { try { localStorage.removeItem(key(name)); } catch (e) {} },
  };
  // solo progress keeps its original key so existing players don't lose it
  const SOLO_KEY = "gis-spele" + (SLOT ? "-" + SLOT : "") + "-v" + QUESTIONS_VERSION;

  // ---- questions ----
  const byId = {};
  CATEGORIES.forEach((cat, c) =>
    cat.questions.forEach((q, i) => { byId[c + "-" + i] = { ...q, cat: cat.title, level: i }; })
  );
  const TOTAL = Object.keys(byId).length;
  const MAX_POINTS = Object.values(byId).reduce((s, q) => s + q.points, 0);
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
    for (let i = 0; i < n; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
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
    return ["question", "result", "end", "pw"].some((id) => $(id).classList.contains("show"));
  }

  // ======================================================================
  //  Shared rendering
  // ======================================================================
  let mode = null; // 'solo' | 'host' | 'player'

  function amountEl(points) {
    const s = el("span", "amount", points + " ");
    s.appendChild(el("small", null, "€"));
    return s;
  }

  // status per tile: { kind: 'open'|'done', mark?: 'ok'|'bad'|'neutral', markText, clickable, live }
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
          t.setAttribute("aria-label", `${cat.title}, ${euro(q.points)} – ${info.word.toLowerCase()}`);
          t.setAttribute("role", "img");
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

  function setConn(state, text) {
    $("conn").className = "conn " + (state || "");
    $("connText").textContent = text;
  }

  function sortRows(rows) {
    return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "lv"));
  }

  // ---- question overlay ----
  // opts: { interactive, onAnswer, hostView, picked, note }
  let shownQ = null;
  function showQuestion(id, opts) {
    const q = byId[id];
    shownQ = id;
    $("qCat").textContent = q.cat;
    $("qPts").textContent = euro(q.points);
    $("qText").textContent = q.q;
    const img = $("qImg");
    if (q.image) { img.src = q.image; img.alt = "Attēls jautājumam"; img.hidden = false; }
    else { img.hidden = true; img.removeAttribute("src"); }
    const optsBox = $("qOpts");
    optsBox.innerHTML = "";
    q.options.forEach((text, i) => {
      const isBtn = !!opts.interactive;
      const b = el(isBtn ? "button" : "div", "opt");
      if (isBtn) {
        b.type = "button";
        b.addEventListener("click", () => {
          optsBox.querySelectorAll("button").forEach((x) => { x.disabled = true; });
          b.classList.add("picked");
          opts.onAnswer(i);
        }, { once: true });
      }
      b.appendChild(el("span", "letter", LETTERS[i]));
      b.appendChild(el("span", null, text));
      if (opts.hostView && i === q.answer) {
        b.classList.add("correct");
        b.appendChild(el("span", "tag", "PAREIZĀ"));
      }
      optsBox.appendChild(b);
    });
    $("qHint").textContent = opts.hostView ? "ATBILŽU VARIANTI" : "IZVĒLIES VIENU ATBILDI";
    $("qNote").textContent = opts.note || "";
    $("qNote").hidden = !opts.note;
    $("hostBox").hidden = !opts.hostView;
    $("question").classList.add("show");
    $("question").scrollTop = 0;
    document.body.classList.add("q-open");
    lockScroll(true);
    if (opts.interactive && optsBox.firstChild) optsBox.firstChild.focus({ preventScroll: true });
  }
  function hideQuestion() {
    shownQ = null;
    $("question").classList.remove("show");
    document.body.classList.remove("q-open");
    if (!anyOverlayOpen()) lockScroll(false);
  }

  // ---- result overlay ----
  let shownResult = null;
  function showResult(id, a, { sub, closable }) {
    const q = byId[id];
    shownResult = id;
    const box = $("result");
    box.className = "overlay show " + (a.correct ? "correct" : "wrong");
    $("rTitle").textContent = a.correct ? "Pareizi!" : "Nepareizi!";
    $("rPoints").textContent = (a.correct ? "+" : "") + euro(q.points);
    $("rPoints").classList.toggle("missed", !a.correct);
    $("rSub").textContent = sub;
    $("rAnswer").textContent = a.correct ? "" : `Pareizā atbilde: ${LETTERS[q.answer]}. ${q.options[q.answer]}`;
    $("rExplain").textContent = q.explain || "";
    $("rClose").hidden = !closable;
    $("rWait").hidden = closable;
    box.scrollTop = 0;
    lockScroll(true);
    if (closable) $("rClose").focus({ preventScroll: true });
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
    $("end").classList.remove("show");
    $("game").hidden = true;
    $("home").hidden = false;
    lockScroll(false);
  }
  function showGame(m) {
    mode = m;
    $("home").hidden = true;
    $("game").hidden = false;
    $("layout").classList.toggle("solo", m === "solo");
    $("aside").hidden = m === "solo";
    $("statMoney").hidden = m === "host";
    $("statRoom").hidden = m === "solo";
    $("resetBtn").hidden = m === "player";
    $("modeLabel").textContent =
      m === "host" ? "MODERATORS · SPĒLES NAUDA" : m === "player" ? "SPĒLĒTĀJS · SPĒLES NAUDA" : "SPĒLES NAUDA · LATVIJA";
    $("progressLabel").textContent = m === "host" ? "SPĒLĒTĀJI" : m === "player" ? "JAUTĀJUMI" : "ATBILDĒTI";
  }

  // ======================================================================
  //  SOLO
  // ======================================================================
  const solo = {
    state: null,
    empty() { return { answered: {}, open: null, result: null, endSeen: false }; },
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(SOLO_KEY));
        if (s && typeof s === "object" && s.answered) return { ...solo.empty(), ...s };
      } catch (e) {}
      return solo.empty();
    },
    save() { try { localStorage.setItem(SOLO_KEY, JSON.stringify(solo.state)); } catch (e) {} },
    score() {
      return Object.entries(solo.state.answered)
        .reduce((s, [id, a]) => s + (a.correct && byId[id] ? byId[id].points : 0), 0);
    },
    start() {
      store.set("mode", { mode: "solo" });
      solo.state = solo.load();
      showGame("solo");
      const st = solo.state;
      if (st.open && !byId[st.open]) st.open = null;
      if (st.result && !(byId[st.result] && st.answered[st.result])) st.result = null;
      solo.render();
      if (st.result) solo.showResult(st.result);
      else if (st.open && !st.answered[st.open]) solo.open(st.open);
      else solo.maybeEnd();
    },
    render() {
      const st = solo.state;
      renderBoard((id) => {
        const a = st.answered[id];
        if (a) return { kind: "done", mark: a.correct ? "ok" : "bad", symbol: a.correct ? "✓" : "✕", word: a.correct ? "IEGŪTS" : "ZAUDĒTS" };
        return { kind: "open", clickable: true };
      }, solo.open);
      $("score").textContent = solo.score();
      $("progress").textContent = `${Object.keys(st.answered).length} / ${TOTAL}`;
    },
    open(id) {
      if (solo.state.answered[id]) return;
      solo.state.open = id;
      solo.save();
      showQuestion(id, {
        interactive: true,
        note: "Jautājumu nevar aizvērt bez atbildes – arī pārlādējot lapu tas atvērsies atkal.",
        onAnswer: (choice) => solo.answer(id, choice),
      });
    },
    answer(id, choice) {
      const st = solo.state;
      if (st.answered[id]) return;
      st.answered[id] = { choice, correct: choice === byId[id].answer };
      st.open = null;
      st.result = id;
      solo.save(); // saved before anything is shown – a reload cannot undo it
      hideQuestion();
      solo.render();
      solo.showResult(id);
    },
    showResult(id) {
      const a = solo.state.answered[id];
      showResult(id, a, {
        closable: true,
        sub: a.correct ? `Kontā tagad: ${euro(solo.score())}` : `Šo naudu tu nesaņēmi. Kontā joprojām: ${euro(solo.score())}`,
      });
    },
    closeResult() {
      solo.state.result = null;
      solo.save();
      hideResult();
      solo.maybeEnd();
    },
    maybeEnd() {
      const st = solo.state;
      if (Object.keys(st.answered).length < TOTAL || st.endSeen) return;
      const correct = Object.values(st.answered).filter((a) => a.correct).length;
      $("ePoints").textContent = euro(solo.score());
      $("eSub").textContent = `Pareizi atbildēti ${correct} no ${TOTAL} jautājumiem. Maksimums: ${euro(MAX_POINTS)}.`;
      $("end").classList.add("show");
      lockScroll(true);
      $("eClose").focus({ preventScroll: true });
    },
    reset() {
      solo.state = solo.empty();
      solo.save();
      solo.render();
    },
  };
  $("eClose").addEventListener("click", () => {
    solo.state.endSeen = true;
    solo.save();
    $("end").classList.remove("show");
    lockScroll(false);
  });

  // ======================================================================
  //  HOST (moderator)
  // ======================================================================
  const host = {
    hs: null,        // persisted room state
    peer: null,
    conns: new Map(), // peerId -> { conn, token }
    retryTimer: null,
    retries: 0,

    newState(code) {
      return { code, phase: "board", current: null, used: {}, players: {}, last: null };
    },
    save() { store.set("host", host.hs); },

    create() {
      host.hs = host.newState(randomId(4));
      host.save();
      store.set("mode", { mode: "host" });
      host.start(false);
    },
    resume() {
      host.hs = store.get("host");
      if (!host.hs || !host.hs.code) { showHome(); return; }
      host.start(true);
    },
    start(restoring) {
      showGame("host");
      $("roomCode").textContent = host.hs.code;
      host.connect(restoring);
      host.renderAll();
      if (host.hs.phase === "question" && host.hs.current) host.showQ();
    },

    connect(restoring) {
      clearTimeout(host.retryTimer);
      if (host.peer) { try { host.peer.destroy(); } catch (e) {} }
      host.conns.clear();
      setConn("", "Atver istabu…");
      if (typeof Peer === "undefined") { setConn("bad", "Neizdevās ielādēt savienojuma bibliotēku. Pārbaudi internetu."); return; }
      const peer = new Peer(PEER_PREFIX + host.hs.code, { debug: 0 });
      host.peer = peer;
      peer.on("open", () => {
        host.retries = 0;
        setConn("ok", "Istaba atvērta");
        host.renderAll();
      });
      peer.on("connection", (conn) => {
        conn.on("data", (d) => host.onData(conn, d));
        conn.on("close", () => host.drop(conn));
        conn.on("error", () => host.drop(conn));
      });
      peer.on("disconnected", () => {
        setConn("", "Savienojums ar serveri pārtrūka, atjauno…");
        if (!peer.destroyed) { try { peer.reconnect(); } catch (e) {} }
      });
      peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          if (restoring && host.retries < 10) {
            // our own old connection may still be registered for a few seconds after a reload
            host.retries++;
            setConn("", "Atjauno istabu…");
            host.retryTimer = setTimeout(() => host.connect(true), 3000);
          } else if (!restoring) {
            host.hs.code = randomId(4);
            host.save();
            $("roomCode").textContent = host.hs.code;
            host.connect(false);
          } else {
            setConn("bad", "Istabas kods ir aizņemts. Izej un izveido jaunu istabu.");
          }
        } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
          setConn("bad", "Nav savienojuma ar serveri. Mēģina vēlreiz…");
          host.retryTimer = setTimeout(() => host.connect(true), 4000);
        } else if (err.type === "browser-incompatible") {
          setConn("bad", "Šis pārlūks neatbalsta tiešsaistes spēli.");
        }
      });
    },

    onlineTokens() {
      const s = new Set();
      host.conns.forEach((c) => { if (c.token) s.add(c.token); });
      return s;
    },

    onData(conn, d) {
      if (!d || typeof d !== "object") return;
      const hs = host.hs;
      if (d.t === "hello") {
        const token = String(d.token || "").slice(0, 40);
        const name = String(d.name || "").trim().slice(0, 20) || "Spēlētājs";
        if (!token) return;
        host.conns.set(conn.peer, { conn, token });
        if (!hs.players[token]) hs.players[token] = { name, score: 0, answers: {} };
        else hs.players[token].name = name;
        host.save();
        host.broadcast();
      } else if (d.t === "answer") {
        const entry = host.conns.get(conn.peer);
        if (!entry) return;
        const p = hs.players[entry.token];
        const q = byId[d.qid];
        const choice = Number(d.choice);
        if (!p || !q || hs.phase !== "question" || hs.current !== d.qid) return;
        if (p.answers[d.qid]) { host.sendTo(entry); return; } // already answered – no second try
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
        const correct = choice === q.answer;
        p.answers[d.qid] = { choice, correct };
        if (correct) p.score += q.points;
        host.save();
        host.broadcast();
      }
    },
    drop(conn) {
      if (host.conns.delete(conn.peer)) host.broadcast();
    },

    leaderboard(forToken) {
      const online = host.onlineTokens();
      return sortRows(Object.entries(host.hs.players).map(([tk, p]) => ({
        name: p.name, score: p.score, online: online.has(tk), me: tk === forToken,
      })));
    },
    stateFor(token) {
      const hs = host.hs;
      const p = hs.players[token] || { name: "", score: 0, answers: {} };
      return {
        t: "state",
        phase: hs.phase,
        current: hs.current,
        used: hs.used,
        last: hs.last,
        board: host.leaderboard(token),
        me: { name: p.name, score: p.score, answers: p.answers },
      };
    },
    sendTo(entry) {
      try { if (entry.conn.open) entry.conn.send(host.stateFor(entry.token)); } catch (e) {}
    },
    broadcast() {
      host.conns.forEach((entry) => { if (entry.token) host.sendTo(entry); });
      host.renderAll();
    },

    liveStats() {
      const hs = host.hs;
      const online = host.onlineTokens();
      let answered = 0, correct = 0;
      const inRoom = new Set(online);
      Object.entries(hs.players).forEach(([tk, p]) => {
        const a = hs.current && p.answers[hs.current];
        if (a) { answered++; inRoom.add(tk); if (a.correct) correct++; }
      });
      return { answered, correct, total: inRoom.size };
    },

    renderAll() {
      const hs = host.hs;
      if (!hs || mode !== "host") return;
      renderBoard((id) => {
        if (hs.used[id]) return { kind: "done", mark: "neutral", symbol: "●", word: "IZSPĒLĒTS" };
        return { kind: "open", clickable: hs.phase === "board", live: hs.current === id };
      }, host.pick);
      const online = host.onlineTokens().size;
      const all = Object.keys(hs.players).length;
      $("progress").textContent = `${online} / ${all}`;
      renderLeaderboard(host.leaderboard(null));
      renderPct(hs.last);
      $("statusText").textContent = hs.phase === "question"
        ? "Jautājums atvērts spēlētājiem."
        : `Spēlētāji pievienojas ar kodu ${hs.code}. Izvēlies jautājumu – tas automātiski atvērsies visiem.`;
      if (hs.phase === "question") {
        const s = host.liveStats();
        $("liveAnswered").textContent = `${s.answered} / ${s.total}`;
        $("liveCorrect").textContent = String(s.correct);
      }
    },

    pick(id) {
      const hs = host.hs;
      if (hs.phase !== "board" || hs.used[id]) return;
      hs.phase = "question";
      hs.current = id;
      host.save();
      host.broadcast();
      host.showQ();
    },
    showQ() {
      showQuestion(host.hs.current, { hostView: true });
      host.renderAll();
    },
    endQuestion() {
      const hs = host.hs;
      if (hs.phase !== "question") return;
      const s = host.liveStats();
      hs.last = {
        qid: hs.current,
        correct: s.correct,
        total: s.total,
        pct: s.total ? Math.round((s.correct / s.total) * 100) : null,
      };
      hs.used[hs.current] = true;
      hs.phase = "board";
      hs.current = null;
      host.save();
      hideQuestion();
      host.broadcast();
    },
    reset() {
      const hs = host.hs;
      Object.values(hs.players).forEach((p) => { p.score = 0; p.answers = {}; });
      hs.used = {};
      hs.last = null;
      hs.phase = "board";
      hs.current = null;
      host.save();
      hideQuestion();
      host.broadcast();
    },
    leave() {
      host.conns.forEach((entry) => { try { entry.conn.send({ t: "closed" }); } catch (e) {} });
      clearTimeout(host.retryTimer);
      setTimeout(() => { try { host.peer && host.peer.destroy(); } catch (e) {} host.peer = null; }, 300);
      store.del("host");
      host.hs = null;
      showHome();
    },
  };
  $("endQBtn").addEventListener("click", () => host.endQuestion());

  // ======================================================================
  //  PLAYER
  // ======================================================================
  const player = {
    session: null,   // { code, name, token }
    peer: null,
    conn: null,
    st: null,        // last state from host
    joined: false,
    timer: null,
    attempt: 0,

    start(session, fresh) {
      player.session = session;
      player.joined = !fresh;
      player.st = null;
      store.set("player", session);
      store.set("mode", { mode: "player" });
      showGame("player");
      $("roomCode").textContent = session.code;
      $("score").textContent = "0";
      $("progress").textContent = `0 / ${TOTAL}`;
      renderLeaderboard([]);
      renderPct(null);
      player.renderBoard();
      player.connect();
    },

    connect() {
      clearTimeout(player.timer);
      if (typeof Peer === "undefined") { player.fail("Neizdevās ielādēt savienojuma bibliotēku. Pārbaudi internetu."); return; }
      setConn("", player.joined ? "Atjauno savienojumu…" : "Pievienojas istabai…");
      $("statusText").textContent = "";
      const go = () => {
        if (player.conn) { try { player.conn.close(); } catch (e) {} }
        const conn = player.peer.connect(PEER_PREFIX + player.session.code, { reliable: true });
        player.conn = conn;
        const openTimeout = setTimeout(() => { if (!conn.open) player.retry(); }, 9000);
        conn.on("open", () => {
          clearTimeout(openTimeout);
          player.attempt = 0;
          conn.send({ t: "hello", token: player.session.token, name: player.session.name });
        });
        conn.on("data", (d) => player.onData(d));
        conn.on("close", () => { if (player.conn === conn) player.retry(); });
        conn.on("error", () => { if (player.conn === conn) player.retry(); });
      };
      if (player.peer && !player.peer.destroyed && player.peer.open) { go(); return; }
      if (player.peer) { try { player.peer.destroy(); } catch (e) {} }
      const peer = new Peer({ debug: 0 });
      player.peer = peer;
      peer.on("open", go);
      peer.on("disconnected", () => { if (!peer.destroyed) { try { peer.reconnect(); } catch (e) {} } });
      peer.on("error", (err) => {
        if (err.type === "peer-unavailable") {
          if (!player.joined) player.fail("Istaba ar šādu kodu nav atrasta. Pārbaudi kodu.");
          else player.retry();
        } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
          player.retry();
        } else if (err.type === "browser-incompatible") {
          player.fail("Šis pārlūks neatbalsta tiešsaistes spēli.");
        }
      });
    },
    retry() {
      if (mode !== "player") return;
      clearTimeout(player.timer);
      player.attempt++;
      if (!player.joined && player.attempt > 2) { player.fail("Neizdevās pievienoties istabai. Pārbaudi kodu un internetu."); return; }
      setConn("bad", "Savienojums pārtrūka. Mēģina vēlreiz…");
      player.timer = setTimeout(() => player.connect(), Math.min(2000 * player.attempt, 8000));
    },
    fail(msg) {
      player.cleanup();
      store.del("player");
      showHome();
      $("joinErr").textContent = msg;
    },
    cleanup() {
      clearTimeout(player.timer);
      try { player.conn && player.conn.close(); } catch (e) {}
      try { player.peer && player.peer.destroy(); } catch (e) {}
      player.conn = null;
      player.peer = null;
    },

    onData(d) {
      if (!d || typeof d !== "object") return;
      if (d.t === "closed") {
        player.cleanup();
        store.del("player");
        showHome();
        toast("Moderators slēdza istabu.");
        return;
      }
      if (d.t !== "state") return;
      player.joined = true;
      setConn("ok", "Savienots ar istabu");
      const prev = player.st;
      player.st = d;
      player.apply(prev, d);
    },

    renderBoard() {
      const st = player.st;
      renderBoard((id) => {
        if (st && st.used[id]) {
          const a = st.me.answers[id];
          if (a) return { kind: "done", mark: a.correct ? "ok" : "bad", symbol: a.correct ? "✓" : "✕", word: a.correct ? "IEGŪTS" : "ZAUDĒTS" };
          return { kind: "done", mark: "neutral", symbol: "–", word: "NEATBILDĒTS" };
        }
        return { kind: "open", clickable: false, live: !!st && st.current === id };
      }, () => {});
    },

    apply(prev, st) {
      $("score").textContent = st.me.score;
      $("progress").textContent = `${Object.keys(st.used).length} / ${TOTAL}`;
      renderLeaderboard(st.board);
      renderPct(st.last);
      player.renderBoard();
      $("statusText").textContent = st.phase === "question"
        ? "Jautājums atvērts – atbildi!"
        : "Gaidi, kamēr moderators izvēlēsies nākamo jautājumu.";

      if (st.phase === "question" && st.current) {
        const id = st.current;
        const a = st.me.answers[id];
        if (a) {
          if (shownQ) hideQuestion();
          if (shownResult !== id) {
            showResult(id, a, {
              closable: false,
              sub: a.correct ? `Kontā tagad: ${euro(st.me.score)}` : `Šo naudu tu nesaņēmi. Kontā joprojām: ${euro(st.me.score)}`,
            });
          }
        } else if (shownQ !== id) {
          hideResult();
          showQuestion(id, {
            interactive: true,
            note: "Tev ir viens mēģinājums. Atbilde tiek nosūtīta moderatoram.",
            onAnswer: (choice) => player.answer(id, choice),
          });
        }
      } else {
        const wasOpen = shownQ || shownResult;
        hideQuestion();
        hideResult();
        if (wasOpen && prev && prev.phase === "question" && st.last && st.last.qid === prev.current && st.last.pct != null) {
          toast(`${st.last.pct}% spēlētāju atbildēja pareizi.`);
        }
      }
    },

    answer(id, choice) {
      if (player.conn && player.conn.open) {
        player.conn.send({ t: "answer", qid: id, choice });
        $("qNote").textContent = "Atbilde nosūtīta…";
        $("qNote").hidden = false;
      } else {
        $("qNote").textContent = "Nav savienojuma ar istabu. Atbilde netika nosūtīta – mēģini vēlreiz, kad savienojums atjaunosies.";
        $("qNote").hidden = false;
        // let them try again once reconnected
        $("qOpts").querySelectorAll("button").forEach((b) => { b.disabled = false; b.classList.remove("picked"); });
        shownQ = null;
      }
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
  $("rClose").addEventListener("click", () => { if (mode === "solo") solo.closeResult(); });

  $("resetBtn").addEventListener("click", () => {
    if (mode === "solo") {
      askPassword({ title: "Sākt no jauna", text: "Ievadi paroli, lai dzēstu visu progresu un naudu.", ok: "Dzēst progresu", danger: true, onOk: solo.reset });
    } else if (mode === "host") {
      askPassword({ title: "Sākt no jauna", text: "Visiem spēlētājiem nauda tiks nodzēsta un jautājumi atkal būs pieejami.", ok: "Sākt no jauna", danger: true, onOk: host.reset });
    }
  });
  $("leaveBtn").addEventListener("click", () => {
    if (mode === "solo") showHome();
    else if (mode === "player") {
      if (confirm("Iziet no istabas? Tava nauda paliks saglabāta, ja pievienosies atkal no šīs ierīces.")) player.leave();
    } else if (mode === "host") {
      if (confirm("Slēgt istabu? Spēle visiem spēlētājiem beigsies.")) host.leave();
    }
  });

  $("soloBtn").addEventListener("click", () => solo.start());
  $("hostBtn").addEventListener("click", () => {
    $("hostErr").textContent = "";
    askPassword({ title: "Moderators", text: "Ievadi moderatora paroli, lai izveidotu istabu.", ok: "Izveidot istabu", onOk: host.create });
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
    if (code.length !== 4) { $("joinErr").textContent = "Istabas kodā ir 4 simboli."; return; }
    const old = store.get("player");
    // same device + same room keeps the same token, so the score survives re-joining
    const token = old && old.code === code && old.token ? old.token : randomId(16);
    store.set("lastName", name);
    player.start({ code, name, token }, true);
  });

  // ---- start: resume whatever this device was doing ----
  const lastName = store.get("lastName");
  if (lastName) $("joinName").value = lastName;
  const urlCode = new URLSearchParams(location.search).get("room");
  if (urlCode) $("joinCode").value = urlCode.toUpperCase().slice(0, 4);

  const saved = store.get("mode");
  if (saved && saved.mode === "solo") solo.start();
  else if (saved && saved.mode === "host") host.resume();
  else if (saved && saved.mode === "player" && store.get("player")) player.start(store.get("player"), false);
  else showHome();
})();
