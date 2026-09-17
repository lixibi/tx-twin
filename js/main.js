/* ============================================================
   AD1200 教学系统 —— 主控制器
   左：配置电脑（模拟浏览器）  右：实机数字孪生（Three.js）
   ============================================================ */
import { Twin } from './twin.js';
import { AudioSim } from './audio.js';
import { STEPS, STEP_INDEX } from './pages/lecture.js';
import * as S from './state.js';
import { SERVICES, MULTICAST, BOOT_IP, LOGIN } from './config.js';
import { MENU_PAGES, currentDisplayText, currentSegmentDesc, segPrefix } from './state.js';

const $  = (s,r=document)=>r.querySelector(s);
/* 界面缩放倍数（自动适配 × 手动微调）。默认 1 表示“自动铺满但等比不变形”，
   窗口比 1600×900 大就放大到铺满，比它小就缩小到完整可见，永远不裁掉界面元素 */
let zoomLevel = 1;
/* 模拟浏览器画框：fitStage 会一起刷新，必须在调用前完成初始化 */
let _screenWrap = null, _screenBox = null;
const SCREEN_BASE = { w: 1600, h: 900 };
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const st = S.getState();

/* ---------------- 主舞台自适应（不再锁 16:9） ----------------
   设计基准 1600×900。窗口比例与 16:9 不一致时，
   · 取 min(w/1600, h/900) 整体等比缩放 —— 保证【元素一个都不少】
   · 再按可用空间居中，多余部分留边，绝不把左栏/右栏裁出去
   演示时建议按 F11 / 点“全屏演示”，缩放会自动跟上。          */
export const VIEW = { scaleNum: 1, baseW: 1600, baseH: 900 };
function vitals(){
  /* 全屏时用 screen 尺寸兜底，避免某些浏览器 innerHeight 有延迟 */
  const w = document.fullscreenElement ? Math.max(innerWidth, screen.width)  : innerWidth;
  const h = document.fullscreenElement ? Math.max(innerHeight, screen.height) : innerHeight;
  return { w: w||1600, h: h||900 };
}
function fitStage(){
  applyZoom();
  if(typeof fitScreen === 'function') fitScreen();
}
addEventListener('resize', fitStage);
addEventListener('orientationchange', fitStage);
document.addEventListener('fullscreenchange', ()=>{ setTimeout(fitStage, 60); });
fitStage();

/* ---------------- 日志 ---------------- */
const LOG_MAX = 120;
function log(line, kind='info'){
  const box = $('#loglist');
  const t = new Date(), p=n=>String(n).padStart(2,'0');
  box.insertAdjacentHTML('beforeend',
    `<div class="logline ${kind}"><span class="t">${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}</span><span class="m">${line}</span></div>`);
  while(box.children.length > LOG_MAX) box.removeChild(box.firstChild);
  box.parentElement.scrollTop = box.parentElement.scrollHeight;
}

/* ---------------- 底部浮动提示 ---------------- */
let floatTimer=null;
function toast(text, ms=3200){
  const bar = $('#floatBar'); $('#floatMsg').innerHTML = text;
  bar.classList.add('show');
  clearTimeout(floatTimer);
  floatTimer = setTimeout(()=>bar.classList.remove('show'), ms);
}

/* ============================================================
   1) 数字孪生
   ============================================================ */
const twin = new Twin($('#threeCanvas'));
twin.setLed('power', true, 0x39d98a);
twin.setLed('work', false);
twin.setWork(true);
twin.setDisplay('--------');

twin.on('hover', (part)=>{});
/* Menu 键长按：按下计时 / 松手判定，避免被同一次 pointerup 误判为短按 */
twin.on('down', (part)=>{ if(part && part.id === 'btn-menu') menuDown(); });
twin.on('release', ()=>{ menuUp(); });
twin.on('click', (part)=>{
  if(!part) return;
  switch(part.id){
    case 'btn-menu':  break;                 /* 交给 down / release 处理 */
    case 'btn-up':    devicePress('up'); break;
    case 'btn-down':  devicePress('down'); break;
    case 'btn-enter': devicePress('enter'); break;
    case 'btn-left':
    case 'btn-right': {
      twin.flashButton(part.id, 220);
      toast('◀ / ▶ 左右键位：本机型<b>未定义功能</b>，仅保留键位，不参与演示');
      log('按下 '+part.title+'：本机型未定义功能（保留键位）','warn');
      break;
    }
    case 'display':   devicePress('menu', {immediate:true}); break;
    default:
      const pid = String(part.id||'');
      /* 背板三芯接口 / 插在上面的卡侬头，都可直接切换试听输出通道 */
      if(pid.startsWith('out-') || pid.startsWith('xlr-')){ selectOutputChannel(pid.slice(4)); return; }
      toast(`<b style="color:#9fd0f0">${part.title}</b> — ${part.desc}`);
      log(`查看部件：${part.title}`, 'info');
  }
});

/* ============================================================
   2.5) 输出通道：背板三块板卡 = 三路音频，每路左右声道（6 个三芯接口）
   ============================================================ */
const OUT_CHANNELS = [
  { ch:'M1L', board:1, side:'L', label:'解码模块1 · 左声道 L', desc:'1 路输出（L · 蓝环）' },
  { ch:'M1R', board:1, side:'R', label:'解码模块1 · 右声道 R', desc:'1 路输出（R · 红环）' },
  { ch:'M2L', board:2, side:'L', label:'解码模块2 · 左声道 L', desc:'2 路输出（L · 蓝环）' },
  { ch:'M2R', board:2, side:'R', label:'解码模块2 · 右声道 R', desc:'2 路输出（R · 红环）' },
  { ch:'M3L', board:3, side:'L', label:'解码模块3 · 左声道 L', desc:'3 路输出（L · 蓝环）' },
  { ch:'M3R', board:3, side:'R', label:'解码模块3 · 右声道 R', desc:'3 路输出（R · 红环）' },
];
function chanById(ch){ return OUT_CHANNELS.find(c=>c.ch===ch) || OUT_CHANNELS[0]; }

/* 点击孪生上的输出接口：选为试听输出并联动播放 */
function selectOutputChannel(ch){
  const c = chanById(ch);
  const d = D();
  if(!d.luck && !st.modules.some(m=>m.locked)){
    toast(`已选择输出通道 <b>${c.label}</b>｜提示：先在后台搜索并锁定一路节目，声音才会从该接口送出`);
    log(`选择输出通道：${c.label}（${c.desc}）`,'info');
    twin.selectChannel(ch);
    outChannelText = c.label + '（' + c.desc + '）';
    renderAudioMode();
    refreshOutStrip();
    return;
  }
  twin.selectChannel(ch);
  outChannelText = c.label + '（' + c.desc + '）';
  renderAudioMode();
  const playing = st.modules.find(m=>m.current) || st.modules[c.board-1];
  const sv = playing?.current;
  if(sv){ audio.play(sv.sid, sv.name, 'online'); audio.setVolume(st.modules[c.board-1].volume); }
  toast(`输出已切到 <b>${c.label}</b>｜${sv ? '正在播放：'+sv.name : '等待选择节目'}`);
  log(`输出通道切换到 ${c.label}（${c.desc}），音频路由到该通道`,'ok');
  refreshOutStrip();
  checkProgress();
}
window.__selectOut = selectOutputChannel;

