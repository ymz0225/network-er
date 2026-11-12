(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var TASKS = window.TASKS;
  var STORE = "gtrs_3d_v1";
  var SHORT = { t1: "路由原理", t2: "静态路由", t3: "RIPv2", t4: "OSPF", t5: "单臂路由" };
  var STEP_SHORT = {
    t1: ["R1 接口寻址", "R2 接口寻址", "观察与测试"],
    t2: ["R1 去程路由", "R2 回程路由", "默认路由"],
    t3: ["启动 RIPv2", "宣告网段", "收敛检查"],
    t4: ["启动 OSPF", "区域宣告", "邻居检查"],
    t5: ["VLAN 与 Access", "Trunk 干道", "子接口"]
  };
  var KNOW = {
    t1: "直连路由只包含接口所在网段。跨网段数据包必须命中静态或动态路由，否则会在路由器上被丢弃。",
    t2: "静态路由优先级 60。只配去程、不配回程会造成“请求能到、响应回不来”的单向连通。",
    t3: "RIPv2 用跳数作为 Cost，最大 15 跳；每 30 秒周期更新，收敛速度较慢。",
    t4: "OSPF 用反掩码宣告网段，Area 0 是骨干区域；同时连接两个区域的 R2 是 ABR。",
    t5: "单臂路由三件套：子接口 + dot1q termination vid + arp broadcast enable，缺一不可。"
  };
  var DEV_NAME = { R1: "核心路由器", R2: "区域路由器", R3: "分支路由器", SW: "接入交换机", PC1: "办公终端", PC2: "财务终端", PC3: "分支终端", Internet: "互联网出口" };
  var DEV_CLASS = { R1: "r1", R2: "r2", R3: "r3", SW: "sw", PC1: "r3", PC2: "r2", PC3: "r1", Internet: "sw" };

  var S = {
    ti: 0,
    states: {},
    queues: {},
    logs: {},
    results: {},
    hint: {},
    progress: loadProgress(),
    animating: false,
    tab: "cmd"
  };

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
  function doneCount() {
    return Object.keys(S.progress.done).filter(function (k) { return S.progress.done[k]; }).length;
  }
  function tileById(id) {
    return task().bank.filter(function (b) { return b.id === id; })[0];
  }
  function hexOf(port) { return "GigabitEthernet" + String(port).replace(/^G/, ""); }
  function isDeviceUp(node, s) {
    if (node.type === "pc" || node.type === "cloud") return true;
    if (node.type === "switch") return !!(s.vlan.SW && s.vlan.SW.created.length);
    return Object.keys(s.iface[node.id] || {}).length > 0 || (s.sub[node.id] || []).length > 0;
  }

  /* ============================================================
     3D 数字孪生场景 / Three.js lab
     ============================================================ */
  var Lab = (function () {
    var THREE = window.THREE;
    var MAP = 88, CX = 500, CZ = 280;
    var canvas, renderer, scene, camera, root, labelHost;
    var clockLast = performance.now();
    var orbit = { theta: 0, phi: 0.9, radius: 20, target: new THREE.Vector3(0, 0.4, 0) };
    var desired = { theta: 0, phi: 0.9, radius: 20, target: new THREE.Vector3(0, 0.4, 0) };
    var nodeObjs = {}, links = {}, labels = [], pickables = [];
    var materials = [], geometries = [], textures = [];
    var cloudHolder = null, platformRings = [];
    var packetAnim = null, fxList = [], glows = [], flowSprites = [];
    var selectedId = null;
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var down = null, dragged = false;
    var onSelectCb = null, onReadyCb = null;
    var started = false;
    var glowTex = null;
    var tmpV = new THREE.Vector3();
    var reduceMotion = false;

    function nodePos(n) {
      var zs = task().id === "t5" ? 1.35 : 1;
      return { x: (n.x - CX) / MAP, z: ((n.y - CZ) / MAP) * zs };
    }
    var ACCENTS = { R1: 0x4c8dff, R2: 0xa78bfa, R3: 0x38e7d8, SW: 0xffb454, PC1: 0xffb454, PC2: 0xa78bfa, PC3: 0x4fe3ff, Internet: 0x4fe3ff };
    function accentOf(node) {
      if (node.accent) return parseInt(String(node.accent).replace("#", ""), 16);
      return ACCENTS[node.id] || 0x4fe3ff;
    }
    function track(o) {
      if (o && o.geometry) geometries.push(o.geometry);
      if (o && o.material) {
        if (Array.isArray(o.material)) o.material.forEach(function (m) { materials.push(m); });
        else materials.push(o.material);
      }
      return o;
    }
    function mesh(geo, mat) {
      var m = new THREE.Mesh(geo, mat);
      track(geo); track(mat);
      return m;
    }
    function box(w, h, d, mat) {
      return mesh(new THREE.BoxGeometry(w, h, d), mat);
    }
    function makeGlowTexture() {
      var c = document.createElement("canvas");
      c.width = c.height = 128;
      var g = c.getContext("2d");
      var grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(0.22, "rgba(150,240,255,.9)");
      grad.addColorStop(0.55, "rgba(79,227,255,.28)");
      grad.addColorStop(1, "rgba(79,227,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      var t = new THREE.CanvasTexture(c);
      return t;
    }
    function makeBackdropTexture() {
      var c = document.createElement("canvas");
      c.width = 16; c.height = 512;
      var g = c.getContext("2d");
      var grad = g.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, "#02060b");
      grad.addColorStop(0.5, "#041019");
      grad.addColorStop(0.82, "#051924");
      grad.addColorStop(1, "#082630");
      g.fillStyle = grad;
      g.fillRect(0, 0, 16, 512);
      return new THREE.CanvasTexture(c);
    }
    function makePlatformTexture() {
      var c = document.createElement("canvas");
      c.width = c.height = 1024;
      var g = c.getContext("2d");
      g.fillStyle = "#06111c";
      g.fillRect(0, 0, 1024, 1024);
      var glow = g.createRadialGradient(512, 512, 40, 512, 512, 520);
      glow.addColorStop(0, "rgba(48,150,190,.16)");
      glow.addColorStop(0.55, "rgba(24,90,120,.08)");
      glow.addColorStop(1, "rgba(2,8,14,.0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, 1024, 1024);
      g.strokeStyle = "rgba(79,227,255,.085)";
      g.lineWidth = 1;
      for (var i = 0; i <= 1024; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
      }
      g.strokeStyle = "rgba(79,227,255,.16)";
      for (var j = 0; j <= 1024; j += 128) {
        g.beginPath(); g.moveTo(j, 0); g.lineTo(j, 1024); g.stroke();
        g.beginPath(); g.moveTo(0, j); g.lineTo(1024, j); g.stroke();
      }
      g.strokeStyle = "rgba(79,227,255,.2)";
      g.lineWidth = 2;
      [1.5, 3.0, 4.5, 5.6].forEach(function (r) {
        g.beginPath(); g.arc(512, 512, r * 60.5, 0, Math.PI * 2); g.stroke();
      });
      var edge = g.createRadialGradient(512, 512, 360, 512, 512, 512);
      edge.addColorStop(0, "rgba(0,0,0,0)");
      edge.addColorStop(1, "rgba(2,7,12,.85)");
      g.fillStyle = edge;
      g.fillRect(0, 0, 1024, 1024);
      return new THREE.CanvasTexture(c);
    }
    function screenTexture() {
      var c = document.createElement("canvas");
      c.width = 320; c.height = 200;
      var g = c.getContext("2d");
      g.fillStyle = "#06131F"; g.fillRect(0, 0, 320, 200);
      g.strokeStyle = "rgba(79,227,255,.16)"; g.lineWidth = 1;
      for (var x = 0; x <= 320; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 200); g.stroke(); }
      for (var y = 0; y <= 200; y += 25) { g.beginPath(); g.moveTo(0, y); g.lineTo(320, y); g.stroke(); }
      var grad = g.createLinearGradient(0, 0, 320, 200);
      grad.addColorStop(0, "rgba(79,227,255,.20)");
      grad.addColorStop(1, "rgba(76,141,255,.04)");
      g.fillStyle = grad; g.fillRect(16, 22, 288, 74);
      g.fillStyle = "#7FE8FF"; g.font = "600 20px Consolas, monospace";
      g.fillText("GLOBALTECH", 30, 58);
      g.fillStyle = "#38E7A6"; g.font = "12px Consolas, monospace";
      g.fillText("● ONLINE   VLAN 10", 30, 80);
      g.fillStyle = "rgba(140,190,220,.5)"; g.font = "10px Consolas, monospace";
      g.fillText("uplink  10.0.0.12", 30, 124);
      g.fillText("routes  0003", 30, 142);
      g.fillStyle = "rgba(79,227,255,.5)"; g.fillRect(16, 160, 288, 3);
      var t = new THREE.CanvasTexture(c);
      textures.push(t);
      return t;
    }

    function init(canvasEl, labelLayer) {
      canvas = canvasEl;
      labelHost = labelLayer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
      } catch (e) {
        var tip = document.createElement("div");
        tip.className = "noWebGL";
        tip.innerHTML = "当前浏览器未启用 WebGL，无法显示 3D 数字孪生场景。<br>请使用 Chrome / Edge 最新版，并开启硬件加速。<br><span style='font-size:10px;color:#51687D'>WEBGL UNAVAILABLE</span>";
        $("viewport").appendChild(tip);
        return false;
      }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x050c16);
      scene.fog = new THREE.Fog(0x050c16, 22, 46);

      camera = new THREE.PerspectiveCamera(40, 1, 0.1, 140);

      var hemi = new THREE.HemisphereLight(0x9fd8ff, 0x07121f, 0.48);
      scene.add(hemi);
      var key = new THREE.DirectionalLight(0xeaf8ff, 0.9);
      key.position.set(6, 15, 9);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -12;
      key.shadow.camera.right = 12;
      key.shadow.camera.top = 12;
      key.shadow.camera.bottom = -12;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 40;
      key.shadow.bias = -0.0006;
      scene.add(key);
      var rimA = new THREE.PointLight(0x2fd7ff, 24, 30);
      rimA.position.set(-7, 5, 5);
      scene.add(rimA);
      var rimB = new THREE.PointLight(0xff9a4c, 11, 26);
      rimB.position.set(7, 3, -5);
      scene.add(rimB);
      var fill = new THREE.DirectionalLight(0xbfe9ff, 0.5);
      fill.position.set(0, 3, 11);
      scene.add(fill);

      var skyTex = makeBackdropTexture();
      var sky = new THREE.Mesh(
        new THREE.SphereGeometry(60, 24, 16),
        new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false })
      );
      scene.add(sky);

      var platTex = makePlatformTexture();
      var baseMat = new THREE.MeshStandardMaterial({ color: 0x04101a, metalness: 0.6, roughness: 0.45 });
      var base = new THREE.Mesh(new THREE.CylinderGeometry(6.0, 5.65, 0.38, 8), baseMat);
      base.position.y = -0.2;
      base.receiveShadow = true;
      base.castShadow = true;
      scene.add(base);

      var topMat = new THREE.MeshBasicMaterial({ map: platTex });
      var top = new THREE.Mesh(new THREE.CircleGeometry(5.78, 96), topMat);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.002;
      scene.add(top);

      var shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(11.6, 11.6),
        new THREE.ShadowMaterial({ opacity: 0.46, color: 0x000000 })
      );
      shadowPlane.rotation.x = -Math.PI / 2;
      shadowPlane.position.y = 0.019;
      shadowPlane.receiveShadow = true;
      scene.add(shadowPlane);

      var rimMat = new THREE.MeshBasicMaterial({ color: 0x4fe3ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
      var rim = new THREE.Mesh(new THREE.RingGeometry(5.76, 5.81, 128), rimMat);
      rim.rotation.x = -Math.PI / 2;
      rim.position.y = 0.012;
      scene.add(rim);
      var rim2Mat = new THREE.MeshBasicMaterial({ color: 0x2fb8e0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
      var rim2 = new THREE.Mesh(new THREE.RingGeometry(5.52, 5.54, 128), rim2Mat);
      rim2.rotation.x = -Math.PI / 2;
      rim2.position.y = 0.011;
      scene.add(rim2);

      var under = new THREE.Mesh(
        new THREE.CylinderGeometry(5.85, 5.1, 0.08, 64),
        new THREE.MeshBasicMaterial({ color: 0x2fb8e0, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      under.position.y = -0.42;
      scene.add(under);

      var arcMat = new THREE.MeshBasicMaterial({ color: 0x2fb8e0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
      [[4.1, 0.4, 0.62], [5.0, 2.6, 0.5]].forEach(function (cfg) {
        var g = new THREE.Group();
        var arc = new THREE.Mesh(new THREE.RingGeometry(cfg[0], cfg[0] + 0.014, 96, 1, cfg[1], Math.PI * cfg[2]), arcMat);
        arc.rotation.x = -Math.PI / 2;
        arc.position.y = 0.014;
        g.add(arc);
        scene.add(g);
        platformRings.push(g);
      });

      var domeGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(6.05, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2));
      var domeMat = new THREE.LineBasicMaterial({ color: 0x2fb8e0, transparent: true, opacity: 0.05 });
      scene.add(new THREE.LineSegments(domeGeo, domeMat));

      var dotCount = 320;
      var pos = new Float32Array(dotCount * 3);
      for (var i = 0; i < dotCount; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 34;
        pos[i * 3 + 1] = Math.random() * 7 + 0.4;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 34;
      }
      var pgeo = new THREE.BufferGeometry();
      pgeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      var pmat = new THREE.PointsMaterial({ color: 0x2a87b8, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
      scene.add(new THREE.Points(pgeo, pmat));

      glowTex = makeGlowTexture();
      var backGlow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0x1f7fa8, transparent: true, opacity: 0.22,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      backGlow.position.set(0, 3.2, -10);
      backGlow.scale.set(24, 13, 1);
      scene.add(backGlow);

      root = new THREE.Group();
      scene.add(root);

      bindPointer();
      window.addEventListener("resize", resize);
      if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe($("viewport"));
      resize();
      loop();
      if (onReadyCb) onReadyCb();
      return true;
    }

    function makeMats() {
      var M = {};
      M.metal = new THREE.MeshStandardMaterial({ color: 0x0f2133, metalness: 0.72, roughness: 0.44 });
      M.metalDark = new THREE.MeshStandardMaterial({ color: 0x0d1b29, metalness: 0.65, roughness: 0.4 });
      M.panel = new THREE.MeshStandardMaterial({ color: 0x0b1a28, metalness: 0.5, roughness: 0.38 });
      M.portOff = new THREE.MeshStandardMaterial({ color: 0x081520, emissive: 0x0a2233, emissiveIntensity: 0.45, metalness: 0.5, roughness: 0.45 });
      M.portOn = new THREE.MeshStandardMaterial({ color: 0x0e2a3a, emissive: 0x4fe3ff, emissiveIntensity: 1.9, metalness: 0.4, roughness: 0.3 });
      M.portGreen = new THREE.MeshStandardMaterial({ color: 0x0e2a24, emissive: 0x38e7a6, emissiveIntensity: 1.7, metalness: 0.4, roughness: 0.3 });
      M.strip = new THREE.MeshStandardMaterial({ color: 0x123a4d, emissive: 0x4fe3ff, emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.4 });
      M.stripAmber = new THREE.MeshStandardMaterial({ color: 0x3a2a12, emissive: 0xffb454, emissiveIntensity: 1.0, metalness: 0.3, roughness: 0.4 });
      Object.keys(M).forEach(function (k) { materials.push(M[k]); });
      return M;
    }

    function pedestal(g, accent, r) {
      var ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
      track(ringMat);
      var ring = mesh(new THREE.RingGeometry(r - 0.035, r, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.015;
      g.add(ring);
      var fillMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
      track(fillMat);
      var fill = mesh(new THREE.CircleGeometry(r - 0.04, 64), fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.y = 0.014;
      g.add(fill);
      var outerMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
      track(outerMat);
      var outer = mesh(new THREE.RingGeometry(r + 0.1, r + 0.112, 64), outerMat);
      outer.rotation.x = -Math.PI / 2;
      outer.position.y = 0.013;
      g.add(outer);
      return { ring: ring, fill: fill, mat: ringMat };
    }

    function outline(m, color, opacity) {
      var eg = new THREE.EdgesGeometry(m.geometry);
      var em = new THREE.LineBasicMaterial({ color: color || 0x3a7fa5, transparent: true, opacity: opacity === undefined ? 0.3 : opacity });
      geometries.push(eg); materials.push(em);
      m.add(new THREE.LineSegments(eg, em));
    }
    function stripMaterial(accent) {
      var m = new THREE.MeshStandardMaterial({ color: 0x0e2a3a, emissive: accent, emissiveIntensity: 1.35, metalness: 0.3, roughness: 0.4 });
      materials.push(m);
      return m;
    }

    function buildRouter(node, M) {
      var g = new THREE.Group();
      var pos = nodePos(node);
      g.position.set(pos.x, 0, pos.z);
      var accent = accentOf(node);
      var pd = pedestal(g, accent, 0.98);
      var w = 1.76, h = 0.55, d = 0.96;
      var body = box(w, h, d, M.metal);
      body.position.y = 0.68;
      body.castShadow = true; body.receiveShadow = true;
      outline(body, 0x4b8fb5, 0.24);
      g.add(body);
      var top = box(w * 0.94, 0.03, d * 0.9, M.metalDark);
      top.position.y = 0.97;
      g.add(top);
      outline(top, 0x2e6d8e, 0.28);
      var front = box(w * 0.9, 0.38, 0.02, M.panel);
      front.position.set(0, 0.68, d / 2 + 0.012);
      g.add(front);
      var strip = box(w * 0.86, 0.018, 0.02, stripMaterial(accent));
      strip.position.set(0, 0.9, d / 2 + 0.02);
      g.add(strip);
      [-1, 1].forEach(function (sx) {
        var bar = box(0.02, 0.34, 0.02, stripMaterial(accent));
        bar.position.set(sx * w * 0.44, 0.66, d / 2 + 0.03);
        g.add(bar);
      });
      var ports = [];
      var pgeo = new THREE.BoxGeometry(0.108, 0.082, 0.03);
      geometries.push(pgeo);
      for (var i = 0; i < 8; i++) {
        var p = new THREE.Mesh(pgeo, M.portOff);
        p.position.set(-0.6 + i * 0.171, 0.67, d / 2 + 0.03);
        g.add(p);
        ports.push(p);
      }
      for (var l = 0; l < 3; l++) {
        var led = mesh(new THREE.SphereGeometry(0.02, 8, 8), l === 0 ? M.portGreen : M.portOn);
        led.position.set(w / 2 - 0.15 + l * 0.055, 0.89, d / 2 + 0.03);
        g.add(led);
      }
      [-1, 1].forEach(function (sx) {
        var ear = box(0.06, 0.6, 0.16, M.metalDark);
        ear.position.set(sx * (w / 2 + 0.025), 0.68, 0);
        g.add(ear);
      });
      for (var v = 0; v < 4; v++) {
        var vent = box(0.012, 0.3, 0.62, M.portOff);
        vent.position.set(w / 2 + 0.03, 0.68, 0);
        g.add(vent);
      }
      var handle = box(w * 0.4, 0.03, 0.05, M.metalDark);
      handle.position.set(0, 1.03, 0);
      g.add(handle);
      g.userData = { node: node, type: "router", ports: ports, size: { w: w, d: d }, ring: pd, accent: accent, anchor: new THREE.Vector3(pos.x, 1.5, pos.z) };
      return g;
    }

    function buildSwitch(node, M) {
      var g = new THREE.Group();
      var pos = nodePos(node);
      g.position.set(pos.x, 0, pos.z);
      var accent = accentOf(node);
      var pd = pedestal(g, accent, 1.05);
      var w = 1.94, h = 0.42, d = 1.04;
      var body = box(w, h, d, M.metal);
      body.position.y = 0.59;
      body.castShadow = true; body.receiveShadow = true;
      outline(body, 0x3f9b92, 0.24);
      g.add(body);
      var top = box(w * 0.95, 0.025, d * 0.92, M.metalDark);
      top.position.y = 0.81;
      g.add(top);
      outline(top, 0x2c6f68, 0.26);
      var front = box(w * 0.93, 0.3, 0.02, M.panel);
      front.position.set(0, 0.59, d / 2 + 0.012);
      g.add(front);
      var ports = [];
      var pgeo = new THREE.BoxGeometry(0.09, 0.062, 0.028);
      geometries.push(pgeo);
      for (var r = 0; r < 2; r++) {
        for (var i = 0; i < 6; i++) {
          var p = new THREE.Mesh(pgeo, M.portOff);
          p.position.set(-0.5 + i * 0.2, 0.655 - r * 0.1, d / 2 + 0.03);
          g.add(p);
          ports.push(p);
        }
      }
      var strip = box(w * 0.9, 0.015, 0.02, stripMaterial(accent));
      strip.position.set(0, 0.785, d / 2 + 0.02);
      g.add(strip);
      [-1, 1].forEach(function (sx) {
        var bar = box(0.02, 0.25, 0.02, stripMaterial(accent));
        bar.position.set(sx * w * 0.45, 0.58, d / 2 + 0.03);
        g.add(bar);
      });
      for (var l = 0; l < 4; l++) {
        var led = mesh(new THREE.SphereGeometry(0.017, 8, 8), l < 2 ? M.portGreen : M.portOn);
        led.position.set(w / 2 - 0.18 + l * 0.05, 0.785, d / 2 + 0.03);
        g.add(led);
      }
      g.userData = { node: node, type: "switch", ports: ports, size: { w: w, d: d }, ring: pd, accent: accent, anchor: new THREE.Vector3(pos.x, 1.34, pos.z) };
      return g;
    }

    function buildPC(node, M) {
      var g = new THREE.Group();
      var pos = nodePos(node);
      g.position.set(pos.x, 0, pos.z);
      var accent = accentOf(node);
      var pd = pedestal(g, accent, 0.72);
      var base = box(0.68, 0.06, 0.44, M.metalDark);
      base.position.y = 0.15;
      base.castShadow = true;
      g.add(base);
      var neck = box(0.11, 0.32, 0.11, M.metal);
      neck.position.y = 0.33;
      g.add(neck);
      var frame = box(1.04, 0.64, 0.06, M.metal);
      frame.position.y = 0.82;
      frame.castShadow = true;
      g.add(frame);
      outline(frame, 0x3d7fa6, 0.26);
      var scrMat = new THREE.MeshBasicMaterial({ map: screenTexture() });
      var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.56), scrMat);
      track(scrMat);
      scr.position.set(0, 0.82, 0.035);
      g.add(scr);
      var kb = box(0.7, 0.03, 0.24, M.panel);
      kb.position.set(0, 0.175, 0.38);
      g.add(kb);
      var power = mesh(new THREE.SphereGeometry(0.015, 8, 8), M.portGreen);
      power.position.set(0.45, 0.48, 0.035);
      g.add(power);
      g.userData = { node: node, type: "pc", ports: [], size: { w: 1.04, d: 0.52 }, ring: pd, accent: accent, anchor: new THREE.Vector3(pos.x, 1.42, pos.z + 0.05) };
      return g;
    }

    function buildCloud(node, M) {
      var g = new THREE.Group();
      var pos = nodePos(node);
      g.position.set(pos.x, 0, pos.z);
      var accent = 0x4fe3ff;
      var pd = pedestal(g, accent, 0.95);      var holder = new THREE.Group();
      holder.position.y = 1.42;
      var cloudMat = new THREE.MeshStandardMaterial({ color: 0x123b55, metalness: 0.2, roughness: 0.35, transparent: true, opacity: 0.62, emissive: 0x1e7ea8, emissiveIntensity: 0.45 });
      materials.push(cloudMat);
      var wireMat = new THREE.LineBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.4 });
      materials.push(wireMat);
      var specs = [[0, 0.18, 0, 0.66], [-0.55, -0.06, 0.1, 0.45], [0.55, -0.05, -0.08, 0.48], [0.1, -0.32, 0.28, 0.4]];
      specs.forEach(function (sp) {
        var geo = new THREE.IcosahedronGeometry(sp[3], 1);
        geometries.push(geo);
        var m = new THREE.Mesh(geo, cloudMat);
        m.position.set(sp[0], sp[1], sp[2]);
        holder.add(m);
        var wgeo = new THREE.WireframeGeometry(geo);
        geometries.push(wgeo);
        var wire = new THREE.LineSegments(wgeo, wireMat);
        wire.position.copy(m.position);
        holder.add(wire);
      });
      g.add(holder);
      cloudHolder = holder;
      g.userData = { node: node, type: "cloud", ports: [], size: { w: 1.6, d: 1.2 }, ring: pd, accent: accent, anchor: new THREE.Vector3(pos.x, 2.35, pos.z) };
      return g;
    }

    function buildDevice(node, M) {
      if (node.type === "router") return buildRouter(node, M);
      if (node.type === "switch") return buildSwitch(node, M);
      if (node.type === "cloud") return buildCloud(node, M);
      return buildPC(node, M);
    }

    function portPoint(obj, toward) {
      var n = obj.userData.node;
      var sz = obj.userData.size;
      var dx = toward.x - obj.position.x, dz = toward.z - obj.position.z;
      var y = n.type === "pc" ? 0.78 : n.type === "cloud" ? 1.3 : n.type === "switch" ? 0.59 : 0.68;
      if (Math.abs(dx) >= Math.abs(dz)) {
        return new THREE.Vector3(obj.position.x + Math.sign(dx) * (sz.w / 2 + 0.03), y, obj.position.z);
      }
      return new THREE.Vector3(obj.position.x, y, obj.position.z + Math.sign(dz) * (sz.d / 2 + 0.03));
    }

    function buildCable(aObj, bObj, M) {
      var p1 = portPoint(aObj, bObj.position);
      var p2 = portPoint(bObj, aObj.position);
      var down1 = p1.clone(); down1.y = 0.075;
      var down2 = p2.clone(); down2.y = 0.075;
      var curve = new THREE.CatmullRomCurve3([p1, down1, down2, p2], false, "catmullrom", 0.2);
      var tubeGeo = new THREE.TubeGeometry(curve, 48, 0.022, 6, false);
      var tubeMat = new THREE.MeshStandardMaterial({ color: 0x2a6a88, emissive: 0x2fb8e0, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3 });
      var tube = mesh(tubeGeo, tubeMat);
      root.add(tube);
      var glowMat = new THREE.MeshBasicMaterial({ color: 0x2fb8e0, transparent: true, opacity: 0.075, blending: THREE.AdditiveBlending, depthWrite: false });
      var glowGeo = new THREE.TubeGeometry(curve, 48, 0.06, 6, false);
      var glow = mesh(glowGeo, glowMat);
      root.add(glow);
      glows.push({ mesh: glow, mat: glowMat, base: 0.075 });
      var key = aObj.userData.node.id + "|" + bObj.userData.node.id;
      links[key] = { curve: curve, rev: false, glow: glowMat };
      links[bObj.userData.node.id + "|" + aObj.userData.node.id] = { curve: curve, rev: true, glow: glowMat };
    }

    function buildZones(t, M) {
      if (!t.topo.zones) return;
      t.topo.zones.forEach(function (z) {
        var zs = t.id === "t5" ? 1.35 : 1;
        var w = z.w / MAP, d = (z.h / MAP) * zs;
        var cx = (z.x + z.w / 2 - CX) / MAP;
        var cz = ((z.y + z.h / 2 - CZ) / MAP) * zs;
        var mat = new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.075, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        var plane = mesh(new THREE.PlaneGeometry(w, d), mat);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(cx, 0.016, cz);
        root.add(plane);
        var pts = [
          new THREE.Vector3(cx - w / 2, 0.02, cz - d / 2),
          new THREE.Vector3(cx + w / 2, 0.02, cz - d / 2),
          new THREE.Vector3(cx + w / 2, 0.02, cz + d / 2),
          new THREE.Vector3(cx - w / 2, 0.02, cz + d / 2)
        ];
        var lgeo = new THREE.BufferGeometry().setFromPoints(pts);
        var lmat = new THREE.LineBasicMaterial({ color: z.color, transparent: true, opacity: 0.55 });
        geometries.push(lgeo); materials.push(lmat);
        root.add(new THREE.LineLoop(lgeo, lmat));
      });
    }

    function addLabels(t) {
      var dense = t.id === "t3" || t.id === "t4";
      labelHost.classList.toggle("dense", dense);
      var LY = { R1: 1.74, R2: 1.3, R3: 1.74, PC1: 1.32, PC3: 1.32, PC2: 1.12 };
      t.topo.nodes.forEach(function (n) {
        var obj = nodeObjs[n.id];
        if (!obj) return;
        var el = document.createElement("div");
        el.className = "label3d";
        el.setAttribute("data-node", n.id);
        var accHex = accentOf(n).toString(16);
        while (accHex.length < 6) accHex = "0" + accHex;
        el.style.borderLeftColor = "#" + accHex;
        el.style.borderLeftWidth = "2px";
        el.innerHTML = '<span class="dot"></span><b>' + esc(n.label) + "</b><i>" + esc(n.sub) + "</i>" +
          (n.badge ? "<u>" + esc(n.badge) + "</u>" : "") +
          '<em data-ips="1"></em>';
        el.addEventListener("click", function (e) {
          e.stopPropagation();
          select(n.id);
        });
        labelHost.appendChild(el);
        var anchor = obj.userData.anchor.clone();
        if (dense && LY[n.id]) anchor.y = LY[n.id];
        labels.push({ el: el, anchor: anchor, id: n.id });
      });
    }

    function updateLabelIPs(s) {
      labels.forEach(function (L) {
        if (!L.id) return;
        var el = L.el.querySelector("[data-ips]");
        if (!el) return;
        var node = nodeObjs[L.id].userData.node;
        var txt = "";
        if (node.type === "router") {
          var ips = [];
          var ifs = s.iface[L.id] || {};
          Object.keys(ifs).forEach(function (p) { ips.push(ifs[p].split("/")[0]); });
          (s.sub[L.id] || []).forEach(function (x) { if (x.ip) ips.push(x.ip.split("/")[0]); });
          txt = ips.length ? ips.slice(0, 2).join(" · ") : "NO IP";
        } else if (node.type === "switch") {
          var sw = s.vlan.SW;
          txt = sw && sw.created.length ? "VLAN " + sw.created.join(" / ") : "NO VLAN";
        } else if (node.type === "cloud") {
          txt = "INTERNET EDGE";
        } else {
          txt = node.accent === "#C98A2E" ? "VLAN 10" : node.accent === "#7A5AF8" ? "VLAN 20" : "ACCESS";
        }
        el.textContent = txt;
        el.style.color = txt === "NO IP" || txt === "NO VLAN" ? "#C8935A" : "";
      });
    }

    function refresh(s) {
      Object.keys(nodeObjs).forEach(function (id) {
        var obj = nodeObjs[id];
        var node = obj.userData.node;
        var lit = 0, total = obj.userData.ports.length;
        if (node.type === "router") {
          lit = Object.keys(s.iface[id] || {}).length + (s.sub[id] || []).length;
        } else if (node.type === "switch") {
          var sw = s.vlan.SW;
          if (sw) lit = Object.keys(sw.access).length + Object.keys(sw.trunk).length;
        }
        obj.userData.ports.forEach(function (p, i) {
          p.material = i < lit ? (node.type === "switch" ? materialsSwitchOn : materialsPortOn) : materialsPortOff;
        });
        if (obj.userData.ring) {
          var up = isDeviceUp(node, s);
          obj.userData.ring.mat.opacity = up ? 0.66 : 0.32;
          obj.userData.ring.mat.color.setHex(obj.userData.accent);
        }
      });
      updateLabelIPs(s);
    }

    var materialsPortOn, materialsPortOff, materialsSwitchOn;
    function cachePortMats(M) {
      materialsPortOn = M.portOn;
      materialsPortOff = M.portOff;
      materialsSwitchOn = M.portGreen;
    }

    function clear() {
      labels.forEach(function (l) { if (l.el && l.el.parentNode) l.el.parentNode.removeChild(l.el); });
      labels = [];
      if (packetAnim && packetAnim.group) scene.remove(packetAnim.group);
      if (packetAnim && packetAnim.tag && packetAnim.tag.parentNode) packetAnim.tag.parentNode.removeChild(packetAnim.tag);
      packetAnim = null;
      fxList.forEach(function (f) { scene.remove(f.mesh); });
      fxList = [];
      if (root) {
        while (root.children.length) root.remove(root.children[0]);
      }
      nodeObjs = {}; links = {}; pickables = []; glows = []; cloudHolder = null;
      flowSprites.forEach(function (f) {
        scene.remove(f.sp);
        if (f.mat && f.mat.dispose) f.mat.dispose();
      });
      flowSprites = [];
      geometries.forEach(function (g) { if (g.dispose) g.dispose(); });
      materials.forEach(function (m) { if (m.dispose) m.dispose(); });
      textures.forEach(function (t) { if (t.dispose) t.dispose(); });
      geometries = []; materials = []; textures = [];
    }

    function build(t, s) {
      if (!renderer) return;
      clear();
      if (!glowTex) glowTex = makeGlowTexture();
      var M = makeMats();
      cachePortMats(M);
      buildZones(t, M);
      t.topo.nodes.forEach(function (n) {
        var obj = buildDevice(n, M);
        obj.userData.id = n.id;
        root.add(obj);
        nodeObjs[n.id] = obj;
        pickables.push(obj);
      });
      t.topo.links.forEach(function (ln, i) {
        var a = nodeObjs[ln.a], b = nodeObjs[ln.b];
        if (a && b) buildCable(a, b, M);
        var l = links[ln.a + "|" + ln.b];
        if (l) {
          var fm = new THREE.SpriteMaterial({
            map: glowTex, color: 0x5fe6ff, transparent: true, opacity: 0.35,
            blending: THREE.AdditiveBlending, depthWrite: false
          });
          var sp = new THREE.Sprite(fm);
          sp.scale.set(0.22, 0.22, 1);
          scene.add(sp);
          flowSprites.push({ sp: sp, mat: fm, curve: l.curve, rev: l.rev, phase: i * 0.21 });
        }
      });
      addLabels(t);
      refresh(s);
      if (!started) { fitView(true); started = true; } else { fitView(false); }
    }

    function fitView(snap) {
      if (!renderer || !root) return;
      var box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      var size = box.getSize(new THREE.Vector3());
      var center = box.getCenter(new THREE.Vector3());
      var cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
      var aspect = cw / ch;
      var vFov = camera.fov * Math.PI / 180;
      var hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      var usable = Math.max(cw * 0.5, cw - 36);
      var sceneW = Math.max(size.x, 10.6) + 2.4;
      var dist = (sceneW * cw) / (2 * Math.tan(hFov / 2) * usable) * 1.0 + 2.4;
      desired.target.set(center.x, Math.max(0.45, center.y * 0.55), center.z);
      desired.theta = 0;
      desired.phi = 1.08;
      desired.radius = Math.max(9, Math.min(24, dist));
      if (snap) {
        orbit.theta = desired.theta; orbit.phi = desired.phi; orbit.radius = desired.radius;
        orbit.target.copy(desired.target);
        updateCamera();
      }
    }

    function updateCamera() {
      var t = orbit.target;
      var sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
      camera.position.set(
        t.x + orbit.radius * sp * Math.sin(orbit.theta),
        t.y + orbit.radius * cp,
        t.z + orbit.radius * sp * Math.cos(orbit.theta)
      );
      camera.lookAt(t);
    }

    function resize() {
      if (!renderer) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function select(id, cb) {
      selectedId = id;
      labels.forEach(function (l) {
        if (l.el) l.el.classList.toggle("sel", l.id === id);
      });
      if (onSelectCb) onSelectCb(id);
    }

    function focus(id) {
      var obj = nodeObjs[id];
      if (!obj) return;
      var p = new THREE.Vector3();
      obj.getWorldPosition(p);
      desired.target.set(p.x, 0.55, p.z);
      desired.radius = 7.5;
      desired.phi = 0.85;
      desired.theta = 0.3;
    }

    function resetView() {
      fitView(false);
      desired.phi = 1.08;
      desired.theta = 0;
    }

    function updateLabels() {
      if (!labels.length || !camera) return;
      var w = canvas.clientWidth, h = canvas.clientHeight;
      labels.forEach(function (L) {
        if (!L.el) return;
        tmpV.copy(L.anchor).project(camera);
        var x = (tmpV.x * 0.5 + 0.5) * w;
        var y = (-tmpV.y * 0.5 + 0.5) * h;
        if (tmpV.z > 1 || x < -160 || x > w + 160 || y < -60 || y > h + 60) {
          L.el.style.display = "none";
          return;
        }
        L.el.style.display = "";
        if (L.center) L.el.style.transform = "translate(" + x + "px," + y + "px) translate(-50%,-50%)";
        else L.el.style.transform = "translate(" + x + "px," + y + "px) translate(-50%,-100%)";
      });
      var tag = document.querySelector(".packettag");
      if (tag && packetAnim && packetAnim.pos) {
        tmpV.copy(packetAnim.pos).project(camera);
        var tx = (tmpV.x * 0.5 + 0.5) * w;
        var ty = (-tmpV.y * 0.5 + 0.5) * h;
        tag.style.transform = "translate(" + tx + "px," + ty + "px) translate(-50%,-140%)";
      }
    }

    function bindPointer() {
      canvas.addEventListener("pointerdown", function (e) {
        down = { x: e.clientX, y: e.clientY };
        dragged = false;
        canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!down) return;
        var dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
        if (dragged) {
          desired.theta -= dx * 0.006;
          desired.phi = Math.max(0.38, Math.min(1.3, desired.phi - dy * 0.004));
          down = { x: e.clientX, y: e.clientY };
        }
      });
      canvas.addEventListener("pointerup", function (e) {
        if (!down) return;
        var wasDrag = dragged;
        down = null;
        if (wasDrag) return;
        var rect = canvas.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        var hits = raycaster.intersectObjects(pickables, true);
        if (hits.length) {
          var o = hits[0].object;
          while (o && !o.userData.node) o = o.parent;
          if (o && o.userData.node) select(o.userData.node.id);
        }
      });
      canvas.addEventListener("wheel", function (e) {
        e.preventDefault();
        desired.radius = Math.max(7, Math.min(32, desired.radius + e.deltaY * 0.012));
      }, { passive: false });
      canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }

    function loop(now) {
      requestAnimationFrame(loop);
      now = now || performance.now();
      var dt = Math.min(0.05, (now - clockLast) / 1000);
      clockLast = now;
      var k = 1 - Math.pow(0.001, dt);
      orbit.theta += (desired.theta - orbit.theta) * k;
      orbit.phi += (desired.phi - orbit.phi) * k;
      orbit.radius += (desired.radius - orbit.radius) * k;
      orbit.target.lerp(desired.target, k);
      updateCamera();
      if (cloudHolder) cloudHolder.rotation.y += dt * 0.16;
      platformRings.forEach(function (r, i) { r.rotation.y += dt * (i % 2 ? -0.06 : 0.04); });
      glows.forEach(function (g, i) {
        g.mat.opacity = g.base + Math.sin(now * 0.0016 + i) * 0.012;
      });
      flowSprites.forEach(function (f) {
        var u = (now * 0.00008 + f.phase) % 1;
        var p = f.curve.getPointAt(f.rev ? 1 - u : u);
        f.sp.position.copy(p);
        f.mat.opacity = 0.08 + 0.3 * Math.sin(u * Math.PI);
      });
      if (packetAnim) updatePacket(now);
      updateFX(dt);
      renderer.render(scene, camera);
      updateLabels();
    }

    function makePacket() {
      var group = new THREE.Group();
      var core = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 16), new THREE.MeshBasicMaterial({ color: 0xd8fbff }));
      group.add(core);
      var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x4fe3ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.set(0.72, 0.72, 1);
      group.add(halo);
      scene.add(group);
      return group;
    }

    function play(ids, ok) {
      if (!renderer) return Promise.resolve();
      var segs = [];
      for (var i = 0; i < ids.length - 1; i++) {
        var l = links[ids[i] + "|" + ids[i + 1]];
        if (l) segs.push(l);
      }
      if (!segs.length) return Promise.resolve();
      var group = makePacket();
      var tag = document.createElement("div");
      tag.className = "packettag";
      tag.textContent = "ICMP";
      $("viewport").appendChild(tag);
      var t = task();
      var start = performance.now();
      segs.forEach(function (sg) { sg.glow.opacity = 0.3; });
      packetAnim = {
        segs: segs, ids: ids, ok: ok, start: start, group: group, tag: tag,
        pos: new THREE.Vector3(), per: 620, gap: 110, dur: 0
      };
      return new Promise(function (resolve) {
        packetAnim.resolve = resolve;
      });
    }

    function updatePacket(now) {
      var p = packetAnim;
      if (!p || p.finishing) return;
      var elapsed = now - p.start;
      var per = p.per + p.gap;
      var idx = Math.max(0, Math.min(p.segs.length - 1, Math.floor(elapsed / per)));
      var local = Math.max(0, Math.min(1, (elapsed - idx * per) / p.per));
      var seg = p.segs[idx];
      var u = seg.rev ? 1 - local : local;
      var pos = seg.curve.getPointAt(u);
      p.pos.copy(pos);
      p.group.position.copy(pos);
      var n = idsTag(idx, p.ids);
      p.tag.textContent = n;
      p.tag.style.color = "#03131e";
      p.tag.style.background = "#4fe3ff";
      if (elapsed > p.segs.length * per) {
        finishPacket();
      }
    }

    function idsTag(i, ids) {
      if (task().id === "t5") {
        if (i <= 1) return "802.1Q · VID 10";
        if (i === 2) return "802.1Q · VID 20";
        return "UNTAGGED";
      }
      return "ICMP · " + ids[i] + " → " + ids[i + 1];
    }

    function finishPacket() {
      var p = packetAnim;
      if (!p || p.finishing) return;
      p.finishing = true;
      var end = p.segs[p.segs.length - 1];
      var endPos = end.curve.getPointAt(end.rev ? 0 : 1);
      burst(endPos, p.ok);
      if (p.ok) {
        p.group.position.copy(endPos);
      }
      var resolve = p.resolve;
      p.segs.forEach(function (sg) { sg.glow.opacity = 0.075; });
      setTimeout(function () {
        if (p.tag && p.tag.parentNode) p.tag.parentNode.removeChild(p.tag);
        scene.remove(p.group);
        p.group.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
        packetAnim = null;
        if (resolve) resolve();
      }, 560);
    }

    function burst(pos, ok) {
      var geo = new THREE.RingGeometry(0.05, 0.11, 40);
      var mat = new THREE.MeshBasicMaterial({ color: ok ? 0x38e7a6 : 0xff6b6b, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      var ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(pos);
      ring.position.y = Math.max(0.06, pos.y);
      scene.add(ring);
      fxList.push({ mesh: ring, mat: mat, life: 0, max: 0.8, geo: geo });
    }

    function updateFX(dt) {
      for (var i = fxList.length - 1; i >= 0; i--) {
        var f = fxList[i];
        f.life += dt;
        var t = f.life / f.max;
        f.mesh.scale.setScalar(1 + t * 7);
        f.mat.opacity = Math.max(0, 0.85 * (1 - t));
        if (t >= 1) {
          scene.remove(f.mesh);
          f.geo.dispose(); f.mat.dispose();
          fxList.splice(i, 1);
        }
      }
    }

    function setSelected(id) { selectedId = id; }

    return {
      init: init,
      build: build,
      refresh: refresh,
      play: play,
      focus: focus,
      resetView: resetView,
      select: select,
      resize: resize,
      onReady: function (cb) { onReadyCb = cb; },
      onSelect: function (cb) { onSelectCb = cb; }
    };
  })();

  /* ============================================================
     终端 / Terminal
     ============================================================ */
  function appendTerm(entry, box) {
    box = box || $("term");
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
    if (S.tab === "term") appendTerm(entry);
  }
  function renderTerm() {
    var box = $("term");
    box.innerHTML = "";
    logs().forEach(function (e) { appendTerm(e, box); });
    box.scrollTop = box.scrollHeight;
  }
  function welcome(t) {
    if (logs().length) return;
    log("out", "// MISSION " + t.no + " · " + t.zh + " / " + t.en);
    log("out", "// 3D 数字孪生场景已就绪。选择命令加入队列后执行。");
  }

  /* ============================================================
     顶部任务导航 / Stepper
     ============================================================ */
  function renderRail() {
    var host = $("rail");
    host.innerHTML = "";
    TASKS.forEach(function (t, i) {
      var b = document.createElement("button");
      b.className = "mstep" + (i === S.ti ? " on" : "") + (S.progress.done[t.id] ? " done" : "");
      b.innerHTML = '<span class="num">0' + t.no + '</span><span class="mlab"><b>' + SHORT[t.id] + "</b><i>" + esc(t.en).toUpperCase() + "</i></span>";
      b.addEventListener("click", function () { switchTask(i); });
      host.appendChild(b);
    });
    $("score").textContent = String(doneCount() * 20);
  }

  function switchTask(i) {
    if (S.animating || i === S.ti) return;
    S.ti = i;
    $("hud").hidden = true;
    hideInspector();
    msg("", "");
    renderAll();
    welcome(task());
    setTab("cmd");
    Lab.build(task(), st());
  }

  /* ============================================================
     任务面板 / Mission
     ============================================================ */
  function renderMission() {
    var t = task(), s = st();
    $("missionNo").textContent = "MISSION 0" + t.no;
    $("tasktag").textContent = t.tag;
    $("tasktitle").textContent = t.zh;
    $("tasken").textContent = t.en.toUpperCase();
    $("taskintro").innerHTML = esc(t.intro) + '<span class="en">' + esc(t.introEn) + "</span>";
    $("sceneTask").textContent = "MISSION 0" + t.no + " · " + t.en.toUpperCase();
    renderSteps();
    renderDevList();
    renderProgress();
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
      d.innerHTML = '<span class="sn">' + (isDone ? "✓" : no) + '</span><span class="sx">' + esc((STEP_SHORT[t.id] || [])[i] || step.zh) +
        '</span><span class="sc">' + (tiles.length ? done + "/" + tiles.length : (isDone ? "DONE" : "TEST")) + "</span>";
      host.appendChild(d);
    });
  }

  function renderDevList() {
    var t = task(), s = st();
    var host = $("devlist");
    host.innerHTML = "";
    t.topo.nodes.forEach(function (n) {
      var up = isDeviceUp(n, s);
      var detail = "";
      var right = "";
      if (n.type === "router") {
        var ips = Object.keys(s.iface[n.id] || {}).length + (s.sub[n.id] || []).length;
        right = ips + " IF";
        detail = ips ? "已配置接口 · " + ips + " up" : "未配置接口";
      } else if (n.type === "switch") {
        var sw = s.vlan.SW;
        right = sw ? (sw.created.length + " VLAN") : "0 VLAN";
        detail = sw && sw.created.length ? "VLAN " + sw.created.join(" / ") : "未创建 VLAN";
      } else if (n.type === "cloud") {
        right = "EDGE";
        detail = "8.8.8.8 · 互联网出口";
      } else {
        right = "ONLINE";
        detail = n.sub + " · 终端";
      }
      var btn = document.createElement("button");
      btn.className = "dsrow" + (up ? " up" : "");
      btn.innerHTML = '<span class="d"></span><b>' + esc(n.label) + '</b><span>' + esc(detail) + '</span><em>' + esc(right) + "</em>";
      btn.addEventListener("click", function () {
        Lab.focus(n.id);
        inspectDevice(n.id);
        Lab.select(n.id);
      });
      host.appendChild(btn);
    });
  }

  function renderProgress() {
    var t = task(), s = st();
    var totalTiles = t.bank.length;
    var applied = s.applied.length;
    var ratio = totalTiles ? applied / totalTiles : 0;
    if (S.results[t.id]) {
      var pass = 0;
      t.checks.forEach(function (c, i) { if (S.results[t.id][i]) pass++; });
      ratio = pass / t.checks.length;
    }
    if (S.progress.done[t.id]) ratio = 1;
    var pct = Math.round(ratio * 100);
    $("progressText").textContent = pct + "%";
    $("progressBar").style.width = pct + "%";
  }

  function renderTelemetry() {
    var t = task();
    $("telDev").textContent = String(t.topo.nodes.length);
    $("telLinks").textContent = String(t.topo.links.length);
    $("telState").textContent = S.progress.done[t.id] ? "PASS" : (S.results[t.id] ? "CHECK" : "READY");
  }

  /* ============================================================
     命令库 / Bank
     ============================================================ */
  function renderBank() {
    var t = task(), s = st();
    var host = $("bank");
    host.innerHTML = "";
    var devs = [];
    t.bank.forEach(function (b) { if (devs.indexOf(b.dev) < 0) devs.push(b.dev); });
    var pending = 0;
    devs.forEach(function (dev) {
      var all = t.bank.filter(function (b) { return b.dev === dev; });
      var left = all.filter(function (b) { return s.applied.indexOf(b.id) < 0; });
      pending += left.length;
      var g = document.createElement("div");
      g.className = "devgroup";
      var head = document.createElement("div");
      head.className = "devhead";
      head.innerHTML = '<span class="devchip ' + (DEV_CLASS[dev] || "r1") + '">' + dev + "</span><span>" +
        (DEV_NAME[dev] === "核心路由器" ? "路由器 ROUTER" : dev === "SW" ? "交换机 SWITCH" : dev === "R1" || dev === "R2" || dev === "R3" ? "路由器 ROUTER" : "设备") +
        '</span><span class="devcnt">' + (left.length ? left.length + " LEFT" : "DONE") + "</span>";
      g.appendChild(head);
      if (left.length) {
        var wrap = document.createElement("div");
        wrap.className = "tiles";
        left.forEach(function (b) {
          var el = document.createElement("div");
          el.className = "tile";
          el.setAttribute("role", "button");
          el.setAttribute("tabindex", "0");
          el.setAttribute("data-id", b.id);
          el.draggable = true;
          el.innerHTML = '<span class="s">' + b.step + '</span><span class="tx">' + esc(b.text) +
            '</span><span class="port">' + esc(b.port || "") + "</span>";
          el.addEventListener("click", function () { if (!S.animating) addToQueue(b.id); });
          el.addEventListener("dragstart", function (e) {
            e.dataTransfer.setData("text/plain", b.id);
            e.dataTransfer.effectAllowed = "copy";
          });
          wrap.appendChild(el);
        });
        g.appendChild(wrap);
      }
      host.appendChild(g);
    });
    var k = document.createElement("div");
    k.className = "knowcard";
    k.innerHTML = '<b>KNOWLEDGE <i>知识卡</i></b><p>' + esc(KNOW[t.id] || "") + "</p>";
    host.appendChild(k);
    $("bankcount").textContent = pending + " 条待下发 / AVAILABLE";
  }

  function addToQueue(id) {
    var q = queue();
    if (q.indexOf(id) >= 0 || st().applied.indexOf(id) >= 0) return;
    q.push(id);
    renderQueue();
    msg("已加入执行队列 / ADDED TO QUEUE", "");
  }

  function renderQueue() {
    var q = queue(), s = st();
    var host = $("queue");
    host.innerHTML = "";
    if (!q.length) {
      host.innerHTML = '<p class="empty">拖拽命令到这里 / DROP COMMANDS HERE</p>';
    } else {
      q.forEach(function (id, i) {
        var b = tileById(id);
        if (!b) return;
        var r = document.createElement("div");
        r.className = "qrow";
        r.innerHTML = '<span class="qn">' + (i + 1) + '</span><span class="qdev devchip ' + (DEV_CLASS[b.dev] || "r1") + '">' +
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
    $("btnVerify").disabled = S.animating;
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
    if (!q.length) { msg("先加入命令 / ADD COMMANDS FIRST", "bad"); return; }
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
    renderProgress();
    renderTelemetry();
    Lab.refresh(s);
    setTab("term");
    if (failed) {
      msg("执行中断：按提示修正顺序或补前置命令 / FIX AND RETRY", "bad");
    } else {
      log("ok", "// 已下发 " + applied.length + " 条命令 / " + applied.length + " COMMANDS APPLIED");
      msg("命令已下发，切换到「校验」检查结果 / READY TO VALIDATE", "ok");
    }
  }

  /* ============================================================
     验证 / Validate
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
        (res ? (res[i] ? "PASS" : "FAIL") : "PENDING") + "</span>";
      host.appendChild(d);
    });
    $("rcount").textContent = (res ? pass : 0) + " / " + t.checks.length;
    $("verifyhint").hidden = !!res;
    if (res) {
      var card = document.createElement("div");
      var allPass = pass === t.checks.length;
      card.className = "donecard " + (allPass ? "ok" : "bad");
      if (allPass) {
        var isLast = S.ti === TASKS.length - 1;
        card.innerHTML = '<b>MISSION COMPLETE</b><p>本任务全部检查通过，场景状态已同步。</p>' +
          (isLast ? '<button data-report="1">查看实验报告 REPORT</button>' : '<button data-next="1">进入下一任务 NEXT MISSION</button>');
      } else {
        card.innerHTML = '<b>' + (t.checks.length - pass) + ' CHECKS FAILED</b><p>按清单补齐配置后再次点击「验证」。</p><button data-back="1">返回命令台 COMMAND</button>';
      }
      host.appendChild(card);
      var btn = card.querySelector("button");
      if (btn) {
        btn.addEventListener("click", function () {
          if (btn.getAttribute("data-next")) switchTask(S.ti + 1);
          else if (btn.getAttribute("data-back")) setTab("cmd");
          else showResult();
        });
      }
    }
    renderProgress();
  }

  function verify() {
    if (S.animating) return;
    var t = task(), s = st();
    var res = {}, pass = 0;
    t.checks.forEach(function (c, i) {
      var ok = !!c.test(s);
      res[i] = ok;
      if (ok) pass++;
    });
    S.results[t.id] = res;
    t.verify(s).forEach(function (l) { log(l[0], l[1], l[2]); });
    renderReport();
    setTab("check");
    renderTelemetry();
    if (pass === t.checks.length) {
      log("ok", "// 全部检查通过 / ALL CHECKS PASSED");
      msg("验证通过：任务完成 / MISSION COMPLETE", "ok");
      markDone(t);
      hud("MISSION COMPLETE · " + t.zh + " 已完成", "good");
    } else {
      msg("通过 " + pass + " / " + t.checks.length + "，继续完善 / KEEP GOING", "warn");
      hud("还有 " + (t.checks.length - pass) + " 项未通过 / " + (t.checks.length - pass) + " CHECKS FAILED", "bad");
    }
    Lab.refresh(s);
  }

  function markDone(t) {
    if (S.progress.done[t.id]) { renderRail(); return; }
    S.progress.done[t.id] = true;
    saveProgress();
    renderRail();
    renderProgress();
    if (doneCount() === TASKS.length) setTimeout(showResult, 900);
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
      msg("思路：" + t.steps[0].zh + "。命令按设备分组，注意前置条件。", "warn");
    } else if (step === 1) {
      msg(next ? "下一步：在 " + next.dev + " 上执行「" + next.text + "」" : "命令已全部下发，点击「验证」。", "warn");
    } else {
      var checks = t.checks.filter(function (c, i) { var r = S.results[t.id]; return !r || !r[i]; });
      msg(checks.length ? "未通过项：" + checks[0].zh : "全部通过，点击「验证」完成任务。", "warn");
    }
    setTab("cmd");
  }

  function msg(text, kind) {
    var el = $("msg");
    el.textContent = text;
    el.className = "msg " + (kind || "");
  }
  function hud(text, kind) {
    var el = $("hud");
    el.hidden = false;
    el.textContent = text;
    el.className = "hud " + (kind || "");
    clearTimeout(hud._t);
    hud._t = setTimeout(function () { el.hidden = true; }, 6200);
  }

  /* ============================================================
     Tabs
     ============================================================ */
  function setTab(name) {
    S.tab = name;
    $$(".tabs button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === name); });
    ["cmd", "term", "check"].forEach(function (n) {
      $("tab-" + n).hidden = n !== name;
    });
    if (name === "term") {
      renderTerm();
      $("term").scrollTop = $("term").scrollHeight;
    }
    if (name === "check") renderReport();
  }

  /* ============================================================
     设备检视 / Inspector
     ============================================================ */
  function hideInspector() {
    $("inspector").hidden = true;
  }
  function inspectDevice(id) {
    var t = task(), s = st();
    var node = t.topo.nodes.filter(function (n) { return n.id === id; })[0];
    if (!node) return;
    var up = isDeviceUp(node, s);
    var rows = "";
    if (node.type === "router") {
      Object.keys(s.iface[id] || {}).forEach(function (p) {
        rows += '<div class="irow"><b>' + esc(hexOf(p)) + "</b><span>" + esc(s.iface[id][p]) + " · UP</span></div>";
      });
      (s.sub[id] || []).forEach(function (x) {
        if (x.ip) rows += '<div class="irow"><b>' + esc(hexOf(x.base + "." + x.vid)) + "</b><span>" + esc(x.ip) + " · 802.1Q " + x.vid + "</span></div>";
      });
      if (!rows) rows = '<div class="irow"><b>接口</b><span>未配置 NO IP</span></div>';
      var proto = s.ospf[id] ? "OSPF · " + s.ospf[id].rid : s.rip[id] ? "RIPv2" : (s.stat[id] || []).length || s.def[id] ? "STATIC" : "DIRECT";
      rows += '<div class="irow"><b>路由协议</b><span>' + esc(proto) + "</span></div>";
    } else if (node.type === "switch") {
      var sw = s.vlan.SW;
      if (sw) {
        rows += '<div class="irow"><b>VLAN</b><span>' + esc(sw.created.join(" / ") || "—") + "</span></div>";
        Object.keys(sw.access).forEach(function (p) {
          rows += '<div class="irow"><b>' + esc(p) + "</b><span>ACCESS · VLAN " + sw.access[p] + "</span></div>";
        });
        Object.keys(sw.trunk).forEach(function (p) {
          rows += '<div class="irow"><b>' + esc(p) + "</b><span>TRUNK · VLAN " + sw.trunk[p].join(",") + "</span></div>";
        });
      }
      if (!rows) rows = '<div class="irow"><b>VLAN</b><span>未创建 NO VLAN</span></div>';
    } else if (node.type === "cloud") {
      rows = '<div class="irow"><b>8.8.8.8</b><span>PUBLIC INTERNET</span></div>' +
        '<div class="irow"><b>出口</b><span>' + (s.def.R2 ? s.def.R2 : "未配置默认路由") + "</span></div>";
    } else {
      var vlan = node.accent === "#C98A2E" ? "VLAN 10" : node.accent === "#7A5AF8" ? "VLAN 20" : "ACCESS";
      rows = '<div class="irow"><b>IP</b><span>' + esc(node.sub) + "</span></div>" +
        '<div class="irow"><b>网关</b><span>' + (node.accent === "#C98A2E" ? "192.168.10.1" : node.accent === "#7A5AF8" ? "192.168.20.1" : "—") + "</span></div>" +
        '<div class="irow"><b>接入</b><span>' + vlan + "</span></div>";
    }
    var host = $("inspector");
    host.hidden = false;
    host.innerHTML = '<div class="ihead"><span class="itype">' + node.type.toUpperCase() + '</span><h4>' + esc(node.label) +
      '</h4><span class="ibadge">' + (up ? "ONLINE" : "IDLE") + '</span><button class="iclose">×</button></div>' +
      rows +
      '<div class="ifoot"><span>点击「聚焦」将镜头移向设备</span><button data-focus="' + esc(id) + '">聚焦 FOCUS</button></div>';
    host.querySelector(".iclose").addEventListener("click", hideInspector);
    host.querySelector("[data-focus]").addEventListener("click", function () { Lab.focus(id); });
  }

  /* ============================================================
     测试包 / Ping
     ============================================================ */
  function renderPingTools() {
    var t = task();
    var host = $("pingtools");
    host.innerHTML = "";
    (t.pings || []).forEach(function (p) {
      var b = document.createElement("button");
      b.className = "pingbtn";
      b.setAttribute("data-id", p.id);
      b.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.4v9.2c0 .5.5.8.9.5l7-4.6a.6.6 0 0 0 0-1L2.9.9a.6.6 0 0 0-.9.5Z"/></svg><span>' + esc(p.label) + '</span><em>TEST PACKET</em>';
      b.addEventListener("click", function () { doPing(p.id); });
      host.appendChild(b);
    });
    updatePingButtons();
  }
  function updatePingButtons() {
    $$("#pingtools .pingbtn").forEach(function (b) { b.disabled = S.animating; });
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
    hud("数据包注入中… / PACKET INJECTED", "");
    var started = Lab.play(info.path, info.ok);
    Promise.resolve(started).then(function () {
      if (info.ok) {
        log("ok", "Reply received：链路可达 / PATH REACHABLE");
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
      renderProgress();
      Lab.refresh(s);
    });
  }

  /* ============================================================
     通用渲染 / Render
     ============================================================ */
  function renderLegend() {
    var t = task();
    $("legend").innerHTML = (t.legend || []).map(function (x) { return "<span><i></i>" + esc(x) + "</span>"; }).join("");
  }
  function renderAll() {
    renderRail();
    renderMission();
    renderBank();
    renderQueue();
    renderReport();
    renderPingTools();
    renderLegend();
    renderTelemetry();
    $("score").textContent = String(doneCount() * 20);
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
      '<h3>3D 数字孪生实验室</h3><p class="sub">DIGITAL TWIN LAB GUIDE</p>' +
      '<p>本平台把《项目四 企业网络路由部署与优化》的 5 个任务，重建为可旋转、可交互的三维网络场景。设备、线缆、VLAN 与数据包都是实时 3D 对象。</p>' +
      '<ul>' +
      '<li><b>3D 视角：</b>拖拽旋转场景，滚轮缩放；点击设备或顶部设备芯片查看接口状态。</li>' +
      '<li><b>命令编排：</b>从右侧命令库点击或拖拽命令，进入执行队列；用 ↑ ↓ × 调整顺序。</li>' +
      '<li><b>执行与校验：</b>点击「执行」下发到设备，点击「验证」运行 display / ping 检查并生成清单。</li>' +
      '<li><b>测试包：</b>底部测试按钮会把数据包注入 3D 链路，可看到路径、VLAN 标签与失败位置。</li>' +
      '<li><b>计分：</b>每任务 20 分，5 个任务满分 100 分，进度保存在本机浏览器。</li>' +
      '</ul>' +
      '<p style="color:#5F778C;font-size:10px">建议使用 Chrome / Edge，并开启硬件加速以获得最佳 3D 效果。</p>' +
      '<div class="mact"><button data-close="1">进入实验室 ENTER LAB</button></div>'
    );
  }
  function showResult() {
    var total = doneCount() * 20;
    var rows = TASKS.map(function (t) {
      var d = S.progress.done[t.id];
      return '<div class="sumrow"><b>0' + t.no + '</b><span>' + esc(t.zh) + "</span><em>" + (d ? "COMPLETE · 20" : "PENDING") + "</em></div>";
    }).join("");
    openModal(
      '<h3>全部任务完成</h3><p class="sub">DIGITAL TWIN RUN COMPLETE</p>' +
      '<p>从直连路由认知，到静态路由、RIP、OSPF，最后用单臂路由打通 VLAN — 5 个任务已在 3D 场景中全部验证通过。</p>' +
      '<div class="bigscore"><b>' + total + '</b><span>/ 100 分</span></div>' +
      '<div class="sumlist">' + rows + "</div>" +
      '<div class="mact"><button data-close="1">关闭 CLOSE</button><button class="primary" data-print="1">打印报告 PRINT</button></div>'
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
      hideInspector();
      renderAll();
      setTab("cmd");
      welcome(t);
      renderTerm();
      Lab.build(t, st());
      msg("本任务已重置 / MISSION RESET", "");
    });
    $("btnResetAll").addEventListener("click", function () {
      if (!window.confirm("重置全部任务与得分？/ RESET ALL PROGRESS?")) return;
      try { localStorage.removeItem(STORE); } catch (e) {}
      window.location.reload();
    });
    $("btnViewReset").addEventListener("click", function () { Lab.resetView(); });
    $("btnFull").addEventListener("click", function () {
      if (!document.fullscreenElement) {
        (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
      } else {
        document.exitFullscreen && document.exitFullscreen();
      }
    });

    $$(".tabs button").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
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
    qbox.addEventListener("dragover", function (e) { e.preventDefault(); qbox.classList.add("drop"); });
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
      if (e.key === "Escape") { closeModal(); hideInspector(); }
    });
    window.addEventListener("resize", function () { if (Lab.resize) Lab.resize(); });
  }

  /* ============================================================
     启动 / Init
     ============================================================ */
  function init() {
    bind();
    Lab.onSelect(function (id) { inspectDevice(id); });
    var ok = Lab.init($("scene"), $("labels"));
    var first = 0;
    for (var i = 0; i < TASKS.length; i++) {
      if (!S.progress.done[TASKS[i].id]) { first = i; break; }
    }
    S.ti = first;
    renderAll();
    welcome(task());
    setTab("cmd");
    if (ok) Lab.build(task(), st());
    renderTerm();
    setTimeout(function () {
      $("loading").classList.add("out");
      setTimeout(function () { $("loading").style.display = "none"; }, 700);
    }, 700);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
