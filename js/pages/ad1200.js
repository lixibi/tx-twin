/* AD1200 后台 —— 1:1 还原原厂 ExtJS 3 界面 + 教学联动 */
import { SERVICES, MULTICAST, LOGIN } from '../config.js';

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const msg = (st, m, kind) => {
  /* 后台页面按 1:1 还原，底部消息栏已去除：操作记录只回传给宿主教学日志 */
  try{ parent.postMessage({type:'pdu-log', rows:[{st,m,kind,t:''}], page:'AD1200.mhtml'}, '*'); }catch(e){}
};
const post = (o) => { try{ parent.postMessage(o, '*'); }catch(e){} };

/* 当前“已生效”的组播参数（由宿主同步过来）。
   保存组播后立刻在本地也记一份，避免宿主同步延迟导致页面读不到。 */
function mc(){
  if(!window.__lastMulticast && window.__pendingMc) window.__lastMulticast = window.__pendingMc;
  return window.__lastMulticast;
}
/* 组播参数是否可用（地址合法 + 端口合法） */
function mcValid(){
  const c = mc();
  if(!c) return false;
  const okG = /^(22[4-9]|23[0-9])\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(String(c.group||''))
    && String(c.group).split('.').every(x=>+x<=255);
  const okP = /^\d{1,5}$/.test(String(c.port||'')) && +c.port>=1 && +c.port<=65535;
  return okG && okP;
}

/* ============ 原厂“设备参数”页（组播地址/端口） ============ */
function viewDeviceParam(){
  return `
  <div class="pdu-hint">当前页：设备参数 → 网络配置 / 组播设置 / SNMP trap 参数设置 / 输入输出设置 / 前面板密码设置 / IP 转 ASI 输出码率设置</div>
  <div class="pdu-title-row">

    <div class="x-panel-c" style="width:320px">
      <div class="x-panel-hd">网络配置</div>
      <div class="x-panel-bd">
        <div class="x-fieldset">
          <legend>网络配置</legend>
          <div class="x-form-item"><label>IP地址:</label><div class="x-form-element"><input class="x-form-text" id="ip_addr" value="192.168.1.150"></div></div>
          <div class="x-form-item"><label>掩码:</label><div class="x-form-element"><input class="x-form-text" id="netmask" value="255.255.255.0"></div></div>
          <div class="x-form-item"><label>网关:</label><div class="x-form-element"><input class="x-form-text" id="gateway" value="192.168.1.1"></div></div>
          <div style="padding-left:112px"><span class="x-btn" id="btnNet">确认</span></div>
        </div>
      </div>
    </div>

    <div class="x-panel-c" style="width:330px">
      <div class="x-panel-hd">组播设置</div>
      <div class="x-panel-bd">
        <div class="x-fieldset" id="fsMulticast">
          <legend>组播设置</legend>
          <div class="x-form-item"><label>组播地址:</label><div class="x-form-element">
            <input class="x-form-text" id="multiprog_addr" placeholder="236.x.x.x"></div></div>
          <div class="x-form-item"><label>端口:</label><div class="x-form-element">
            <input class="x-form-text" id="port" placeholder="4000"></div></div>
          <div class="x-form-item"><label>组播源过滤使能:</label><div class="x-form-element">
            <label class="rlbl"><input type="radio" name="source_enable" value="1" checked>ON</label>
            <label class="rlbl"><input type="radio" name="source_enable" value="2">OFF</label></div></div>
          <div class="x-form-item"><label>组播源地址:</label><div class="x-form-element">
            <input class="x-form-text" id="multiprog_source_addr" readonly></div></div>
          <div class="x-form-item" style="margin-top:-2px">
            <label style="visibility:hidden">x</label><div class="x-form-element">
              <span style="font-size:11px;color:#7a8ba3">组播源地址无需设置：设备默认与组播地址保持一致</span>
            </div></div>
          <div style="padding-left:112px;display:flex;gap:6px;align-items:center">
            <span class="x-btn" id="btnMulticast">确认</span>
            <span id="mcastState" style="font-size:11px;color:#8a6d1a"></span>
          </div>
        </div>
      </div>
    </div>

    <div class="x-panel-c" style="width:300px">
      <div class="x-panel-hd">输入输出设置</div>
      <div class="x-panel-bd">
        <div class="x-fieldset">
          <legend>输入输出设置</legend>
          <div class="x-form-item"><label>输入源:</label><div class="x-form-element">
            <select class="x-form-text" id="in_src" style="width:80px">
              <option selected>IP</option><option>ASI1</option><option>E1</option></select></div></div>
          <div class="x-form-item"><label>ASI输出:</label><div class="x-form-element">
            <select class="x-form-text" style="width:80px"><option>ON</option><option selected>OFF</option></select></div></div>
          <div class="x-form-item"><label>自动切换:</label><div class="x-form-element">
            <select class="x-form-text" style="width:80px">
              <option selected>自动</option><option>手动</option><option>关闭</option></select>
            <span style="font-size:11px;color:#7a8ba3">保持默认“自动”即可</span></div></div>
          <div class="x-form-item"><label>输入源优先级1:</label><div class="x-form-element">
            <select class="x-form-text" style="width:80px"><option selected>IP</option><option>ASI1</option><option>E1</option></select></div></div>
          <div class="x-form-item"><label>输入源优先级2:</label><div class="x-form-element">
            <select class="x-form-text" style="width:80px"><option>IP</option><option selected>ASI1</option><option>E1</option></select></div></div>
          <div class="x-form-item"><label>输入源优先级3:</label><div class="x-form-element">
            <select class="x-form-text" style="width:80px"><option>IP</option><option>ASI1</option><option selected>E1</option></select></div></div>
          <div style="padding-left:112px"><span class="x-btn">刷新</span></div>
        </div>
      </div>
    </div>

    <div class="x-panel-c" style="width:300px">
      <div class="x-panel-hd">SNMP trap参数设置</div>
      <div class="x-panel-bd">
        <div class="x-fieldset">
          <legend>SNMP trap参数设置</legend>
          <div class="x-form-item"><label>Trap1接收地址:</label><div class="x-form-element"><input class="x-form-text" style="width:150px" value="192.168.1.200"></div></div>
          <div class="x-form-item"><label>Trap2版本:</label><div class="x-form-element">
            <label class="rlbl"><input type="radio" name="t2v" checked>V1</label><label class="rlbl"><input type="radio" name="t2v">V2c</label></div></div>
          <div class="x-form-item"><label>Trap1使能:</label><div class="x-form-element">
            <label class="rlbl"><input type="radio" name="t1e" checked>ON</label><label class="rlbl"><input type="radio" name="t1e">OFF</label></div></div>
          <div class="x-form-item"><label>Trap2接收地址:</label><div class="x-form-element"><input class="x-form-text" style="width:150px" value="192.168.1.201"></div></div>
          <div class="x-form-item"><label>Trap发送间隔:</label><div class="x-form-element"><input class="x-form-text" style="width:60px" value="30"><span style="font-size:11px">秒</span></div></div>
          <div style="padding-left:112px"><span class="x-btn">确认</span></div>
        </div>
      </div>
    </div>

    <div class="x-panel-c" style="width:300px">
      <div class="x-panel-hd">前面板密码设置</div>
      <div class="x-panel-bd">
        <div class="x-fieldset">
          <legend>前面板密码设置</legend>
          <div class="x-form-item"><label>原来的密码:</label><div class="x-form-element"><input type="password" class="x-form-text" style="width:130px"></div></div>
          <div class="x-form-item"><label>新密码:</label><div class="x-form-element"><input type="password" class="x-form-text" style="width:130px"></div></div>
          <div class="x-form-item"><label>确认密码:</label><div class="x-form-element"><input type="password" class="x-form-text" style="width:130px"></div></div>
          <div style="padding-left:112px"><span class="x-btn">确认</span></div>
        </div>
      </div>
    </div>

    <div class="x-panel-c" style="width:300px">
      <div class="x-panel-hd">IP转ASI输出码率设置</div>
      <div class="x-panel-bd">
        <div class="x-fieldset">
          <legend>IP转ASI输出码率设置</legend>
          <div class="x-form-item"><label>码率(Kbps):</label><div class="x-form-element"><input class="x-form-text" style="width:80px" value="4096"></div></div>
          <div style="padding-left:112px"><span class="x-btn">确认</span></div>
        </div>
      </div>
    </div>

  </div>`;
}