/* 输出通道：界面上不再放卡片面板，只在数字孪生上同步接口状态（保持简洁） */
function refreshOutStrip(){
  const cur = twin.channelOut;
  if(twin.setChannelState) OUT_CHANNELS.forEach(c=>{
    if(c.ch !== cur && twin.outChannels[c.ch] && twin.outChannels[c.ch].state !== 'off')
      twin.setChannelState(c.ch, 'off');
  });
  syncTxAudio();
}
/* 发射机电平表（L / R 两条竖直音柱）：只有【解码锁定】后才给电平，
   未解码时 txInL / txInR 置 false → 音柱整块不显示（NO DECODE） */
function syncTxAudio(){
  if(!twin || !twin.setTxInput) return;
  const m1 = st.modules[0];
  const on = !!(m1 && m1.locked && m1.playing && m1.current);
  twin.setTxInput('L', on);
  twin.setTxInput('R', on);
  twin._txAudio = on;
}
window.__refreshOutStrip = refreshOutStrip;
window.__syncTxAudio = syncTxAudio;

/* ============================================================
   2) 实机面板状态机（数码管 / 按键 / LOCK）
   ============================================================ */
const D = () => S.getState().device;

const LONG_PRESS_MS = 650;
let holdTimer = null, pressStart = null, menuHandled = false;

/* Menu 键：按下开始计时，松手判定短按 / 长按（长按由定时器直接触发） */
function menuDown(){
  twin.flashButton('btn-menu', 900);
  pressStart = Date.now(); menuHandled = false;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(()=>{ menuHandled = true; doLongMenu(); }, LONG_PRESS_MS);
}
function menuUp(){
  if(pressStart == null) return;
  clearTimeout(holdTimer);
  const held = Date.now() - pressStart;
  pressStart = null;
  if(menuHandled) return;
  if(held < LONG_PRESS_MS) doShortMenu();
}

function devicePress(kind, opts={}){
  const immediate = opts.immediate === true;
  if(kind === 'menu'){
    twin.flashButton('btn-menu', 320);
    /* 键盘 M 键 / Esc：直接按“长按”处理，进入或退出菜单 */
    if(immediate) return doLongMenu();
    return menuDown();
  }
  twin.flashButton('btn-'+kind);
  if(kind === 'up'){
    if(!D().menuOpen){ log('上键：尚未进入菜单，请先长按 Menu 键','warn'); toast('请先<b>长按 Menu 键</b>进入设置菜单'); return; }
    if(!D().enterDone){
      log('上键：还没按 Enter 进页，数码管只显示菜单项名','warn');
      toast('请先按 <b>Enter</b> 进入「'+MENU_PAGES[D().pageIndex].label+'」，再用 ▲ 逐段查看');
      return;
    }
    S.arrowKey('up');
    log(`上键 → ${curSegText()}`,'ok');
    toast(`数码管：<b>${curSegText()}</b>`);
  } else if(kind === 'down'){
    if(!D().menuOpen){ log('下键：尚未进入菜单，请先长按 Menu 键','warn'); toast('请先<b>长按 Menu 键</b>进入设置菜单'); return; }
    S.arrowKey('down');
    log(`下键 → 菜单项：${MENU_PAGES[D().pageIndex].label}（数码管只显示菜单项名）`,'ok');
    toast(`菜单项：<b>${MENU_PAGES[D().pageIndex].label}</b>（${D().pageIndex+1}/${MENU_PAGES.length}）｜按 Enter 进入`);
  } else if(kind === 'enter'){
    if(!D().menuOpen){ log('Enter 键：请先长按 Menu 键进入菜单','warn'); toast('请先<b>长按 Menu 键</b>进入设置菜单'); return; }
    const page = S.enterKey();
    const st = D();
    if(!st.menuOpen){ log(`Enter 键 → 退出「${page.label}」菜单`,'ok'); toast('已退出设置菜单'); }
    else {
      const vm = st.viewMode==='TEXT' ? '完整显示' : (st.enterDone ? '逐段查看（按 ▲ 翻段）' : '菜单项名');
      log(`Enter 键 → 「${page.label}」：${vm}${st.enterDone? '，数码管显示 '+currentDisplayText() : ''}`,'ok');
      toast(st.enterDone
        ? `进入 <b>${page.label}</b>｜数码管：<b>${currentDisplayText()}</b>`
        : `<b>${page.title}</b>｜${vm}`);
    }
  }
  refreshDevice(); checkProgress();
}

function menuRolling(){
  return MENU_PAGES
    .map(p=> `${p.sys==='ip'?'▶ ':''}${p.label}${p.sys==='ip'?'（Enter 进入 → A1-192）':''}`)
    .join(' │ ');
}
function doLongMenu(){
  S.menuKey('long');
  const d = D();
  log(`长按 Menu 键 → ${d.menuOpen?'进入设备设置菜单，数码管显示 IP ADD':'退出设备设置菜单'}`,'ok');
  if(d.menuOpen){
    log(`菜单项顺序（全部大写）：${menuRolling()}`,'info');
    toast('已进入设置菜单，数码管显示菜单项名 <b>IP ADD</b>｜按 <b>Enter</b> 进入本项才会显示 IP 数值（A1-192），按 <b>▼</b> 逐项切换');
  } else {
    toast('已退出设置菜单');
  }
  refreshDevice(); checkProgress();
}
function doShortMenu(){
  if(!D().menuOpen){ log('短按 Menu 键：未在菜单中，需先长按 Menu 键进入','warn'); toast('请先<b>长按 Menu 键</b>进入设置菜单'); return; }
  S.menuKey('short');
  log(`短按 Menu 键 → 切换菜单项：${MENU_PAGES[D().pageIndex].label}`,'info');
  toast(`菜单项：<b>${MENU_PAGES[D().pageIndex].label}</b>（${D().pageIndex+1}/${MENU_PAGES.length}）｜按 Enter 进入`);
  refreshDevice(); checkProgress();
}
/* 供自动化/键盘调用 */
export const api = { press: (k,o)=>devicePress(k,o), refresh: ()=>refreshDevice() };

