:root{
  --bg:#F2F6FB; --card:#FFFFFF; --ink:#1B2A3C; --body:#3A4C60; --muted:#7B8B9E;
  --line:#E3EAF2; --line2:#D2DFEC; --blue:#2F6FEB; --blue-dark:#1E56C8; --soft:#EDF3FE;
  --green:#188A5E; --green-bg:#F0FAF5; --red:#C24B4B; --red-bg:#FFF5F5;
  --amber:#A8690F; --amber-bg:#FFF9ED; --purple:#7A5AF8;
  --mono:Consolas,"Cascadia Mono",Menlo,"Courier New",monospace;
  --shadow:0 1px 2px rgba(17,38,66,.04),0 8px 24px rgba(17,38,66,.05);
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
[hidden]{display:none!important}
html,body{height:100%}
body{
  margin:0;background:var(--bg);color:var(--body);overflow:hidden;
  font-family:"Microsoft YaHei","PingFang SC",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:14px;line-height:1.5;
}
button{font-family:inherit}
h1,h2,p{margin:0}
.app{height:100dvh;display:flex;flex-direction:column;min-height:0}

/* ---------- top bar ---------- */
.topbar{
  display:flex;align-items:center;gap:16px;padding:10px 20px;background:var(--card);
  border-bottom:1px solid var(--line);flex:none;
}
.brand{display:flex;align-items:center;gap:12px;min-width:0;margin-right:auto}
.logo{
  width:40px;height:40px;border-radius:11px;flex:none;display:grid;place-items:center;
  background:linear-gradient(160deg,#EDF4FF,#DCE8FB);border:1px solid #D3E2F8;color:var(--blue);
}
.logo svg{width:22px;height:22px}
.brandtext{min-width:0}
.brandtext h1{font-size:19px;color:var(--ink);letter-spacing:.2px;white-space:nowrap;display:flex;align-items:baseline;gap:8px}
.brandtext h1 span{font-size:12px;color:var(--muted);font-weight:500;letter-spacing:.4px}
.brandtext p{font-size:11.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.topactions{display:flex;align-items:center;gap:9px;flex:none}
.scorebox{
  display:flex;align-items:baseline;gap:5px;border:1px solid var(--line);background:#F8FAFD;
  border-radius:9px;padding:6px 11px;
}
.scorebox span{font-size:11px;color:var(--muted)}
.scorebox b{font-family:var(--mono);font-size:20px;color:var(--blue);line-height:1}
.scorebox em{font-style:normal;font-size:11px;color:#9AA8B8}
.ghost{
  border:1px solid var(--line2);background:#fff;color:#59708A;border-radius:8px;
  padding:7px 12px;font-size:12.5px;cursor:pointer;transition:.15s;
}
.ghost:hover{color:var(--blue);border-color:#A9C6EE;background:#FAFCFF}

/* ---------- rail ---------- */
.rail{
  display:flex;align-items:center;gap:0;padding:8px 20px;background:#FAFCFF;
  border-bottom:1px solid var(--line);overflow-x:auto;flex:none;
}
.railbtn{
  flex:1 1 0;min-width:148px;display:flex;align-items:center;gap:9px;background:none;border:0;
  padding:4px 8px;cursor:pointer;position:relative;text-align:left;color:var(--muted);
}
.railbtn::after{
  content:"";position:absolute;right:-4px;top:50%;width:10px;height:1px;background:var(--line2);
}
.railbtn:last-child::after{display:none}
.railbtn .n{
  width:26px;height:26px;border-radius:50%;flex:none;display:grid;place-items:center;
  border:1px solid var(--line2);background:#fff;font-family:var(--mono);font-size:12px;
  color:#8496A9;transition:.18s;
}
.railbtn .lab{min-width:0}
.railbtn .lab b{display:block;font-size:12.5px;color:#5C7188;font-weight:600;white-space:nowrap}
.railbtn .lab i{display:block;font-style:normal;font-size:10px;color:#9AA8B8;white-space:nowrap}
.railbtn:hover .n{border-color:#A9C6EE;color:var(--blue)}
.railbtn.on .n{background:var(--blue);border-color:var(--blue);color:#fff;box-shadow:0 0 0 3px rgba(47,111,235,.13)}
.railbtn.on .lab b{color:var(--blue)}
.railbtn.done .n{background:var(--green);border-color:var(--green);color:#fff;font-size:0}
.railbtn.done .n::before{content:"✓";font-family:inherit;font-size:13px}

/* ---------- layout ---------- */
.workspace{
  flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.18fr) minmax(356px,.82fr);
  gap:13px;padding:13px 18px 16px;
}
.stage-col{display:flex;flex-direction:column;gap:12px;min-height:0;min-width:0}
.panel{display:flex;flex-direction:column;gap:12px;min-height:0;overflow-y:auto;padding-right:3px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);min-width:0}

/* ---------- stage ---------- */
.stagecard{flex:1 1 auto;min-height:250px;display:flex;flex-direction:column;overflow:hidden}
.cardhead{
  display:flex;align-items:center;gap:8px;padding:9px 13px;border-bottom:1px solid var(--line);
  font-size:12px;color:var(--muted);flex:none;min-height:40px;
}
.cardhead.slim{padding:8px 13px;min-height:38px}
.cardhead .dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex:none}
.ch-zh{color:#4E657D;font-size:12.5px;font-weight:600}
.ch-en{font-size:10.5px;color:#9AA8B8;letter-spacing:.2px}
.pingtools{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.pingbtn{
  border:1px solid #CFE0F6;background:#F4F9FF;color:#2766C9;border-radius:7px;
  font-size:12px;padding:5px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;
}
.pingbtn:hover{background:#E9F3FF;border-color:#A9C6EE}
.pingbtn:disabled{opacity:.5;cursor:default}
.pingbtn svg{width:11px;height:11px}
.canvas-wrap{position:relative;flex:1;min-height:0;background-color:#FBFDFF;background-image:radial-gradient(circle at 1px 1px,#E4ECF6 1px,transparent 0);background-size:20px 20px}
#topo{display:block;width:100%;height:100%}
.hud{
  position:absolute;left:14px;bottom:14px;right:14px;max-width:520px;background:#fff;
  border:1px solid var(--line2);border-left:3px solid var(--blue);border-radius:9px;
  padding:9px 12px;font-size:12.5px;line-height:1.55;color:#42566D;
  box-shadow:0 8px 26px rgba(17,38,66,.12);animation:hudin .2s ease-out;
}
.hud.bad{border-left-color:var(--red);color:#7C4141;background:#FFFAFA}
.hud.good{border-left-color:var(--green);color:#2C6B53;background:#FBFEFC}
@keyframes hudin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* ---------- terminal ---------- */
.termcard{flex:0 0 182px;display:flex;flex-direction:column;overflow:hidden}
.termhead{
  display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid var(--line);
  background:#F7FAFE;flex:none;
}
.tdot{width:8px;height:8px;border-radius:50%;background:#DCE4EE}
.tdot:nth-child(1){background:#E8B7B7}
.tdot:nth-child(2){background:#EBD3A8}
.tdot:nth-child(3){background:#B4DAC8}
.termtitle{font-size:11px;color:#7C8B9D;font-family:var(--mono);margin-left:5px}
.termclear{
  margin-left:auto;border:0;background:none;color:#9AA8B8;font-size:11px;cursor:pointer;padding:2px 4px;
}
.termclear:hover{color:var(--blue)}
.termout{
  flex:1;min-height:0;overflow-y:auto;padding:8px 12px 10px;background:#FCFDFF;
  font-family:var(--mono);font-size:12px;line-height:1.62;color:#4A5D72;
  white-space:pre-wrap;overflow-wrap:anywhere;
}
.tl{display:block}
.tl .pr{color:#8090A4;margin-right:6px}
.tl .cm{color:#22364D}
.tl.out{color:#5E7188}
.tl.err{color:#B94A4A}
.tl.note{color:#94701F}
.tl.ok{color:#188A5E}

/* ---------- task card ---------- */
.taskcard{padding:14px 16px 15px;flex:none}
.tasktop{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.taskno{font-family:var(--mono);font-size:11px;color:var(--blue);background:var(--soft);border:1px solid #D8E6FB;border-radius:5px;padding:2px 6px}
.tasktag{font-size:10.5px;color:#8B9CAE;letter-spacing:.2px}
.reset-task{margin-left:auto}
.linkbtn{border:0;background:none;color:#93A4B6;font-size:11px;cursor:pointer;padding:2px;text-decoration:underline;text-underline-offset:2px}
.linkbtn:hover{color:var(--blue)}
.taskcard h2{font-size:20px;color:var(--ink);letter-spacing:.2px;line-height:1.35}
.ten{font-size:11.5px;color:var(--muted);margin-top:1px}
.tintro{margin-top:8px;font-size:12.8px;line-height:1.62;color:var(--body)}
.tintro .en{display:block;font-size:11px;color:var(--muted);margin-top:3px;line-height:1.55}
.steps{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
.step{
  display:flex;align-items:center;gap:5px;font-size:11px;line-height:1.3;color:#6B7E92;
  border:1px solid var(--line);border-radius:6px;padding:3px 7px 3px 4px;background:#FAFCFF;
  max-width:100%;
}
.step .sn{
  width:15px;height:15px;border-radius:50%;flex:none;display:grid;place-items:center;
  border:1px solid var(--line2);font-family:var(--mono);font-size:9px;color:#93A4B6;background:#fff;
}
.step .sx{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:132px}
.step .sen{display:none}
.step .sc{font-family:var(--mono);font-size:9px;color:#A3B1C1;flex:none}
.step.done{color:#4C7E68;border-color:#D8EADF;background:#F7FBF9}
.step.done .sn{background:var(--green);border-color:var(--green);color:#fff;font-size:0}
.step.done .sn::before{content:"✓";font-size:10px}
.step.done .sc{color:var(--green)}

/* ---------- bank ---------- */
.buildcard{display:flex;flex-direction:column;flex:none;overflow:hidden}
.bankhint{margin-left:auto;font-size:10.5px;color:#A9B6C5}
.bank{padding:6px 10px 8px;max-height:190px;overflow-y:auto}
.devgroup+.devgroup{margin-top:8px}
.devhead{display:flex;align-items:center;gap:6px;margin:2px 0 5px;font-size:10.5px;color:#93A4B6}
.devchip{
  font-family:var(--mono);font-size:10px;font-weight:700;border-radius:4px;padding:1px 5px;letter-spacing:.3px;
  border:1px solid;flex:none;
}
.devchip.r1{color:#2766C9;border-color:#C9DCF7;background:#F1F7FF}
.devchip.r2{color:#7A4FBD;border-color:#DCCDF3;background:#F8F3FF}
.devchip.r3{color:#0F7B7B;border-color:#C6E5E5;background:#F2FBFB}
.devchip.sw{color:#8A6414;border-color:#EAD9B6;background:#FFFAF0}
.devcnt{margin-left:auto;font-family:var(--mono);color:#B2BFCD}
.tiles{display:flex;flex-direction:column;gap:4px}
.tile{
  display:flex;align-items:center;gap:7px;width:100%;text-align:left;cursor:pointer;
  border:1px solid var(--line);background:#fff;border-radius:7px;padding:6px 8px;transition:.14s;
}
.tile:hover:not(.done){border-color:#B7D0F2;background:#FAFCFF;transform:translateX(1px)}
.tile.done{background:#F6FAF8;border-color:#D8EADF;cursor:default}
.tile .s{
  flex:none;width:16px;height:16px;border-radius:4px;background:#F0F5FB;color:#8B9CAE;
  font-family:var(--mono);font-size:9px;display:grid;place-items:center;
}
.tile .tx{font-family:var(--mono);font-size:11.5px;color:#33475B;line-height:1.4;min-width:0;word-break:break-word}
.tile.done .tx{color:#8AA597;text-decoration:line-through}
.tile .port{flex:none;margin-left:auto;font-family:var(--mono);font-size:9.5px;color:#9AA8B8;white-space:nowrap}
.tile.done .s{background:var(--green);color:#fff}

/* ---------- queue ---------- */
.qhead{
  display:flex;align-items:center;justify-content:space-between;padding:7px 13px 5px;
  border-top:1px solid var(--line);font-size:11.5px;color:#6B7E92;
}
.qhead i{font-style:normal;font-family:var(--mono);font-size:10px;color:#9AA8B8;margin-left:3px}
.queue{padding:2px 10px 6px;max-height:172px;overflow-y:auto;min-height:44px}
.queue.drop{background:#F4F9FF;outline:1px dashed #A9C6EE;outline-offset:-3px;border-radius:6px}
.queue .empty{font-size:11.5px;color:#A9B6C5;text-align:center;padding:10px 0}
.qrow{
  display:flex;align-items:center;gap:6px;padding:5px 7px;border:1px solid var(--line);
  background:#FBFCFE;border-radius:6px;margin-bottom:4px;animation:qin .16s ease-out;
}
@keyframes qin{from{opacity:0;transform:translateY(-3px)}to{opacity:1;transform:none}}
.qrow .qn{font-family:var(--mono);font-size:9.5px;color:#A3B1C1;width:13px;flex:none}
.qrow .qdev{font-family:var(--mono);font-size:9px;font-weight:700;border-radius:3px;padding:1px 4px;border:1px solid;flex:none}
.qrow .qtx{font-family:var(--mono);font-size:11px;color:#3B4F64;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.qrow .qa{display:flex;gap:1px;flex:none}
.qrow .qa button{
  border:1px solid transparent;background:none;color:#A3B1C1;font-size:11px;cursor:pointer;
  width:19px;height:19px;border-radius:4px;line-height:1;padding:0;
}
.qrow .qa button:hover{background:#EDF4FE;color:var(--blue);border-color:#D6E4F8}
.qrow .qa button.del:hover{background:#FFF1F1;color:var(--red);border-color:#F0D5D5}
.actions{display:flex;gap:7px;padding:6px 13px 8px}
.actions button{
  border-radius:8px;padding:8px 12px;font-size:12.5px;cursor:pointer;border:1px solid;transition:.15s;flex:1;
}
.primary{background:var(--blue);border-color:var(--blue);color:#fff;font-weight:600}
.primary:hover:not(:disabled){background:var(--blue-dark)}
.primary:disabled{background:#CFDCEA;border-color:#CFDCEA;color:#fff;cursor:default}
.verify{background:#fff;border-color:#BBD3F1;color:#2766C9}
.verify:hover{background:#F4F9FF}
.actions .ghost{flex:0 0 72px}
.msg{padding:0 13px 9px;font-size:11.5px;line-height:1.5;color:#8B9CAE;min-height:22px}
.msg.ok{color:var(--green)}
.msg.bad{color:var(--red)}
.msg.warn{color:var(--amber)}

/* ---------- report ---------- */
.reportcard{flex:none;overflow:hidden}
.rcount{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:#9AA8B8}
.report{padding:6px 11px 9px}
.rrow{display:flex;align-items:flex-start;gap:7px;padding:5px 3px;border-bottom:1px dashed #EDF1F6}
.rrow:last-child{border-bottom:0}
.rnum{
  width:15px;height:15px;border-radius:50%;flex:none;margin-top:1px;display:grid;place-items:center;
  background:#F1F5FA;color:#A3B1C1;font-family:var(--mono);font-size:8.5px;
}
.rtxt{min-width:0;flex:1}
.rtxt b{display:block;font-size:11.5px;font-weight:500;color:#5E7188;line-height:1.45}
.rtxt i{display:block;font-style:normal;font-size:10px;color:#A3B1C1;line-height:1.4}
.rstate{flex:none;font-size:10px;color:#B2BFCD;padding-top:2px;font-family:var(--mono)}
.rrow.pass .rnum{background:var(--green);color:#fff}
.rrow.pass .rtxt b{color:#2C6B53}
.rrow.pass .rstate{color:var(--green)}
.rrow.fail .rnum{background:var(--red);color:#fff}
.rrow.fail .rtxt b{color:#9B4444}
.rrow.fail .rstate{color:var(--red)}

/* ---------- modal ---------- */
.modal{
  position:fixed;inset:0;background:rgba(20,36,56,.34);backdrop-filter:blur(2px);
  display:grid;place-items:center;padding:20px;z-index:50;
}
.modalcard{
  width:min(600px,100%);max-height:88vh;overflow-y:auto;background:#fff;border-radius:14px;
  border:1px solid var(--line);box-shadow:0 24px 70px rgba(17,38,66,.25);padding:22px 24px;
  animation:modin .2s ease-out;
}
@keyframes modin{from{opacity:0;transform:translateY(10px) scale(.99)}to{opacity:1;transform:none}}
.modalcard h3{font-size:19px;color:var(--ink);margin-bottom:3px}
.modalcard .sub{font-size:11.5px;color:var(--muted)}
.modalcard p{font-size:12.8px;line-height:1.7;color:var(--body);margin-top:10px}
.modalcard ul{margin:10px 0 0;padding-left:18px}
.modalcard li{font-size:12.5px;line-height:1.75;color:var(--body)}
.modalcard .mact{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.modalcard .mact button{border-radius:8px;padding:8px 15px;font-size:12.5px;cursor:pointer;border:1px solid var(--line2);background:#fff;color:#59708A}
.modalcard .mact .primary{border-color:var(--blue);background:var(--blue);color:#fff}
.sumlist{display:flex;flex-direction:column;gap:5px;margin-top:12px}
.sumrow{display:flex;align-items:center;gap:8px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:#FAFCFF;font-size:12px}
.sumrow b{font-family:var(--mono);font-size:11px;color:#93A4B6}
.sumrow span{flex:1;color:#4E657D}
.sumrow em{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--green)}
.bigscore{display:flex;align-items:baseline;gap:6px;margin-top:14px}
.bigscore b{font-family:var(--mono);font-size:38px;color:var(--blue);line-height:1}
.bigscore span{font-size:12px;color:var(--muted)}

/* ---------- responsive ---------- */
@media (max-width:1080px){
  .workspace{grid-template-columns:1fr;overflow-y:auto;display:block}
  body{overflow:auto}
  .app{height:auto;min-height:100dvh}
  .stage-col{height:auto}
  .stagecard{height:440px}
  .termcard{height:190px;margin-top:12px}
  .panel{margin-top:12px;overflow:visible}
  .railbtn{min-width:130px}
  .brandtext h1 span{display:none}
}
@media (max-width:640px){
  .topbar{padding:9px 12px;flex-wrap:wrap}
  .brandtext h1{font-size:16px}
  .brandtext p{display:none}
  .topactions{margin-left:auto}
  .ghost{padding:6px 9px;font-size:11.5px}
  .scorebox b{font-size:17px}
  .rail{padding:6px 10px}
  .railbtn{min-width:112px}
  .railbtn .lab i{display:none}
  .workspace{padding:10px 11px 14px}
  .stagecard{height:360px}
  .pingtools{margin-left:0;width:100%;justify-content:flex-start}
  .cardhead{flex-wrap:wrap}
}
@media print{
  body{overflow:visible;background:#fff}
  .app,.modal .mact{display:none!important}
  .modal{position:static;background:#fff;padding:0;display:block}
  .modalcard{box-shadow:none;border:0;max-height:none;width:100%}
}