/* ============ 原厂“解码模块 N 设置”页（参数设置 + 节目列表） ============ */
function viewDecoder(id){
  return `
  <div class="pdu-hint">
    <b>当前页：解码模块${id}设置</b> → 参数设置（含强制解码设置、循环播放设置） / 节目搜索与选择
    <span class="boardhot">
      <span class="blbl">板卡：</span>
      <span class="x-btn small ${id===1?'press':''}" id="btnBoard_1">板卡1</span>
      <span class="x-btn small ${id===2?'press':''}" id="btnBoard_2">板卡2</span>
      <span class="x-btn small ${id===3?'press':''}" id="btnBoard_3">板卡3</span>
      <span id="boardSaveTag" class="save-tag"></span>
    </span>
  </div>
  <div class="pdu-title-row">

  <div class="x-panel-c" style="width:310px">
    <div class="x-panel-hd">参数设置</div>
    <div class="x-panel-bd">
      <div class="x-fieldset">
        <legend>参数设置</legend>
        <div class="x-form-item" style="margin-bottom:2px">
          <label style="width:104px;visibility:hidden">x</label>
          <div class="x-form-element"><label class="rlbl" style="font-weight:bold">
            <input type="checkbox" id="fd_en_${id}">强制解码设置</label></div>
        </div>
        <div class="x-fieldset" style="margin-left:0">
          <legend>强制解码设置</legend>
          <div class="x-form-item"><label>PCR PID:</label><div class="x-form-element">
            <input class="x-form-text" style="width:110px" id="D${id}_pcrpid" readonly></div></div>
          <div class="x-form-item"><label>Video PID:</label><div class="x-form-element">
            <input class="x-form-text" style="width:110px" id="D${id}_videopid" readonly></div></div>
          <div class="x-form-item"><label>Audio PID:</label><div class="x-form-element">
            <input class="x-form-text" style="width:110px" id="D${id}_audiopid" readonly></div></div>
          <div style="padding-left:112px"><span class="x-btn" id="btnForce_${id}">确认</span></div>
        </div>
        <div class="x-fieldset">
          <legend><input type="checkbox">循环播放设置</legend>
          <div class="x-form-item"><label>时间间隔(S):</label><div class="x-form-element">
            <input class="x-form-text" style="width:60px" value="10">
            <span class="x-btn small">设置</span><span class="x-btn small">开始</span></div></div>
        </div>
      </div>
    </div>
  </div>

  <div class="x-panel-c" style="width:860px;max-width:100%">
    <div class="x-panel-hd">解码模块${id}设置</div>
    <div class="x-panel-bd" style="padding:8px">
      <div class="x-toolbar">
        <span class="x-btn" id="btnSearch_${id}">搜索</span>
        <span class="x-sep"></span>
        <span class="lbl" id="D${id}_lockLabel">IP :</span>
        <span class="lamp" id="lockLamp_${id}" style="margin-left:4px"></span>
        <span class="x-sep"></span>
        <span class="lbl" id="curProg_${id}">当前节目: 0 PID强制解码</span>
        <span class="x-sep"></span>
        <span class="lbl">音量:</span>
        <span class="x-slider" id="slider_${id}">
          <span class="track"></span><span class="thumb" style="left:70%"></span>
        </span>
        <span class="val" id="volVal_${id}">70</span>
      </div>
      <div class="search-panel" id="searchPanel_${id}" style="display:none">
        <div class="sp-row">
          <span class="sp-name" id="spName_${id}">搜索节目源</span>
          <span class="sp-step" id="spStep_${id}">等待开始…</span>
          <span class="sp-pct" id="spPct_${id}">0%</span>
        </div>
        <div class="sp-bar"><i id="spBar_${id}"></i></div>
        <div class="sp-hint" id="spHint_${id}"></div>
      </div>
      <div id="gridWrap_${id}">
        <table class="x-grid" id="grid_${id}">
          <thead><tr>
            <th style="width:20px"></th><th style="width:52px">序号</th><th>节目名称</th>
            <th style="width:86px">节目类型</th><th style="width:104px">音源频率</th>
            <th style="width:96px">PCR / Audio PID</th><th style="width:74px">状态</th>
          </tr></thead>
          <tbody id="rows_${id}"><tr><td colspan="7" style="text-align:center;color:#888;height:60px">暂无数据，请点击“搜索”解析节目源</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  </div>

  <div class="x-panel-c" style="width:1226px;max-width:100%;clear:both">
    <div class="x-panel-hd">码流与音频参数说明</div>
    <div class="x-panel-bd">
      <div style="font-size:12px;line-height:2;color:#3f5c85">
        信源类型：<b id="infoInput_${id}">组播 IP</b> &nbsp;|&nbsp;
        组播地址：<b id="infoGroup_${id}">—</b> &nbsp;|&nbsp; 端口：<b id="infoPort_${id}">—</b><br>
        音源频率 / PCR PID / 音频 PID 在搜索成功后由设备自动从 PAT → PMT 表中解析，通常无需手工填写。<br>
        当输入源出现“锁定（LOCK）”后，即可点击某一路节目开始解码输出到发射机。
      </div>
    </div>
  </div>`;
}