function curSegText(){
  const t = currentDisplayText();
  if(!D().menuOpen) return D().luck ? 'LOCK' : '待机';
  return t || MENU_PAGES[D().pageIndex].title;
}
function refreshDevice(){
  const d = D();
  const page = MENU_PAGES[d.pageIndex];
  const disp = currentDisplayText();      /* 与状态机一致的“数码管上应该显示什么” */
  const segs = page.net ? String(S.pageText ? S.pageText(page) : page.text).split('.') : [];

  if(!d.menuOpen){
    /* 待机 / LOCK */
    twin.setDisplay(d.luck ? 'LOCK' : '--------');
    $('#ledLabel').textContent = d.luck ? '节目锁定 LOCK' : '待机 / 长按 Menu 键';
    $('#ledModeTag').textContent = d.luck ? 'LOCK' : 'MODE';
    $('#ledProg').textContent = d.luck ? '节目已锁定，数码管显示 LOCK'
      : '长按 Menu 键（约 0.65 秒）进入设置菜单，数码管先显示菜单项名 IP ADD';
  } else if(page.sys === 'exit'){
    twin.setDisplay('EXIT');
    $('#ledLabel').textContent = 'EXIT（退出菜单）';
    $('#ledModeTag').textContent = 'EXIT';
    $('#ledProg').textContent = '按 Enter 或长按 Menu 键退出设置菜单';
  } else if(!d.enterDone){
    /* 已进菜单但还没按 Enter：只显示菜单项名，不显示数值 */
    twin.setDisplay(page.label);
    $('#ledLabel').textContent = `${page.label} · 菜单项 ${d.pageIndex+1}/${MENU_PAGES.length}`;
    $('#ledModeTag').textContent = 'MENU';
    $('#ledProg').textContent = page.sys === 'ip'
      ? '按 Enter 键进入本项，才会显示 IP 数值（A1-192）；按 ▼ 键切下一项'
      : '按 Enter 键进入本项查看数值，按 ▼ / 短按 Menu 键切下一项';
  } else if(page.net){
    /* 已进页：逐段查看 / 完整显示 */
    if(d.viewMode === 'TEXT'){
      twin.setDisplay(currentDisplayText());
      $('#ledLabel').textContent = `${page.label} · 完整显示`;
      $('#ledModeTag').textContent = page.label;
      $('#ledProg').textContent = '完整显示 ｜ 再按 Enter 键返回逐段查看';
    } else {
      twin.setDisplay(disp);
      $('#ledLabel').textContent = `${page.label} · 第 ${d.segment+1}/${segs.length} 段`;
      $('#ledModeTag').textContent = page.label;
      $('#ledProg').textContent = page.sys === 'ip'
        ? '按 ▲ 键逐段翻页：A1-192 → A1-168 → A1-001 → A1-150（每屏 3 位）'
        : `按 ▲ 键逐段翻页（每屏 ${page.digits} 位），按 ▼ 键退出本项`;
    }
  } else {
    twin.setDisplay(disp);
    $('#ledLabel').textContent = page.label;
    $('#ledModeTag').textContent = page.label;
    $('#ledProg').textContent = '按 Enter 键切换“完整 / 逐段”，按 ▼ 键切到下一项';
  }
  /* 菜单项滚动条 */
  $('#ledDigits').innerHTML = ledTextHTML();
  /* LOCK 指示 */
  ['1','2','3'].forEach(i=>{
    const m = st.modules[+i-1];
    const dot = $('#lockDot'+i), txt = $('#lockTxt'+i);
    dot.className = 'lockdot' + (m.locked?' green':(m.playing?' amber':''));
    txt.textContent = `解码模块${i} · ${m.locked ? ((m.current?m.current.name:'') + ' 已锁定'+((st.saved?.program?.module===+i)?' · 已保存':'')) : '未锁定'}`;
  });
  $('#lockProg').textContent = st.modules.some(m=>m.locked)
    ? (st.saved?.program ? `已锁定并保存：${st.saved.program.name}，音频经卡侬线送至 200W 发射机` : 'LOCK 灯转绿，音频已送至发射机')
    : '选中节目名称即锁定并保存，数码管显示 LOCK，后台指示灯转绿';
}

/* 数码管 DOM 版：8 位窗口，左侧 N 位点亮，其余显示暗段
   与 Three.js 里的实体数码管保持同一套显示逻辑：
   未按 Enter → 只显示菜单项名；按 Enter 后 → 显示 A1-192 这样的段值 */
const LED_OFF = '<span class="seg-off">8</span>';
function ledTextHTML(){
  const d = D();
  const win = (txt, cols=8)=>{
    const t = String(txt||'');
    const body = [...t].map(c => c===' ' ? LED_OFF : c).join('');
    const rest = Math.max(0, cols - [...t].length);
    return body + LED_OFF.repeat(rest);
  };
  if(!d.menuOpen) return d.luck ? win('LOCK') : win('');
  const page = MENU_PAGES[d.pageIndex];
  const disp = currentDisplayText();
  if(page.sys === 'exit') return win('EXIT');
  if(!d.enterDone) return win(page.label);          /* 只显示菜单项名 */
  if(page.net){
    if(d.viewMode === 'TEXT') return win(String(disp));
    return win(disp);                               /* A1-192 */
  }
  return win(String(disp));
}

S.on('device', refreshDevice);
[1,2,3].forEach(i=> S.on('module:'+i, ()=>{ refreshOutStrip(); }));
S.on('change:device.luck', refreshDevice);
S.on('reset', ()=>{ refreshDevice(); refreshLamps(); });
[1,2,3].forEach(i=> S.on('module:'+i, ()=>{ if(i===1) refreshDevice(); }));

function refreshLamps(){
  const m1 = st.modules[0];
  $('#lockDot1').className = 'lockdot' + (m1.locked?' green':'');
  twin.setLed('work', true);
}

/* ============================================================
   3) 模拟浏览器
   ============================================================ */
const frame = $('#screenFrame');
const hist = { list:['about:blank'], idx:0 };
function nav(url, push=true){
  if(push){ hist.list = hist.list.slice(0, hist.idx+1); hist.list.push(url); hist.idx = hist.list.length-1; }
  frame.src = url;
  /* 子页面加载后同步当前网络与组播状态 */
  frame.onload = ()=>{ syncSub(); };
  setTimeout(syncSub, 60);
  $('#urlText').textContent = url === 'about:blank' ? 'about:blank' : url;
  $('#addrLock').textContent = url.startsWith('http://192.168.1.150') ? '🔒' : '🔓';
  st.session.page = url;
}
$('#navBack').onclick = ()=>{ if(hist.idx>0){ hist.idx--; nav(hist.list[hist.idx], false); } };
$('#navFwd').onclick  = ()=>{ if(hist.idx<hist.list.length-1){ hist.idx++; nav(hist.list[hist.idx], false); } };
$('#navReload').onclick = ()=>{ frame.src = frame.src; };

