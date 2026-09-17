/* AD1200 教学系统 —— 单一状态源 + 事件总线 */
import { SERVICES, MULTICAST, BOOT_IP, LOGIN } from './config.js';

const listeners = new Map();
export function on(evt, fn){
  if(!listeners.has(evt)) listeners.set(evt,[]);
  listeners.get(evt).push(fn);
  return () => { const a=listeners.get(evt); a.splice(a.indexOf(fn),1); };
}
export function emit(evt, payload){
  (listeners.get(evt)||[]).slice().forEach(f=>{try{f(payload)}catch(e){console.error(e)}});
  (listeners.get('*')||[]).slice().forEach(f=>{try{f(evt,payload)}catch(e){console.error(e)}});
}

/* ---------- 数码管菜单页定义（长按 Menu 进入） ---------- */
/* 数码管菜单页：
   地址类页（IP ADD / IP MASK / GATEWAY / MCAST IP）为 4 段可翻页，
   数码管一次只显示 3 位（一段），按 ▲ 键依次 192 → 168 → 001 → 150 翻段。
   net    : true 表示该页是 IPv4 地址（4 段）
   digits : 每段的显示位数
   text   : 非地址页的直接显示内容
   entries: 菜单项名称（IP ADD / IP MASK …）用于滚动提示
   注意：数码管菜单名与 LOCK 等提示统一使用【大写】字母，与实机一致        */
export function menuLabelOf(sys){
  const p = MENU_PAGES.find(x=>x.sys===sys); return p? p.label : 'IP ADD';
}
export const MENU_PAGES = [
  { key:'IP',    sys:'ip',       label:'IP ADD',   short:'ip',  title:'IP 地址',   text:BOOT_IP,       net:true, digits:3, up:true },
  { key:'MASK',  sys:'mask',     label:'IP MASK',  short:'mask',title:'子网掩码',  text:'255.255.255.0', net:true, digits:3, up:true },
  { key:'GW',    sys:'gateway',  label:'GATEWAY',  short:'gw',  title:'网关',      text:'192.168.1.1', net:true, digits:3, up:true },
  { key:'MCAST', sys:'mcast',    label:'MCAST IP', short:'mcast',title:'组播地址', text:MULTICAST.group, net:true, digits:3, up:true },
  { key:'MPORT', sys:'mport',    label:'MCAST PORT',short:'mport',title:'组播端口', text:MULTICAST.port, net:false, digits:5, up:true },
  { key:'MAC',   sys:'macadd',   label:'MAC ADD',  short:'mac', title:'MAC 地址',  text:'E0:1C:41:A2:5F:9B', net:false, digits:8, up:true },
  { key:'SOFT',  sys:'softver',  label:'SOFT VER', short:'ver', title:'软件版本',  text:'V2.13',      net:false, digits:4, up:true },
  { key:'EXIT',  sys:'exit',     label:'EXIT',     short:'exit',title:'退出菜单',  text:'EXIT',       net:false, digits:4, up:true },
];
/* 数码管每页可显示的段数 */
export function segmentsOf(page){
  if(!page || !page.net) return 1;
  return String(pageText(page)).split('.').length;
}

const S = {
  /* ---- 实机 ---- */
  device: {
    booted: true,
    ip: BOOT_IP,
    mask: '255.255.255.0',
    gateway: '192.168.1.1',
    menuOpen: false,
    pageIndex: 0,
    view: 'IP',            // IP | MASK | GW | MAC | SOFT | EXIT
    viewMode: 'NAME',      // NAME(只显示菜单项名) | VIEW(逐段查看) | TEXT(完整显示)
    segment: 0,            // 当前显示第 N 段
    enterDone: false,      // IP 页是否已进入（Enter）
    luck: false            // LOCK 指示灯
  },
  /* ---- 本机电脑 ---- */
  pc: { ip:'', mask:'', gw:'' },
  net: { sameSubnet:false, reachable:false, reason:'请先为本机配置与设备同网段的 IP 地址' },
  /* ---- 台架网络 ---- */
  net2: { group: MULTICAST.group, port: MULTICAST.port, valid:false, msg:'尚未下发组播参数' },
  /* ---- 设备上电即“已保存”的参数（掉电不丢，供实机数码管回读） ----
     组播地址 / 组播源地址 / 自动切换 都沿用出厂值，学员只需在后台确认下发 */
  saved: {
    group: MULTICAST.group, port: MULTICAST.port, mcastSaved: true,
    src: MULTICAST.group,          /* 组播源地址默认等于组播地址 */
    srcEnable: MULTICAST.srcEnable,
    autoSwitch: 'AUTO',            /* 自动切换默认“自动” */
    inSrc: 'IP',
    program: null                  /* 选中的节目（选了就保存） */
  },
  /* ---- 当前会话 ---- */
  session: { loggedIn:false, page:'login.html', user:'' },
  /* ---- 三个解码模块 ---- */
  modules: [1,2,3].map(i => ({
    id:i, input: i===1?'IP':(i===2?'ASI1':'E1'),
    pcr:'', video:'', audio:'', volume:70,
    searching:false, searched:false, current:null, locked:false, playing:false,
    programList:[], filter:''
  })),
  /* ---- 教学进度 ---- */
  lesson: null
};