/* ============ 用户管理 / 关于 ============ */
function viewUser(){
  return `<div class="pdu-hint">当前页：用户管理（原厂页仅支持修改管理员账号密码，此处按原样还原字段）</div>
  <div class="x-panel-c" style="width:340px"><div class="x-panel-hd">用户管理</div>
  <div class="x-panel-bd"><div class="x-fieldset"><legend>用户管理</legend>
    <div class="x-form-item"><label>用户名:</label><div class="x-form-element"><input class="x-form-text" value="dtv"></div></div>
    <div class="x-form-item"><label>原密码:</label><div class="x-form-element"><input type="password" class="x-form-text"></div></div>
    <div class="x-form-item"><label>新密码:</label><div class="x-form-element"><input type="password" class="x-form-text"></div></div>
    <div class="x-form-item"><label>确认新密码:</label><div class="x-form-element"><input type="password" class="x-form-text"></div></div>
    <div style="padding-left:112px"><span class="x-btn">确认</span></div>
  </div></div></div>`;
}
function viewAbout(){
  return `<div class="pdu-hint">当前页：关于</div>
  <div class="x-panel-c" style="width:420px"><div class="x-panel-hd">关于</div>
  <div class="x-panel-bd"><div style="font-size:12px;line-height:2.1;color:#3f5c85">
    产品名称：AD1200 音频解码器<br>
    软件版本：V2.13 &nbsp;&nbsp; 硬件版本：HW 1.4<br>
    生产厂商：北京环路网科技（Circloop Inc.）<br>
    官网：www.circloop.com.cn<br>
    版权：Copyright © 2000-2014 Circloop Inc. All rights reserved
  </div></div></div>`;
}

/* ============ 视图路由 ============ */
const views = $('#views');
let currentMod = 1;

function render(view){
  if(document.querySelector('#fsMulticast')) window.__curMod = 0;
  if(view==='device'){ views.innerHTML = viewDeviceParam(); bindDevice(); }
  else if(view==='user'){ views.innerHTML = viewUser(); }
  else if(view==='about'){ views.innerHTML = viewAbout(); }
  else {
    const m = /^decoder(\d)$/.exec(view) || /^module(\d)$/.exec(view);
    currentMod = m? +m[1] : 1;
    window.__curMod = currentMod;
    views.innerHTML = viewDecoder(currentMod); bindDecoder(currentMod);
  }
  /* 页面是整体重建的，重建后要把宿主同步过来的组播/设备参数重新套上，
     否则“保存组播 → 自动跳到解码模块1”之后会丢掉已生效的组播状态 */
  if(document.querySelector('#fsMulticast') || document.querySelector('#ip_addr')) bindDeviceValues();
  post({type:'pdu-view', view});
}

