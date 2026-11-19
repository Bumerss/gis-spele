/*
 * ĢIS Viktorīna – game logic.
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
 * Host and players talk directly through PeerJS (WebRTC). The public PeerJS
 * server is only used to find each other; game data goes browser to browser.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const LETTERS = "ABCDEFGH";
  const PASSWORD = "0102";   // casual lock only – visible in the page source
  const ROOM_CODE = "LBTU";  // the room always uses this code
  const PEER_PREFIX = "gis-viktorina-v1-";
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

  // answer distribution: one row per option, correct option highlighted
  function renderChart(box, qid, reveal, myChoice) {
    const q = byId[qid];
    box.innerHTML = "";
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
    const answered = opts.picked != null;
    q.options.forEach((text, i) => {
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
    $("qHint").textContent = opts.reveal ? "KĀ ATBILDĒJA SPĒLĒTĀJI" : opts.hostView ? "ATBILŽU VARIANTI" : answered ? "TAVA ATBILDE PIEŅEMTA" : "IZVĒLIES VIENU ATBILDI";
    $("qNote").textContent = opts.note || "";
    $("qNote").hidden = !opts.note;
    $("hostBox").hidden = !opts.hostView;

    const wasOpen = $("question").classList.contains("show");
    $("question").classList.add("show");
    if (!wasOpen) $("question").scrollTop = 0;
    document.body.classList.add("q-open");
    lockScroll(true);
    if (opts.interactive && !answered && optsBox.firstChild) optsBox.firstChild.focus({ preventScroll: true });
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
    renderChart($("rChart"), id, reveal, a ? a.choice : null);
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
  //  HOST (moderator)
  // ======================================================================
  const host = {
    hs: null,          // persisted room state
    peer: null,
    conns: new Map(),  // peerId -> { conn, token }
    retryTimer: null,
    retries: 0,

    newState() {
      // players[token] = { name, answers: { qid: { choice, correct } } }
      return { code: ROOM_CODE, phase: "board", current: null, used: {}, players: {}, last: null };
    },
    save() { store.set("host", host.hs); },

    open() {
      const saved = store.get("host");
      // keep an unfinished game (same code) so a moderator can continue after closing the tab
      host.hs = saved && saved.code === ROOM_CODE && saved.players ? saved : host.newState();
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
      clearTimeout(host.retryTimer);
      if (host.peer) { try { host.peer.destroy(); } catch (e) {} }
      host.conns.clear();
      setConn("", "Atver istabu…");
      if (typeof Peer === "undefined") { setConn("bad", "Neizdevās ielādēt savienojuma bibliotēku. Pārbaudi internetu."); return; }
      const peer = new Peer(PEER_PREFIX + ROOM_CODE, { debug: 0 });
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
          // after a reload our previous connection can stay registered for a few seconds;
          // if it never frees up, the room is open on another device or tab
          host.retries++;
          if (host.retries <= 10) {
            setConn("", "Atver istabu… (mēģinājums " + host.retries + ")");
            host.retryTimer = setTimeout(() => host.connect(), 3000);
          } else {
            setConn("bad", `Istaba ${ROOM_CODE} jau ir atvērta citā ierīcē vai cilnē. Aizver to un pārlādē lapu.`);
          }
        } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
          setConn("bad", "Nav savienojuma ar serveri. Mēģina vēlreiz…");
          host.retryTimer = setTimeout(() => host.connect(), 4000);
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
    score(p) {
      // money counts only for revealed questions
      return Object.entries(p.answers).reduce(
        (s, [qid, a]) => s + (a.correct && host.hs.used[qid] && byId[qid] ? byId[qid].points : 0), 0);
    },

    onData(conn, d) {
      if (!d || typeof d !== "object") return;
      const hs = host.hs;
      if (d.t === "hello") {
        const token = String(d.token || "").slice(0, 40);
        const name = String(d.name || "").trim().slice(0, 20) || "Spēlētājs";
        if (!token) return;
        host.conns.set(conn.peer, { conn, token });
        if (!hs.players[token]) hs.players[token] = { name, answers: {} };
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
        if (p.answers[d.qid]) { host.sendTo(entry); return; } // one answer only
        if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;
        p.answers[d.qid] = { choice, correct: choice === q.answer };
        host.save();
        if (!host.maybeAutoReveal()) host.broadcast();
      }
    },
    drop(conn) {
      if (!host.conns.delete(conn.peer)) return;
      if (!host.maybeAutoReveal()) host.broadcast();
    },

    // reveal by itself once every connected player has answered
    maybeAutoReveal() {
      const hs = host.hs;
      if (hs.phase !== "question") return false;
      const online = [...host.onlineTokens()];
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
      const counts = q ? q.options.map(() => 0) : [];
      const inRoom = host.onlineTokens();
      let answered = 0, correct = 0;
      Object.entries(hs.players).forEach(([tk, p]) => {
        const a = hs.current && p.answers[hs.current];
        if (!a) return;
        answered++;
        inRoom.add(tk);
        counts[a.choice] = (counts[a.choice] || 0) + 1;
        if (a.correct) correct++;
      });
      const total = inRoom.size;
      return { qid: hs.current, counts, answered, correct, total, pct: total ? Math.round((correct / total) * 100) : null };
    },

    leaderboard(forToken) {
      const online = host.onlineTokens();
      return sortRows(Object.entries(host.hs.players).map(([tk, p]) => ({
        name: p.name, score: host.score(p), online: online.has(tk), me: tk === forToken,
      })));
    },
    stateFor(token) {
      const hs = host.hs;
      const p = hs.players[token] || { name: "", answers: {} };
      // never send whether the current answer is right before the reveal
      const answers = {};
      Object.entries(p.answers).forEach(([qid, a]) => {
        answers[qid] = hs.used[qid] ? { choice: a.choice, correct: a.correct } : { choice: a.choice };
      });
      return {
        t: "state",
        phase: hs.phase,
        current: hs.current,
        used: hs.used,
        last: hs.last,
        reveal: hs.phase === "reveal" ? hs.last : null,
        board: host.leaderboard(token),
        me: { name: p.name, score: host.score(p), answers },
      };
    },
    sendTo(entry) {
      try { if (entry.conn.open) entry.conn.send(host.stateFor(entry.token)); } catch (e) {}
    },
    broadcast() {
      host.conns.forEach((entry) => { if (entry.token) host.sendTo(entry); });
      host.renderAll();
    },

    renderAll() {
      const hs = host.hs;
      if (!hs || mode !== "host") return;
      renderBoard((id) => {
        if (hs.used[id] && hs.current !== id) return { kind: "done", mark: "neutral", symbol: "●", word: "IZSPĒLĒTS" };
        return { kind: "open", clickable: hs.phase === "board", live: hs.current === id };
      }, host.pick);
      const online = host.onlineTokens().size;
      $("progress").textContent = `${online} / ${Object.keys(hs.players).length}`;
      renderLeaderboard(host.leaderboard(null));
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
      host.syncOverlay();
    },
    reveal() {
      const hs = host.hs;
      if (hs.phase !== "question") return;
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
      Object.values(hs.players).forEach((p) => { p.answers = {}; });
      hs.used = {};
      hs.last = null;
      hs.phase = "board";
      hs.current = null;
      host.save();
      host.broadcast();
      host.syncOverlay();
    },
    leave() {
      host.conns.forEach((entry) => { try { entry.conn.send({ t: "closed" }); } catch (e) {} });
      clearTimeout(host.retryTimer);
      setTimeout(() => { try { host.peer && host.peer.destroy(); } catch (e) {} host.peer = null; }, 300);
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
        const conn = player.peer.connect(PEER_PREFIX + ROOM_CODE, { reliable: true });
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
          if (!player.joined) player.fail("Istaba vēl nav atvērta. Pagaidi, kamēr moderators to atver, un mēģini vēlreiz.");
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
      if (!player.joined && player.attempt > 2) { player.fail("Neizdevās pievienoties istabai. Pārbaudi internetu un mēģini vēlreiz."); return; }
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
      player.st = d;
      player.apply(d);
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
      if (st.phase === "question" && id) {
        hideResult();
        const a = st.me.answers[id];
        const k = id + ":" + (a ? a.choice : "-");
        if (shownQKey !== k) {
          shownQKey = k;
          showQuestion(id, a ? {
            interactive: true,
            picked: a.choice,
            note: "Atbilde pieņemta. Rezultāti parādīsies, kad visi būs atbildējuši.",
          } : {
            interactive: true,
            note: "Tev ir viens mēģinājums.",
            onAnswer: (choice) => player.answer(id, choice),
          });
        }
      } else if (st.phase === "reveal" && id && st.reveal) {
        if (shownQKey) hideQuestion();
        if (shownResult !== id) {
          const a = st.me.answers[id];
          showResult(id, a && "correct" in a ? a : null, st.reveal, `Kontā tagad: ${euro(st.me.score)}`);
        }
      } else {
        hideQuestion();
        hideResult();
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
        shownQKey = null; // next state from the host redraws the options
        $("qOpts").querySelectorAll("button").forEach((b) => { b.disabled = false; b.classList.remove("picked"); });
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