export function getState(){ return S; }
export function set(path, value){
  const parts = path.split('.'); let o=S;
  for(let i=0;i<parts.length-1;i++) o=o[parts[i]];
  const k = parts[parts.length-1]; const old=o[k]; o[k]=value;
  emit('change:'+path, {value, old});
  emit('change', {path, value, old});
  return value;
}
export function toggle(path){ return set(path, !getVal(path)); }
export function getVal(path){
  const parts = path.split('.'); let o=S;
  for(const p of parts){ if(o==null) return undefined; o=o[p]; }
  return o;
}

/* ---------- 网络判定工具 ---------- */
export function ipToInt(ip){
  const p = String(ip||'').trim().split('.');
  if (p.length!==4) return null;
  let n=0;
  for(const s of p){
    if(!/^\d{1,3}$/.test(s)) return null;
    const v=+s; if(v>255) return null;
    n = (n<<8) | v;
  }
  return n>>>0;
}
export function maskToInt(m){
  const n = ipToInt(m);
  if(n===null) return null;
  // 校验是否为连续 1
  const inv = (~n)>>>0;
  if(((inv+1) & inv)!==0) return null;
  return n;
}
export function inSameSubnet(a,b,mask){
  const A=ipToInt(a), B=ipToInt(b), M=maskToInt(mask);
  if(A===null||B===null||M===null) return false;
  return ((A & M)>>>0) === ((B & M)>>>0);
}
/* 设备与电脑网段是否可通（考虑电脑掩码较宽的情况） */
export function canReach(pcIp, pcMask, devIp){
  const P=ipToInt(pcIp), M=maskToInt(pcMask), D=ipToInt(devIp);
  if(P===null||M===null||D===null) return {ok:false, msg:'IP 或掩码格式不正确'};
  if(((P&M)>>>0) === ((D&M)>>>0)) return {ok:true, msg:'同网段，可直接通信'};
  // 反查设备侧网段是否包含电脑
  const DM = maskToInt(S.device.mask) || 0xffffff00;
  if(((P&DM)>>>0) === ((D&DM)>>>0))
    return {ok:true, msg:'掩码较宽，设备侧网段包含本机，可通信'};
  return {ok:false, msg:'不在同一网段，无法访问 ' + devIp};
}

/* ---------- 业务动作 ---------- */
export function resetAll(){
  S.pc = {ip:'',mask:'',gw:''};
  S.net = {sameSubnet:false, reachable:false, reason:'请先为本机配置与设备同网段的 IP 地址'};
  S.net2 = {group:MULTICAST.group, port:MULTICAST.port, valid:false, msg:'尚未下发组播参数'};
  S.session = {loggedIn:false, page:'login.html', user:''};
  S.device.menuOpen=false; S.device.pageIndex=0; S.device.view='IP'; S.device.segment=0;
  S.device.viewMode='NAME'; S.device.enterDone=false; S.device.luck=false;
  S.modules = [1,2,3].map(i=>({
    id:i, input:i===1?'IP':(i===2?'ASI1':'E1'),
    pcr:'', video:'', audio:'', volume:70, searching:false, searched:false,
    current:null, locked:false, playing:false, programList:[], filter:''
  }));
  emit('reset');
}

/* 组播地址/端口未确认生效 → 不允许搜出节目（学员要先在“设备参数”里确认）
   返回 {ok, msg} 供页面提示 */
export function canSearch(){
  if(!S.net2.valid) return { ok:false, msg:'组播地址、端口尚未保存生效，无法加入组播组，搜索不到节目' };
  if(!String(S.net2.group||'').trim() || !String(S.net2.port||'').trim())
    return { ok:false, msg:'组播地址或端口为空，设备无法加入组播组' };
  return { ok:true, msg:'' };
}

