(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var TASKS = window.TASKS;
  var VW = 1000, VH = 560;
  var STORE = "gtrs_progress_v1";

  var S = {
    ti: 0,
    states: {},
    queues: {},
    logs: {},
    results: {},
    hint: {},
    progress: loadProgress(),
    animating: false
  };

  var cv, ctx;
  var view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  var anim = null;

  function loadProgress() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return { done: {} };
      var p = JSON.parse(raw);
      return { done: p.done || {} };
    } catch (e) { return { done: {} }; }
  }
  function saveProgress() {
    try { localStorage.setItem(STORE, JSON.stringify({ done: S.progress.done })); } catch (e) {}
  }

  function task() { return TASKS[S.ti]; }
  function fresh(t) {
    var s = { iface: {}, stat: {}, def: {}, rip: {}, ospf: {}, vlan: {}, sub: {}, applied: [], pinged: {} };
    if (t.pre) t.pre(s);
    return s;
  }
  function st() {
    var t = task();
    if (!S.states[t.id]) S.states[t.id] = fresh(t);
    return S.states[t.id];
  }
  function queue() {
    var t = task();
    if (!S.queues[t.id]) S.queues[t.id] = [];
    return S.queues[t.id];
  }
  function logs() {
    var t = task();
    if (!S.logs[t.id]) S.logs[t.id] = [];
    return S.logs[t.id];
  }
  function tileById(id) {
    var arr = task().bank.filter(function (b) { return b.id === id; });
    return arr[0];
  }
  function doneCount() {
    return Object.keys(S.progress.done).filter(function (k) { return S.progress.done[k]; }).length;
  }
  function nodeById(id) {
    var arr = task().topo.nodes.filter(function (n) { return n.id === id; });
    return arr[0];
  }

  /* ============================================================
     终端 / Terminal
     ============================================================ */
  function termEl() { return $("term"); }
  function appendTerm(entry) {
    var box = termEl();
    var d = document.createElement("div");
    d.className = "tl " + entry[0];
    if (entry[0] === "cmd") {
      d.innerHTML = '<span class="pr">' + esc(entry[1]) + "</span> <span class=\"cm\">" + esc(entry[2]) + "</span>";
    } else {
      d.textContent = entry[1];
    }
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
  }
  function log(type, a, b) {
    var entry = [type, a, b];
    logs().push(entry);
    appendTerm(entry);
  }
  function renderTerm() {
    var box = termEl();
    box.innerHTML = "";
    logs().forEach(function (entry) {
      var d = document.createElement("div");
      d.className = "tl " + entry[0];
      if (entry[0] === "cmd") {
        d.innerHTML = '<span class="pr">' + esc(entry[1]) + "</span> <span class=\"cm\">" + esc(entry[2]) + "</span>";
      } else {
        d.textContent = entry[1];
      }
      box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }
  function welcome(t) {
    if (logs().length) return;
    log("out", "// 任务 " + t.no + " · " + t.zh + " / " + t.en);
    log("out", "// 从命令库选择命令加入队列，点击「执行」下发到设备。");
  }

  /* ============================================================
     顶部导航 / Rail
     ============================================================ */
  function renderRail() {
    var host = $("rail");
    host.innerHTML = "";
    TASKS.forEach(function (t, i) {
      var b = document.createElement("button");
      b.className = "railbtn" + (i === S.ti ? " on" : "") + (S.progress.done[t.id] ? " done" : "");
      b.setAttribute("data-i", i);
      b.innerHTML = '<span class="n">' + t.no + '</span><span class="lab"><b>' + esc(t.zh) + "</b><i>" + esc(t.en) + "</i></span>";
      b.addEventListener("click", function () {
        if (S.animating || i === S.ti) return;
        S.ti = i;
        $("hud").hidden = true;
        document.querySelector(".panel").scrollTop = 0;
        renderAll();
        welcome(task());
        renderTerm();
      });
      host.appendChild(b);
    });
    $("score").textContent = String(doneCount() * 20);
  }

  /* ============================================================
     任务卡 / Task card
     ============================================================ */
  function renderTaskCard() {
    var t = task();
    $("taskno").textContent = "任务 " + (t.no < 10 ? "0" + t.no : t.no);
    $("tasktag").textContent = t.tag;
    $("tasktitle").textContent = t.zh;
    $("tasken").textContent = t.en;
    $("taskintro").innerHTML = esc(t.intro) + '<span class="en">' + esc(t.introEn) + "</span>";
    renderSteps();
  }
  function renderSteps() {
    var t = task(), s = st();
    var host = $("steps");
    host.innerHTML = "";
    t.steps.forEach(function (step, i) {
      var no = i + 1;
      var tiles = t.bank.filter(function (b) { return b.step === no; });
      var done = 0;
      tiles.forEach(function (b) { if (s.applied.indexOf(b.id) >= 0) done++; });
      var isDone = tiles.length ? done === tiles.length : !!s.pinged[t.id];
      var d = document.createElement("div");
      d.className = "step" + (isDone ? " done" : "");
      d.title = step.zh + " / " + step.en;
      d.innerHTML = '<span class="sn">' + (isDone ? "✓" : no) + '</span><span class="sx">' + esc(step.zh) +
        '</span><span class="sc">' + (tiles.length ? done + "/" + tiles.length : (isDone ? "完成" : "待测试")) + "</span>";
      host.appendChild(d);
    });
  }

  /* ============================================================
     命令库 / Command bank
     ============================================================ */
  var DEV_NAME = { R1: "路由器 Router", R2: "路由器 Router", R3: "路由器 Router", SW: "交换机 Switch" };
  var DEV_CLASS = { R1: "r1", R2: "r2", R3: "r3", SW: "sw" };
  function renderBank() {
    var t = task(), s = st();
    var host = $("bank");
    host.innerHTML = "";
    var devs = [];
    t.bank.forEach(function (b) { if (devs.indexOf(b.dev) < 0) devs.push(b.dev); });
    devs.forEach(function (dev) {
      var all = t.bank.filter(function (b) { return b.dev === dev; });
      var left = all.filter(function (b) { return s.applied.indexOf(b.id) < 0; });
      var g = document.createElement("div");
      g.className = "devgroup";
      var head = document.createElement("div");
      head.className = "devhead";
      head.innerHTML = '<span class="devchip ' + DEV_CLASS[dev] + '">' + dev + "</span><span>" + DEV_NAME[dev] +
        '</span><span class="devcnt">' + (left.length ? left.length + " 条待下发" : "已全部下发") + "</span>";
      g.appendChild(head);
      if (!left.length) { host.appendChild(g); return; }
      var wrap = document.createElement("div");
      wrap.className = "tiles";
      left.forEach(function (b) {
        var el = document.createElement("div");
        el.className = "tile";
        el.setAttribute("role", "button");
        el.setAttribute("tabindex", "0");
        el.setAttribute("data-id", b.id);
        el.draggable = true;
        el.innerHTML = '<span class="s">' + b.step + '</span><span class="tx">' +
          esc(b.text) + '</span><span class="port">' + esc(b.port || "") + "</span>";
        el.addEventListener("click", function () {
          if (S.animating) return;
          addToQueue(b.id);
        });
        el.addEventListener("dragstart", function (e) {
          e.dataTransfer.setData("text/plain", b.id);
          e.dataTransfer.effectAllowed = "copy";
        });
        wrap.appendChild(el);
      });
      g.appendChild(wrap);
      host.appendChild(g);
    });
  }

  /* ============================================================
     队列 / Queue
     ============================================================ */
  function addToQueue(id) {
    var q = queue();
    if (q.indexOf(id) >= 0 || st().applied.indexOf(id) >= 0) return;
    q.push(id);
    renderQueue();
    msg("已加入队列，可调整顺序后执行 / Added to queue", "");
  }
  function renderQueue() {
    var q = queue(), s = st();
    var host = $("queue");
    host.innerHTML = "";
    if (!q.length) {
      host.innerHTML = '<p class="empty">把命令拖进来 / Drop commands here</p>';
    } else {
      q.forEach(function (id, i) {
        var b = tileById(id);
        if (!b) return;
        var r = document.createElement("div");
        r.className = "qrow";
        r.innerHTML = '<span class="qn">' + (i + 1) + '</span><span class="qdev devchip ' + DEV_CLASS[b.dev] + '">' +
          b.dev + '</span><span class="qtx">' + esc(b.text) + '</span><span class="qa">' +
          '<button type="button" data-act="up" data-i="' + i + '" title="上移">↑</button>' +
          '<button type="button" data-act="down" data-i="' + i + '" title="下移">↓</button>' +
          '<button type="button" class="del" data-act="del" data-i="' + i + '" title="移除">×</button></span>';
        host.appendChild(r);
      });
    }
    $("qcount").textContent = String(q.length);
    var run = $("btnRun");
    run.disabled = !q.length || S.animating || q.every(function (id) { return s.applied.indexOf(id) >= 0; });
  }

  /* ============================================================
     执行 / Execute
     ============================================================ */
  function linesOf(tile, s) {
    return typeof tile.lines === "function" ? tile.lines(s) : tile.lines;
  }
  function runQueue() {
    if (S.animating) return;
    var t = task(), s = st();
    var q = queue().slice();
    if (!q.length) { msg("先加入命令 / Add commands first", "bad"); return; }
    var applied = [], failed = false;
    for (var i = 0; i < q.length; i++) {
      var tile = tileById(q[i]);
      if (!tile) continue;
      var err = tile.pre ? tile.pre(s) : null;
      if (err) {
        log("err", "Error: " + err);
        failed = true;
        break;
      }
      linesOf(tile, s).forEach(function (ln) { log("cmd", ln[0], ln[1]); });
      tile.run(s);
      s.applied.push(tile.id);
      applied.push(tile.id);
    }
    S.queues[t.id] = q.filter(function (id) { return applied.indexOf(id) < 0; });
    S.results[t.id] = null;
    renderBank();
    renderQueue();
    renderSteps();
    renderReport();
    draw();
    if (failed) {
      msg("执行中断：按提示调整顺序或补充前置命令 / Fix the error and retry", "bad");
    } else {
      log("ok", "// 已下发 " + applied.length + " 条命令 / " + applied.length + " commands applied");
      msg("命令已下发，点击「验证」检查结果 / Verify when ready", "ok");
    }
    if (!queue().length) $("btnRun").disabled = true;
  }

  /* ============================================================
     验证 / Verify
     ============================================================ */
  function renderReport() {
    var t = task();
    var res = S.results[t.id];
    var host = $("report");
    host.innerHTML = "";
    var pass = 0;
    t.checks.forEach(function (c, i) {
      var state = res ? (res[i] ? "pass" : "fail") : "";
      if (res && res[i]) pass++;
      var d = document.createElement("div");
      d.className = "rrow " + state;
      d.innerHTML = '<span class="rnum">' + (res ? (res[i] ? "✓" : "×") : i + 1) + '</span><span class="rtxt"><b>' +
        esc(c.zh) + "</b><i>" + esc(c.en) + '</i></span><span class="rstate">' +
        (res ? (res[i] ? "通过" : "未过") : "待验证") + "</span>";
      host.appendChild(d);
    });
    $("rcount").textContent = (res ? pass : 0) + " / " + t.checks.length;
  }
  function verify() {
    if (S.animating) return;
    var t = task(), s = st();
    var res = {};
    var pass = 0;
    t.checks.forEach(function (c, i) {
      var ok = !!c.test(s);
      res[i] = ok;
      if (ok) pass++;
    });
    S.results[t.id] = res;
    t.verify(s).forEach(function (l) { log(l[0], l[1], l[2]); });
    renderReport();
    if (pass === t.checks.length) {
      log("ok", "// 全部检查通过 / All checks passed");
      msg("验证通过：本任务完成 / Task complete", "ok");
      markDone(t);
      hud("任务 " + t.no + " 完成：" + t.zh + " / Task complete", "good");
    } else {
      msg("通过 " + pass + " / " + t.checks.length + "，继续完善配置 / Keep going", "warn");
      hud("还有 " + (t.checks.length - pass) + " 项未通过，查看右侧清单 / " + (t.checks.length - pass) + " checks failed", "bad");
    }
    reportEl().scrollIntoView({ behavior: "smooth", block: "nearest" });
    draw();
  }
  function markDone(t) {
    if (S.progress.done[t.id]) { renderRail(); return; }
    S.progress.done[t.id] = true;
    saveProgress();
    renderRail();
    if (doneCount() === TASKS.length) {
      setTimeout(showResult, 900);
    }
  }

  /* ============================================================
     提示 / Hint
     ============================================================ */
  function hint() {
    var t = task(), s = st();
    var step = S.hint[t.id] || 0;
    S.hint[t.id] = (step + 1) % 3;
    var next = t.bank.filter(function (b) { return s.applied.indexOf(b.id) < 0; })[0];
    if (step === 0) {
      msg("思路：" + t.steps[0].zh + "；命令按设备分组，注意选中正确的设备。", "warn");
    } else if (step === 1) {
      msg(next ? "下一步：在 " + next.dev + " 上执行「" + next.text + "」/ Next: " + next.text : "命令已全部下发，点「验证」查看结果。", "warn");
    } else {
      var checks = t.checks.filter(function (c, i) {
        var r = S.results[t.id];
        return !r || !r[i];
      });
      msg(checks.length ? "未通过项：" + checks[0].zh + "（" + checks[0].en + "）" : "全部通过，点击「验证」完成任务。", "warn");
    }
  }

  /* ============================================================
     消息 / HUD
     ============================================================ */
  function msg(text, kind) {
    var el = $("msg");
    el.textContent = text;
    el.className = "msg " + (kind || "");
  }
  function reportEl() { return document.querySelector(".reportcard"); }
  function hud(text, kind) {
    var el = $("hud");
    el.hidden = false;
    el.textContent = text;
    el.className = "hud " + (kind || "");
  }

  /* ============================================================
     画布 / Topology canvas
     ============================================================ */
  function nsize(n) {
    if (n.type === "pc") return { w: 132, h: 84 };
    if (n.type === "cloud") return { w: 172, h: 92 };
    if (n.type === "switch") return { w: 148, h: 98 };
    return { w: 154, h: 98 };
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function fit() {
    var wrap = $("canvasWrap");
    if (!wrap) return;
    var r = wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    view.dpr = dpr;
    view.scale = Math.min(r.width / VW, r.height / VH) * 0.96;
    view.ox = (r.width - VW * view.scale) / 2;
    view.oy = (r.height - VH * view.scale) / 2;
    draw();
  }
  function anchor(n, tx, ty) {
    var sz = nsize(n);
    var dx = tx - n.x, dy = ty - n.y;
    if (!dx && !dy) return { x: n.x, y: n.y };
    var sx = dx === 0 ? Infinity : (sz.w / 2) / Math.abs(dx);
    var sy = dy === 0 ? Infinity : (sz.h / 2) / Math.abs(dy);
    var k = Math.min(sx, sy);
    return { x: n.x + dx * k, y: n.y + dy * k };
  }
  function ipsLine(n) {
    if (n.type === "pc") return "";
    if (n.type === "cloud") return "";
    var s = st();
    if (n.id === "SW") {
      var sw = s.vlan.SW;
      if (sw && sw.created.length) return "VLAN " + sw.created.join(" / ");
      return "未划分 VLAN";
    }
    var list = [];
    var ifs = s.iface[n.id] || {};
    Object.keys(ifs).forEach(function (p) { list.push(ifs[p].split("/")[0]); });
    (s.sub[n.id] || []).forEach(function (x) { if (x.ip) list.push(x.ip.split("/")[0]); });
    if (!list.length) return "未配置接口";
    return list.slice(0, 2).join(" · ") + (list.length > 2 ? " …" : "");
  }
  function draw() {
    if (!ctx) return;
    var t = task(), s = st();
    var W = cv.width / view.dpr, H = cv.height / view.dpr;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!t.topo) return;
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);

    /* canvas header */
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#9AA8B8";
    ctx.font = "14px Microsoft YaHei, system-ui, sans-serif";
    ctx.fillText("GlobalTech · 企业网络路由部署 / Enterprise Routing Deployment", 26, 32);
    ctx.fillStyle = "#22364D";
    ctx.font = "700 20px Microsoft YaHei, system-ui, sans-serif";
    ctx.fillText("任务 " + (t.no < 10 ? "0" + t.no : t.no) + " · " + t.zh, 26, 58);

    /* zones */
    if (t.topo.zones) {
      t.topo.zones.forEach(function (z) {
        ctx.save();
        roundRect(ctx, z.x, z.y, z.w, z.h, 18);
        ctx.fillStyle = z.color + "0D";
        ctx.fill();
        ctx.setLineDash([7, 6]);
        ctx.strokeStyle = z.color + "66";
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = z.color;
        ctx.font = "600 16px Microsoft YaHei, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(z.label, z.x + 14, z.y + 11);
        ctx.restore();
      });
    }

    /* links */
    t.topo.links.forEach(function (ln) {
      var a = nodeById(ln.a), b = nodeById(ln.b);
      var pa = anchor(a, b.x, b.y), pb = anchor(b, a.x, a.y);
      ctx.save();
      ctx.strokeStyle = "#CFDCEA";
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.restore();

      /* subnet label — lifted above the device row to avoid overlap */
      var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      var horizontal = Math.abs(pb.x - pa.x) >= Math.abs(pb.y - pa.y);
      var lx, ly;
      if (horizontal) {
        lx = mx;
        ly = my - 78;
      } else {
        lx = mx - 84;
        ly = my - 2;
      }
      ctx.font = "15px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var tw = ctx.measureText(ln.net).width;
      if (horizontal) {
        ctx.save();
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "#E3EBF4";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(mx, my - 64);
        ctx.lineTo(mx, my - 9);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      roundRect(ctx, lx - tw / 2 - 8, ly - 12, tw + 16, 24, 7);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = "#E1E9F2";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#7E90A4";
      ctx.fillText(ln.net, lx, ly + 1);
    });

    /* active path highlight */
    if (anim) {
      for (var i = 0; i < anim.segs.length; i++) {
        var sg = anim.segs[i];
        var qa = anchor(sg.a, sg.b.x, sg.b.y), qb = anchor(sg.b, sg.a.x, sg.a.y);
        ctx.save();
        ctx.strokeStyle = anim.ok ? "rgba(47,111,235,.20)" : "rgba(194,75,75,.16)";
        ctx.lineWidth = 9;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(qa.x, qa.y);
        ctx.lineTo(qb.x, qb.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    /* nodes */
    t.topo.nodes.forEach(function (n) {
      var sz = nsize(n);
      var x = n.x - sz.w / 2, y = n.y - sz.h / 2;
      var accent = n.accent || (n.type === "router" ? "#2F6FEB" : n.type === "switch" ? "#0F7E7E" : n.type === "cloud" ? "#6D7F93" : "#6D7F93");
      ctx.save();
      ctx.shadowColor = "rgba(17,38,66,.07)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      roundRect(ctx, x, y, sz.w, sz.h, 15);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.restore();
      roundRect(ctx, x, y, sz.w, sz.h, 15);
      ctx.strokeStyle = "#D8E2EE";
      ctx.lineWidth = 1.4;
      ctx.stroke();

      /* icon bubble */
      var bx = x + 33, by = n.type === "pc" ? n.y : n.y - 17;
      ctx.beginPath();
      ctx.arc(bx, by, 19, 0, Math.PI * 2);
      ctx.fillStyle = accent + "14";
      ctx.fill();
      ctx.strokeStyle = accent + "33";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawIcon(n.type, bx, by, accent);

      /* label */
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#22364D";
      ctx.font = "700 25px Microsoft YaHei, system-ui, sans-serif";
      if (n.type === "pc") {
        ctx.fillText(n.label, x + 59, n.y - 6);
        ctx.fillStyle = "#8194A8";
        ctx.font = "13.5px Consolas, monospace";
        ctx.fillText(n.sub, x + 59, n.y + 18);
      } else {
        ctx.fillText(n.label, x + 59, n.y - 8);
        ctx.fillStyle = "#8194A8";
        ctx.font = "13.5px Consolas, monospace";
        ctx.fillText(n.sub, x + 59, n.y + 13);
        var line = ipsLine(n);
        if (line) {
          ctx.textAlign = "center";
          ctx.fillStyle = n.id === "SW" ? "#8A6414" : "#5E7188";
          ctx.font = "13px Consolas, monospace";
          ctx.fillText(line, n.x, y + sz.h - 13, sz.w - 18);
        }
      }

      /* badge */
      if (n.badge) {
        ctx.font = "600 11.5px Microsoft YaHei, system-ui, sans-serif";
        var bw = ctx.measureText(n.badge).width + 14;
        roundRect(ctx, x + sz.w - bw - 8, y + 8, bw, 20, 9);
        ctx.fillStyle = "#EEF4FE";
        ctx.fill();
        ctx.strokeStyle = "#D6E4FA";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#2F6FEB";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.badge, x + sz.w - bw / 2 - 8, y + 18.5);
      }
    });

    /* packet */
    if (anim) drawPacket();

    /* bottom hint */
    /* bottom legend + hint */
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#93A4B6";
    ctx.font = "13px Microsoft YaHei, system-ui, sans-serif";
    ctx.fillText(t.legend.join("     ·     "), 22, VH - 42);
    ctx.fillStyle = "#A9B6C5";
    ctx.fillText("点击右上角按钮发送测试包，观察数据包路径 / Send a test packet to trace the path", 22, VH - 16);
  }
  function drawIcon(type, x, y, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (type === "router") {
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 5); ctx.lineTo(x + 9, y - 5);
      ctx.moveTo(x + 5, y - 9); ctx.lineTo(x + 9, y - 5); ctx.lineTo(x + 5, y - 1);
      ctx.moveTo(x + 9, y + 6); ctx.lineTo(x - 9, y + 6);
      ctx.moveTo(x - 5, y + 2); ctx.lineTo(x - 9, y + 6); ctx.lineTo(x - 5, y + 10);
      ctx.stroke();
    } else if (type === "switch") {
      [-1, 1].forEach(function (sx) {
        [-1, 1].forEach(function (sy) {
          ctx.strokeRect(x + sx * 6 - 4, y + sy * 5 - 3.5, 7, 7);
        });
      });
    } else if (type === "pc") {
      ctx.strokeRect(x - 9, y - 7, 18, 12);
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 9); ctx.lineTo(x + 4, y + 9);
      ctx.moveTo(x, y + 5); ctx.lineTo(x, y + 9);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x - 5, y + 2, 6, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(x - 1, y - 4, 8, Math.PI, Math.PI * 1.9);
      ctx.arc(x + 7, y + 2, 5, Math.PI * 1.4, Math.PI * 0.5);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawPacket() {
    var seg = anim.segs[anim.seg];
    if (!seg) return;
    var pa = anchor(seg.a, seg.b.x, seg.b.y), pb = anchor(seg.b, seg.a.x, seg.a.y);
    var x = pa.x + (pb.x - pa.x) * anim.p;
    var y = pa.y + (pb.y - pa.y) * anim.p;
    var color = anim.ok ? "#2F6FEB" : "#C24B4B";

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = color + "1F";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    var tag = anim.tag(anim.seg);
    if (tag) {
      ctx.font = "600 13px Consolas, monospace";
      var tw = ctx.measureText(tag).width;
      var tx = x + 16, ty = y - 24;
      roundRect(ctx, tx, ty, tw + 14, 21, 8);
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.fill();
      ctx.strokeStyle = color + "44";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(tag, tx + 7, ty + 11);
    }
    if (anim.done && !anim.ok) {
      ctx.strokeStyle = "#C24B4B";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - 9, y - 9); ctx.lineTo(x + 9, y + 9);
      ctx.moveTo(x + 9, y - 9); ctx.lineTo(x - 9, y + 9);
      ctx.stroke();
    }
    if (anim.done && anim.ok) {
      ctx.beginPath();
      ctx.arc(x, y, 18 + Math.sin(Date.now() / 160) * 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(24,138,94,.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ============================================================
     数据包动画 / Packet animation
     ============================================================ */
  function animatePath(ids, ok) {
    return new Promise(function (resolve) {
      var segs = [];
      for (var i = 0; i < ids.length - 1; i++) {
        segs.push({ a: nodeById(ids[i]), b: nodeById(ids[i + 1]) });
      }
      if (!segs.length) { resolve(); return; }
      var DUR = 560, GAP = 110;
      var start = performance.now();
      var t = task();
      anim = {
        segs: segs, seg: 0, p: 0, ok: ok, done: false,
        tag: function (i) {
          if (t.id === "t5") {
            if (i <= 1) return "802.1Q · VID 10";
            if (i === 2) return "802.1Q · VID 20";
            return "Untagged";
          }
          return "ICMP";
        }
      };
      function frame(now) {
        var el = now - start;
        var per = DUR + GAP;
        var idx = Math.max(0, Math.min(segs.length - 1, Math.floor(el / per)));
        var local = (el - idx * per) / DUR;
        if (local > 1) local = 1;
        if (local < 0) local = 0;
        anim.seg = idx;
        anim.p = local;
        draw();
        if (el < segs.length * per - GAP) {
          requestAnimationFrame(frame);
        } else {
          anim.done = true;
          anim.p = 1;
          draw();
          setTimeout(function () {
            anim = null;
            draw();
            resolve();
          }, 900);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  /* ============================================================
     发送测试包 / Ping
     ============================================================ */
  function renderPingTools() {
    var t = task();
    var host = $("pingtools");
    host.innerHTML = "";
    (t.pings || []).forEach(function (p) {
      var b = document.createElement("button");
      b.className = "pingbtn";
      b.setAttribute("data-id", p.id);
      b.innerHTML = '<svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true"><path d="M2 1.4v9.2c0 .5.5.8.9.5l7-4.6a.6.6 0 0 0 0-1L2.9.9a.6.6 0 0 0-.9.5Z"/></svg>' + esc(p.label);
      b.addEventListener("click", function () { doPing(p.id); });
      host.appendChild(b);
    });
    updatePingButtons();
  }
  function updatePingButtons() {
    var btns = $("pingtools").querySelectorAll(".pingbtn");
    for (var i = 0; i < btns.length; i++) btns[i].disabled = S.animating;
  }
  function doPing(pid) {
    if (S.animating) return;
    var t = task(), s = st();
    var p = (t.pings || []).filter(function (x) { return x.id === pid; })[0];
    if (!p) return;
    var info = p.run(s);
    S.animating = true;
    updatePingButtons();
    renderQueue();
    log("cmd", "<PC1>", p.cmd);
    hud("数据包发送中… / Sending packet…", "");
    animatePath(info.path, info.ok).then(function () {
      if (info.ok) {
        log("ok", "Reply received：链路可达 / Path is reachable");
        log("note", info.reason);
        hud(info.reason, "good");
      } else {
        log("err", "Request timeout!");
        log("note", info.reason);
        hud(info.reason, "bad");
      }
      S.animating = false;
      s.pinged[t.id] = true;
      updatePingButtons();
      renderQueue();
      renderSteps();
      renderReport();
    });
  }

  /* ============================================================
     渲染总入口 / Render all
     ============================================================ */
  function renderAll() {
    renderRail();
    renderTaskCard();
    renderBank();
    renderQueue();
    renderReport();
    renderPingTools();
    fit();
  }

  /* ============================================================
     弹窗 / Modals
     ============================================================ */
  function openModal(html) {
    $("modalcard").innerHTML = html;
    $("modal").hidden = false;
  }
  function closeModal() { $("modal").hidden = true; }

  function showGuide() {
    openModal(
      '<h3>实验说明 <span style="font-size:12px;color:#7B8B9E;font-weight:400">Lab Guide</span></h3>' +
      '<p>本仿真对应《项目四 企业网络路由部署与优化》的 5 个任务，采用华为 VRP 命令风格，所有配置只在本页面内生效。</p>' +
      '<ul>' +
      '<li>从右侧「命令库」点击或拖拽命令，加入「执行队列」；可用 ↑ ↓ × 调整顺序。</li>' +
      '<li>命令按设备分组（R1 / R2 / R3 / SW），前置条件不满足时会给出提示并中断执行。</li>' +
      '<li>点击「执行」下发命令，点击「验证」运行 display / ping 检查并生成清单。</li>' +
      '<li>右上角「发送测试包」可查看数据包在拓扑中的实际路径与失败位置。</li>' +
      '<li>每个任务 5–7 项检查全部通过即完成，总分 100 分，进度保存在本机浏览器。</li>' +
      '</ul>' +
      '<p style="color:#7B8B9E;font-size:11.5px">建议顺序：任务一 → 任务二 → 任务三 → 任务四 → 任务五，任务五综合性最强。</p>' +
      '<div class="mact"><button data-close="1">知道了 Close</button></div>'
    );
  }
  function showResult() {
    var total = doneCount() * 20;
    var rows = TASKS.map(function (t) {
      var d = S.progress.done[t.id];
      return '<div class="sumrow"><b>T' + t.no + '</b><span>' + esc(t.zh) + "</span><em>" + (d ? "完成 20" : "未完成") + "</em></div>";
    }).join("");
    openModal(
      '<h3>实验完成 <span style="font-size:12px;color:#7B8B9E;font-weight:400">Experiment Completed</span></h3>' +
      '<p>已完成 GlobalTech 企业网络路由部署的 5 个任务：从直连路由认知，到静态路由、RIP、OSPF，最后用单臂路由打通 VLAN。</p>' +
      '<div class="bigscore"><b>' + total + '</b><span>/ 100 分</span></div>' +
      '<div class="sumlist">' + rows + "</div>" +
      '<div class="mact"><button data-close="1">关闭 Close</button><button class="primary" data-print="1">打印报告 Print</button></div>'
    );
  }

  /* ============================================================
     事件绑定 / Bindings
     ============================================================ */
  function bind() {
    $("btnRun").addEventListener("click", runQueue);
    $("btnVerify").addEventListener("click", verify);
    $("btnHint").addEventListener("click", hint);
    $("btnGuide").addEventListener("click", showGuide);
    $("btnClearTerm").addEventListener("click", function () {
      S.logs[task().id] = [];
      renderTerm();
    });
    $("btnClearQ").addEventListener("click", function () {
      S.queues[task().id] = [];
      renderQueue();
    });
    $("btnResetTask").addEventListener("click", function () {
      var t = task();
      S.states[t.id] = fresh(t);
      S.queues[t.id] = [];
      S.logs[t.id] = [];
      S.results[t.id] = null;
      S.hint[t.id] = 0;
      $("hud").hidden = true;
      renderAll();
      welcome(t);
      renderTerm();
      msg("本任务已重置 / Task reset", "");
    });
    $("btnResetAll").addEventListener("click", function () {
      if (!window.confirm("重置全部任务与得分？/ Reset all progress?")) return;
      try { localStorage.removeItem(STORE); } catch (e) {}
      window.location.reload();
    });

    $("queue").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn) return;
      var q = queue();
      var i = Number(btn.getAttribute("data-i"));
      var act = btn.getAttribute("data-act");
      if (act === "del") q.splice(i, 1);
      if (act === "up" && i > 0) q.splice(i - 1, 0, q.splice(i, 1)[0]);
      if (act === "down" && i < q.length - 1) q.splice(i + 1, 0, q.splice(i, 1)[0]);
      renderQueue();
    });
    var qbox = $("queue");
    qbox.addEventListener("dragover", function (e) {
      e.preventDefault();
      qbox.classList.add("drop");
    });
    qbox.addEventListener("dragleave", function () { qbox.classList.remove("drop"); });
    qbox.addEventListener("drop", function (e) {
      e.preventDefault();
      qbox.classList.remove("drop");
      var id = e.dataTransfer.getData("text/plain");
      if (id) addToQueue(id);
    });

    $("modal").addEventListener("click", function (e) {
      if (e.target === $("modal")) { closeModal(); return; }
      if (e.target.getAttribute && e.target.getAttribute("data-close")) { closeModal(); return; }
      if (e.target.getAttribute && e.target.getAttribute("data-print")) { window.print(); }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
    window.addEventListener("resize", fit);
    if (window.ResizeObserver) {
      new ResizeObserver(function () { fit(); }).observe($("canvasWrap"));
    }
  }

  /* ============================================================
     启动 / Init
     ============================================================ */
  function init() {
    cv = $("topo");
    ctx = cv.getContext("2d");
    bind();
    var first = 0;
    for (var i = 0; i < TASKS.length; i++) {
      if (!S.progress.done[TASKS[i].id]) { first = i; break; }
    }
    S.ti = first;
    renderAll();
    welcome(task());
    renderTerm();
    setTimeout(fit, 60);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