/* 支持在地址栏上双击编辑 */
$('#urlBox').ondblclick = ()=>{
  const cur = $('#urlText').textContent;
  const v = prompt('请输入网址（设备 IP）', cur.startsWith('http')? cur : 'http://'+cur);
  if(v) gotoDevice(v);
};
function gotoDevice(raw){
  let url = String(raw).trim().replace(/^https?:\/\//,'').replace(/\/+$/,'');
  const ip = url.split('/')[0].split(':')[0];
  const check = S.ipToInt(ip);
  if(check === null){ toast('❌ IP 格式不正确：<b>'+ip+'</b>'); log(`地址栏输入非法 IP：${ip}`,'err'); return false; }
  if(st.pc.ip === ''){ toast('⚠ 还没有为本机配置 IP，请先在左下角完成网络配置'); log('本机未配置 IP，无法发起访问','warn'); return false; }
  if(!st.net.reachable){ 
    toast('❌ 无法访问 <b>'+ip+'</b>：本机 '+st.pc.ip+' 与设备不在同一网段');
    log(`访问失败：${st.pc.ip}/${st.pc.mask} 与 ${ip} 不同网段，请求超时`,'err');
    logWebFail(ip);
    return false;
  }
  if(ip !== st.device.ip){
    toast(`❌ 该地址无响应：设备实际管理 IP 为 <b>${st.device.ip}</b>`);
    log(`访问失败：${ip} 无响应，设备 IP 实为 ${st.device.ip}`,'err');
    return false;
  }
  if(st.session.loggedIn){ nav(`pages/ad1200.html?host=${ip}`); log(`已登录，直接打开后台：http://${ip}`,'ok'); }
  else { nav(`pages/login.html?host=${ip}`); log(`打开设备登录页：http://${ip}/`,'ok'); toast('请输入账号 <b>dtv</b> / 密码 <b>123</b>'); }
  return true;
}
/* 模拟“无法访问”的浏览器错误页 */
function logWebFail(ip){
  frame.src = 'about:blank';
  const doc = frame.contentDocument;
  if(doc){
    doc.open(); doc.write(`<!DOCTYPE html><meta charset="utf-8"><body style="font:14px Arial;padding:40px;color:#333;background:#fff">
      <h2 style="color:#c62828">无法访问此网站</h2>
      <p>无法访问 <b>http://${ip}</b>，请检查网络连接并确认本机与设备处于同一网段。</p>
      <p style="color:#888;font-size:12px">ERR_ADDRESS_UNREACHABLE</p></body>`); doc.close();
  }
  $('#urlText').textContent = `http://${ip}`;
}
window.__gotoDevice = gotoDevice;

/* 把宿主状态推给子页面（后台回读设备自身参数） */
function syncSub(){
  const mc = st.net2.valid ? {group:st.net2.group, port:st.net2.port} : null;
  try{ frame.contentWindow.postMessage({type:'host-sync', multicast:mc,
    deviceNet:{ip:st.device.ip, mask:st.device.mask, gw:st.device.gateway},
    savedProgram: st.saved && st.saved.program ? st.saved.program : null}, '*'); }catch(e){}
}

/* ============================================================
   3.45) 模拟浏览器屏幕：真·视口 + 可滚动
   原厂后台按 1600×900 排版。这里把 iframe 直接按【可用窗口尺寸】铺满，
   页面自己出滚动条 —— 与真实浏览器一致：
     · 窗口宽 → 后台横向排开，不用放大也不会被裁
     · 窗口窄 → 出横向滚动条，拖一下就能看到右边，绝不会"显示不全又动不了"
   iframe 内部始终按 1600×900 的 CSS 视口渲染，用 transform 等比缩放，
   这样后台排版与实机一致，同时缩放比随窗口实时变化。
   ============================================================ */
_screenWrap = $('#screenWrap'); _screenBox = $('#screenBox');
function fitScreen(){
  const screenWrap = _screenWrap || ($('#screenWrap'));
  const screenBox  = _screenBox  || ($('#screenBox'));
  if(!screenWrap || !screenBox) return;
  const w = screenWrap.clientWidth, h = screenWrap.clientHeight;
  if(!w || !h) return;
  /* 让 iframe 填满可用区域（真视口行为），最小不低于设计尺寸的 46%，
     再小就交给外层滚动条，保证任何窗口尺寸都能看到完整内容 */
  const k = Math.max(0.46, Math.min(1.35, Math.min(w/SCREEN_BASE.w, h/SCREEN_BASE.h)));
  screenBox.style.transform = `scale(${k.toFixed(4)})`;
  const el = $('#screenScaleVal'); if(el) el.textContent = Math.round(k*100) + '%';
  /* 缩放后若仍超出可视区 → 外层出滚动条（真浏览器就是这样） */
  const overW = SCREEN_BASE.w*k - w > 2, overH = SCREEN_BASE.h*k - h > 2;
  screenWrap.style.overflow = (overW || overH) ? 'auto' : 'hidden';
  screenBox.style.margin = (overW || overH) ? '0' : 'auto';
}
addEventListener('resize', ()=>setTimeout(fitScreen, 0));
document.addEventListener('fullscreenchange', ()=>setTimeout(fitScreen, 60));
if(window.ResizeObserver && _screenWrap) new ResizeObserver(()=>fitScreen()).observe(screenWrap);
if(window.ResizeObserver && _screenBox) new ResizeObserver(()=>fitScreen()).observe(screenBox);
fitScreen();

/* ============================================================
   3.5) 模拟浏览器窗口：最大化 / 拖动 / 缩放
   ============================================================ */
const pcShell = $('#pcShell'), pcBar = $('#pcBar'), pcGrip = $('#pcGrip');
const clamp = (v,a,b)=>Math.max(a, Math.min(b, v));
const PC_HOME = { l: pcShell.offsetLeft, t: pcShell.offsetTop, w: pcShell.offsetWidth, h: pcShell.offsetHeight };
const PC_MIN  = { w: 430, h: 320 };
/* 拖拽缩放的几何上限（实际最大值在 pcMaxGeom() 里按左栏可用空间动态算） */
const PC_MAX  = { w: 1580, h: 838 };
let pcRect = null;                 /* null = 停靠在左栏；否则为浮动窗口的几何 */
function stageScale(){ const r = $('#stage').getBoundingClientRect(); return (r.width||1600)/1600 || 1; }
function applyPcRect(){
  if(!pcRect){
    pcShell.classList.remove('floating','max');
    $('#leftCol').classList.remove('pc-float');
    pcShell.style.left = pcShell.style.top = pcShell.style.width = pcShell.style.height = '';
    return;
  }
  pcShell.classList.add('floating');
  $('#leftCol').classList.add('pc-float');   /* 让 dock 保持贴底，不被浮动窗口顶上去 */
  pcShell.style.left = pcRect.l+'px'; pcShell.style.top = pcRect.t+'px';
  pcShell.style.width = pcRect.w+'px'; pcShell.style.height = pcRect.h+'px';
}
/* 计算“最大化”几何：
   以停靠态（PC_HOME）的窗口位置/尺寸为基准向右、向下扩展，
   右边界 = 左栏右缘，下边界 = 左栏底部“本机网络配置”面板上方。
   这样「应用配置 / 测试连通性 / 放大浏览器」这排按钮永远露在外面可点。 */
function pcMaxGeom(){
  const lc = $('#leftCol');
  const dock = $('#dock');
  const padR = 8, padB = 8;
  const dockH = dock ? dock.offsetHeight : 212;
  const rightEdge  = lc.offsetWidth - padR;                       /* 左栏可用右边界 */
  const bottomEdge = lc.offsetHeight - dockH - padB - 6;          /* 网络面板上沿 */
  const l = PC_HOME.l;
  const t = Math.max(2, PC_HOME.t - 2);
  return {
    l, t,
    w: Math.max(PC_MIN.w, rightEdge - l),
    h: Math.max(PC_MIN.h, bottomEdge - t),
  };
}
function pcMaximize(){
  const geom = pcMaxGeom();
  if(pcRect && pcRect.w >= geom.w - 2){ pcRestore(); return; }
  pcRect = geom;
  applyPcRect(); pcShell.classList.add('max'); setTimeout(fitScreen, 40);
  if(window.__syncMaxBrowserBtn) window.__syncMaxBrowserBtn();
  log('模拟浏览器窗口已最大化（拖标题栏移动，拖右下角缩放，点 ⇲ 还原）','info');
  toast('模拟浏览器已<b>最大化</b>｜拖标题栏移动 · 拖右下角缩放 · 点 <b>⇲</b> 还原');
}
function pcRestore(){
  pcRect = null; applyPcRect(); setTimeout(fitScreen, 40);
  if(window.__syncMaxBrowserBtn) window.__syncMaxBrowserBtn();
  toast('模拟浏览器已还原到左侧栏');
}
function pcDrag(el, e, mode){
  if(!pcRect) pcRect = { ...PC_HOME };
  pcShell.classList.remove('max');
  applyPcRect();
  const k = stageScale() || 1;
  const s = { x:e.clientX, y:e.clientY, ...pcRect };
  const move = (ev)=>{
    const dx = (ev.clientX - s.x)/k, dy = (ev.clientY - s.y)/k;
    if(mode !== 'move') setTimeout(fitScreen, 0);
    if(mode === 'move'){
      pcRect.l = clamp(s.l + dx, -s.w + 220, 1580 - 40);
      pcRect.t = clamp(s.t + dy, 0, 848 - 40);
    } else {
      pcRect.w = clamp(s.w + dx, PC_MIN.w, PC_MAX.w);
      pcRect.h = clamp(s.h + dy, PC_MIN.h, PC_MAX.h);
    }
    applyPcRect();
  };
  const up = ()=>{ el.removeEventListener('pointermove', move); };
  try{ el.setPointerCapture(e.pointerId); }catch(_){}
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up, {once:true});
  el.addEventListener('pointercancel', up, {once:true});
}
pcBar.addEventListener('pointerdown', (e)=>{
  if(e.target.closest('.pcbtn')) return;
  if(e.detail === 2){ pcMaximize(); return; }   /* 双击标题栏 = 最大化/还原 */
  pcDrag(pcBar, e, 'move');
});
pcGrip.addEventListener('pointerdown', (e)=>{ e.stopPropagation(); pcDrag(pcGrip, e, 'resize'); });
$('#pcMax').onclick = pcMaximize;
$('#pcDock').onclick = pcRestore;
window.__pcMax = pcMaximize;
window.__pcRestore = pcRestore;