export function searchPrograms(modId){
  const m = S.modules.find(x=>x.id===modId);
  if(!m) return;
  m.searching = true; m.programList = []; m.searched=false; emit('module:'+modId, m);
  /* 模拟逐条解析 PAT/PMT 的耗时 */
  SERVICES.forEach((sv,i)=>{
    setTimeout(()=>{
      m.programList.push({...sv});
      m.searching = i < SERVICES.length-1;
      if(i===SERVICES.length-1){ m.searched=true; }
      emit('module:'+modId, m);
    }, 110 + i*130);
  });
}

export function decodeProgram(modId, sid){
  const m = S.modules.find(x=>x.id===modId);
  if(!m) return;
  const sv = m.programList.find(p=>p.sid===sid);
  if(!sv) return;
  m.current = sv; m.pcr=String(sv.pcr); m.audio=String(sv.audio); m.video='—';
  m.locked = false; m.playing = false; emit('module:'+modId, m);
  setTimeout(()=>{
    m.locked = true; m.playing = true;
    if(m.id===1) S.device.luck = true;
    /* 只要选了（点了）节目名称，就立即锁定该节目并把选择写入设备保存 */
    S.saved.program = { module:modId, sid:sv.sid, name:sv.name, pcr:sv.pcr, audio:sv.audio,
      freq:sv.freq, savedAt:new Date().toISOString() };
    emit('saved', S.saved.program);
    emit('module:'+modId, m);
    emit('lock', m);
  }, 620);
}

/* 选中节目 = 立即锁定 + 保存（学员只要点了节目名称就落盘，掉电不丢） */
export function saveProgram(modId, sv){
  const m = S.modules.find(x=>x.id===modId);
  if(!m || !sv) return null;
  m.locked = true; m.playing = true;
  if(modId === 1) S.device.luck = true;
  S.saved.program = { module:modId, sid:sv.sid, name:sv.name,
    pcr:sv.pcr, audio:sv.audio, freq:sv.freq, savedAt:new Date().toISOString() };
  emit('saved', S.saved.program);
  emit('change:saved.program', {value:S.saved.program});
  return S.saved.program;
}

export function stopDecode(modId){
  const m = S.modules.find(x=>x.id===modId);
  if(!m) return;
  m.current=null; m.locked=false; m.playing=false; m.pcr=''; m.audio='';
  if(m.id===1) S.device.luck=false;
  emit('module:'+modId, m);
}

/* ---------- 数码管页面操作 ----------
   menuKey('long')  进入菜单，固定停在 IP ADD 页
   menuKey('short') 在 IP ADD / IP MASK / GATEWAY / MCAST IP / MCAST PORT / MAC ADD / SOFT VER / EXIT 间切换
   arrowKey('up')   地址页：逐段翻页（192 → 168 → 001 → 150），循环
   arrowKey('down') 切到下一个菜单项
   enterKey()       地址页：进入逐段查看；已经是查看态则切回完整显示
   --------------------------------------- */
/* 数码管菜单交互（与实机一致）：
   长按 Menu   → 进入菜单，数码管只显示当前菜单项名（IP ADD / IP MASK …），不显示数值
   短按 Menu   → 菜单中切到下一项
   Enter       → 进入当前菜单项，从第 1 段开始显示数值（IP 页：A1-192）
   ▲ / ▼       → 进入后逐段翻页（A1-192 → A1-168 → A1-001 → A1-150）
   长按 Menu   → 退出菜单
   ------------------------------------------------------------------ */