function bindDeviceValues(){
  const cur = mc();
  const g = document.querySelector('#multiprog_addr'), pt = document.querySelector('#port');
  if(g) g.value = cur? cur.group : '';
  if(pt) pt.value = cur? cur.port : '';
  /* 组播源地址不单独设置：显示值始终跟随组播地址（只读） */
  const src = document.querySelector('#multiprog_source_addr');
  if(src) src.value = cur && cur.group ? cur.group : (g ? g.value : '');
  /* 自动切换保持默认“自动” */
  const asw = document.querySelector('#in_src')?.closest('.x-fieldset')?.querySelectorAll('select')[2];
  if(asw && !asw.dataset.fixed){ asw.value = '自动'; asw.dataset.fixed = '1'; }
  /* 网络配置：设备自身的 IP 由主控同步过来，保证显示与实际一致 */
  const dv = window.__deviceNet;
  if(dv){
    if($('#ip_addr'))  $('#ip_addr').value  = dv.ip  || '';
    if($('#netmask'))  $('#netmask').value  = dv.mask|| '';
    if($('#gateway'))  $('#gateway').value  = dv.gw  || '';
  }
}

/* --- 设备参数页绑定 --- */
function bindDevice(){
  const $m = $('#multiprog_addr'), $p = $('#port'), $s = $('#multiprog_source_addr'), $st=$('#mcastState');
  $('#btnNet').onclick = ()=>{ msg('成功','网络配置已保存'); post({type:'pdu-net-saved'}); };
  $('#btnMulticast').onclick = ()=>{
    const group = $m.value.trim(), port = $p.value.trim();
    const okGroup = /^(22[4-9]|23[0-9])\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(group)
      && group.split('.').slice(1).every(n=>+n<=255);
    const okPort = /^\d{1,5}$/.test(port) && +port>=1 && +port<=65535;
    $m.classList.toggle('bad', !okGroup); $p.classList.toggle('bad', !okPort);
    $m.classList.toggle('good', okGroup); $p.classList.toggle('good', okPort);
    if(!okGroup){ $st.style.color='#c62828'; $st.textContent='✗ 组播地址须为 224.0.0.0 ~ 239.255.255.255'; msg('失败',`组播地址 ${group||'空'} 非法，保存被拒绝`,'err'); post({type:'pdu-mcast-fail', reason:'group'}); return; }
    if(!okPort){ $st.style.color='#c62828'; $st.textContent='✗ 端口须为 1~65535'; msg('失败',`端口 ${port||'空'} 非法，保存被拒绝`,'err'); post({type:'pdu-mcast-fail', reason:'port'}); return; }
    $st.style.color='#1a7f4f'; $st.textContent='✓ 已保存并生效';
    $s.value = group;                    /* 源地址默认 = 组播地址 */
    window.__pendingMc = { group, port }; /* 本地先记住，避免宿主同步延迟 */
    msg('成功',`组播设置已保存：${group}:${port}（组播源地址自动=${group}）`);
    post({type:'pdu-mcast-ok', group, port, source:group});
    /* 提示学员下一步去哪，但不自动跳页（避免打断，也避免跳页丢状态） */
    $st.textContent = '✓ 已保存并生效，可去「解码模块1设置」点搜索了';
    /* 页面上其它读组播信息的地方同步刷新 */
    $$('.pdu-center [id^="infoGroup_"]').forEach(el=>el.textContent = group);
    $$('.pdu-center [id^="infoPort_"]').forEach(el=>el.textContent = port);
  };
  /* 改动组播地址时，只读的组播源地址自动跟随 */
  $m && $m.addEventListener('input', ()=>{ if($s) $s.value = $m.value.trim(); });
  bindDeviceValues();
  /* 设备会先“回读”当前已保存的组播参数（教学场景：出厂默认未设置，留空提示填写） */
  const cur = mc();
  if(cur){ $('#mcastState').style.color='#1a7f4f'; $('#mcastState').textContent='✓ 当前已生效'; }
  else { $('#mcastState').style.color='#8a6d1a'; $('#mcastState').textContent='未设置，请填写组播地址与端口'; }
}