/* ============================================================
   4) 本机网络配置
   ============================================================ */
const pcIp = $('#pcIp'), pcMask = $('#pcMask'), pcGw = $('#pcGw');
/* 顶部“链路状态”徽标：未配好=红灯，同网段=黄灯，ping 通=绿灯（可点） */
function refreshLinkBadge(state){
  const el = $('#pcLockBadge'); if(!el) return;
  el.className = 'pcLockBadge' + (state==='link' ? ' ok' : (state==='net' ? ' warn' : ''));
  el.textContent = state==='link' ? '● 已连通 · 连接绿色'
                 : state==='net'  ? '● 同网段 · 待测试'
                 : '● 本机未在同网段';
  el.title = state==='link' ? '已 ping 通设备，可以去浏览器访问了'
            : state==='net' ? '与设备同网段，点左侧“测试连通性”验证'
            : '请先给本机配置与设备同网段的 IP';
}
function refreshNetHint(){
  const ip = pcIp.value.trim(), mask = pcMask.value.trim();
  const el = $('#netHint');
  pcIp.classList.remove('bad','good'); pcMask.classList.remove('bad','good');
  if(!ip && !mask){ el.className='hint'; el.innerHTML='请配置与设备同网段的 IP 地址。设备 IP 从实机数码管读取：长按 <b>Menu</b> 键。'; return; }
  if(S.ipToInt(ip) === null){ el.className='hint warn'; el.innerHTML='⚠ IP 格式不正确，应形如 <code>192.168.1.50</code>'; pcIp.classList.add('bad'); return; }
  if(S.maskToInt(mask) === null){ el.className='hint warn'; el.innerHTML='⚠ 子网掩码格式不正确，应形如 <code>255.255.255.0</code>'; pcMask.classList.add('bad'); return; }
  if(ip === st.device.ip){ el.className='hint warn'; el.innerHTML=`⚠ <code>${ip}</code> 已被设备占用，请换一个地址（如 192.168.1.50）`; pcIp.classList.add('bad'); return; }
  const r = S.canReach(ip, mask, st.device.ip);
  if(r.ok){
    el.className='hint ok';
    el.innerHTML = `✓ 与设备 ${st.device.ip} 同网段，可直接通信。<br>${mask==='255.255.0.0'?'（掩码放宽到 /16，设备侧网段也能覆盖本机）':'（/24 网段直连，无需网关）'}`;
    pcIp.classList.add('good'); pcMask.classList.add('good');
  } else {
    el.className='hint warn';
    el.innerHTML = `⚠ 与设备 ${st.device.ip} 不在同一网段，浏览器会超时。<br>建议：IP 改 <code>192.168.1.x</code> + 掩码 <code>255.255.255.0</code>，或掩码放宽为 <code>255.255.0.0</code>。`;
    pcIp.classList.add('bad'); pcMask.classList.add('bad');
  }
}
[pcIp,pcMask,pcGw].forEach(el=>el.addEventListener('input', refreshNetHint));

$('#btnApplyNet').onclick = ()=>{
  const ip = pcIp.value.trim(), mask = pcMask.value.trim(), gw = pcGw.value.trim();
  if(S.ipToInt(ip)===null){ toast('❌ 请填写正确的 IP 地址'); return; }
  if(S.maskToInt(mask)===null){ toast('❌ 请填写正确的子网掩码'); return; }
  if(ip === st.device.ip){ toast('❌ 该 IP 已被设备占用'); return; }
  st.pc = { ip, mask, gw };
  const r = S.canReach(ip, mask, st.device.ip);
  st.net.sameSubnet = r.ok; st.net.reachable = false;
  st.net.reason = r.msg;
  refreshNetHint();
  refreshLinkBadge(r.ok ? 'net' : 'none');
  twin.setLinkState && twin.setLinkState(r.ok ? 'ready' : 'idle');
  if(r.ok){ log(`本机网络已应用：${ip} / ${mask}（${r.msg}）`,'ok'); toast('✓ 本机 IP 已应用：<b>'+ip+'</b>'); }
  else { log(`本机网络已应用：${ip} / ${mask} — ${r.msg}`,'warn'); toast('⚠ 已应用，但仍与设备不同网段：'+r.msg); }
  checkProgress();
};