export function menuKey(mode){        // 'short' | 'long'
  if(mode !== 'long' && !S.device.menuOpen) return;   /* 未进入菜单时不响应短按 */
  if(mode === 'long'){
    if(S.device.menuOpen){ S.device.menuOpen = false; S.device.view = 'IP'; }
    else { S.device.menuOpen = true; S.device.pageIndex = 0; S.device.segment = 0;
           S.device.viewMode = 'NAME'; S.device.enterDone = false; }
  } else {
    S.device.pageIndex = (S.device.pageIndex + 1) % MENU_PAGES.length;
    S.device.segment = 0; S.device.viewMode = 'NAME'; S.device.enterDone = false;
  }
  S.device.view = MENU_PAGES[S.device.pageIndex].sys;
  emit('device', S.device);
}
export function arrowKey(dir){        // 'up' | 'down'
  if(!S.device.menuOpen) return;
  const total = MENU_PAGES.length;
  const page = MENU_PAGES[S.device.pageIndex];
  if(!S.device.enterDone){
    /* 还没按 Enter 进页 → 上下键只在菜单项之间移动，不移出数值 */
    S.device.pageIndex = (dir === 'down')
      ? (S.device.pageIndex + 1) % total
      : (S.device.pageIndex + total - 1) % total;
    S.device.segment = 0; S.device.viewMode = 'NAME';
  } else if(dir === 'down'){
    /* 已进页：▼ 退回菜单项列表（与实机一致，先按 Enter 再翻段） */
    S.device.pageIndex = (S.device.pageIndex + 1) % total;
    S.device.segment = 0; S.device.viewMode = 'NAME'; S.device.enterDone = false;
  } else {
    /* 已进页：▲ 逐段翻页 */
    const n = segmentsOf(page);
    S.device.segment = (S.device.segment + 1) % n;
    S.device.viewMode = 'VIEW';
  }
  S.device.view = MENU_PAGES[S.device.pageIndex].sys;
  emit('device', S.device);
}
export function enterKey(){
  const page = MENU_PAGES[S.device.pageIndex];
  if(!S.device.menuOpen) return page;
  if(page.sys === 'exit'){ S.device.menuOpen = false; S.device.view = 'IP'; }
  else if(page.net){
    if(!S.device.enterDone){
      /* 第一次按 Enter：进入本页，从第 1 段开始显示数值 */
      S.device.enterDone = true; S.device.segment = 0; S.device.viewMode = 'VIEW';
    } else if(S.device.viewMode === 'TEXT'){
      S.device.viewMode = 'VIEW'; S.device.segment = 0;   /* 完整显示 → 回到逐段 */
    } else {
      S.device.viewMode = 'TEXT';                          /* 逐段 → 完整显示 */
    }
  } else {
    S.device.enterDone = true;
    S.device.viewMode = S.device.viewMode === 'TEXT' ? 'VIEW' : 'TEXT';
  }
  emit('device', S.device);
  return page;
}
/* 数码管显示内容 —— 与实机一致的关键点：
   · 菜单项名（IP ADD / MCAST IP …）只显示【菜单名】本身，不显示数值
   · 必须【按 Enter 进页】后才显示数值；IP 页每段带段号：A1-192 / A1-168 / A1-001 / A1-150
   · ▲ 逐段翻页；再按 Enter 切“完整显示”
   pageText() 取“当前生效值”（组播地址/端口用设备已保存的值） */
export function pageText(page){
  if(!page) return '';
  if(page.sys === 'mcast') return String(S.saved?.group || page.text);
  if(page.sys === 'mport') return String(S.saved?.port  || page.text);
  return page.text;
}
/* 地址页的段标签：IP / MCAST IP 用 A1- / A2-（A1 = 模块1 的 IP，A2 = 第二组播地址），其余页 A0- */
export function segPrefix(page, idx){
  if(!page) return '';
  if(page.sys === 'ip')     return 'A1-';
  if(page.sys === 'mcast')  return 'A2-';
  if(page.sys === 'mask' || page.sys === 'gateway') return 'A1-';
  return 'A0-';
}
export function currentDisplayText(){
  const d = S.device, page = MENU_PAGES[d.pageIndex];
  if(!d.menuOpen) return d.luck ? 'LOCK' : '';
  if(!page) return '';
  /* 未按 Enter 进页：只显示菜单项名（如 IP ADD） */
  if(page.net && !d.enterDone) return page.label;
  if(!page.net && !d.enterDone) return page.label;
  if(!page.net) return page.up ? String(pageText(page)).toUpperCase() : pageText(page);
  const segs = String(pageText(page)).split('.').map(x => x.padStart(page.digits,'0'));
  if(d.viewMode === 'TEXT'){
    return segs.join('.').slice(0,8);
  }
  return segPrefix(page, d.segment) + (segs[d.segment] ?? segs[0]);
}
/* 某一页的段描述，例如 '第 2/4 段 · A1-168' */
export function currentSegmentDesc(){
  const d = S.device, page = MENU_PAGES[d.pageIndex];
  if(!page || !page.net || !d.enterDone) return '';
  const segs = String(pageText(page)).split('.');
  return `第 ${d.segment+1}/${segs.length} 段 · ${segPrefix(page,d.segment)}${segs[d.segment]}`;
}
export { MENU_PAGES as PAGES };

export { SERVICES, MULTICAST, BOOT_IP, LOGIN };