/* --- 解码模块页绑定 --- */
function bindDecoder(id){
  const D = { id, list:[], cur:null, vol:70, searching:false };
  window.__activeDecoder = D;
  window.__repaintDecoder = ()=>paintGrid();
  const rows = $('#rows_'+id), lamp = $('#lockLamp_'+id), cur = $('#curProg_'+id);
  const slider = $('#slider_'+id), thumb = slider.querySelector('.thumb'), volVal = $('#volVal_'+id);
  $('#infoGroup_'+id).textContent = mcValid()? mc().group : '（未设置）';
  $('#infoPort_'+id).textContent  = mcValid()? mc().port  : '（未设置）';

  function paintGrid(){
    if(!D.list.length){
      rows.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#888;height:60px">${D.searching?'正在解析 PAT / PMT / SDT，请稍候…':'暂无数据，请点击“搜索”解析节目源'}</td></tr>`;
      return;
    }
    rows.innerHTML = D.list.map((p,i)=>`
      <tr data-sid="${p.sid}" class="${D.cur&&D.cur.sid===p.sid?'sel':''} ${i%2?'odd':''}">
        <td class="ck"><input type="radio" name="pick_${id}" ${D.cur&&D.cur.sid===p.sid?'checked':''}></td>
        <td class="c"><span class="idx">${i+1}</span></td>
        <td>${p.name}</td>
        <td>${p.type || '广播'}</td>
        <td>${p.freq || '—'}</td>
        <td>${p.pcr} / ${p.audio}</td>
        <td class="st-cell">${D.cur&&D.cur.sid===p.sid?'<span class="tag-play">▶ 播放中</span>':'<span class="tag-idle">待选</span>'}</td>
      </tr>`).join('');
    $$('#rows_'+id+' tr[data-sid]').forEach(tr=>{
      tr.onclick = ()=> pick(+tr.dataset.sid);
    });
  }

  /* 点中节目名称 = 立即锁定该频道并保存（无需再点确认；本机为“选中即保存”） */
  function pick(sid){
    const p = D.list.find(x=>x.sid===sid); if(!p) return;
    D.cur = p; D.searched = true; paintGrid();
    $('#D'+id+'_pcrpid').value = p.pcr;
    $('#D'+id+'_audiopid').value = p.audio;
    $('#D'+id+'_videopid').value = '—';
    cur.textContent = `当前节目: ${p.sid} ${p.name}`;
    lamp.classList.remove('green'); lamp.classList.add('amber');
    $('#D'+id+'_lockLabel').textContent = 'IP : LOCKING';
    $('#D'+id+'_lockLabel').style.color = '#8a6d1a';
    msg('成功',`已选中频道 [${p.sid}] ${p.name}，设备正在锁定并保存…`);
    post({type:'pdu-pick', module:id, sid:p.sid, name:p.name, pcr:p.pcr, audio:p.audio, freq:p.freq});
    setTimeout(()=>{
      lamp.classList.remove('amber'); lamp.classList.add('green');
      $('#D'+id+'_lockLabel').textContent = 'IP : LOCK';
      $('#D'+id+'_lockLabel').style.color = '#1a7f4f';
      cur.textContent = `当前节目: ${p.sid} ${p.name}（已锁定 · 已保存）`;
      msg('成功',`解码模块${id} 已锁定 [${p.sid}] ${p.name}，选择已保存（掉电不丢），音频已输出至发射机`);
      /* 选中即保存：把“本板卡已保存频道”同步给宿主与页面标记 */
      window.__savedProgram = { module:id, sid:p.sid, name:p.name, pcr:p.pcr, audio:p.audio, freq:p.freq };
      showBoardSaved();
      post({type:'pdu-locked', module:id, sid:p.sid, name:p.name});
      post({type:'pdu-save-program', module:id, sid:p.sid, name:p.name, pcr:p.pcr, audio:p.audio, freq:p.freq});
    }, 620);
  }

  /* ---- 搜索：几秒钟的进度条动画 ---- */
  const SP_STEPS = [
    {p:  6, t:'初始化调谐器，锁定组播频点…'},
    {p: 18, t:'加入组播组，等待 IGMP 响应…'},
    {p: 33, t:'接收 TS 码流，同步 0x47 包…'},
    {p: 50, t:'解析 PAT（节目关联表）…'},
    {p: 68, t:'解析 PMT（节目映射表）／PCR PID…'},
    {p: 84, t:'解析 SDT（业务描述表）节目名称…'},
    {p:100, t:'搜索完成，节目列表已生成'},
  ];
  const SP_TOTAL = 3400;   /* 整体约 3.4 秒 */
  let spTimer = null, spT0 = 0;

  function spFinish(){
    const bar = $('#spBar_'+id), pct = $('#spPct_'+id);
    if(spTimer){ clearTimeout(spTimer); spTimer = null; }
    if(bar){ bar.style.width = '100%'; pct.textContent = '100%'; }
    $('#spStep_'+id).textContent = '搜索完成';
    $('#spHint_'+id).innerHTML = `共解析到 <b>${SERVICES.length}</b> 个节目 · 组播 <b>${mc()?.group || MULTICAST.group}</b>:<b>${mc()?.port || MULTICAST.port}</b> · 点击下方任一行节目即可单独试听（选中即锁定并保存）`;
  }

  $('#btnSearch_'+id).onclick = ()=>{
    if(D.searching) return;
    /* 组播地址/端口未保存生效 → 设备无法加入组播组，搜不出节目 */
    if(!mcValid()){
      D.list = []; D.cur = null; D.searching = false; D.searched = false;
      $('#searchPanel_'+id).style.display = 'block';
      $('#spName_'+id).textContent = `搜索节目源 · 解码模块${id}`;
      $('#spBar_'+id).style.width = '0%';
      $('#spPct_'+id).textContent = '0%';
      $('#spStep_'+id).textContent = '搜索中止：组播参数未设置';
      $('#spHint_'+id).innerHTML = '❌ <b>还没设置组播地址</b>：请先到 <b>设备参数 → 组播设置</b> 填写组播地址与端口并点“确认”，设备才能加入组播组；' +
        '组播参数未生效时搜不出任何节目。';
      $('#D'+id+'_lockLabel').textContent = 'IP : NO MCAST';
      $('#D'+id+'_lockLabel').style.color = '#c62828';
      lamp.classList.remove('green','amber');
      $$('#rows_'+id).length; rows.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#c62828;height:60px">搜索中止：组播地址尚未设置 / 未生效</td></tr>`;
      msg('失败','搜索中止：组播地址与端口尚未保存生效，设备无法加入组播组','err');
      post({type:'pdu-search-blocked', module:id, reason:'no-mcast'});
      return;
    }
    D.searching = true; D.list = []; D.cur = null; paintGrid();
    $('#D'+id+'_lockLabel').textContent = 'IP :';
    $('#D'+id+'_lockLabel').style.color = '';
    lamp.classList.remove('green','amber');
    $('#searchPanel_'+id).style.display = 'block';
    $('#spName_'+id).textContent = `搜索节目源 · 解码模块${id}`;
    $('#spBar_'+id).style.width = '0%';
    $('#spPct_'+id).textContent = '0%';
    $('#spStep_'+id).textContent = '准备中…';
    $('#spHint_'+id).textContent = '';
    $('#btnSearch_'+id).classList.add('disabled');
    msg('成功','开始搜索节目源（解析 PAT / PMT / SDT）…');
    post({type:'pdu-search-start', module:id});

    spT0 = performance.now();
    const tickSp = ()=>{
      const k = Math.min(1, (performance.now()-spT0)/SP_TOTAL);
      let cur2 = SP_STEPS[0];
      for(const st of SP_STEPS) if(k*100 >= st.p - 6) cur2 = st;
      $('#spBar_'+id).style.width = Math.round(k*100) + '%';
      $('#spPct_'+id).textContent = Math.round(k*100) + '%';
      $('#spStep_'+id).textContent = cur2.t;
      if(k < 1) spTimer = setTimeout(tickSp, 90);
    };
    tickSp();

    SERVICES.forEach((sv,i)=>{
      setTimeout(()=>{
        D.list.push({...sv});
        paintGrid();
        if(i===SERVICES.length-1){
          D.searching=false;
          spFinish();
          $('#btnSearch_'+id).classList.remove('disabled');
          msg('成功',`搜索完成，共解析到 ${SERVICES.length} 个节目`);
          post({type:'pdu-search-done', module:id, count:SERVICES.length});
        }
      }, 1200 + i*400);
    });
  };
  $('#fd_en_'+id).onchange = e => {
    const on = e.target.checked;
    ['pcrpid','videopid','audiopid'].forEach(k=>$('#D'+id+'_'+k).readOnly = !on);
    msg('成功', `强制解码设置 ${on?'已启用':'已关闭'}`);
  };
  $('#btnForce_'+id).onclick = ()=>{ msg('成功','强制解码 PID 参数已保存'); };

  /* 音量滑块 */
  let dragging=false;
  const setFromEvent = (e)=>{
    const r = slider.getBoundingClientRect();
    let k = (e.clientX - r.left)/r.width; k = Math.max(0,Math.min(1,k));
    D.vol = Math.round(k*100); thumb.style.left = D.vol+'%'; volVal.textContent = D.vol;
    post({type:'pdu-volume', module:id, volume:D.vol});
  };
  slider.onmousedown = e=>{ dragging=true; setFromEvent(e); e.preventDefault(); };
  window.addEventListener('mousemove', e=>{ if(dragging) setFromEvent(e); });
  window.addEventListener('mouseup', ()=>{ if(dragging){ dragging=false; msg('成功',`解码模块${id} 音量已设置为 ${D.vol}`); } });

  /* ---- 板卡 1/2/3 直接切换（点一下就切到对应解码模块设置页） ---- */
  [1,2,3].forEach(k=>{
    const b = $('#btnBoard_'+k); if(!b) return;
    b.onclick = ()=>{
      if(k === id) return;
      rememberList(id, D.list, D.cur);
      const li = document.querySelector(`.pdu-west li[data-go="decoder${k}"]`);
      if(li){ li.click(); }
      else { render('decoder'+k); }
      msg('成功', `已切换到板卡${k}（解码模块${k}设置）`);
    };
  });
  showBoardSaved();

  /* 列表每次变化都记一份，保证板卡切换后能原样回来（只包一次） */
  if(!D._paintWrapped){
    D._paintWrapped = true;
    const _pg = paintGrid;
    paintGrid = function(){ _pg(); rememberList(id, D.list, D.cur); };
  }
  /* 回到本板卡：把上次的搜索结果与已锁定频道原样恢复（切换板卡不丢状态） */
  const mem = window.__modMem[id];
  if(mem && mem.list && mem.list.length){
    D.list = mem.list.map(x=>({...x}));
    D.searched = true;
    D.cur = mem.sid ? (D.list.find(x=>x.sid===mem.sid) || null) : null;
  }
  paintGrid();
  if(D.cur){
    /* 有已保存频道：恢复 LOCK 指示与当前节目显示 */
    lamp.classList.remove('amber'); lamp.classList.add('green');
    $('#D'+id+'_lockLabel').textContent = 'IP : LOCK';
    $('#D'+id+'_lockLabel').style.color = '#1a7f4f';
    cur.textContent = `当前节目: ${D.cur.sid} ${D.cur.name}（已锁定 · 已保存）`;
    $('#D'+id+'_pcrpid').value = D.cur.pcr;
    $('#D'+id+'_audiopid').value = D.cur.audio;
  }

  /* 离开本板卡（切到别的板卡/页面）时把状态记下来，回来时原样恢复 */
  window.__rememberThis = ()=> rememberList(id, D.list, D.cur);
}