$('#btnPing').onclick = ()=>{
  if(!st.pc.ip){ toast('请先配置并应用本机 IP'); return; }
  const r = S.canReach(st.pc.ip, st.pc.mask, st.device.ip);
  const btn = $('#btnPing');
  btn.classList.remove('on','bad');
  if(!r.ok){
    st.net.reachable = false;
    refreshLinkBadge('none');
    btn.classList.add('bad');
    toast('❌ ping '+st.device.ip+' 不通：'+r.msg);
    log(`ping ${st.device.ip} → 请求超时（${r.msg}）`,'err');
    setTimeout(()=>btn.classList.remove('bad'), 1200);
    return;
  }
  /* 测试中：按钮进入“测试中…”态，与实机看指示灯一样有过程感 */
  btn.textContent = '测试中…';
  refreshLinkBadge('net');
  toast('正在 ping '+st.device.ip+' …');
  log(`ping ${st.device.ip} …`,'info');
  setTimeout(()=>{
    st.net.reachable = true;
    btn.textContent = '测试连通性';
    /* ===== 连通成功：链路状态转绿（“连接绿色”）===== */
    btn.classList.add('on');
    refreshLinkBadge('link');
    toast('✓ 已连通 <b>'+st.device.ip+'</b>｜<b style="color:#6ee7b7">连接绿色</b>，可以去浏览器访问了');
    log(`来自 ${st.device.ip} 的回复: 字节=32 时间<1ms TTL=64（4/4 通）`,'ok');
    log('链路状态：IP 已应用 → 同网段 → ping 通，链路指示灯转绿','ok');
    /* 孪生侧：网口/网线同步点亮，体现“网线连接”真的通了 */
    twin.setLinkState && twin.setLinkState('online');
    if(!st.session.loggedIn && !hist.list.some(u=>u.includes('login')))
      nav(`pages/login.html?host=${st.device.ip}`);
    checkProgress();
  }, 620);
};
$('#pcLockBadge').onclick = ()=>{ if(!st.net.reachable) $('#btnPing').click(); };
/* 「放大浏览器」：在“测试连通性”旁边，一键把模拟浏览器放大 / 还原 */
$('#btnMaxBrowser').onclick = ()=>{
  pcMaximize();
  syncMaxBrowserBtn();
};
/* 按钮文案跟随窗口是否处于最大化态 */
function syncMaxBrowserBtn(){
  const btn = $('#btnMaxBrowser'); if(!btn) return;
  const max = !!(pcRect && pcRect.w >= pcMaxGeom().w - 2);
  btn.textContent = max ? '⤡ 还原浏览器' : '⤢ 放大浏览器';
  btn.classList.toggle('on', max);
}
window.__syncMaxBrowserBtn = syncMaxBrowserBtn;

/* ============================================================
   5) 子页面消息桥
   ============================================================ */
addEventListener('message', (e)=>{
  const d = e.data||{};
  switch(d.type){
    case 'pdu-login-ok':
      st.session.loggedIn = true; st.session.user = d.user;
      log(`登录成功：用户 ${d.user}`,'ok');
      toast('✓ 登录成功，正在加载后台…');
      setTimeout(()=>nav(`pages/ad1200.html?host=${st.device.ip}`), 500);
      checkProgress();
      break;
    case 'pdu-login-fail':
      log(`登录失败：用户名或密码错误（输入 ${d.user||'空'}）`,'err');
      break;
    case 'pdu-logout':
      st.session.loggedIn = false;
      log('已注销，返回登录页','info');
      nav(`pages/login.html?host=${st.device.ip}`);
      break;
    case 'pdu-log':
      (d.rows||[]).forEach(r=>log(`[后台] ${r.m}`, r.kind==='err'?'err':'ok'));
      break;
    case 'pdu-nav':
      if(d.go && d.go.startsWith('decoder')) log(`切换后台页面：解码模块${d.go.slice(-1)}设置`,'info');
      break;
    case 'pdu-view':
      if(d.view === 'device') log('进入后台页面：设备参数 / 组播设置','info');
      checkProgress();
      break;
    case 'pdu-net-saved': break;
    /* 后台点中某路频道 = 立即锁定 + 保存（掉电不丢），并同步给实机与教学进度 */
    case 'pdu-save-program': {
      const sv = SERVICES.find(x=>x.sid===d.sid) || {sid:d.sid, name:d.name, pcr:d.pcr, audio:d.audio, freq:d.freq};
      S.saveProgram(d.module, sv);
      st.modules[d.module-1].current = sv;
      st.modules[d.module-1].searched = true;
      if(!st.modules[d.module-1].programList.length) st.modules[d.module-1].programList = SERVICES.map(x=>({...x}));
      log(`后台「解码模块${d.module}」：点击频道 [${d.sid}] ${d.name} → 已自动保存并锁定该频道`,'ok');
      break;
    }
    case 'pdu-mcast-ok': {
      st.net2 = { group:d.group, port:d.port, valid:true, msg:'组播参数已生效' };
      /* 组播源地址不单独设置：默认跟随组播地址（源过滤使能保持 ON） */
      st.saved.group = d.group; st.saved.port = d.port;
      st.saved.src = d.group; st.saved.srcEnable = 'ON'; st.saved.mcastSaved = true;
      st.modules.forEach(m=>{ if(m.id===1) m.input='IP'; });
      log(`组播设置已生效：${d.group}:${d.port}（组播源地址自动=组播地址），已通知全部解码模块加入组播组`,'ok');
      toast('✓ 组播参数已生效：<b>'+d.group+':'+d.port+'</b>｜源地址默认 = 组播地址');
      twin.setLed('work', true);
      refreshDevice(); checkProgress();
      break;
    }
    case 'pdu-mcast-fail':
      log(`组播参数被拒绝（${d.reason==='group'?'组播地址非法':'端口非法'}）`,'err');
      break;
    case 'pdu-search-start': {
      const gate = S.canSearch();
      if(!gate.ok){
        log(`解码模块${d.module}：搜索中止 —— ${gate.msg}`,'err');
        toast('❌ 搜不到节目：<b>'+gate.msg+'</b>');
      } else {
        log(`解码模块${d.module}：开始搜索节目源（PAT/PMT/SDT），组播 ${st.net2.group}:${st.net2.port}`,'info');
      }
      break;
    }
    case 'pdu-search-blocked': {
      log(`解码模块${d.module}：搜索中止 —— 尚未设置组播地址/端口（设备无法加入组播组）`,'err');
      toast('❌ 搜不到节目：<b>请先到「设备参数 → 组播设置」填写组播地址与端口并确认</b>');
      break;
    }
    case 'pdu-search-done':
      log(`解码模块${d.module}：搜索完成，共 ${d.count} 个节目：${SERVICES.map(s=>s.name).join('、')}`,'ok');
      break;
    case 'pdu-pick': {
      log(`解码模块${d.module}：选择节目 [${d.sid}] ${d.name}${d.freq?'（'+d.freq+'）':''}（PCR PID ${d.pcr}，Audio PID ${d.audio}）`,'ok');
      log(`只要选中节目名称，设备即锁定该节目并把选择写入保存（掉电不丢）`,'info');
      st.standalonePlay = { module:d.module, sid:d.sid, name:d.name };
      const mod = st.modules[d.module-1];
      const sv = SERVICES.find(s=>s.sid===d.sid);
      mod.current = sv; mod.pcr=String(d.pcr); mod.audio=String(d.audio);
      mod.searching=false; mod.searched=true;
      mod.programList = SERVICES.map(x=>({...x}));
      /* 立即落盘保存：选了就锁定 + 保存 */
      S.saveProgram(d.module, sv || {sid:d.sid, name:d.name, pcr:d.pcr, audio:d.audio, freq:d.freq});
      S.emit('module:'+d.module, mod);
      audio.play(d.sid, d.name, 'online');
      audio.setVolume(st.modules[d.module-1].volume);
      twin.selectChannel(twin.channelOut || 'M1L');
      refreshOutStrip();
      break;
    }
    case 'pdu-locked': {
      const m = st.modules[d.module-1];
      m.locked = true; m.playing = true; m.saved = true;
      if(d.module===1) st.device.luck = true;
      const chans = OUT_CHANNELS.filter(c=>c.board===d.module);
      const target = twin.channelOut && chans.some(c=>c.ch===twin.channelOut) ? twin.channelOut : (chans[0]||{}).ch;
      if(target){ twin.selectChannel(target); twin.setChannelState(target, 'lock'); }
      if(st.standalonePlay) st.standalonePlay = null;
      S.emit('module:'+d.module, m);
      refreshOutStrip();
      twin.setLed('work', true); twin.setLed('power', true, 0x39d98a);
      log(`解码模块${d.module}：节目锁定 LOCK，数码管显示 LOCK，选择已保存`,'ok');
      log('解码模块1 音频经 2 根卡侬线送入下方 200W 发射机（250W 功放 L/R 输入）','ok');
      toast('✓ <b>'+d.name+'</b> 已锁定并保存，实机 LOCK 指示转绿');
      refreshDevice(); checkProgress();
      break;
    }
    case 'pdu-volume': {
      st.modules[d.module-1].volume = d.volume;
      audio.setVolume(d.volume);
      break;
    }
    case 'npc-ping': break;
  }
});

