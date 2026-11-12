(function (global) {
  "use strict";

  /* ============================================================
     基础工具 / Shared helpers
     ============================================================ */
  function netOf(cidr) {
    var parts = cidr.split("/");
    var ip = parts[0].split(".").map(Number);
    var len = Number(parts[1]);
    var addr = ((ip[0] << 24) | (ip[1] << 16) | (ip[2] << 8) | ip[3]) >>> 0;
    var mask = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0;
    var net = (addr & mask) >>> 0;
    return [net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join(".") + "/" + len;
  }
  function ipOnly(cidr) { return cidr.split("/")[0]; }
  function ifaceOf(s, dev, port) {
    return s.iface[dev] ? s.iface[dev][port] : undefined;
  }
  function hasStatic(s, dev, net, len, nh) {
    return (s.stat[dev] || []).some(function (r) {
      return r.net === net && String(r.len) === String(len) && r.nh === nh;
    });
  }
  function hasDefault(s, dev, nh) {
    return s.def[dev] === nh;
  }
  function ripHas(s, dev, net) {
    var r = s.rip[dev];
    return !!(r && r.nets.indexOf(net) >= 0);
  }
  function ripReady(s, dev, nets) {
    var r = s.rip[dev];
    if (!r || r.ver !== 2) return false;
    return nets.every(function (n) { return r.nets.indexOf(n) >= 0; });
  }
  function ospfNetHas(s, dev, area, net, wc) {
    var o = s.ospf[dev];
    if (!o) return false;
    return o.nets.some(function (n) {
      return n.area === area && n.net === net && n.wc === wc;
    });
  }
  function ospfReady(s, dev, rid, areaNets) {
    var o = s.ospf[dev];
    if (!o || o.rid !== rid) return false;
    return areaNets.every(function (n) { return ospfNetHas(s, dev, n[0], n[1], n[2]); });
  }
  function ensureSw(s) {
    if (!s.vlan.SW) s.vlan.SW = { created: [], linkType: {}, access: {}, trunk: {} };
    return s.vlan.SW;
  }
  function subOf(s, dev, base, vid) {
    return (s.sub[dev] || []).filter(function (x) { return x.base === base && x.vid === vid; })[0];
  }
  function ensureSub(s, dev, base, vid) {
    if (!s.sub[dev]) s.sub[dev] = [];
    var x = subOf(s, dev, base, vid);
    if (!x) { x = { base: base, vid: vid, dot1q: false, ip: null, arp: false }; s.sub[dev].push(x); }
    return x;
  }
  function pad(v, n) { return String(v) + Array(Math.max(0, n - String(v).length) + 1).join(" "); }
  function fullIf(port) { return "GigabitEthernet" + String(port).replace(/^G/, ""); }
  function row(net, proto, pre, cost, nh, intf, flag) {
    return pad(net, 20) + pad(proto, 8) + pad(pre, 5) + pad(cost, 5) + pad(flag === undefined ? "D" : flag, 6) + pad(nh, 16) + intf;
  }
  function cols(vals, widths) {
    return vals.map(function (v, i) { return pad(v, widths[i] || 0); }).join("");
  }
  function routeHead() {
    return cols(["Destination/Mask", "Proto", "Pre", "Cost", "Flags", "NextHop", "Interface"], [20, 8, 5, 5, 6, 16, 0]);
  }

  /* ============================================================
     命令积木工厂 / Command tile factories
     ============================================================ */
  function ipTile(id, dev, step, port, cidr) {
    var cmd = "ip address " + cidr.replace("/", " ");
    return {
      id: id, dev: dev, step: step, port: port, text: cmd,
      lines: [["[" + dev + "]", "interface " + fullIf(port)],
              ["[" + dev + "-" + fullIf(port) + "]", cmd]],
      pre: function (s) {
        return ifaceOf(s, dev, port) ? "该接口已配置 IP，无需重复下发 / Interface already has an IP" : null;
      },
      run: function (s) {
        if (!s.iface[dev]) s.iface[dev] = {};
        s.iface[dev][port] = cidr;
      }
    };
  }
  function staticTile(id, dev, step, net, len, nh) {
    var cmd = "ip route-static " + net + " " + len + " " + nh;
    return {
      id: id, dev: dev, step: step, port: net + "/" + len, text: cmd,
      lines: [["[" + dev + "]", cmd]],
      pre: function (s) {
        return hasStatic(s, dev, net, len, nh) ? "该静态路由已存在 / Route already exists" : null;
      },
      run: function (s) {
        if (!s.stat[dev]) s.stat[dev] = [];
        s.stat[dev].push({ net: net, len: len, nh: nh });
      }
    };
  }
  function defaultTile(id, dev, step, nh) {
    var cmd = "ip route-static 0.0.0.0 0 " + nh;
    return {
      id: id, dev: dev, step: step, port: "0.0.0.0/0", text: cmd,
      lines: [["[" + dev + "]", cmd]],
      pre: function (s) {
        return s.def[dev] ? "默认路由已存在 / Default route already exists" : null;
      },
      run: function (s) { s.def[dev] = nh; }
    };
  }
  function ripStart(id, dev, step) {
    return {
      id: id, dev: dev, step: step, port: "RIP", text: "rip 1",
      lines: [["[" + dev + "]", "rip 1"]],
      pre: function (s) { return s.rip[dev] ? "RIP 进程已启动 / RIP already started" : null; },
      run: function (s) { s.rip[dev] = { ver: 1, nets: [] }; }
    };
  }
  function ripVer(id, dev, step) {
    return {
      id: id, dev: dev, step: step, port: "RIP", text: "version 2",
      lines: function (s) {
        return [["[" + dev + "-rip-1]", "version 2"]];
      },
      pre: function (s) {
        if (!s.rip[dev]) return "请先启动 RIP 进程：rip 1 / Start RIP first";
        return s.rip[dev].ver === 2 ? "已是 RIPv2 / Already version 2" : null;
      },
      run: function (s) { s.rip[dev].ver = 2; }
    };
  }
  function ripNet(id, dev, step, net) {
    return {
      id: id, dev: dev, step: step, port: net, text: "network " + net,
      lines: [["[" + dev + "-rip-1]", "network " + net]],
      pre: function (s) {
        if (!s.rip[dev]) return "请先启动 RIP 进程：rip 1 / Start RIP first";
        return ripHas(s, dev, net) ? "该网段已宣告 / Already advertised" : null;
      },
      run: function (s) {
        if (!s.rip[dev].nets.length || s.rip[dev].nets.indexOf(net) < 0) s.rip[dev].nets.push(net);
      }
    };
  }
  function ospfStart(id, dev, step, rid) {
    var cmd = "ospf 1 router-id " + rid;
    return {
      id: id, dev: dev, step: step, port: rid, text: cmd,
      lines: [["[" + dev + "]", cmd]],
      pre: function (s) { return s.ospf[dev] ? "OSPF 进程已启动 / OSPF already started" : null; },
      run: function (s) { s.ospf[dev] = { rid: rid, nets: [], cur: "0.0.0.0" }; }
    };
  }
  function ospfArea(id, dev, step, area) {
    return {
      id: id, dev: dev, step: step, port: "Area " + area, text: "area " + area,
      lines: function (s) {
        return [["[" + dev + "-ospf-1]", "area " + area]];
      },
      pre: function (s) {
        if (!s.ospf[dev]) return "请先启动 OSPF 进程 / Start OSPF first";
        return s.ospf[dev].cur === area ? "已在该区域 / Already in this area" : null;
      },
      run: function (s) { s.ospf[dev].cur = area; }
    };
  }
  function ospfNet(id, dev, step, area, net, wc) {
    var cmd = "network " + net + " " + wc;
    return {
      id: id, dev: dev, step: step, port: net + " " + wc, text: cmd,
      lines: function (s) {
        var cur = s.ospf[dev] ? s.ospf[dev].cur : "0.0.0.0";
        var base = ["[" + dev + "-ospf-1]"];
        var prompts = [];
        if (cur !== area) prompts.push([base[0], "area " + area]);
        prompts.push(["[" + dev + "-ospf-1-area-" + area + "]", cmd]);
        return prompts;
      },
      pre: function (s) {
        if (!s.ospf[dev]) return "请先启动 OSPF 进程 / Start OSPF first";
        if (s.ospf[dev].cur !== area) return "请先进入 area " + area + " / Enter the area first";
        return ospfNetHas(s, dev, area, net, wc) ? "该网段已在区域内宣告 / Already advertised" : null;
      },
      run: function (s) {
        s.ospf[dev].nets.push({ area: area, net: net, wc: wc });
      }
    };
  }
  function swVlan(id, step) {
    return {
      id: id, dev: "SW", step: step, port: "VLAN", text: "vlan batch 10 20",
      lines: [["[SW]", "vlan batch 10 20"]],
      pre: function (s) {
        var sw = s.vlan.SW;
        return sw && sw.created.length ? "VLAN 已创建 / VLANs already exist" : null;
      },
      run: function (s) { ensureSw(s).created = [10, 20]; }
    };
  }
  function swAccessType(id, step, port) {
    return {
      id: id, dev: "SW", step: step, port: port, text: "port link-type access",
      lines: [["[SW]", "interface " + fullIf(port)],
              ["[SW-" + fullIf(port) + "]", "port link-type access"]],
      pre: function (s) {
        var sw = ensureSw(s);
        return sw.linkType[port] === "access" ? "该接口已是 Access / Already access" : null;
      },
      run: function (s) { ensureSw(s).linkType[port] = "access"; }
    };
  }
  function swAccessVlan(id, step, port, vid) {
    return {
      id: id, dev: "SW", step: step, port: port + " · VLAN " + vid, text: "port default vlan " + vid,
      lines: [["[SW-" + fullIf(port) + "]", "port default vlan " + vid]],
      pre: function (s) {
        var sw = ensureSw(s);
        if (sw.created.indexOf(vid) < 0) return "VLAN " + vid + " 不存在，请先执行 vlan batch 10 20 / Create VLAN first";
        if (sw.linkType[port] !== "access") return "请先将接口设为 access / Set link-type access first";
        return sw.access[port] === vid ? "该接口已属于 VLAN " + vid + " / Already assigned" : null;
      },
      run: function (s) { ensureSw(s).access[port] = vid; }
    };
  }
  function swTrunkType(id, step, port) {
    return {
      id: id, dev: "SW", step: step, port: port, text: "port link-type trunk",
      lines: [["[SW]", "interface " + fullIf(port)],
              ["[SW-" + fullIf(port) + "]", "port link-type trunk"]],
      pre: function (s) {
        var sw = ensureSw(s);
        return sw.linkType[port] === "trunk" ? "该接口已是 Trunk / Already trunk" : null;
      },
      run: function (s) { ensureSw(s).linkType[port] = "trunk"; }
    };
  }
  function swTrunkAllow(id, step, port, vlans) {
    return {
      id: id, dev: "SW", step: step, port: port + " · Trunk", text: "port trunk allow-pass vlan " + vlans.join(" "),
      lines: [["[SW-" + fullIf(port) + "]", "port trunk allow-pass vlan " + vlans.join(" ")]],
      pre: function (s) {
        var sw = ensureSw(s);
        if (sw.linkType[port] !== "trunk") return "请先将接口设为 trunk / Set link-type trunk first";
        if (sw.created.indexOf(10) < 0 || sw.created.indexOf(20) < 0) return "VLAN 10/20 尚未创建 / Create VLANs first";
        return (sw.trunk[port] || []).length === vlans.length ? "Trunk 已放通这些 VLAN / Already allowed" : null;
      },
      run: function (s) { ensureSw(s).trunk[port] = vlans.slice(); }
    };
  }
  function subDot1q(id, dev, step, base, vid) {
    return {
      id: id, dev: dev, step: step, port: base + "." + vid, text: "dot1q termination vid " + vid,
      lines: [["[" + dev + "]", "interface " + fullIf(base + "." + vid)],
              ["[" + dev + "-" + fullIf(base + "." + vid) + "]", "dot1q termination vid " + vid]],
      pre: function (s) {
        var x = subOf(s, dev, base, vid);
        return x && x.dot1q ? "子接口已封装 802.1Q / Already encapsulated" : null;
      },
      run: function (s) {
        var x = ensureSub(s, dev, base, vid);
        x.dot1q = true;
        x.dot1qVid = vid;
      }
    };
  }
  function subIp(id, dev, step, base, vid, cidr) {
    return {
      id: id, dev: dev, step: step, port: base + "." + vid, text: "ip address " + cidr.replace("/", " "),
      lines: [["[" + dev + "-" + fullIf(base + "." + vid) + "]", "ip address " + cidr.replace("/", " ")]],
      pre: function (s) {
        var x = subOf(s, dev, base, vid);
        if (!x || !x.dot1q) return "请先执行 dot1q termination vid " + vid + " / Encapsulate first";
        return x.ip ? "子接口已有 IP / Already has an IP" : null;
      },
      run: function (s) { ensureSub(s, dev, base, vid).ip = cidr; }
    };
  }
  function subArp(id, dev, step, base, vid) {
    return {
      id: id, dev: dev, step: step, port: base + "." + vid, text: "arp broadcast enable",
      lines: [["[" + dev + "-" + fullIf(base + "." + vid) + "]", "arp broadcast enable"]],
      pre: function (s) {
        var x = subOf(s, dev, base, vid);
        if (!x || !x.ip) return "请先为子接口配置 IP / Configure the IP first";
        return x.arp ? "ARP 广播已开启 / Already enabled" : null;
      },
      run: function (s) { ensureSub(s, dev, base, vid).arp = true; }
    };
  }

  /* ============================================================
     任务数据 / Task definitions
     ============================================================ */
  var TASKS = [
    /* ---------------- 任务一 ---------------- */
    {
      id: "t1", no: 1,
      zh: "路由原理认知", en: "Routing Principles",
      tag: "基础认知 · Foundation",
      intro: "搭建 PC1—R1—R2—PC2 基础拓扑，为四个接口配置 IP，观察路由表只出现直连网段，理解跨网段转发为什么需要路由。",
      introEn: "Build the PC1–R1–R2–PC2 topology, configure four interface IPs, and observe that the routing table only contains directly connected networks.",
      legend: ["直连路由 Direct", "同网段可通", "跨网段需路由"],
      pre: function () {},
      topo: {
        nodes: [
          { id: "PC1", type: "pc", x: 150, y: 300, label: "PC1", sub: "192.168.1.10/24" },
          { id: "R1", type: "router", x: 390, y: 300, label: "R1", sub: "AR2220" },
          { id: "R2", type: "router", x: 650, y: 300, label: "R2", sub: "AR2220" },
          { id: "PC2", type: "pc", x: 880, y: 300, label: "PC2", sub: "192.168.2.10/24" }
        ],
        links: [
          { a: "PC1", b: "R1", net: "192.168.1.0/24", pa: "", pb: "G0/0/0" },
          { a: "R1", b: "R2", net: "10.0.0.0/24", pa: "G0/0/1", pb: "G0/0/0" },
          { a: "R2", b: "PC2", net: "192.168.2.0/24", pa: "G0/0/1", pb: "" }
        ]
      },
      steps: [
        { zh: "完成 R1 两个接口的 IP 配置", en: "Address both R1 interfaces" },
        { zh: "完成 R2 两个接口的 IP 配置", en: "Address both R2 interfaces" },
        { zh: "查看路由表并测试跨网段转发", en: "Inspect the table and test forwarding" }
      ],
      bank: [
        ipTile("t1-a", "R1", 1, "G0/0/0", "192.168.1.1/24"),
        ipTile("t1-b", "R1", 1, "G0/0/1", "10.0.0.1/24"),
        ipTile("t1-c", "R2", 2, "G0/0/0", "10.0.0.2/24"),
        ipTile("t1-d", "R2", 2, "G0/0/1", "192.168.2.1/24")
      ],
      checks: [
        { zh: "R1 G0/0/0 配置 192.168.1.1/24", en: "R1 G0/0/0 = 192.168.1.1/24", test: function (s) { return ifaceOf(s, "R1", "G0/0/0") === "192.168.1.1/24"; } },
        { zh: "R1 G0/0/1 配置 10.0.0.1/24", en: "R1 G0/0/1 = 10.0.0.1/24", test: function (s) { return ifaceOf(s, "R1", "G0/0/1") === "10.0.0.1/24"; } },
        { zh: "R2 G0/0/0 配置 10.0.0.2/24", en: "R2 G0/0/0 = 10.0.0.2/24", test: function (s) { return ifaceOf(s, "R2", "G0/0/0") === "10.0.0.2/24"; } },
        { zh: "R2 G0/0/1 配置 192.168.2.1/24", en: "R2 G0/0/1 = 192.168.2.1/24", test: function (s) { return ifaceOf(s, "R2", "G0/0/1") === "192.168.2.1/24"; } },
        { zh: "发起一次跨网段 ping，观察直连路由的局限", en: "Send one cross-segment ping", test: function (s) { return !!s.pinged.t1; } }
      ],
      pings: [{
        id: "p1", label: "PC1 → PC2", cmd: "ping 192.168.2.10",
        run: function (s) {
          var r1ok = !!ifaceOf(s, "R1", "G0/0/0") && !!ifaceOf(s, "R1", "G0/0/1");
          if (!r1ok) {
            return { path: ["PC1", "R1"], ok: false, reason: "R1 接口还没有配置 IP，数据包无法继续转发 / R1 has no interface IP." };
          }
          return { path: ["PC1", "R1"], ok: false, reason: "R1 的路由表只有直连网段，没有 192.168.2.0/24，数据包在 R1 被丢弃。直连路由无法完成跨网段转发。" };
        }
      }],
      verify: function (s) {
        var out = [], ports = Object.keys(s.iface.R1 || {});
        out.push(["cmd", "<R1>", "display ip routing-table"]);
        out.push(["out", routeHead()]);
        if (!ports.length) out.push(["out", "(路由表为空：还没有为任何接口配置 IP)"]);
        ports.forEach(function (p) {
          var cidr = s.iface.R1[p];
          out.push(["out", row(netOf(cidr), "Direct", 0, 0, ipOnly(cidr), fullIf(p))]);
        });
        out.push(["cmd", "<PC1>", "ping 192.168.2.10"]);
        out.push(["out", "PING 192.168.2.10: 32 data bytes, press CTRL_C to break"]);
        out.push(["err", "Request timeout!  (目的网段不可达)"]);
        out.push(["note", "结论：路由表里只学到直连网段，跨网段必须再配置静态路由或动态协议。"]);
        return out;
      }
    },

    /* ---------------- 任务二 ---------------- */
    {
      id: "t2", no: 2,
      zh: "静态路由配置", en: "Static Routing",
      tag: "手工路由 · Manual",
      intro: "接口 IP 已预配置。为 R1、R2 分别写入去程与回程静态路由，再为末梢网络配置默认路由，打通 PC 互访与互联网出口。",
      introEn: "Interface IPs are pre-configured. Add forward and return static routes on R1/R2, then a default route for the stub network and Internet egress.",
      legend: ["Static 优先级 60", "默认路由 0.0.0.0/0", "回程路由同样重要"],
      pre: function (s) {
        s.iface.R1 = { "G0/0/0": "192.168.1.1/24", "G0/0/1": "10.0.0.1/24" };
        s.iface.R2 = { "G0/0/0": "10.0.0.2/24", "G0/0/1": "192.168.2.1/24", "G0/0/2": "203.0.113.1/30" };
      },
      topo: {
        nodes: [
          { id: "PC1", type: "pc", x: 130, y: 305, label: "PC1", sub: "192.168.1.10/24" },
          { id: "R1", type: "router", x: 355, y: 305, label: "R1", sub: "AR2220" },
          { id: "R2", type: "router", x: 625, y: 305, label: "R2", sub: "AR2220" },
          { id: "PC2", type: "pc", x: 875, y: 305, label: "PC2", sub: "192.168.2.10/24" },
          { id: "Internet", type: "cloud", x: 625, y: 120, label: "Internet", sub: "8.8.8.8" }
        ],
        links: [
          { a: "PC1", b: "R1", net: "192.168.1.0/24", pa: "", pb: "G0/0/0" },
          { a: "R1", b: "R2", net: "10.0.0.0/24", pa: "G0/0/1", pb: "G0/0/0" },
          { a: "R2", b: "PC2", net: "192.168.2.0/24", pa: "G0/0/1", pb: "" },
          { a: "R2", b: "Internet", net: "0.0.0.0/0 · 默认路由", pa: "G0/0/2", pb: "" }
        ]
      },
      steps: [
        { zh: "在 R1 写入去程静态路由", en: "Forward route on R1" },
        { zh: "在 R2 写入回程静态路由", en: "Return route on R2" },
        { zh: "配置默认路由并验证内外网", en: "Default route and verification" }
      ],
      bank: [
        staticTile("t2-a", "R1", 1, "192.168.2.0", 24, "10.0.0.2"),
        staticTile("t2-b", "R2", 2, "192.168.1.0", 24, "10.0.0.1"),
        defaultTile("t2-c", "R2", 3, "203.0.113.2")
      ],
      checks: [
        { zh: "R1 有去往 192.168.2.0/24 的静态路由", en: "R1 static route to 192.168.2.0/24", test: function (s) { return hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2"); } },
        { zh: "R2 有去往 192.168.1.0/24 的静态路由", en: "R2 static route to 192.168.1.0/24", test: function (s) { return hasStatic(s, "R2", "192.168.1.0", 24, "10.0.0.1"); } },
        { zh: "R2 配置默认路由指向互联网", en: "R2 default route to the Internet", test: function (s) { return hasDefault(s, "R2", "203.0.113.2"); } },
        { zh: "PC1 能 ping 通 PC2（去程 + 回程）", en: "PC1 reaches PC2", test: function (s) { return hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2") && hasStatic(s, "R2", "192.168.1.0", 24, "10.0.0.1"); } },
        { zh: "默认路由生效，内网可访问 8.8.8.8", en: "Default route works for 8.8.8.8", test: function (s) { return hasDefault(s, "R2", "203.0.113.2") && hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2"); } }
      ],
      pings: [
        {
          id: "p1", label: "PC1 → PC2", cmd: "ping 192.168.2.10",
          run: function (s) {
            if (!hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2")) {
              return { path: ["PC1", "R1"], ok: false, reason: "R1 没有 192.168.2.0/24 的静态路由，数据包在 R1 被丢弃。" };
            }
            if (!hasStatic(s, "R2", "192.168.1.0", 24, "10.0.0.1")) {
              return { path: ["PC1", "R1", "R2"], ok: false, reason: "去程能到 PC2，但 R2 没有回程路由，回包在 R2 被丢弃。" };
            }
            return { path: ["PC1", "R1", "R2", "PC2"], ok: true, reason: "去程与回程静态路由都已就位，双向互通。" };
          }
        },
        {
          id: "p2", label: "PC1 → 8.8.8.8", cmd: "ping 8.8.8.8",
          run: function (s) {
            if (!hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2")) {
              return { path: ["PC1", "R1"], ok: false, reason: "R1 还没有去往 R2 方向的路由，无法到达出口。" };
            }
            if (!hasDefault(s, "R2", "203.0.113.2")) {
              return { path: ["PC1", "R1", "R2"], ok: false, reason: "R2 没有默认路由，私网去往 8.8.8.8 的流量没有出口。" };
            }
            return { path: ["PC1", "R1", "R2", "Internet"], ok: true, reason: "命中 0.0.0.0/0 默认路由，流量送往互联网出口。" };
          }
        }
      ],
      verify: function (s) {
        var out = [];
        out.push(["cmd", "<R1>", "display ip routing-table"]);
        out.push(["out", routeHead()]);
        out.push(["out", row("192.168.1.0/24", "Direct", 0, 0, "192.168.1.1", "GigabitEthernet0/0/0")]);
        out.push(["out", row("10.0.0.0/24", "Direct", 0, 0, "10.0.0.1", "GigabitEthernet0/0/1")]);
        if (hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2")) {
          out.push(["out", row("192.168.2.0/24", "Static", 60, 0, "10.0.0.2", "GigabitEthernet0/0/1")]);
        } else {
          out.push(["err", "192.168.2.0/24 缺失 — 需要在 R1 上配置静态路由"]);
        }
        out.push(["cmd", "<R2>", "display ip routing-table"]);
        out.push(["out", routeHead()]);
        out.push(["out", row("192.168.2.0/24", "Direct", 0, 0, "192.168.2.1", "GigabitEthernet0/0/1")]);
        if (hasStatic(s, "R2", "192.168.1.0", 24, "10.0.0.1")) {
          out.push(["out", row("192.168.1.0/24", "Static", 60, 0, "10.0.0.1", "GigabitEthernet0/0/0")]);
        } else {
          out.push(["err", "192.168.1.0/24 缺失 — 回程不通"]);
        }
        if (hasDefault(s, "R2", "203.0.113.2")) {
          out.push(["out", row("0.0.0.0/0", "Static", 60, 0, "203.0.113.2", "GigabitEthernet0/0/2")]);
        }
        var ok1 = hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2") && hasStatic(s, "R2", "192.168.1.0", 24, "10.0.0.1");
        out.push(["cmd", "<PC1>", "ping 192.168.2.10"]);
        if (ok1) {
          out.push(["ok", "Reply from 192.168.2.10: bytes=32 time=15ms TTL=126  (x4)  通 / Success"]);
        } else {
          out.push(["err", "Request timeout!  去程或回程缺少静态路由"]);
        }
        out.push(["cmd", "<PC1>", "ping 8.8.8.8"]);
        if (hasDefault(s, "R2", "203.0.113.2") && hasStatic(s, "R1", "192.168.2.0", 24, "10.0.0.2")) {
          out.push(["ok", "Reply from 8.8.8.8: bytes=32 time=28ms TTL=252  (x4)  默认路由生效"]);
        } else {
          out.push(["err", "Request timeout!  出口默认路由未配置"]);
        }
        return out;
      }
    },

    /* ---------------- 任务三 ---------------- */
    {
      id: "t3", no: 3,
      zh: "RIP 路由协议部署", en: "RIP Deployment",
      tag: "动态路由 · Distance Vector",
      intro: "R1—R2—R3 三台路由器串联，接口 IP 已预配置。部署 RIPv2 自动学习路由，观察 Cost 跳数与收敛结果。",
      introEn: "Three routers in series with pre-configured interfaces. Deploy RIPv2 to learn routes automatically and observe hop-count metrics.",
      legend: ["RIP 优先级 100", "Cost = 跳数", "30s 周期更新"],
      pre: function (s) {
        s.iface.R1 = { "G0/0/0": "192.168.1.1/24", "G0/0/1": "10.0.12.1/30" };
        s.iface.R2 = { "G0/0/0": "10.0.12.2/30", "G0/0/1": "192.168.2.1/24", "G0/0/2": "10.0.23.1/30" };
        s.iface.R3 = { "G0/0/0": "10.0.23.2/30", "G0/0/1": "192.168.3.1/24" };
      },
      topo: {
        nodes: [
          { id: "PC1", type: "pc", x: 135, y: 285, label: "PC1", sub: "192.168.1.10/24" },
          { id: "R1", type: "router", x: 330, y: 285, label: "R1", sub: "AR2220" },
          { id: "R2", type: "router", x: 545, y: 285, label: "R2", sub: "AR2220" },
          { id: "R3", type: "router", x: 760, y: 285, label: "R3", sub: "AR2220" },
          { id: "PC3", type: "pc", x: 920, y: 285, label: "PC3", sub: "192.168.3.10/24" },
          { id: "PC2", type: "pc", x: 545, y: 462, label: "PC2", sub: "192.168.2.10/24" }
        ],
        links: [
          { a: "PC1", b: "R1", net: "192.168.1.0/24", pa: "", pb: "G0/0/0" },
          { a: "R1", b: "R2", net: "10.0.12.0/30", pa: "G0/0/1", pb: "G0/0/0" },
          { a: "R2", b: "R3", net: "10.0.23.0/30", pa: "G0/0/2", pb: "G0/0/0" },
          { a: "R2", b: "PC2", net: "192.168.2.0/24", pa: "G0/0/1", pb: "" },
          { a: "R3", b: "PC3", net: "192.168.3.0/24", pa: "G0/0/1", pb: "" }
        ]
      },
      steps: [
        { zh: "三台路由器启动 RIP 进程并指定 version 2", en: "Start RIP and set version 2" },
        { zh: "宣告各自的直连网段", en: "Advertise connected networks" },
        { zh: "查看 RIP 路由表与跳数", en: "Inspect RIP routes and metrics" }
      ],
      bank: [
        ripStart("t3-a", "R1", 1), ripVer("t3-b", "R1", 1), ripNet("t3-c", "R1", 2, "10.0.0.0"), ripNet("t3-d", "R1", 2, "192.168.1.0"),
        ripStart("t3-e", "R2", 1), ripVer("t3-f", "R2", 1), ripNet("t3-g", "R2", 2, "10.0.0.0"), ripNet("t3-h", "R2", 2, "192.168.2.0"),
        ripStart("t3-i", "R3", 1), ripVer("t3-j", "R3", 1), ripNet("t3-k", "R3", 2, "10.0.0.0"), ripNet("t3-l", "R3", 2, "192.168.3.0")
      ],
      checks: [
        { zh: "R1 运行 RIPv2 并宣告 10.0.0.0、192.168.1.0", en: "R1 RIPv2 advertisements", test: function (s) { return ripReady(s, "R1", ["10.0.0.0", "192.168.1.0"]); } },
        { zh: "R2 运行 RIPv2 并宣告 10.0.0.0、192.168.2.0", en: "R2 RIPv2 advertisements", test: function (s) { return ripReady(s, "R2", ["10.0.0.0", "192.168.2.0"]); } },
        { zh: "R3 运行 RIPv2 并宣告 10.0.0.0、192.168.3.0", en: "R3 RIPv2 advertisements", test: function (s) { return ripReady(s, "R3", ["10.0.0.0", "192.168.3.0"]); } },
        { zh: "R1 学到 192.168.3.0/24，Cost = 2", en: "R1 learns 192.168.3.0/24 with cost 2", test: function (s) { return ripReady(s, "R1", ["10.0.0.0", "192.168.1.0"]) && ripReady(s, "R2", ["10.0.0.0", "192.168.2.0"]) && ripReady(s, "R3", ["10.0.0.0", "192.168.3.0"]); } },
        { zh: "PC1 可经 R1 → R2 → R3 访问 PC3", en: "PC1 reaches PC3 via R1–R2–R3", test: function (s) { return ripReady(s, "R1", ["10.0.0.0", "192.168.1.0"]) && ripReady(s, "R2", ["10.0.0.0", "192.168.2.0"]) && ripReady(s, "R3", ["10.0.0.0", "192.168.3.0"]); } }
      ],
      pings: [{
        id: "p1", label: "PC1 → PC3", cmd: "tracert 192.168.3.10",
        run: function (s) {
          var ok = ripReady(s, "R1", ["10.0.0.0", "192.168.1.0"]) && ripReady(s, "R2", ["10.0.0.0", "192.168.2.0"]) && ripReady(s, "R3", ["10.0.0.0", "192.168.3.0"]);
          if (!ok) {
            return { path: ["PC1", "R1", "R2"], ok: false, reason: "RIP 还未收敛：三台路由器都要启动 RIPv2 并宣告网段，R1 才学得到 192.168.3.0/24。" };
          }
          return { path: ["PC1", "R1", "R2", "R3", "PC3"], ok: true, reason: "RIP 收敛完成：路径 R1 → R2 → R3，到 192.168.3.0/24 的 Cost = 2。" };
        }
      }],
      verify: function (s) {
        var out = [];
        var ready = ripReady(s, "R1", ["10.0.0.0", "192.168.1.0"]) && ripReady(s, "R2", ["10.0.0.0", "192.168.2.0"]) && ripReady(s, "R3", ["10.0.0.0", "192.168.3.0"]);
        out.push(["cmd", "<R1>", "display ip routing-table protocol rip"]);
        if (!ready) {
          out.push(["out", "Routing Tables: RIP"]);
          out.push(["out", "Routes : 0   (RIP 尚未完成宣告，路由表为空)"]);
          out.push(["err", "缺少邻居或宣告 — 检查三台设备的 rip / version 2 / network"]);
        } else {
          out.push(["out", "Routing Tables: RIP        Routes : 3"]);
          out.push(["out", routeHead()]);
          out.push(["out", row("192.168.2.0/24", "RIP", 100, 1, "10.0.12.2", "GigabitEthernet0/0/1")]);
          out.push(["out", row("192.168.3.0/24", "RIP", 100, 2, "10.0.12.2", "GigabitEthernet0/0/1")]);
          out.push(["out", row("10.0.23.0/30", "RIP", 100, 1, "10.0.12.2", "GigabitEthernet0/0/1")]);
        }
        out.push(["cmd", "<PC1>", "tracert 192.168.3.10"]);
        if (ready) {
          out.push(["out", "1  192.168.1.1   5ms   4ms   5ms     R1 (网关)"]);
          out.push(["out", "2  10.0.12.2     10ms  8ms   10ms    R2"]);
          out.push(["out", "3  10.0.23.2     15ms  14ms  15ms    R3"]);
          out.push(["out", "4  192.168.3.10  18ms  16ms  18ms    PC3"]);
          out.push(["ok", "路径成立：3 跳，RIP 路由的 Cost=2 与路径一致。"]);
        } else {
          out.push(["err", "Request timeout!  RIP 路由尚未形成"]);
        }
        return out;
      }
    },

    /* ---------------- 任务四 ---------------- */
    {
      id: "t4", no: 4,
      zh: "OSPF 路由协议部署", en: "OSPF Deployment",
      tag: "多区域 · Link State",
      intro: "R1、R2 属于 Area 0，R2、R3 属于 Area 1，R2 成为 ABR。部署 OSPF 建立邻居、计算最优路径，观察多区域路由。",
      introEn: "R1/R2 sit in Area 0, R2/R3 in Area 1, making R2 an ABR. Deploy OSPF, form adjacencies and observe inter-area routes.",
      legend: ["OSPF 优先级 10", "Cost 基于带宽", "Area 0 骨干区域"],
      pre: function (s) {
        s.iface.R1 = { "G0/0/0": "192.168.1.1/24", "G0/0/1": "10.0.12.1/30" };
        s.iface.R2 = { "G0/0/0": "10.0.12.2/30", "G0/0/1": "192.168.2.1/24", "G0/0/2": "10.0.23.1/30" };
        s.iface.R3 = { "G0/0/0": "10.0.23.2/30", "G0/0/1": "192.168.3.1/24" };
      },
      topo: {
        nodes: [
          { id: "PC1", type: "pc", x: 135, y: 285, label: "PC1", sub: "192.168.1.10/24" },
          { id: "R1", type: "router", x: 330, y: 285, label: "R1", sub: "AR2220", badge: "Area 0" },
          { id: "R2", type: "router", x: 545, y: 285, label: "R2", sub: "AR2220", badge: "ABR" },
          { id: "R3", type: "router", x: 760, y: 285, label: "R3", sub: "AR2220", badge: "Area 1" },
          { id: "PC3", type: "pc", x: 920, y: 285, label: "PC3", sub: "192.168.3.10/24" },
          { id: "PC2", type: "pc", x: 545, y: 462, label: "PC2", sub: "192.168.2.10/24" }
        ],
        links: [
          { a: "PC1", b: "R1", net: "192.168.1.0/24", pa: "", pb: "G0/0/0" },
          { a: "R1", b: "R2", net: "10.0.12.0/30 · Area 0", pa: "G0/0/1", pb: "G0/0/0" },
          { a: "R2", b: "R3", net: "10.0.23.0/30 · Area 1", pa: "G0/0/2", pb: "G0/0/0" },
          { a: "R2", b: "PC2", net: "192.168.2.0/24", pa: "G0/0/1", pb: "" },
          { a: "R3", b: "PC3", net: "192.168.3.0/24", pa: "G0/0/1", pb: "" }
        ]
      },
      steps: [
        { zh: "三台路由器启动 OSPF 并指定 Router-ID", en: "Start OSPF with Router-IDs" },
        { zh: "按区域宣告网段（反掩码）", en: "Advertise networks by area" },
        { zh: "检查邻居状态与 OSPF 路由", en: "Check neighbors and routes" }
      ],
      bank: [
        ospfStart("t4-a", "R1", 1, "1.1.1.1"),
        ospfNet("t4-b", "R1", 2, "0.0.0.0", "10.0.12.0", "0.0.0.3"),
        ospfNet("t4-c", "R1", 2, "0.0.0.0", "192.168.1.0", "0.0.0.255"),
        ospfNet("t4-d", "R1", 2, "0.0.0.0", "1.1.1.1", "0.0.0.0"),

        ospfStart("t4-e", "R2", 1, "2.2.2.2"),
        ospfNet("t4-f", "R2", 2, "0.0.0.0", "10.0.12.0", "0.0.0.3"),
        ospfNet("t4-g", "R2", 2, "0.0.0.0", "2.2.2.2", "0.0.0.0"),
        ospfArea("t4-h", "R2", 2, "0.0.0.1"),
        ospfNet("t4-i", "R2", 2, "0.0.0.1", "10.0.23.0", "0.0.0.3"),

        ospfStart("t4-j", "R3", 1, "3.3.3.3"),
        ospfArea("t4-k", "R3", 2, "0.0.0.1"),
        ospfNet("t4-l", "R3", 2, "0.0.0.1", "10.0.23.0", "0.0.0.3"),
        ospfNet("t4-m", "R3", 2, "0.0.0.1", "192.168.3.0", "0.0.0.255"),
        ospfNet("t4-n", "R3", 2, "0.0.0.1", "3.3.3.3", "0.0.0.0")
      ],
      checks: [
        { zh: "R1：Router-ID 1.1.1.1，Area 0 宣告 3 个网段", en: "R1 area 0 advertisements", test: function (s) { return ospfReady(s, "R1", "1.1.1.1", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "192.168.1.0", "0.0.0.255"], ["0.0.0.0", "1.1.1.1", "0.0.0.0"]]); } },
        { zh: "R2：Router-ID 2.2.2.2，Area 0 + Area 1", en: "R2 area 0 and area 1", test: function (s) { return ospfReady(s, "R2", "2.2.2.2", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "2.2.2.2", "0.0.0.0"], ["0.0.0.1", "10.0.23.0", "0.0.0.3"]]); } },
        { zh: "R3：Router-ID 3.3.3.3，Area 1 宣告 3 个网段", en: "R3 area 1 advertisements", test: function (s) { return ospfReady(s, "R3", "3.3.3.3", [["0.0.0.1", "10.0.23.0", "0.0.0.3"], ["0.0.0.1", "192.168.3.0", "0.0.0.255"], ["0.0.0.1", "3.3.3.3", "0.0.0.0"]]); } },
        { zh: "R1 与 R2 邻居状态达到 Full", en: "R1–R2 adjacency reaches Full", test: function (s) { return ospfReady(s, "R1", "1.1.1.1", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "192.168.1.0", "0.0.0.255"], ["0.0.0.0", "1.1.1.1", "0.0.0.0"]]) && ospfReady(s, "R2", "2.2.2.2", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "2.2.2.2", "0.0.0.0"], ["0.0.0.1", "10.0.23.0", "0.0.0.3"]]); } },
        { zh: "PC1 可经 OSPF 路由访问 PC3", en: "PC1 reaches PC3 through OSPF", test: function (s) { return ospfReady(s, "R1", "1.1.1.1", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "192.168.1.0", "0.0.0.255"], ["0.0.0.0", "1.1.1.1", "0.0.0.0"]]) && ospfReady(s, "R2", "2.2.2.2", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "2.2.2.2", "0.0.0.0"], ["0.0.0.1", "10.0.23.0", "0.0.0.3"]]) && ospfReady(s, "R3", "3.3.3.3", [["0.0.0.1", "10.0.23.0", "0.0.0.3"], ["0.0.0.1", "192.168.3.0", "0.0.0.255"], ["0.0.0.1", "3.3.3.3", "0.0.0.0"]]); } }
      ],
      pings: [{
        id: "p1", label: "PC1 → PC3", cmd: "ping 192.168.3.10",
        run: function (s) {
          var ok = ospfReady(s, "R1", "1.1.1.1", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "192.168.1.0", "0.0.0.255"], ["0.0.0.0", "1.1.1.1", "0.0.0.0"]]) &&
                   ospfReady(s, "R2", "2.2.2.2", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "2.2.2.2", "0.0.0.0"], ["0.0.0.1", "10.0.23.0", "0.0.0.3"]]) &&
                   ospfReady(s, "R3", "3.3.3.3", [["0.0.0.1", "10.0.23.0", "0.0.0.3"], ["0.0.0.1", "192.168.3.0", "0.0.0.255"], ["0.0.0.1", "3.3.3.3", "0.0.0.0"]]);
          if (!ok) {
            return { path: ["PC1", "R1", "R2"], ok: false, reason: "OSPF 邻接尚未建立或区域宣告不完整，R1 学不到 192.168.3.0/24。" };
          }
          return { path: ["PC1", "R1", "R2", "R3", "PC3"], ok: true, reason: "邻居 Full，LSA 泛洪完成：R1 经 R2 学到 3.3.3.3/32（Cost 2）与 192.168.3.0/24。" };
        }
      }],
      verify: function (s) {
        var out = [];
        var r1ok = ospfReady(s, "R1", "1.1.1.1", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "192.168.1.0", "0.0.0.255"], ["0.0.0.0", "1.1.1.1", "0.0.0.0"]]);
        var r2ok = ospfReady(s, "R2", "2.2.2.2", [["0.0.0.0", "10.0.12.0", "0.0.0.3"], ["0.0.0.0", "2.2.2.2", "0.0.0.0"], ["0.0.0.1", "10.0.23.0", "0.0.0.3"]]);
        var r3ok = ospfReady(s, "R3", "3.3.3.3", [["0.0.0.1", "10.0.23.0", "0.0.0.3"], ["0.0.0.1", "192.168.3.0", "0.0.0.255"], ["0.0.0.1", "3.3.3.3", "0.0.0.0"]]);
        out.push(["cmd", "<R1>", "display ospf peer"]);
        if (r1ok && r2ok) {
          out.push(["out", "Area 0.0.0.0 interface 10.0.12.1(GigabitEthernet0/0/1)'s neighbors"]);
          out.push(["out", "Router ID: 2.2.2.2    Address: 10.0.12.2"]);
          out.push(["out", "State: Full          Mode: Nbr is Master"]);
        } else {
          out.push(["out", "没有邻居 / No neighbor"]);
          out.push(["err", "检查 Router-ID、区域号与 network 反掩码是否匹配"]);
        }
        out.push(["cmd", "<R1>", "display ip routing-table protocol ospf"]);
        if (r1ok && r2ok && r3ok) {
          out.push(["out", routeHead()]);
          out.push(["out", row("3.3.3.3/32", "OSPF", 10, 2, "10.0.12.2", "GigabitEthernet0/0/1")]);
          out.push(["out", row("10.0.23.0/30", "OSPF", 10, 1, "10.0.12.2", "GigabitEthernet0/0/1")]);
          out.push(["out", row("192.168.3.0/24", "OSPF", 10, 2, "10.0.12.2", "GigabitEthernet0/0/1")]);
          out.push(["ok", "OSPF 多区域路由正常，PC1 可访问 PC3。"]);
        } else {
          out.push(["out", "Routes : 0   (OSPF 路由尚未形成)"]);
        }
        return out;
      }
    },

    /* ---------------- 任务五 ---------------- */
    {
      id: "t5", no: 5,
      zh: "单臂路由实现 VLAN 间通信", en: "Single-arm Routing",
      tag: "VLAN 间路由 · Router-on-a-Stick",
      intro: "交换机划分 VLAN 10 / 20，24 口配置 Trunk；路由器只用一个物理口，通过两个子接口 + 802.1Q 封装承担两个 VLAN 的网关。",
      introEn: "Create VLAN 10/20, trunk port 24, and let two 802.1Q sub-interfaces on one router port act as both VLAN gateways.",
      legend: ["VLAN 10 办公", "VLAN 20 财务", "Trunk 承载 802.1Q"],
      pre: function () {},
      topo: {
        nodes: [
          { id: "PC1", type: "pc", x: 205, y: 158, label: "PC1", sub: "192.168.10.10/24", accent: "#C98A2E" },
          { id: "PC2", type: "pc", x: 205, y: 420, label: "PC2", sub: "192.168.20.10/24", accent: "#7A5AF8" },
          { id: "SW", type: "switch", x: 470, y: 290, label: "SW", sub: "S5700" },
          { id: "R1", type: "router", x: 775, y: 290, label: "R1", sub: "AR2220" }
        ],
        links: [
          { a: "PC1", b: "SW", net: "VLAN 10", pa: "", pb: "G0/0/1" },
          { a: "PC2", b: "SW", net: "VLAN 20", pa: "", pb: "G0/0/2" },
          { a: "SW", b: "R1", net: "Trunk 802.1Q", pa: "G0/0/24", pb: "G0/0/0" }
        ],
        zones: [
          { x: 82, y: 76, w: 246, h: 166, label: "VLAN 10 · 办公 Office", color: "#C98A2E" },
          { x: 82, y: 338, w: 246, h: 166, label: "VLAN 20 · 财务 Finance", color: "#7A5AF8" }
        ]
      },
      steps: [
        { zh: "创建 VLAN 10 / 20 并配置两个 Access 口", en: "Create VLANs and access ports" },
        { zh: "把 24 口配置为 Trunk 并放通 VLAN", en: "Configure the trunk port" },
        { zh: "配置两个子接口（802.1Q + IP + ARP）", en: "Configure both sub-interfaces" }
      ],
      bank: [
        swVlan("t5-a", 1),
        swAccessType("t5-b", 1, "G0/0/1"),
        swAccessVlan("t5-c", 1, "G0/0/1", 10),
        swAccessType("t5-d", 1, "G0/0/2"),
        swAccessVlan("t5-e", 1, "G0/0/2", 20),
        swTrunkType("t5-f", 2, "G0/0/24"),
        swTrunkAllow("t5-g", 2, "G0/0/24", [10, 20]),
        subDot1q("t5-h", "R1", 3, "G0/0/0", 10),
        subIp("t5-i", "R1", 3, "G0/0/0", 10, "192.168.10.1/24"),
        subArp("t5-j", "R1", 3, "G0/0/0", 10),
        subDot1q("t5-k", "R1", 3, "G0/0/0", 20),
        subIp("t5-l", "R1", 3, "G0/0/0", 20, "192.168.20.1/24"),
        subArp("t5-m", "R1", 3, "G0/0/0", 20)
      ],
      checks: [
        { zh: "交换机创建 VLAN 10 与 VLAN 20", en: "VLANs 10 and 20 exist", test: function (s) { var sw = s.vlan.SW; return !!sw && sw.created.indexOf(10) >= 0 && sw.created.indexOf(20) >= 0; } },
        { zh: "G0/0/1 为 Access，划入 VLAN 10", en: "G0/0/1 access VLAN 10", test: function (s) { var sw = s.vlan.SW; return !!sw && sw.linkType["G0/0/1"] === "access" && sw.access["G0/0/1"] === 10; } },
        { zh: "G0/0/2 为 Access，划入 VLAN 20", en: "G0/0/2 access VLAN 20", test: function (s) { var sw = s.vlan.SW; return !!sw && sw.linkType["G0/0/2"] === "access" && sw.access["G0/0/2"] === 20; } },
        { zh: "G0/0/24 为 Trunk 并放通 VLAN 10、20", en: "G0/0/24 trunk allows 10 and 20", test: function (s) { var sw = s.vlan.SW; return !!sw && sw.linkType["G0/0/24"] === "trunk" && (sw.trunk["G0/0/24"] || []).length === 2; } },
        { zh: "子接口 .10：dot1q 10、192.168.10.1/24、ARP 开启", en: "Sub-interface .10 configured", test: function (s) { var x = subOf(s, "R1", "G0/0/0", 10); return !!x && x.dot1q && x.ip === "192.168.10.1/24" && x.arp; } },
        { zh: "子接口 .20：dot1q 20、192.168.20.1/24、ARP 开启", en: "Sub-interface .20 configured", test: function (s) { var x = subOf(s, "R1", "G0/0/0", 20); return !!x && x.dot1q && x.ip === "192.168.20.1/24" && x.arp; } },
        { zh: "PC1 可 ping 通 PC2（跨 VLAN 路由成功）", en: "PC1 reaches PC2 across VLANs", test: function (s) {
          var a = subOf(s, "R1", "G0/0/0", 10), b = subOf(s, "R1", "G0/0/0", 20);
          var sw = s.vlan.SW;
          return !!a && !!b && a.arp && b.arp && !!sw && sw.linkType["G0/0/24"] === "trunk" && sw.access["G0/0/1"] === 10 && sw.access["G0/0/2"] === 20;
        } }
      ],
      pings: [{
        id: "p1", label: "PC1 → PC2", cmd: "ping 192.168.20.10",
        run: function (s) {
          var a = subOf(s, "R1", "G0/0/0", 10), b = subOf(s, "R1", "G0/0/0", 20);
          var sw = s.vlan.SW;
          if (!sw || sw.linkType["G0/0/24"] !== "trunk") {
            return { path: ["PC1", "SW"], ok: false, reason: "到路由器的 24 口还不是 Trunk，带 VLAN 标签的帧无法通过。" };
          }
          if (!a || !a.dot1q || !a.ip) {
            return { path: ["PC1", "SW", "R1"], ok: false, reason: "R1 缺少 VLAN 10 子接口（802.1Q + 网关 IP），PC1 的网关不可达。" };
          }
          if (!a.arp) {
            return { path: ["PC1", "SW", "R1"], ok: false, reason: "子接口 .10 未开启 arp broadcast enable，ARP 应答无法返回（华为默认关闭）。" };
          }
          if (!b || !b.dot1q || !b.ip || !b.arp) {
            return { path: ["PC1", "SW", "R1"], ok: false, reason: "VLAN 20 子接口未完成配置，路由器没有到 192.168.20.0/24 的直连路由。" };
          }
          return { path: ["PC1", "SW", "R1", "SW", "PC2"], ok: true, reason: "子接口完成 802.1Q 解封装与路由转发，两侧 VLAN 互通。" };
        }
      }],
      verify: function (s) {
        var out = [], sw = s.vlan.SW;
        out.push(["cmd", "<SW>", "display vlan"]);
        var v10 = [], v20 = [];
        if (sw) {
          if (sw.access["G0/0/1"] === 10) v10.push("GE0/0/1(U)");
          if (sw.access["G0/0/2"] === 20) v20.push("GE0/0/2(U)");
          if ((sw.trunk["G0/0/24"] || []).indexOf(10) >= 0) v10.push("GE0/0/24(T)");
          if ((sw.trunk["G0/0/24"] || []).indexOf(20) >= 0) v20.push("GE0/0/24(T)");
        }
        out.push(["out", cols(["VID", "Status", "Property", "Ports"], [5, 9, 11, 0])]);
        out.push(["out", cols(["10", "enable", "default", v10.join(" ") || "-"], [5, 9, 11, 0])]);
        out.push(["out", cols(["20", "enable", "default", v20.join(" ") || "-"], [5, 9, 11, 0])]);
        out.push(["cmd", "<R1>", "display ip interface brief"]);
        out.push(["out", cols(["Interface", "IP Address/Mask", "Physical", "Protocol"], [28, 22, 10, 0])]);
        out.push(["out", cols(["GigabitEthernet0/0/0", "unassigned", "up", "up"], [28, 22, 10, 0])]);
        ["10", "20"].forEach(function (vid) {
          var x = subOf(s, "R1", "G0/0/0", Number(vid));
          out.push(["out", cols(["GigabitEthernet0/0/0." + vid, (x && x.ip) || "unassigned", x ? "up" : "down", x ? "up" : "down"], [28, 22, 10, 0])]);
        });
        out.push(["cmd", "<PC1>", "ping 192.168.20.10"]);
        var a = subOf(s, "R1", "G0/0/0", 10), b = subOf(s, "R1", "G0/0/0", 20);
        if (a && a.arp && b && b.arp && sw && sw.linkType["G0/0/24"] === "trunk" && sw.access["G0/0/1"] === 10 && sw.access["G0/0/2"] === 20) {
          out.push(["ok", "Reply from 192.168.20.10: bytes=32 time=6ms TTL=127  (x4)"]);
          out.push(["ok", "VLAN 10 → VLAN 20 间路由成功。"]);
        } else {
          out.push(["err", "Request timeout!  VLAN 间路由尚未打通"]);
        }
        return out;
      }
    }
  ];

  global.TASKS = TASKS;
  global.RS_UTIL = { netOf: netOf, ipOnly: ipOnly };
})(window);