/* ---- 当前板卡已保存（锁定）的频道回显：进入页就能看到上次选了哪路 ---- */
function showBoardSaved(){
  const sv = window.__savedProgram;
  [1,2,3].forEach(k=>{
    const b = $('#btnBoard_'+k);
    if(!b) return;
    const on = sv && sv.module===k;
    b.classList.toggle('saved', !!on);
  });
  const tag = $('#boardSaveTag');
  if(tag){
    const m = window.__curMod;
    if(sv && sv.module===m){
      tag.className = 'save-tag on';
      tag.textContent = `✓ 本板卡已保存频道：[${sv.sid}] ${sv.name}（已锁定 · 掉电不丢）`;
    } else if(sv){
      tag.className = 'save-tag';
      tag.textContent = `板卡${sv.module} 已保存频道：[${sv.sid}] ${sv.name}`;
    } else {
      tag.className = 'save-tag';
      tag.textContent = '本板卡尚未保存频道：点一下节目行即锁定并保存';
    }
  }
}

/* ---- 板卡切换不丢状态：每块板卡各自记一份搜索结果 + 已锁定频道 ---- */
window.__modMem = window.__modMem || {};
function rememberList(id, list, cur){
  window.__modMem[id] = { list: (list||[]).map(x=>({...x})), sid: cur? cur.sid : null };
}
function restoreList(id, mem){
  if(!mem || !mem.list || !mem.list.length) return false;
  const D = window.__activeDecoder;
  if(!D || D.id !== id) return false;
  D.list = mem.list.map(x=>({...x}));
  D.searched = true;
  D.searching = false;
  D.cur = mem.sid ? (D.list.find(x=>x.sid===mem.sid) || null) : null;
  window.__repaintDecoder && window.__repaintDecoder();
  return true;
}