/* ============================================================
   6) 音频
   ============================================================ */
const audio = new AudioSim();
/* 音频模式反馈：本机 30s 真实语音 / 离线合成音 */
let audioModeText = '音频输出：待播放（选择节目后播放对应的 30s 语音）';
let audioModeCls = 'audiomode';
let outChannelText = '';
/* 输出通道不再用卡片面板，统一在这一行里体现 */
function renderAudioMode(){
  const box = $('#audioMode'); if(!box) return;
  box.className = audioModeCls;
  box.innerHTML = audioModeText + (outChannelText ? ' ｜ 输出通道：<b>'+outChannelText+'</b>' : '');
}
audio.onState = (mode, label)=>{
  audioModeCls = 'audiomode ' + (mode==='online' ? 'online' : 'synth');
  audioModeText = (mode==='online' ? '🔊 30s 真实语音' : '🎹 离线合成音') + ' · ' + label;
  renderAudioMode();
  log(`音频输出：${label}`,'ok');
};
S.on('module:1', ()=>{});
/* 用户在页面上首次交互后解锁 AudioContext */
addEventListener('pointerdown', function once(){ audio.ensure(); removeEventListener('pointerdown', once); }, {once:true});

/* ============================================================
   7) 教学进度
   ============================================================ */
const done = new Set();
function mark(k){ if(!done.has(k)){ done.add(k); log('✔ 教学检查项达成：'+checkText(k), 'ok'); renderChecks(); } }
function checkText(k){
  for(const s of STEPS) for(const c of s.checks||[]) if(c.k===k) return c.t;
  return k;
}
function currentStep(){
  for(let i=0;i<STEPS.length;i++){
    const s = STEPS[i];
    if((s.checks||[]).some(c=>!done.has(c.k))) return i;
  }
  return STEPS.length-1;
}
function renderStepbar(active){
  $('#stepbar').innerHTML = STEPS.map((s,i)=>{
    const cls = i<active? 'done' : (i===active? 'active':'');
    return `<div class="step ${cls}" data-i="${i}"><span class="n">${i<active?'✓':i+1}</span>${s.short}</div>`;
  }).join('');
  $$('#stepbar .step').forEach(el=>el.onclick = ()=>{
    const i = +el.dataset.i; showStep(i, true);
  });
}
function showStep(i, manual){
  const s = STEPS[i];
  $('#stepTitle').textContent = s.title;
  $('#stepBody').innerHTML = s.html;
  $('#taskTag').textContent = `${i+1}/${STEPS.length}`;
  renderChecks();
  if(manual) log(`查看教学步骤 ${i+1}：${s.short}`,'info');
}
function renderChecks(){
  const s = STEPS[STEPS.findIndex(x=>x.id===STEPS[currentStep()]?.id)] || STEPS[0];
  const list = STEPS.flatMap(x=>x.checks||[]);
  $('#checkList').innerHTML = list.map(c=>{
    const ok = done.has(c.k);
    return `<div class="chk ${ok?'ok':''}"><span class="ic">${ok?'✓':''}</span><span>${c.t}</span></div>`;
  }).join('');
}
function checkProgress(){
  /* --- 各检查项判定 --- */
  if(D().menuOpen) mark('menu-opened');
  if(D().menuOpen && MENU_PAGES[D().pageIndex].sys==='ip' && D().enterDone && D().segment>=3) mark('ip-read');
  if(st.pc.ip && S.ipToInt(st.pc.ip)!==null && S.canReach(st.pc.ip, st.pc.mask, st.device.ip).ok) mark('pc-ip');
  if(st.net.reachable) mark('pc-reachable');
  if(st.session.page.includes('login') || st.session.page.includes('ad1200')) mark('navigated');
  if(st.session.loggedIn) mark('logged-in');
  if(st.net2.valid) mark('mcast-ok');
  if(st.modules[0].searched && st.modules[0].programList.length>=6) mark('searched');
  if(st.modules[0].programList.length>=6) mark('found-6');
  if(st.modules.some(m=>m.playing)) mark('picked');
  if(st.modules.some(m=>m.locked)) mark('locked');
  if(done.size >= STEPS.flatMap(s=>s.checks||[]).length) mark('done');
  /* --- 渲染 --- */
  const cur = currentStep();
  renderStepbar(cur);
  showStep(cur);
  refreshDevice();
}

/* 步骤内自动动作（如自动跳转后台相关页） */
S.on('change:net2.valid', ()=>{ if(st.net2.valid) log('后台已保存组播设置，可以进入解码模块1设置点搜索了','info'); });

/* ============================================================
   8) 顶栏按钮 / 视图按钮 / 快捷键
   ============================================================ */