/* ============ AI 助手（演示版：不接真实模型，回复为演示内容） ============ */
const AI_DEMO = {
  ip:['设备没有屏幕，IP 只能从前面板 8 位数码管读出来。','长按 Menu 键（约 0.65 秒）进菜单，数码管先显示菜单项名 IP ADD；',
      '再按 Enter 进页才显示数值：A1-192 → 按 ▲ → A1-168 → A1-001 → A1-150。',
      '\n\n本机出厂管理地址：192.168.1.150 / 掩码 255.255.255.0 / 网关 192.168.1.1。'],
  mcast:['组播设置决定设备收哪一路节目，在「设备参数 → 组播设置」里填。','地址 236.171.30.5（合法范围 224.0.0.0 ~ 239.255.255.255），端口 4000（1~65535），',
      '组播源过滤保持 ON，源地址不用填 —— 它会自动跟随组播地址。','\n\n注意：组播参数没保存生效之前，解码模块点“搜索”是搜不出节目的。'],
  search:['解码模块页工具栏点「搜索」，设备会解析 PAT → PMT → SDT，列出全部节目并自动填 PCR / Audio PID。',
      '\n\n搜不到节目，按这个顺序查：① 组播地址/端口是否已保存生效；② 前端是否真在推这路组播；',
      '③ 交换机是否开了 IGMP Snooping（建议开）；④ 网线是否插在本机背板 NET 口。'],
  save:['本机是“选中即保存”：解码模块页里点任意一行节目的名称，设备立即锁定该频道并写入保存，掉电不丢。',
      '\n\n锁定成功的标志：右侧测试栏那一行转绿显示“播放中”，工具栏 IP : 变绿显示 LOCK。',
      '要换频道，直接点另一行节目即可覆盖保存；三个板卡各自独立记一路。'],
  audio:['音频输出在背板：三块板卡 = 三路音频，每路都分左右声道，共 6 个圆柱形三芯（3 口）接口。',
      '蓝环 = 左声道 L，红环 = 右声道 R。','\n\n其中 2 根卡侬线把解码模块1 的 L/R 直送下方 200W 发射机的 250W 功放（接在发射机后面板），调制后由 RF OUT 上天馈。'],
  tx:['下方 2U 是 200W 立体声调频发射机：前面板显示频率（约 88.3MHz，工作时会轻微漂动）与输出功率（约 170~198W），',
      '后面板是 250W 功放模块的 2 个卡侬音频输入 + AC 220V + RF OUT。',
      '\n\n巡机看三点：功率是否在额定区间、风扇是否转、进出风口是否积尘。'],
  web:['后台打不开，按顺序查：① 电脑 IP 是否与设备同网段（192.168.1.x / 255.255.255.0）；',
      '② IP 是否与设备冲突；③ 电脑侧 ping 设备通不通；④ 本机背板 NET 口灯是否亮。',
      '\n\n都正常还打不开，再看上级交换机后面板 VLAN30 业务口那根网线有没有松。'],
  board:['左侧「解码模块1/2/3设置」三个板卡都可以点，页面里的「板卡1/2/3」按钮也能直接切。',
      '\n\n本次改动：切换板卡不再丢状态，每块板卡各自记自己的搜索列表与已锁定频道；点一下节目名就自动保存并锁定该频道。'],
  fallback:['（演示回复）这个问题我先按标准处理流程答：先看现象在哪一段链路，再缩小范围。',
      '\n\n① 信源段：组播地址/端口是否与前端一致、前端是否在推流；',
      '\n② 链路段：网线是否插在本机背板 NET 口、上级交换机 VLAN30 端口是否正常；',
      '\n③ 设备段：前面板数码管是否有 LOCK、板卡指示灯是否转绿；',
      '\n④ 输出段：背板卡侬/三芯输出是否接到发射机，左右声道是否对应。',
      '\n\n本次为演示回复（未接入真实大模型），把问题描述得更具体我再细化。']
};
function aiAnswer(q){
  const t = String(q||'');
  /* 具体词优先，泛词最后：避免问“组播地址怎么设”被误判成“读 IP” */
  const rules = [
    [/组播|multicast|236\.|4000|MCAST/i,               'mcast'],
    [/搜索|搜不到|节目源|节目列表|PAT|PMT|解析/i,         'search'],
    [/板卡|切换|点不动|点不了|点不开|模块\s*[123]|1\/2\/3/i,'board'],
    [/保存|锁定|lock|换台|频道|选中/i,                   'save'],
    [/音柱|卡侬|左右声道|声道|声音|音频|音调|输出口/i,      'audio'],
    [/发射机|功放|功率|频率|88\.|天馈/i,                 'tx'],
    [/打不开|登录|登入|后台|ping|网段|浏览器|访问不了/i,    'web'],
    [/数码管|读\s*ip|看\s*ip|查\s*ip|IP\s*地址|ip\s*是多少/i,'ip'],
  ];
  const hit = rules.find(([re])=>re.test(t));
  return (AI_DEMO[hit? hit[1] : 'fallback'] || AI_DEMO.fallback).join('');
}
function aiRender(rows){
  const box = $('#aiBody'); if(!box) return;
  box.innerHTML = rows.map(r=> r.me
    ? `<div class="ai-row me"><div class="ai-bub">${r.t}</div></div>`
    : `<div class="ai-row"><div class="ai-bub bot">${String(r.t).replace(/\n/g,'<br>')}</div></div>`).join('');
  box.scrollTop = box.scrollHeight;
}
function aiOpen(){
  const panel = $('#aiPanel');
  if(!panel) return;
  panel.style.display = 'block';
  $('#aiFab').style.display = 'none';
  if(!window.__aiGreeted){
    window.__aiGreeted = true;
    aiRender([
      {t:'你好，我是本台的 AI 值班助手（<b>演示版</b>，未接入真实大模型，回答为演示内容）。'},
      {t:'可以问我：数码管怎么读 IP、组播地址怎么设、搜不到节目怎么查、板卡怎么切换、选中怎么保存…'},
    ]);
  }
  const inp = $('#aiInput'); if(inp) setTimeout(()=>inp.focus(), 30);
}
function aiClose(){
  const panel = $('#aiPanel'); if(panel) panel.style.display = 'none';
  const fab = $('#aiFab'); if(fab) fab.style.display = 'flex';
}
function aiAsk(q){
  q = (q||'').trim(); if(!q) return;
  const hist = window.__aiHist = window.__aiHist || [];
  hist.push({me:true, t:q.replace(/</g,'&lt;')});
  aiRender(hist);
  /* 演示：本地生成一条“演示回复”，不做任何真实模型调用 */
  setTimeout(()=>{
    hist.push({t:`<span class="ai-demo">演示回复</span><br>`+aiAnswer(q).replace(/</g,'&lt;').replace(/&lt;br&gt;/g,'<br>')});
    aiRender(hist);
  }, 520);
}
function bindAI(){
  const fab = $('#aiFab'), panel = $('#aiPanel');
  if(!fab || !panel) return;
  fab.onclick = aiOpen;
  $('#aiClose').onclick = aiClose;
  $('#aiClear').onclick = ()=>{ window.__aiHist = []; aiRender([]); $('#aiInput').focus(); };
  $('#aiSend').onclick = ()=>{ const v=$('#aiInput').value; $('#aiInput').value=''; aiAsk(v); };
  $('#aiInput').addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); const v=e.target.value; e.target.value=''; aiAsk(v); }
  });
  document.querySelectorAll('.ai-q').forEach(el=>{
    el.onclick = ()=> aiAsk(el.textContent.replace(/^·\s*/,''));
  });
  $('#aiRunGuide').onclick = ()=>{ document.querySelector('.pdu-west li[data-go="device"]').click(); aiAsk('组播地址怎么设'); };
  window.__aiOpen = aiOpen;
}

/* 侧栏导航 */
$$('.pdu-west li[data-go]').forEach(li=>{
  li.onclick = ()=>{
    const go = li.dataset.go;
    if(go==='about'){ render('about'); clip(li); return; }
    if(go==='reboot'){ if(confirm('确定要重启设备吗？')) msg('成功','设备重启指令已下发'); return; }
    if(go==='user'){ render('user'); clip(li); return; }
    if(go==='device'){ render('device'); clip(li); return; }
    render(go); clip(li);
  };
});
function clip(li){ $$('.pdu-west li').forEach(x=>x.classList.remove('sel')); li.classList.add('sel'); }
$('#btnLogout').onclick = ()=> post({type:'pdu-logout'});
$('#hdUser').textContent = '当前用户: dtv';

/* 宿主消息 */
window.addEventListener('message', (e)=>{
  const d = e.data||{};
  if(d.type==='host-multicast'){ window.__lastMulticast = {group:d.group, port:d.port}; bindDeviceValues(); }
  if(d.type==='host-sync'){
    window.__lastMulticast = d.multicast || window.__pendingMc || null;
    window.__deviceNet = d.deviceNet || null;
    if(d.savedProgram) window.__savedProgram = d.savedProgram;
    showBoardSaved();
    /* 每块板卡各自记住自己的搜索列表与已锁定频道，切换板卡不丢状态 */
    if(window.__savedProgram){
      const sm = window.__savedProgram.module;
      const mod = window.__modMem && window.__modMem[sm];
      if(mod && mod.list && mod.list.length) restoreList(sm, mod);
    }
    if(document.querySelector('#fsMulticast') || document.querySelector('#ip_addr')) bindDeviceValues();
    /* 解码模块页上的“组播地址 / 端口”信息行同步 */
    const c = mc();
    $$('[id^="infoGroup_"]').forEach(el=>el.textContent = mcValid()? c.group : '（未设置）');
    $$('[id^="infoPort_"]').forEach(el=>el.textContent  = mcValid()? c.port  : '（未设置）');
  }
  if(d.type==='host-goto'){ 
    const li = document.querySelector(`.pdu-west li[data-go="${d.view}"]`);
    if(li) li.click();
  }
  if(d.type==='host-search'){ const b=$('#btnSearch_'+d.module); if(b) b.click(); }
  if(d.type==='pdu-search-blocked'){
    msg('失败', d.reason==='no-mcast'
      ? '搜索中止：组播地址与端口未设置生效，设备无法加入组播组'
      : '搜索中止', 'err');
  }
  if(d.type==='host-pick'){ const tr=$(`#rows_${d.module} tr[data-sid="${d.sid}"]`); if(tr) tr.click(); }
  /* 操作引导 · AI 提问（演示版）：宿主可唤起面板或直接提问 */
  if(d.type==='host-ai-open') aiOpen();
  if(d.type==='host-ai-ask'){ aiOpen(); aiAsk(d.q); }
});

/* 初始状态：若宿主要求先进设备参数页则直接进入 */
bindAI();
render('decoder1');
msg('成功','登录成功，欢迎使用 AD1200 音频解码器 WEB 管理平台');