$('#btnGuide').onclick = ()=>{
  const i = currentStep();
  showStep(i, true);
  toast(`当前任务：<b>${STEPS[i].short}</b> — 请看左下角教学引导`);
};
/* 操作引导 · AI 提问（演示版）：后台页里的 AI 面板也在这里给个入口 */
$('#btnAi').onclick = ()=>{
  /* 确保后台页已打开：没登录就先走一遍登录页流程 */
  if(!st.session.loggedIn){ toast('请先登录后台（dtv / 123）再来提问'); return; }
  if(!st.session.page.includes('ad1200')){ nav(`pages/ad1200.html?host=${st.device.ip}`); }
  setTimeout(()=>{
    try{ frame.contentWindow.postMessage({type:'host-ai-open'}, '*'); }catch(e){}
  }, 260);
  toast('已打开后台右下角的 <b>AI 提问</b>（演示版回复）');
  log('打开操作引导 · AI 提问（演示版，未接入真实大模型）','info');
};
$('#btnAutoFill').onclick = ()=>{
  pcIp.value = '192.168.1.50'; pcMask.value='255.255.255.0'; pcGw.value='192.168.1.1';
  $('#btnApplyNet').click();
  setTimeout(()=>$('#btnPing').click(), 200);
  log('一键正确配置：本机 192.168.1.50/24，开始 ping 设备','info');
};
$('#btnReset').onclick = ()=>{
  S.resetAll(); done.clear();
  audio.stop();
  pcIp.value=''; pcMask.value=''; pcGw.value='';
  refreshNetHint();
  refreshLinkBadge('none');
  $('#btnPing').textContent = '测试连通性';
  $('#btnPing').classList.remove('on','bad');
  twin.setLinkState && twin.setLinkState('idle');
  hist.list=['about:blank']; hist.idx=0; nav('about:blank');
  $('#loglist').innerHTML = '';
  twin.setDisplay('--------'); twin.setLed('power', true, 0x39d98a);
  twin.resetChannels(); refreshOutStrip();
  outChannelText = ''; audioModeText = '音频输出：待播放（选择节目后自动播放真实试听音频）';
  audioModeCls = 'audiomode'; renderAudioMode();
  log('实验已重置，可重新开始（后台页面按原厂 1:1 还原，底部消息栏已去除）','info');
  checkProgress();
  toast('实验已重置');
};
/* ---- 演示视图：全屏 / 放大界面 / 恢复 ---- */
function toggleFullscreen(){
  const el = document.documentElement;
  if(!document.fullscreenElement){
    (el.requestFullscreen ? el.requestFullscreen() : Promise.reject())
      .then(()=>{ log('已进入全屏演示模式（可按 Esc 退出）','ok'); toast('已进入全屏演示模式，按 <b>Esc</b> 退出'); })
      .catch(()=>toast('当前浏览器不允许脚本全屏，请按 <b>F11</b> 最大化窗口'));
  } else {
    document.exitFullscreen?.().catch(()=>{});
    log('已退出全屏演示模式','info');
  }
  setTimeout(fitStage, 120);
}
/* ---- 界面缩放：自动适配 + 手动微调（拖动窗口实时跟随，元素不会被裁掉） ---- */
function applyZoom(){
  const stg = $('#stage'); if(!stg) return;
  const { w, h } = vitals();
  const B = VIEW.baseH / VIEW.baseW;                    /* 基准宽高比 0.5625 = 16:9 */
  const wh = h / w;
  /* 比例接近 16:9 → 取较小系数铺满（不留黑边）；
     其它比例 → 一律按【宽度】铺满：先保证左右两栏都在画面里，
     纵向不足时整页可上下滚动，纵向富余时居中留边。
     这样任何窗口/投影比例下都不会"看不到左边"。 */
  const k = Math.abs(wh - B) < 0.02
    ? Math.min(w/VIEW.baseW, h/VIEW.baseH)
    : w / VIEW.baseW;
  VIEW.scaleNum = k;
  const sc = k * zoomLevel;
  stg.style.transform = `scale(${sc.toFixed(5)})`;
  /* 缩放后实际占用尺寸：比可视区大就允许滚动，绝不被 overflow:hidden 吃掉 */
  const needW = VIEW.baseW * sc, needH = VIEW.baseH * sc;
  const narrow = needH - h > 2;
  document.body.classList.toggle('narrow', narrow);
  stg.style.marginTop = narrow ? '0' : `${Math.max(0,(h-needH)/2)}px`;
  const el = $('#zoomVal'); if(el) el.textContent = Math.round(k*zoomLevel*100) + '%';
}
function zoomInterface(k){
  zoomLevel = Math.max(0.7, Math.min(1.6, k));
  applyZoom();
  toast(`界面缩放 <b>${Math.round(VIEW.scaleNum*zoomLevel*100)}%</b>`);
}
window.__fitStage = fitStage;
$('#btnFull').onclick = toggleFullscreen;
$('#btnZoomIn').onclick  = ()=>zoomInterface(zoomLevel + 0.1);
$('#btnZoomOut').onclick = ()=>zoomInterface(zoomLevel - 0.1);
$('#btnZoomReset').onclick = ()=>{ zoomLevel = 1; fitStage(); toast('界面缩放已复位为自动适配'); };
addEventListener('keydown', (e)=>{ if(e.key === 'F11'){ e.preventDefault(); toggleFullscreen(); } });

$('#viewFront').onclick = ()=>twin.viewFront();
$('#viewBack').onclick  = ()=>twin.viewBack();
$('#viewDisp').onclick  = ()=>{ twin.viewDisplay(); toast('已聚焦<b>数码管</b>｜长按 Menu 键可进菜单读 IP'); };
$('#viewZoomIn').onclick  = ()=>twin.zoomBy(0.78);
$('#viewZoomOut').onclick = ()=>twin.zoomBy(1.28);
$('#viewMax').onclick   = (e)=>{
  const wrap = $('#threeWrap');
  const on = !wrap.classList.contains('zoomed');
  wrap.classList.toggle('zoomed', on);
  e.currentTarget.classList.toggle('on', on);
  e.currentTarget.textContent = on ? '⤡ 还原' : '⤢ 放大';
  setTimeout(()=>{ twin.resize(); twin.fitView(); }, 60);
  toast(on ? '3D 仿真窗口已<b>放大</b>（再点一次还原）' : '3D 仿真窗口已还原');
};
$('#viewSpin').onclick  = (e)=>{
  const on = !twin.spin; twin.setSpin(on);
  e.currentTarget.classList.toggle('on', on);
  toast(on? '已开启自动旋转' : '已停止自动旋转');
};

/* 键盘快捷键：模拟实机按键 */
addEventListener('keydown', (e)=>{
  if(e.target.tagName==='INPUT') return;
  const map = {ArrowUp:'up', ArrowDown:'down', Enter:'enter'};
  if(map[e.key]){ e.preventDefault(); devicePress(map[e.key]); return; }
  if(e.key==='m' || e.key==='M'){ e.preventDefault(); devicePress('menu', {immediate:true}); }
  if(e.key==='Escape'){ e.preventDefault(); if(D().menuOpen) devicePress('menu', {immediate:true}); }
  if(e.key==='w' || e.key==='W'){ e.preventDefault(); twin.setLed('work', true); toast('Work 灯已点亮'); }
});

/* ============================================================
   9) 初始化
   ============================================================ */
(function init(){
  refreshNetHint();
  refreshLinkBadge('none');
  renderStepbar(0);
  showStep(0);
  renderChecks();
  refreshDevice();
  refreshOutStrip();
  log('系统就绪：左侧为运维电脑，右侧为 AD1200 实机数字孪生','info');
  log('提示：先长按实机 Menu 键读出设备 IP，再配置本机电脑 IP','info');
  twin.viewIso();
  /* 数码管上电自检动画 */
  const seq = ['88888888','        ','AD1200  ','--------'];
  let i=0;
  const t = setInterval(()=>{
    twin.setDisplay(seq[i]);
    if(++i>=seq.length){ clearInterval(t); refreshDevice(); }
  }, 340);
})();

/* 调试钩子（便于自动化测试与教学演示外部控制） */
window.__twin = twin;
window.__state = S;
window.__press = (k,o)=>devicePress(k,o);
window.__audio = audio;
window.__goto = (u)=>gotoDevice(u);

export { twin, audio, checkProgress, mark };
