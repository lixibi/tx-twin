/* ============================================================
   AD1200 数字孪生 —— Three.js 实机 1U 机型建模
   材质分片 → 发光面片 ID 映射 → Raycaster 命中 → 事件回传
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { SERVICES } from './config.js';

const C = {
  chassisTop:  0xdfe3e8,
  chassisFace: 0xe9edf1,
  chassisDark: 0x6f767e,
  railMetal:   0xc3c9d0,
  knobDark:    0x2a2e34,
  knobLight:   0x7d848c,
  ledIdle:     0x3a1c1c,
  pcb:         0x1d5a3a,
  bgPanel:     0x2b3742,
};

const D2R = Math.PI/180;
const mm = v => v/1000;   // 毫米 → 米

export class Twin {
  constructor(canvas, opts={}){
    this.canvas = canvas;
    this.handlers = { hover:()=>{}, click:()=>{}, down:()=>{}, release:()=>{}, state:()=>{} };
    this.parts = [];          // {mesh, id, title, desc}
    this.hotspots = [];       // 发光面片（射线优先）
    this.ledMeshes = {};      // 可控发光件
    this.segments = [];       // 数码管段
    this.anim = [];
    this.outChannels = {};    // 输出接口高亮状态 {ch: {active, color}}
    this.channelOut = null;   // 当前被选中的输出通道
    this.spin = false;
    this.initScene();
    this.build();
    this.bind();
    this.animate();
  }
  on(evt, fn){ this.handlers[evt]=fn; return this; }

  /* ---------------- 场景 ---------------- */
  initScene(){
    const w = this.canvas.clientWidth||780, h = this.canvas.clientHeight||500;
    this.renderer = new THREE.WebGLRenderer({canvas:this.canvas, antialias:true, alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
    this.renderer.setSize(w,h,false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x06090f, 2.6, 6.0);

    this.camera = new THREE.PerspectiveCamera(46, w/h, 0.05, 40);
    this.camera.position.set(0.40, 0.26, 1.02);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.minDistance = 0.14;
    this.controls.maxDistance = 2.0;
    this.controls.maxPolarAngle = 115*D2R;
    this.controls.target.set(0, 0.02, 0);

    /* 灯光 */
    this.scene.add(new THREE.HemisphereLight(0xa9c8ea, 0x141a22, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(0.9, 1.5, 1.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048,2048);
    const d = 1.1;
    Object.assign(key.shadow.camera, {left:-d,right:d,top:d,bottom:-d,near:0.1,far:5});
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fd0ff, 0.55);
    fill.position.set(-1.2, 0.6, 0.6); this.scene.add(fill);
    const backFill = new THREE.DirectionalLight(0xdce8f5, 1.15); backFill.position.set(-0.3, 0.5, -1.2); this.scene.add(backFill);
    const rim = new THREE.SpotLight(0x7fd4ff, 1.1, 3.2, 0.9, 0.6, 1.6);
    rim.position.set(0.2, 1.0, -1.3); rim.target.position.set(0,0,0);
    this.scene.add(rim, rim.target);
    this.key = key;

    /* 地面 + 接地阴影 */
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1.35, 64),
      new THREE.MeshStandardMaterial({color:0x0a1018, roughness:0.85, metalness:0.1})
    );
    ground.rotation.x = -Math.PI/2; ground.position.y = -0.24; ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;

  }

  /* ---------------- 工具 ---------------- */
  mesh(geo, mat, x,y,z){
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  reg(m, id, title, desc, kind='general'){
    m.userData.part = {id, title, desc, kind};
    this.parts.push(m); return m;
  }
  addHotspots(parent, list, x, y, z, opts={}){
    const w = opts.w||0.03, h = opts.h||0.008;
    list.forEach((it,i)=>{
      const isBtn = it.kind==='button';
      const geo = isBtn
        ? new THREE.CircleGeometry(opts.r||0.0105, 24)
        : new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshStandardMaterial({
        color: it.color||0x2a3a4a, roughness: isBtn?0.35:0.6, metalness: isBtn?0.4:0.2,
        emissive: it.emissive!=null?it.emissive:0x000000, emissiveIntensity: 0.6,
        transparent: !isBtn, opacity: isBtn?1:0.001,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x + (it.dx||0), y + (it.dy||0) + (i*(opts.gap||0)), z + (it.dz||0));
      m.userData.part = {id:it.id, title:it.title, desc:it.desc, kind:it.kind||'hotspot'};
      m.userData.hotspot = true;
      m.userData.baseColor = mat.color.getHex();
      m.userData.baseEmissive = mat.emissive.getHex();
      parent.add(m); this.hotspots.push(m); this.parts.push(m);
      if(isBtn){ /* 按键底座 */
        const ring = new THREE.Mesh(
          new THREE.RingGeometry((opts.r||0.0105), (opts.r||0.0105)*1.28, 28),
          new THREE.MeshStandardMaterial({color:0x9aa2ab, roughness:0.4, metalness:0.85, side:THREE.DoubleSide})
        );
        ring.position.copy(m.position); ring.position.z -= 0.0016;
        parent.add(ring);
      }
    });
  }
  emissivePlane(w,h,color,intensity){
    return new THREE.MeshStandardMaterial({
      color:0x05070a, emissive:color, emissiveIntensity:intensity, roughness:0.25, metalness:0.0
    });
  }

  /* ---------------- 建模 ---------------- */
  build(){
    const g = new THREE.Group(); this.root = g;
    this.scene.add(g);
    const W = 0.4826;            // 19 英寸 = 482.6mm
    const H = 0.0445;            // 1U = 44.45mm
    const D = 0.30;              // 机深（示意）
    const FZ = D/2;              // 前面板 z
    const BZ = -D/2;             // 背板 z

    const matFace = new THREE.MeshStandardMaterial({color:C.chassisFace, roughness:0.62, metalness:0.34});
    const matTop  = new THREE.MeshStandardMaterial({color:C.chassisTop,  roughness:0.45, metalness:0.72});
    const matSide = new THREE.MeshStandardMaterial({color:0xccd1d6, roughness:0.5, metalness:0.6});
    const matBrk  = new THREE.MeshStandardMaterial({color:0xb9bfc6, roughness:0.42, metalness:0.8});

    /* 主机箱体 */
    const body = this.mesh(new THREE.BoxGeometry(W,H,D), matFace, 0,0,0);
    g.add(body);
    this.reg(body,'chassis','AD1200 机箱（机柜内 1U）','1U 19 英寸标准机架式结构，前面板为铝挤型材，机箱深 300mm，整机重量约 4.2kg。通过左右安装耳用面板螺钉固定在 19 英寸机柜立柱上，与上方 2U 的上一级交换机、下方 2U 的 200W 发射机同柜安装。','general');

    /* 顶盖：通风孔阵列 */
    const top = this.mesh(new THREE.BoxGeometry(W-0.02, 0.0018, D-0.012), matTop, 0, H/2+0.0009, 0);
    top.castShadow = false; g.add(top);
    const ventGeo = new THREE.CircleGeometry(0.0032, 10);
    const ventMat = new THREE.MeshStandardMaterial({color:0x1b2027, roughness:0.9, emissive:0x000000});
    for(let r=0;r<3;r++) for(let c=0;c<26;c++){
      const v = new THREE.Mesh(ventGeo, ventMat);
      v.rotation.x = -Math.PI/2;
      v.position.set(-0.20 + c*0.0158, H/2+0.002, -0.06 + r*0.0245);
      g.add(v);
    }
    /* 顶盖丝印机型标签 */
    const labelMat = new THREE.MeshStandardMaterial({color:0x8d949c, roughness:0.5, metalness:0.4});
    const lbl = this.mesh(new THREE.PlaneGeometry(0.10,0.016), labelMat, -0.14, H/2+0.0022, 0.02);
    lbl.rotation.x = -Math.PI/2; lbl.castShadow=false; g.add(lbl);

    /* 前面板 */
    const face = this.mesh(new THREE.BoxGeometry(W, H, 0.0035), matFace, 0, 0, FZ+0.0018);
    g.add(face);
    this.reg(face,'faceplate','前面板','前面板从左到右：厂商 LOGO、8 位数码管窗、Power/Module1-3 状态指示灯、▲▼◀▶ 方向键组、Enter 与 Menu 键（并排，Enter 在左、Menu 在右）。本机唯一的 RJ45 网口在背板。','general');

    /* 前面板左右安装耳 */
    [-1,1].forEach(sd=>{
      const ear = this.mesh(new THREE.BoxGeometry(0.024, H+0.008, 0.006), matBrk, sd*(W/2+0.011), 0, FZ-0.001);
      g.add(ear);
      this.reg(ear, sd<0?'earL':'earR', sd<0?'左侧把手/安装耳':'右侧把手/安装耳',
        '19 英寸机架固定安装耳，含提拉把手，用于在标准 1U 机位中推入并螺栓固定。','general');
      [-1,1].forEach(k=>{
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.0034,14), new THREE.MeshStandardMaterial({color:0x2a3038, roughness:0.9}));
        hole.position.set(sd*(W/2+0.011), k*0.0125, FZ+0.0022); g.add(hole);
      });
    });

    /* ---- 数码管窗（深色玻璃）——按实机照片：位于面板最左 ---- */
    const glassX = -0.150;
    const glass = this.mesh(new THREE.BoxGeometry(0.098,0.0175,0.0016),
      new THREE.MeshStandardMaterial({color:0x06090d, roughness:0.12, metalness:0.45, emissive:0x160c00, emissiveIntensity:0.30}),
      glassX, 0.0035, FZ+0.0036);
    g.add(glass);
    this.reg(glass,'display','7 段数码管显示屏',
      '实机面板最左侧的黑色 8 位数码管窗。长按 Menu 键进入设置菜单，用上/下键在 IP ADD / IP MASK / GATEWAY / MCAST IP / MCAST PORT / MAC ADD / SOFT VER / EXIT 之间切换；Enter 键进入，上键逐段查看 IP 的四个字段。','display');
    this.buildSegments(g, glassX, 0.0035, FZ+0.0045);
    /* 数码管窗边框 */
    const bezel = this.mesh(new THREE.BoxGeometry(0.104,0.0218,0.0012),
      new THREE.MeshStandardMaterial({color:0xb2b8c0, roughness:0.4, metalness:0.8}), glassX, 0.0035, FZ+0.0027);
    g.add(bezel);

    /* ---- LED 指示灯组 Power / Module1 / Module2 / Module3 ---- */
    const ledGroup = new THREE.Group(); g.add(ledGroup);
    const lampGeo = new THREE.CircleGeometry(0.0026, 20);
    const ledDefs = [
      {id:'led-power',  y:0.0110, t:'Power 电源指示灯', d:'常亮绿色表示设备已上电，内部电源模块工作正常。'},
      {id:'led-mod1',   y:0.0020, t:'Module1 状态指示灯', d:'解码模块1 的工作状态灯。节目锁定（LOCK）后点亮；正在搜索码流时闪烁。'},
      {id:'led-mod2',   y:-0.0070,t:'Module2 状态指示灯', d:'解码模块2 的工作状态灯，逻辑同 Module1。'},
      {id:'led-mod3',   y:-0.0160,t:'Module3 状态指示灯', d:'解码模块3 的工作状态灯，逻辑同 Module1。'},
    ];
    const LED_NAMES = ['POWER','MOD1','MOD2','MOD3'];
    ledDefs.forEach((cfg,i)=>{
      const mat = new THREE.MeshStandardMaterial({color:0x101418, emissive:C.ledIdle, emissiveIntensity:1.0, roughness:0.2});
      const m = new THREE.Mesh(lampGeo, mat);
      m.position.set(-0.0680, cfg.y, FZ+0.0048);
      ledGroup.add(m);
      this.ledMeshes['led'+i] = m;
      this.reg(m, cfg.id, cfg.t, cfg.d, 'led');
      /* 丝印（整体右移，避免与数码管窗/边框重叠） */
      this.buildPrintText(g, LED_NAMES[i], -0.0865, cfg.y, FZ+0.0046, 0.0165, 0.22);
    });
    this.ledMeshes.power = this.ledMeshes.led0;

    /* ---- 按键：方向键组（▲▼◀▶）+ 并排的 Enter / Menu ----
       布局按现场实机：
         · ▲▼◀▶ 四个方向键十字排布，键帽正中都是黑色三角丝印
         · Enter 与 Menu 并排放在方向键右侧同一水平线：Enter 在左、Menu 在右
         · ◀ ▶ 在本机型未定义功能，仅保留键位，不参与演示            */
    const matBtn  = new THREE.MeshStandardMaterial({color:0xb9bfc7, roughness:0.38, metalness:0.42});
    const matBtnD = new THREE.MeshStandardMaterial({color:0x4a5057, roughness:0.34, metalness:0.55});
    const matBtnX = new THREE.MeshStandardMaterial({color:0x9ba1a9, roughness:0.42, metalness:0.40});
    const printMat = new THREE.MeshStandardMaterial({color:0x3c4650, roughness:0.72});

    /* 方向键组：以 (AX,AY) 为中心的十字，▲▼ 竖直、◀▶ 左右 */
    const AX = 0.0330, AY = 0.0, ASPAN = 0.0104, AR = 0.0066;
    const B_UP    = { x: AX,         y: AY + ASPAN, r: AR };
    const B_DOWN  = { x: AX,         y: AY - ASPAN, r: AR };
    const B_LEFT  = { x: AX - ASPAN, y: AY,         r: AR };
    const B_RIGHT = { x: AX + ASPAN, y: AY,         r: AR };
    /* Enter 左 / Menu 右：两个键并排 */
    const B_ENTER = { x: 0.0760, y: 0.0, r: 0.0074 };
    const B_MENU  = { x: 0.1030, y: 0.0, r: 0.0074 };

    const btnDefs = [
      { ...B_UP,    m:matBtn,  id:'btn-up',    t:'上键 ▲',
        d:'逐段翻页键。菜单中在地址页按 ▲，数码管一屏 3 位依次显示 192 → 168 → 001 → 150。' },
      { ...B_DOWN,  m:matBtn,  id:'btn-down',  t:'下键 ▼',
        d:'切换菜单项：IP ADD → IP MASK → GATEWAY → MCAST IP → MCAST PORT → MAC ADD → SOFT VER → EXIT。' },
      { ...B_LEFT,  m:matBtnX, id:'btn-left',  t:'左键 ◀（保留键位）',
        d:'方向键组的左键位。本机型未定义功能、不参与演示，仅保留键位。' },
      { ...B_RIGHT, m:matBtnX, id:'btn-right', t:'右键 ▶（保留键位）',
        d:'方向键组的右键位。本机型未定义功能、不参与演示，仅保留键位。' },
      { ...B_ENTER, m:matBtn,  id:'btn-enter', t:'Enter 键',
        d:'确认键。进入所选菜单项，在地址页切换“逐段查看 / 完整显示”。' },
      { ...B_MENU,  m:matBtnD, id:'btn-menu',  t:'Menu 菜单键',
        d:'核心操作键。长按约 0.65 秒进入 / 退出设备设置菜单，进入时数码管显示 IP ADD；短按在菜单中切到下一项。' },
    ];
    btnDefs.forEach(b=>{
      const btn = this.mesh(new THREE.CylinderGeometry(b.r, b.r*1.08, 0.0042, 28), b.m, b.x, b.y, FZ+0.0034);
      btn.rotation.x = Math.PI/2; g.add(btn);
      const ring = new THREE.Mesh(new THREE.RingGeometry(b.r, b.r*1.3, 30),
        new THREE.MeshStandardMaterial({color:0xa7aeb6, roughness:0.36, metalness:0.85, side:THREE.DoubleSide}));
      ring.position.set(b.x, b.y, FZ+0.0030); g.add(ring);
      this.reg(btn, b.id, b.t, b.d, 'button');
    });

    /* 四个方向键：键帽正中的黑色三角丝印 */
    const tri = (x,y,dir,size)=>{
      const sh = new THREE.Shape();
      const w = size||0.0054, h = (size||0.0054)*0.86;
      if(dir==='up'){ sh.moveTo(0,h/2); sh.lineTo(-w/2,-h/2); sh.lineTo(w/2,-h/2); sh.lineTo(0,h/2); }
      else if(dir==='down'){ sh.moveTo(0,-h/2); sh.lineTo(-w/2,h/2); sh.lineTo(w/2,h/2); sh.lineTo(0,-h/2); }
      else if(dir==='right'){ sh.moveTo(h/2,0); sh.lineTo(-h/2,w/2); sh.lineTo(-h/2,-w/2); sh.lineTo(h/2,0); }
      else { sh.moveTo(-h/2,0); sh.lineTo(h/2,w/2); sh.lineTo(h/2,-w/2); sh.lineTo(-h/2,0); }
      const m2 = new THREE.Mesh(new THREE.ShapeGeometry(sh),
        new THREE.MeshStandardMaterial({color:0x14181d, roughness:0.62, metalness:0.08, side:THREE.DoubleSide}));
      m2.position.set(x,y,FZ+0.0059); return m2;
    };
    g.add(tri(B_UP.x,    B_UP.y,    'up'));
    g.add(tri(B_DOWN.x,  B_DOWN.y,  'down'));
    g.add(tri(B_LEFT.x,  B_LEFT.y,  'left'));
    g.add(tri(B_RIGHT.x, B_RIGHT.y, 'right'));

    /* Enter / Menu 丝印紧贴各自按键正下方 */
    this.buildPrintText(g, 'Enter', B_ENTER.x, B_ENTER.y - B_ENTER.r - 0.0040, FZ+0.0046, 0.0145, 0.60);
    this.buildPrintText(g, 'Menu',  B_MENU.x,  B_MENU.y  - B_MENU.r  - 0.0040, FZ+0.0046, 0.0140, 0.60);

    /* 按键区分隔线（面板压线，紧贴按键组左右两侧） */
    [0.0085, 0.0580, 0.1190].forEach(x=>{
      const v = this.mesh(new THREE.BoxGeometry(0.0008,0.036,0.0008),
        new THREE.MeshStandardMaterial({color:0xc3c8ce, roughness:0.5, metalness:0.6}), x, 0.000, FZ+0.0042);
      g.add(v);
    });

    /* 说明：本机只有 1 个 RJ45 网口，位于背板（见 buildBackPanel） */

    /* 卡扣锁（面板右侧两块银色卡扣） */
    [0.1450, 0.2120].forEach((x,i)=>{
      const latch = this.mesh(new THREE.BoxGeometry(0.0150,0.0195,0.0100),
        new THREE.MeshStandardMaterial({color:0xaeb5bd, roughness:0.36, metalness:0.82}), x, -0.0015, FZ+0.0042);
      g.add(latch);
      this.reg(latch, 'latch'+i, '面板卡扣 / 紧固螺柱',
        '用于固定前面板与机箱本体的金属卡扣，拆机时需先松开，日常运维不要随意旋动。','general');
    });

    /* 厂商 LOGO 区（左侧，实机为“环路网科技”丝印） */
    this.buildVendorLogo(g, -0.2180, 0.0030, FZ+0.0044);

    this.buildBackPanel(g, W, H, BZ);
    /* 机架环境与线缆：本机固定时，交换机在上方、发射机在下方，各自独立机位互不遮挡 */
    this.buildRack(g);
    this.buildCabling(g);

    this.rootGroup = g;
    this.W=W; this.H=H; this.D=D;
  }

  /* ---- 线缆工具 ---- */
  cable(points, r, color, seg=52){
    const curve = new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(p[0],p[1],p[2])));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, r, 8, false),
      new THREE.MeshStandardMaterial({color, roughness:0.8, metalness:0.05}));
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }

  /* ---- 卡侬头（XLR）插头：插在背板三芯输出接口上 ---- */
  xlrPlug(pos, bootColor, ch){
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({color:0xb9c0c8, roughness:0.3, metalness:0.92});
    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.0054,0.0054,0.009,16), metal);
    nose.rotation.x = Math.PI/2; nose.position.z = -0.001; g.add(nose);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0092,0.0092,0.026,20), metal);
    body.rotation.x = Math.PI/2; body.position.z = -0.019; g.add(body);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0098,0.0098,0.0032,20),
      new THREE.MeshStandardMaterial({color:0x8e959d, roughness:0.35, metalness:0.9}));
    ring.rotation.x = Math.PI/2; ring.position.z = -0.010; g.add(ring);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.0050,0.0082,0.018,18),
      new THREE.MeshStandardMaterial({color:bootColor, roughness:0.66, metalness:0.08}));
    boot.rotation.x = Math.PI/2; boot.position.z = -0.042; g.add(boot);
    /* 尾夹 + 出线 */
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.0042,0.0050,0.008,14),
      new THREE.MeshStandardMaterial({color:0x2a3038, roughness:0.7, metalness:0.2}));
    tail.rotation.x = Math.PI/2; tail.position.z = -0.054; g.add(tail);
    g.position.set(pos.x, pos.y, pos.z);
    g.traverse(o=>{ if(o.isMesh) o.castShadow = true; });
    const board = ch.slice(1,2), side = ch.slice(2);
    const sideTxt = side === 'L' ? '左声道 L（蓝环）' : '右声道 R（红环）';
    this.reg(body, 'xlr-'+ch, `${board} 路输出音频线 · 卡侬头 XLR（${side==='L'?'L':'R'}）`,
      `背板第 ${board} 路输出的${sideTxt}卡侬线（XLR 三芯平衡头），从这里送到发射机的音频输入端。` +
      `点击可把试听输出切到该通道。`,'outport');
    return g;
  }

  /* ---- 机架环境：本机固定，交换机在上方、发射机在下方，各自独立机位 ----
     设计原则（教学可视性优先）：
       · 三台设备上下分层排布，中间留出明显间隙，任何一台都不会挡住另一台
       · 平面板与竖直立柱相对本机居中对称，不再"偏到一边"
       · 立柱只做到刚好夹住三台设备的高度，需要看侧面时可自己旋转视角
     ------------------------------------------------------------------ */
  buildRack(parent){
    const steel  = new THREE.MeshStandardMaterial({color:0x2b3138, roughness:0.55, metalness:0.85});
    const hole   = new THREE.MeshStandardMaterial({color:0x12171c, roughness:0.9, metalness:0.2});
    const PX = 0.288;                       /* 立柱中心 X：夹在设备安装耳外侧 */

    /* 本机 1U：y 中心 0，高度 44.45mm */
    this.rackY = {
      dev: 0.0445,
      sw:  0.0890,                          /* 上级交换机 2U  */
      tx:  0.0890,                          /* 200W 发射机 2U  */
    };
    /* 竖直间隙：设备之间留 ≥ 18mm，保证正面/背面直线视角下互不遮挡 */
    const GAP = 0.0240;
    const devTop = 0.0445/2;
    const devBot = -0.0445/2;
    this.swCY = devTop + GAP + this.rackY.sw/2;    /* 交换机中心 ≈ +0.0907 */
    this.txCY = devBot - GAP - this.rackY.tx/2;    /* 发射机中心 ≈ -0.0907 */

    /* 机架立柱：从发射机底到交换机顶，留 12mm 余量 */
    const YT = this.swCY + this.rackY.sw/2 + 0.014;
    const YB = this.txCY - this.rackY.tx/2 - 0.014;
    const PH = YT - YB, PCY = (YT + YB)/2;
    this.rackTop = YT; this.rackBot = YB;

    /* 四根立柱 + 左右侧梁（前后各一对，居中对称） */
    [-1,1].forEach(sx=>{
      [0.150, -0.150].forEach(z=>{
        const p = this.mesh(new THREE.BoxGeometry(0.046, PH, 0.046), steel.clone(), sx*PX, PCY, z);
        parent.add(p);
        this.reg(p,'rack-post','19 英寸机柜立柱',
          '标准 19 英寸机柜方孔立柱。三台设备都通过左右安装耳用面板螺钉固定在这四根立柱上，' +
          '孔位按 1U = 44.45mm 递增。立柱用于定位机位，不参与遮挡演示。','general');
      });
      [YT-0.026, YB+0.026].forEach(y=>{
        const r = this.mesh(new THREE.BoxGeometry(0.046,0.046, 0.300), steel.clone(), sx*PX, y, 0);
        parent.add(r);
        this.reg(r,'rack-rail','机柜侧梁','机柜左右侧梁，把前后立柱连成框架并承托托板。','general');
      });
      /* 前立柱方孔阵列 */
      for(let y = YB+0.085; y < YT-0.055; y += 0.0280){
        const h = new THREE.Mesh(new THREE.PlaneGeometry(0.015,0.010), hole);
        h.position.set(sx*PX, y, 0.174); parent.add(h);
      }
    });

    /* 本机安装耳的固定螺钉（左右各上下两颗） */
    [-1,1].forEach(sx=>[-1,1].forEach(sy=>{
      const sc = this.mesh(new THREE.CylinderGeometry(0.0040,0.0040,0.006,14),
        new THREE.MeshStandardMaterial({color:0xc7ced6, roughness:0.3, metalness:0.95}),
        sx*(0.4826/2+0.011), sy*0.0125, 0.1545);
      sc.rotation.x = Math.PI/2; parent.add(sc);
    }));

    this.buildSwitch(parent);
    this.buildTransmitter(parent);
  }

  /* ---- 上级交换机：本机上方 2U 位，独立机箱，四周留缝 ---- */
  buildSwitch(parent){
    const SW = { d:0.30 };                                  /* 机深与本机一致 300mm */
    const cy = this.swCY, h = this.rackY.sw;
    const box = this.mesh(new THREE.BoxGeometry(0.4826, h, SW.d),
      new THREE.MeshStandardMaterial({color:0x2a3038, roughness:0.62, metalness:0.45}), 0, cy, 0);
    parent.add(box);
    this.swFaceZ = SW.d/2 + 0.0011;
    this.buildSwitchFace(parent, 0, cy, this.swFaceZ, 0.4826, h);
    /* 交换机后面板（网线从这里的上行口出来） */
    const swBackZ = -SW.d/2 - 0.0012;
    const swBack = this.mesh(new THREE.BoxGeometry(0.4826, h, 0.0024),
      new THREE.MeshStandardMaterial({color:0x8b939c, roughness:0.52, metalness:0.72}), 0, cy, swBackZ);
    parent.add(swBack);
    this.swBackZ = swBackZ;
    /* 后面板：管理口 + 业务口（网线就插在业务口上） */
    const upX = 0.0620;
    [-1,1].forEach((s,i)=>{
      const jack = this.mesh(new THREE.BoxGeometry(0.0172,0.0140,0.0060),
        new THREE.MeshStandardMaterial({color:0x333b44, roughness:0.48, metalness:0.72}),
        s*upX, 0, swBackZ - 0.0030);
      jack.position.y = cy - 0.0040;
      parent.add(jack);
      const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.0128,0.0090),
        new THREE.MeshStandardMaterial({color:0x0b0e12, roughness:0.95}));
      slot.position.set(s*upX, cy - 0.0040, swBackZ - 0.0061); slot.rotation.y = Math.PI; parent.add(slot);
      this.reg(jack, i===0?'sw-port-biz':'sw-port-mgmt',
        i===0?'上级交换机 后面板 · 业务口':'上级交换机 后面板 · 管理口',
        i===0 ? '去 AD1200 的网线插在这个口上，从机柜后侧走到本机背板 NET 口。'
              : '运维电脑的网线插这个口。','port');
      this.buildPrintText(parent, i===0?'业务口':'管理口', s*upX, cy + 0.0060, swBackZ - 0.0062, 0.0140, 0.34);
    });
    this.swUpLink = { x:-upX, y:cy-0.0040, z:swBackZ };
    this.swBizPort = { x: upX, y:cy-0.0040, z:swBackZ };

    /* 19 英寸安装耳 */
    [-1,1].forEach(sx=>{
      const ear = this.mesh(new THREE.BoxGeometry(0.024, h, 0.006),
        new THREE.MeshStandardMaterial({color:0xb0b7bf, roughness:0.4, metalness:0.8}),
        sx*(0.4826/2+0.011), cy, SW.d/2 - 0.004);
      parent.add(ear);
      [-1,1].forEach(sy=>{
        const sc = this.mesh(new THREE.CylinderGeometry(0.0038,0.0038,0.006,14),
          new THREE.MeshStandardMaterial({color:0xc7ced6, roughness:0.3, metalness:0.95}),
          sx*(0.4826/2+0.018), cy + sy*h*0.30, this.swFaceZ + 0.0012);
        sc.rotation.x = Math.PI/2; parent.add(sc);
      });
    });
    this.reg(box,'upstream-switch','上一级交换机（本机上方 2U）',
      '24 口千兆上级交换机（VLAN 已设置完成）。网线从它后面板的业务口出来接到本机背板 NET 口；' +
      '学员不需要改交换机配置，接好网线即可通。','general');
  }

  /* ---- 2U 200W 发射机：本机下方 2U 位，独立机箱，四周留缝 ---- */
  buildTransmitter(parent){
    const TH = this.rackY.tx, TD = 0.300, TX = 0.2413;
    this.txCenterY = this.txCY;                    /* ≈ -0.0907，与本机不再重叠 */
    const TZ = TD/2;                               /* 前脸与本机前面板齐平 */

    const box = new THREE.Mesh(new THREE.BoxGeometry(TX*2, TH, TD),
      new THREE.MeshStandardMaterial({color:0x4b535c, roughness:0.50, metalness:0.60}));
    box.position.set(0, this.txCenterY, 0);
    box.castShadow = box.receiveShadow = true; parent.add(box);
    this.txBody = box;
    /* 顶盖散热格栅 */
    const ventMat = new THREE.MeshStandardMaterial({color:0x1b2027, roughness:0.9});
    for(let c=0;c<30;c++){
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.0088,0.0022,0.030), ventMat);
      v.position.set(-0.225 + c*0.0155, this.txCenterY + TH/2 + 0.0006, TZ - 0.090); parent.add(v);
    }
    /* 前脸面板：频率 / 功率 / 电平柱 / 旋钮 */
    this.buildTxFace(parent, 0, this.txCenterY, TZ + 0.0012, TX*2, TH);

    [-1,1].forEach(sx=>{
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.024, TH, 0.006),
        new THREE.MeshStandardMaterial({color:0xb0b7bf, roughness:0.4, metalness:0.8}));
      ear.position.set(sx*(TX+0.011), this.txCenterY, TZ - 0.004); parent.add(ear);
      [-1,1].forEach(sy=>{
        const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0038,0.0038,0.006,14),
          new THREE.MeshStandardMaterial({color:0xc7ced6, roughness:0.3, metalness:0.95}));
        sc.rotation.x = Math.PI/2;
        sc.position.set(sx*(TX+0.018), this.txCenterY + sy*TH*0.28, TZ + 0.0012);
        parent.add(sc);
      });
    });

    /* ---- 发射机后面板：音频输入 + 电源 + 风扇 + RF OUT（卡侬线接在这里） ---- */
    const txBackZ = -TD/2 - 0.0012;
    const txBack = new THREE.Mesh(new THREE.BoxGeometry(TX*2, TH, 0.0024),
      new THREE.MeshStandardMaterial({color:0x8b939c, roughness:0.52, metalness:0.72}));
    txBack.position.set(0, this.txCenterY, txBackZ); parent.add(txBack);
    this.txBackZ = txBackZ;
    this.reg(txBack,'tx-backplane','发射机后面板（音频输入 / 电源 / 射频输出）',
      '2U 发射机后面板。左半部分是音频输入区：250W 功放模块的 2 个卡侬（XLR）母座 ' +
      '（左声道 L 蓝环 / 右声道 R 红环），AD1200 解码出来的左右声道就接在这里；' +
      '右侧是 AC 220V 电源插座、散热风扇与射频输出（RF OUT，N 型）。' +
      '注意：卡侬线接的是【后面板】，前面板只做指示与操作。','general');

    /* 后面板：AC 电源插座 */
    const txPwr = new THREE.Mesh(new THREE.BoxGeometry(0.034,0.026,0.0060),
      new THREE.MeshStandardMaterial({color:0x1a1f25, roughness:0.7, metalness:0.3}));
    txPwr.position.set(0.172, this.txCenterY, txBackZ - 0.0030); parent.add(txPwr);
    this.reg(txPwr,'tx-power','发射机 AC 220V 电源输入',
      '发射机自身的 AC 220V 电源插座（与本机一样从机柜 PDU 取电）。','port');
    /* 散热风扇 */
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.0190,0.0190,0.0060,26),
      new THREE.MeshStandardMaterial({color:0x14181d, roughness:0.75, emissive:0x0a1a12, emissiveIntensity:0.5}));
    fan.rotation.x = Math.PI/2; fan.position.set(0.106, this.txCenterY, txBackZ - 0.0032); parent.add(fan);
    this.txFan = fan;
    this.reg(fan,'tx-fan','发射机散热风扇',
      '2U 发射机后部的散热风扇。满功率工作会明显发热，巡机时要确认风扇运转、进出风口不积尘。','general');
    /* 射频输出 */
    const txRf = new THREE.Mesh(new THREE.CylinderGeometry(0.0084,0.0084,0.0150,22),
      new THREE.MeshStandardMaterial({color:0xa9b1ba, roughness:0.42, metalness:0.88}));
    txRf.rotation.x = Math.PI/2; txRf.position.set(0.018, this.txCenterY, txBackZ - 0.0065); parent.add(txRf);
    this.txRfOut = txRf;
    this.reg(txRf,'tx-rf-out-back','发射机射频输出 RF OUT（后面板 N 型，200W）',
      '发射机的射频输出接口，经同轴电缆送到天馈线。这一路才是最终上天线的 200W 信号。','port');
    /* 后板丝印 */
    this.buildPrintText(parent, 'AC 220V', 0.172, this.txCenterY + 0.0210, txBackZ - 0.0032, 0.0230, 0.22);
    this.buildPrintText(parent, 'COOLING FAN', 0.106, this.txCenterY + 0.0290, txBackZ - 0.0032, 0.0330, 0.20);
    this.buildPrintText(parent, 'RF OUT', 0.018, this.txCenterY + 0.0195, txBackZ - 0.0075, 0.0210, 0.22);

    /* 后面板的 250W 功放模块：2 个卡侬（XLR）母座 + 射频输出 */
    this.buildTxAmplifier(parent, this.txCenterY, txBackZ);

    /* ---- 品牌 LOGO：银色 + 蓝色 组合的「R.V.R」铭牌（铝质拉丝底 + 蓝色丝印） ---- */
    this.buildTxLogo(parent, this.txCenterY, TZ + 0.0013, TX*2, TH);

    this.reg(box,'tx-chassis','200W 调频发射机（本机下方 2U）',
      '装在本机下方的 2U 发射机（200W 立体声调频发射机）。前面板是频率数显（约 88.3MHz，随调谐微动）、' +
      '功率/电平指示与调节旋钮；后面板是音频输入与射频输出：250W 功放模块带 2 个卡侬（XLR）音频输入母座，' +
      '两根卡侬线从 AD1200 背板输出接口接过来，解码出来的音频就由此送入发射机调制后上天馈。','general');
  }


  /* ---- 发射机品牌 LOGO 铭牌：银色金属底 + 蓝色「R.V.R」组合 ----
     用一块贴在前面板上的铝质拉丝铭牌（银色）+ 蓝色丝印文字实现，
     银色取自金属材质，蓝色取自丝印与蓝色描边/下划线。
     ------------------------------------------------------------------ */
  buildTxLogo(parent, cy, cz, w, h){
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = Math.round(1024*h/w);
    const H = cv.height, c = cv.getContext('2d');
    /* 银色拉丝底：横向细纹 + 中性灰渐变 */
    const g = c.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#eef3f8'); g.addColorStop(.42,'#c3cad3'); g.addColorStop(.55,'#aab2bc'); g.addColorStop(1,'#dbe2ea');
    c.fillStyle = g; c.fillRect(0,0,1024,H);
    c.globalAlpha = 0.10; c.strokeStyle = '#5b6672'; c.lineWidth = 1;
    for(let y=1; y<H; y+=3){ c.beginPath(); c.moveTo(0,y); c.lineTo(1024,y); c.stroke(); }
    c.globalAlpha = 1;
    /* 品牌文字：银色描边 + 蓝色实心 的「R.V.R」 */
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.font = 'bold 74px Georgia,"Times New Roman",serif';
    c.lineWidth = 3.4;
    c.strokeStyle = '#9aa6b4';
    c.strokeText('R.V.R', 44, H*0.50);
    c.fillStyle = '#1667cf';
    c.fillText('R.V.R', 44, H*0.50);
    /* 蓝色下划线 + 末端圆点 */
    c.strokeStyle = '#1667cf'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(46, H*0.50 + 46); c.lineTo(330, H*0.50 + 46); c.stroke();
    c.beginPath(); c.arc(344, H*0.50 + 46, 7, 0, 6.29); c.fillStyle = '#1667cf'; c.fill();
    /* 副标：银色小字（纯英文） */
    c.font = 'bold 26px Arial'; c.fillStyle = '#5d6874';
    c.fillText('ELETTRONICA', 48, H*0.50 - 54);
    /* 右侧：型号与蓝色标签块 */
    c.textAlign = 'right';
    c.font = 'bold 30px Arial'; c.fillStyle = '#2c3340';
    c.fillText('FM STEREO', 986, H*0.34);
    c.font = 'bold 30px Arial'; c.fillStyle = '#37424e';
    c.fillText('TRANSMITTER 200W', 986, H*0.66);
    c.fillStyle = '#1667cf'; c.fillRect(986-186, H*0.79, 186, 12);

    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    /* 贴在前脸左上角：2U 面板高 89mm，上面 30mm 让给 LOGO，
       高度取 26.8mm、宽 145.2mm，正好压不到下方 频率/功率 显示窗 */
    const logoH = 0.0268, logoW = logoH * 1024 / H;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(logoW, logoH),
      new THREE.MeshStandardMaterial({ map:tex, roughness:0.30, metalness:0.75 }));
    mesh.position.set(-0.2413 + 0.012 + logoW/2, cy + 0.0294, cz + 0.0022);
    parent.add(mesh);
    this.txLogoMesh = mesh;
    this.reg(mesh, 'tx-logo', '发射机品牌铭牌 R.V.R',
      '发射机前面板左上角的品牌铭牌：银色铝质拉丝底 + 蓝色「R.V.R ELETTRONICA」丝印，' +
      '右上角为 FM STEREO TRANSMITTER 200W 型号标注。','general');
    return mesh;
  }

  /* ---- 发射机前脸：频率（约 88.3，随调谐微动）+ 功率 + 电平柱 + 旋钮 ----
     频率与功率不是死值：发射机工作时频率会在 88.3 附近轻微漂动、
     功率/电平柱会随音频起伏，让孪生"活"起来（见 animate()）
     ------------------------------------------------------------------ */
  buildTxFace(parent, cx, cy, cz, w, h){
    /* 画布宽高比严格跟 2U 面板一致（482.6 × 89mm），贴上去不会被拉高 */
    const cv=document.createElement('canvas'); cv.width=1024; cv.height=Math.round(1024*h/w);
    const H = cv.height;
    const c=cv.getContext('2d');
    const g=c.createLinearGradient(0,0,0,H);
    g.addColorStop(0,'#4a535c'); g.addColorStop(.45,'#39414a'); g.addColorStop(1,'#2b323a');
    c.fillStyle=g; c.fillRect(0,0,1024,H);
    this.txFaceH = H;
    /* 频率显示窗（左，给顶部 LOGO 让位 → 从 y=64 开始） */
    c.fillStyle='#05080c'; c.fillRect(30,64,300,80);
    c.strokeStyle='#6d7883'; c.lineWidth=3; c.strokeRect(30,64,300,80);
    /* 功率显示窗（中） */
    c.fillStyle='#05080c'; c.fillRect(346,64,232,80);
    c.strokeStyle='#6d7883'; c.strokeRect(346,64,232,80);
    /* ---- 左右声道电平表：两条【竖直并排】的音柱 L | R，各 13 段 ----
       未解码（无音频输入）时不显示；解码锁定后才点亮（见 drawTxFace）  */
    this.txBarBox  = { x: 630, y: 10, w: 62, bottom: H - 22 };   /* 电平表外框 */
    this.txBarArea = { x: 638, y: 30, w: 46, bottom: H - 26 };   /* 两条音柱的活动区 */
    this.txBarsL = []; this.txBarsR = [];
    const bars = 13;
    const colW = 18, segGap = 2.4;
    const top = this.txBarArea.y, bot = this.txBarArea.bottom;
    const segH = ((bot - top) - (bars-1)*segGap) / bars;
    for(let i=0;i<bars;i++){
      const y  = bot - (i+1)*segH - i*segGap;
      const xL = this.txBarArea.x;             /* 左列 L */
      const xR = this.txBarArea.x + colW + 10; /* 右列 R，竖直并排 */
      this.txBarsL.push({x:xL, y, w:colW, h:segH, base:i});
      this.txBarsR.push({x:xR, y, w:colW, h:segH, base:i});
    }
    /* 标注：纯英文（非中文界面） */
    c.fillStyle='#8b97a3'; c.font='bold 20px Arial'; c.textAlign='left';
    c.fillText('200W FM STEREO TRANSMITTER', 30, H-30);
    c.font='bold 17px Arial'; c.fillStyle='#6f7a86';
    c.fillText('R.V.R. ELETTRONICA', 30, H-8);
    /* 旋钮 */
    for(let i=0;i<3;i++){
      c.fillStyle='#20262d'; c.beginPath(); c.arc(876+i*50, H*0.42, 21, 0, 6.29); c.fill();
      c.strokeStyle='#6d7883'; c.lineWidth=3; c.stroke();
      c.fillStyle='#c8d2dc'; c.fillRect(876+i*50-3, H*0.42-18, 6, 12);
      c.fillStyle='#8b97a3'; c.font='bold 14px Arial'; c.textAlign='center';
      c.fillText(['PWR','AUDIO','METER'][i], 876+i*50, H*0.42+34);
    }
    /* 电源/告警灯 */
    c.fillStyle='#39d98a'; c.beginPath(); c.arc(988,H*0.26,7,0,6.29); c.fill();
    c.fillStyle='#d8443c'; c.beginPath(); c.arc(988,H*0.62,7,0,6.29); c.fill();
    c.fillStyle='#8b97a3'; c.font='bold 14px Arial'; c.textAlign='left';
    c.fillText('ON', 1002, H*0.26+4); c.fillText('FAULT', 1002, H*0.62+4);

    const tex=new THREE.CanvasTexture(cv); tex.colorSpace=THREE.SRGBColorSpace;
    this.txFaceTex = tex; this.txFaceCtx = c;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshStandardMaterial({map:tex, roughness:0.55, metalness:0.35}));
    m.position.set(cx,cy,cz); parent.add(m);
    this.txFaceMesh = m;
    /* 左/右声道输入状态：由两根卡侬线（AD1200 M1L / M1R）决定 */
    this.txInL = true; this.txInR = true;
    /* 画一次初值 */
    this.drawTxFace(88.30, 0.62, 0.58);
    return m;
  }

  /* 在发射机前脸上重绘 频率（带末位漂动）与 功率/电平 */
  drawTxFace(freq, level, levelR){
    const c = this.txFaceCtx; if(!c) return;
    const L = Math.max(0, Math.min(1, level==null?0:level));
    const R = Math.max(0, Math.min(1, levelR==null? L : levelR));
    const H = this.txFaceH || 189;
    /* 频率窗 */
    c.save();
    c.fillStyle='#05080c'; c.fillRect(32,66,296,76);
    c.fillStyle='#ff8c1a'; c.font='bold 56px Consolas,monospace';
    c.textBaseline='middle'; c.textAlign='center';
    c.fillText(freq.toFixed(2), 168, 104);
    c.fillStyle='#3a2a14'; c.font='bold 17px Consolas,monospace';
    c.fillText('MHz', 270, 138);
    c.restore();
    /* 功率窗 */
    c.save();
    c.fillStyle='#05080c'; c.fillRect(348,66,228,76);
    const pwr = 168 + level*30;                       /* 168 ~ 198W 之间浮动 */
    c.fillStyle='#7fe0b6'; c.font='bold 46px Consolas,monospace';
    c.textBaseline='middle'; c.textAlign='center';
    c.fillText(pwr.toFixed(0), 436, 102);
    c.fillStyle='#3a5a4a'; c.font='bold 16px Consolas,monospace';
    c.fillText('W OUT', 508, 134);
    c.fillStyle= pwr>192 ? '#f5b942':'#39d98a'; c.font='bold 14px Arial';
    c.fillText(pwr>192?'NEAR FULL':'RATED', 438, 134);
    c.restore();
    /* 电平表：L / R 两条竖直音柱并排。level=0（未解码/无输入）时整块不显示 */
    c.save();
    const barsL = this.txBarsL || [], barsR = this.txBarsR || [];
    const box = this.txBarBox || {x:588,y:54};
    const decoding = (L > 0.001 || R > 0.001);
    /* 表头 + 外框 */
    c.fillStyle='#05080c'; c.fillRect(box.x, box.y, box.w, box.bottom - box.y);
    c.strokeStyle = decoding ? '#6d7883' : '#2c343d';
    c.lineWidth = 2; c.strokeRect(box.x, box.y, box.w, box.bottom - box.y);
    c.textAlign='center'; c.font='bold 13px Arial';
    c.fillStyle = decoding ? '#8fd0ff' : '#3c454f';
    c.fillText('L', (barsL[0]? barsL[0].x : box.x) + 9, box.y + 20);
    c.fillStyle = decoding ? '#ff8f8a' : '#3c454f';
    c.fillText('R', (barsR[0]? barsR[0].x : box.x) + 9, box.y + 20);
    /* 两条音柱：解码锁定后才点亮 */
    const paint = (bars, k)=>{
      const lit = decoding ? Math.round(1 + k*(bars.length-1)) : 0;
      bars.forEach(b=>{
        const on = b.base < lit;
        c.fillStyle = on ? (b.base<8? '#39d98a' : (b.base<11? '#f5b942':'#d8443c')) : '#12171d';
        c.fillRect(b.x, b.y, b.w, b.h);
      });
    };
    paint(barsL, L); paint(barsR, R);
    /* 未解码提示（纯英文） */
    c.textAlign='center'; c.font='bold 13px Arial';
    c.fillStyle='#5a646f';
    c.fillText(decoding ? 'AUDIO LEVEL' : 'NO DECODE', box.x + box.w/2, box.bottom + 16);
    c.restore();
    if(this.txFaceTex) this.txFaceTex.needsUpdate = true;
  }

  /* ---- 左右声道输入（音柱）状态：某一侧卡侬断开，对应音柱归零 ----
     供教学演示“只有左声道 / 只有右声道 / 左右都有”的差别 */
  setTxInput(side, on){
    if(side === 'L') this.txInL = !!on;
    else if(side === 'R') this.txInR = !!on;
    return side === 'L' ? this.txInL : this.txInR;
  }

  /* ---- 发射机 250W 功放模块：装在【后面板】，2 个卡侬（XLR）音频输入 ----
     卡侬线从 AD1200 背板输出接口过来，接到这里；前面板只做指示与操作
     ------------------------------------------------------------------ */
  buildTxAmplifier(parent, cy, backZ){
    const matZinc = new THREE.MeshStandardMaterial({color:0xc2c9d1, roughness:0.38, metalness:0.90});
    const matCore = new THREE.MeshStandardMaterial({color:0x9aa3ac, roughness:0.36, metalness:0.92});
    const dark    = new THREE.MeshStandardMaterial({color:0x14181d, roughness:0.85});

    /* 模块底板：贴在后面板左侧音频输入区 */
    const panelW = 0.1820, panelH = 0.0800, panelCx = -0.1220;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(panelW, panelH, 0.0060), matZinc);
    panel.position.set(panelCx, cy, backZ - 0.0040);
    panel.castShadow = panel.receiveShadow = true; parent.add(panel);

    /* 2 个卡侬（XLR）音频输入母座：音频从这里进发射机（后面板） */
    const PA_L = { x: panelCx - 0.0380, y: cy + 0.0070, z: backZ - 0.0072 };
    const PA_R = { x: panelCx + 0.0060, y: cy + 0.0070, z: backZ - 0.0072 };
    this.paInPos = { L: PA_L, R: PA_R };
    [
      { p:PA_L, side:'L', ch:'M1L', t:'左声道 L', color:0x3f8fd6, ink:'#8fd0ff' },
      { p:PA_R, side:'R', ch:'M1R', t:'右声道 R', color:0xd8443c, ink:'#ff8f8a' },
    ].forEach(({p,side,ch,t,color,ink})=>{
      /* 母座外壳：从后面板向机柜后方伸出，便于背视图看到卡侬线 */
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.0074,0.0074,0.0110,26), matZinc);
      shell.rotation.x = Math.PI/2; shell.position.set(p.x, p.y, p.z - 0.0045);
      shell.castShadow = true; parent.add(shell);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0084,0.0084,0.0019,26), matCore);
      collar.rotation.x = Math.PI/2; collar.position.set(p.x, p.y, p.z + 0.0006); parent.add(collar);
      /* 3 孔母座 */
      [-1,0,1].forEach(k=>{
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.00090,0.00090,0.0060,10), dark);
        hole.rotation.x = Math.PI/2;
        hole.position.set(p.x + k*0.0021, p.y + (k===0?0.0018:0), p.z - 0.0038);
        parent.add(hole);
      });
      /* 声道色环：蓝 = L，红 = R */
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.0090,0.0110,32),
        new THREE.MeshStandardMaterial({color, roughness:0.4, metalness:0.3,
          emissive:color, emissiveIntensity:0.35, side:THREE.DoubleSide}));
      ring.position.set(p.x, p.y, p.z + 0.0019); parent.add(ring);
      this.buildPrintText(parent, 'XLR IN '+side, p.x, p.y - 0.0140, p.z + 0.0004, 0.0180, 0.24);
      this.reg(shell, 'tx-in-'+side, `发射机功放 · 卡侬输入 ${t}（XLR 母座，后面板）`,
        `250W 功放模块上的${t}卡侬（XLR 三芯）音频输入母座，位于【发射机后面板】。` +
        `由 AD1200 背板对应输出接口用一根卡侬线接过来。${side==='L'?'左声道接口带蓝色环':'右声道接口带红色环'}。`,'port');
    });

    /* 模块丝印 */
    const namePlate = new THREE.Mesh(new THREE.PlaneGeometry(0.1420, 0.0130),
      new THREE.MeshStandardMaterial({color:0x0d1218, roughness:0.7, metalness:0.2}));
    namePlate.position.set(panelCx, cy + 0.0330, backZ - 0.0068);
    namePlate.rotation.y = Math.PI; parent.add(namePlate);
    const np = this.buildPrintText(parent, '250W PA MODULE · XLR IN x2', panelCx, cy + 0.0330, backZ - 0.0070, 0.1680, 0.13);
    np.rotation.y = Math.PI;
    const ip = this.buildPrintText(parent, 'L / R AUDIO IN', panelCx, cy - 0.0300, backZ - 0.0070, 0.1100, 0.16);
    ip.rotation.y = Math.PI;
    /* 功放指示灯 */
    [['ON',0x39d98a,0.0620],['DRV',0xf5b942,0.0780]].forEach(([txt,col,dx])=>{
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.0022,14),
        new THREE.MeshStandardMaterial({color:0x0b0e12, emissive:col, emissiveIntensity:1.6}));
      led.position.set(panelCx + dx, cy + 0.0250, backZ - 0.0072); led.rotation.y = Math.PI; parent.add(led);
      const t1 = this.buildPrintText(parent, txt, panelCx + dx, cy + 0.0340, backZ - 0.0072, 0.0100, 0.26);
      t1.rotation.y = Math.PI;
    });
  }

  /* ---- 交换机面板（标准 24 口 GE 交换机丝印：铭牌 + 端口 + 指示灯 ----
     教学用：交换机 VLAN 已设置完成，学员不用碰它，面板只做“标准样式”，
     不再堆一堆说明文字。端口明细放到鼠标悬停提示里。
     ------------------------------------------------------------------ */
  buildSwitchFace(parent, cx, cy, cz, w, h){
    const cv=document.createElement('canvas'); cv.width=1024; cv.height=192;
    const c=cv.getContext('2d');
    /* 2U 机箱底色 */
    const g=c.createLinearGradient(0,0,0,192);
    g.addColorStop(0,'#2c333b'); g.addColorStop(.5,'#232a31'); g.addColorStop(1,'#1a2027');
    c.fillStyle=g; c.fillRect(0,0,1024,192);

    c.textBaseline='middle'; c.textAlign='left';
    /* 左侧铭牌：品牌 + 型号（标准丝印，不加解释文字） */
    c.fillStyle='#e6eef7'; c.font='bold 34px Arial';
    c.fillText('SWITCH', 24, 52);
    c.fillStyle='#9aa7b4'; c.font='bold 20px Arial';
    c.fillText('24GE · 2U', 24, 88);
    /* 电源/系统指示灯（左上角，与实机一致） */
    const led=(x,y,col,txt)=>{
      c.fillStyle=col; c.beginPath(); c.arc(x,y,6,0,6.29); c.fill();
      c.fillStyle='#8f9caa'; c.font='bold 14px Arial';
      c.fillText(txt, x+12, y+1);
    };
    led(30, 132, '#39d98a', 'PWR');
    led(30, 160, '#39c7ff', 'SYS');

    /* 24 个千兆口：上下两排，标准 2U 交换机前面板样式 */
    const cols=12, pw=52, ph=40, gapX=12, gapY=14;
    const x0=232, y0=34;
    for(let i=0;i<cols;i++){
      const x=x0+i*(pw+gapX);
      /* 上排 1~12 口 */
      c.fillStyle='#0b0e12'; c.fillRect(x,y0,pw,ph);
      c.strokeStyle='#67717c'; c.lineWidth=2; c.strokeRect(x,y0,pw,ph);
      /* 每个口上方两颗链路/速率灯（标准布局） */
      c.fillStyle='#39d98a'; c.fillRect(x+8,y0-9,8,6);
      c.fillStyle='#f5b942'; c.fillRect(x+pw-16,y0-9,8,6);
      c.fillStyle='#8f9caa'; c.font='bold 15px Arial'; c.textAlign='center';
      c.fillText(String(i+1), x+pw/2, y0+ph+14);
      /* 下排 13~24 口 */
      const y1=y0+ph+gapY+22;
      c.fillStyle='#0b0e12'; c.fillRect(x,y1,pw,ph);
      c.strokeStyle='#67717c'; c.strokeRect(x,y1,pw,ph);
      c.fillStyle='#39d98a'; c.fillRect(x+8,y1-9,8,6);
      c.fillStyle='#f5b942'; c.fillRect(x+pw-16,y1-9,8,6);
      c.fillStyle='#8f9caa'; c.fillText(String(i+13), x+pw/2, y1+ph+14);
      c.textAlign='left';
    }

    const tx=new THREE.CanvasTexture(cv); tx.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshStandardMaterial({map:tx, roughness:0.6, metalness:0.3}));
    m.position.set(cx,cy,cz); parent.add(m);
    this.swFace = m;
    /* 上排 1 口（AD1200 NET）、2 口（运维电脑）的实际坐标，供布网线用 */
    const px = x => (x/1024 - 0.5) * w;
    const py = y => (0.5 - y/192) * h;
    this.swPort1 = { x: cx + px(x0 + 0*(pw+gapX) + pw/2), y: cy + py(y0+ph/2), z: cz + 0.0025 };
    this.swPort2 = { x: cx + px(x0 + 1*(pw+gapX) + pw/2), y: cy + py(y0+ph/2), z: cz + 0.0025 };
    return m;
  }

  /* ---- 线缆：AC 220V 电源线 / ASI 输入 / 交换机网线 / 3 路输出卡侬线 ---- */
  buildCabling(parent){
    const zB = -0.154;
    const dark  = new THREE.MeshStandardMaterial({color:0x1a1f25, roughness:0.7, metalness:0.15});
    const metal = new THREE.MeshStandardMaterial({color:0xb9bfc7, roughness:0.32, metalness:0.9});

    /* 1) AC 220V 电源线（IEC C13 插头 + 三芯线） */
    const P = this.pwrPos || {x:0.156, y:0, z:zB};
    const plug = this.mesh(new THREE.BoxGeometry(0.026,0.023,0.022), dark, P.x, P.y, P.z-0.011);
    parent.add(plug);
    const pcord = this.mesh(new THREE.CylinderGeometry(0.0055,0.0062,0.012,14), dark, P.x, P.y, P.z-0.028);
    pcord.rotation.x = Math.PI/2; parent.add(pcord);
    this.reg(plug,'power-cord','AC 220V 电源线（IEC C13）',
      '三芯电源线，从机柜 PDU 取 AC 220V / 50Hz 市电送入本机；上电后前面板 Power 灯常亮。','port');
    parent.add(this.cable([
      [P.x, P.y, P.z-0.034],[P.x+0.012, P.y-0.020, P.z-0.100],[P.x+0.030,-0.085, P.z-0.220],
      [P.x+0.040,-0.190, P.z-0.340],[P.x+0.055,-0.222,-0.640]
    ], 0.0048, 0x14181d));

    /* 2) ASI 输入同轴线（BNC） */
    const A = this.asiInPos || {x:-0.2065, y:0.0095, z:zB};
    const bnc = this.mesh(new THREE.CylinderGeometry(0.0080,0.0086,0.018,18), metal, A.x, A.y, A.z-0.012);
    bnc.rotation.x = Math.PI/2; parent.add(bnc);
    this.reg(bnc,'asi-cable','ASI 输入同轴线（BNC）',
      '上一级 ASI 码流（270Mb/s）经这根同轴电缆从 ASI IN 进入本机，作为 IP 组播信源之外的第二备份信源。','port');
    parent.add(this.cable([
      [A.x, A.y, A.z-0.024],[A.x-0.022, A.y-0.012, A.z-0.100],[A.x-0.040,-0.085, A.z-0.230],
      [A.x-0.050,-0.190, A.z-0.350],[A.x-0.060,-0.222,-0.620]
    ], 0.0038, 0x1c2229));

    /* 3) 网线：上级交换机【后面板 VLAN30 业务口】 → 本机【背板 NET 口】
         —— 两端都在机柜后侧，走线短、写实，也不再绕到前面挡面板 */
    const N  = this.netPortPos || {x:0.068, y:0, z:zB};
    const SWP = this.swBizPort || { x:0.062, y:this.swCY-0.004, z:this.swBackZ };
    const rjMat = new THREE.MeshStandardMaterial({color:0x2f6fb5, roughness:0.55, metalness:0.1});
    const bootMat = new THREE.MeshStandardMaterial({color:0x24405c, roughness:0.7, metalness:0.1});
    /* 交换机侧 RJ45 水晶头（向机柜后方伸出） */
    const swPlug = this.mesh(new THREE.BoxGeometry(0.0105,0.0080,0.022), rjMat, SWP.x, SWP.y, SWP.z - 0.013);
    parent.add(swPlug);
    const swBoot = this.mesh(new THREE.BoxGeometry(0.0098,0.0074,0.014), bootMat, SWP.x, SWP.y, SWP.z - 0.030);
    parent.add(swBoot);
    this.netCableParts = [swPlug, swBoot];
    this.reg(swPlug,'net-cable-sw','网线 · 交换机侧（后面板业务口）',
      '超五类网线插在【上级交换机后面板的业务口】上（交换机 VLAN 已设置完成，接好线即可）。' +
      '这根线就在机柜后侧往下走到本机背板的 NET 口，是最短、最贴近现场的一种走法。','port');
    /* 本机侧 RJ45 水晶头 */
    const netPlug = this.mesh(new THREE.BoxGeometry(0.0105,0.0080,0.022), rjMat, N.x, N.y, N.z - 0.013);
    parent.add(netPlug);
    const netBoot = this.mesh(new THREE.BoxGeometry(0.0098,0.0074,0.014), bootMat, N.x, N.y, N.z - 0.030);
    parent.add(netBoot);
    this.netCableParts.push(netPlug, netBoot);
    this.reg(netPlug,'net-cable','网线 · 本机侧（背板 NET 口）',
      '超五类网线：上级交换机后面板业务口 → 本机背板唯一的 RJ45 网口（NET）。' +
      'IP 组播码流与 WEB 后台访问都走这根线，本机只要与它在同一网段即可。','port');
    /* 走线：交换机后面板业务口 → 贴着机柜右侧后方下行 → 本机背板 NET 口
       （两根设备都只占 1U/2U，中间留了 24mm 缝，线从缝侧绕过去，不遮正面） */
    const netTube = this.cable([
      [SWP.x, SWP.y, SWP.z - 0.036],
      [SWP.x + 0.010, SWP.y - 0.014, SWP.z - 0.056],
      [0.196, SWP.y - 0.026, -0.196],            /* 往右后方收 */
      [0.232, (SWP.y + N.y)/2 + 0.014, -0.222],  /* 贴右立柱后侧下行 */
      [0.226, N.y + 0.026, -0.216],
      [0.150, N.y + 0.010, -0.206],              /* 到本机背板高度 */
      [N.x + 0.026, N.y + 0.002, -0.192],
      [N.x + 0.006, N.y + 0.001, N.z - 0.052],
      [N.x, N.y, N.z - 0.036]                    /* 插进本机 NET 口 */
    ], 0.0034, 0x2f6fb5, 96);
    this.netTube = netTube;
    this.reg(netTube, 'net-cable-run', '机柜内网线（交换机 → AD1200）',
      '上级交换机后面板业务口 → 本机背板 NET 口的这一段网线。' +
      '运维电脑配上同网段 IP 并 ping 通之后，这根线会亮起来，表示业务链路已经通了。','port');
    parent.add(netTube);

    /* 4) 3 路输出音频线：每路左右声道各一根卡侬（XLR）线 */
    const BOOT = { L:0x2f6fb5, R:0xc0392b };
    ['M1L','M1R','M2L','M2R','M3L','M3R'].forEach((ch,i)=>{
      const p = (this.outJackPos||{})[ch]; if(!p) return;
      const side = ch.slice(2);
      parent.add(this.xlrPlug(p, BOOT[side], ch));
      parent.add(this.cable([
        [p.x, p.y, p.z-0.058],[p.x, p.y-0.012, p.z-0.105],[p.x, -0.070, p.z-0.205],
        [p.x*0.85+0.030, -0.190, p.z-0.340],[p.x*0.75+0.060, -0.222, -0.600 - i*0.018]
      ], 0.0028, 0x161b21));
    });

    /* 5) 2 根卡侬线：AD1200 背板输出 → 发射机后面板 250W 功放模块 XLR 输入
         （M1L → 发射机 L，M1R → 发射机 R；即解码模块1 的左右声道直送发射机）
         两台设备都在机柜后侧，卡侬线就在背板之间短距离连接，写实且不遮正面 */
    const LINK = [
      { ch:'M1L', side:'L', to:this.paInPos?.L, boot:0x2f6fb5 },
      { ch:'M1R', side:'R', to:this.paInPos?.R, boot:0xc0392b },
    ];
    LINK.forEach(({ch, side, to, boot}, i)=>{
      const p = (this.outJackPos||{})[ch]; if(!p || !to) return;
      /* 发射机侧卡侬头（公头，插进功放母座）：插头体朝向机柜后方（-z） */
      const g = this.xlrPlug({ x:to.x, y:to.y, z:to.z - 0.0060 }, boot, ch);
      parent.add(g);
      /* 走线：本机背板输出 → 往下越过机柜间隙 → 绕到发射机后面板卡侬母座 */
      parent.add(this.cable([
        [p.x, p.y, p.z - 0.062],                        /* 出本机背板输出接口 */
        [p.x - 0.016 - i*0.006, p.y - 0.016, p.z - 0.104],
        [to.x + 0.052 - i*0.008, -0.036, -0.196],       /* 机柜后侧下行，两根错开 */
        [to.x + 0.030 - i*0.004, to.y + 0.022, -0.206],
        [to.x + 0.010, to.y + 0.008 - i*0.004, to.z - 0.086],
        [to.x, to.y, to.z - 0.038]                      /* 插进发射机后面板卡侬母座 */
      ], 0.0030, i===0?0x2f6fb5:0xc0392b, 110));
      const tube = this.parts[this.parts.length-1];
      this.reg(tube, 'tx-link-'+ch,
        `卡侬线 ${i+1}/2：AD1200 ${ch} → 发射机${side==='L'?'左':'右'}声道`,
        `一根卡侬（XLR 三芯平衡）线：本机背板 ${ch} 输出接口 → 发射机【后面板】250W 功放模块的 ` +
        `${side==='L'?'L（蓝环）':'R（红环）'} 输入母座。两根卡侬线把解码模块1 的左右声道直送发射机，` +
        `发射机调制后由 RF OUT 上天馈。`,'port');
    });
  }

  /* ---- 数码管段建模 ---- */
  buildSegments(parent, cx, cy, cz){
    /* 数码管窗口中心与 z，供像素点阵字体显示面片对齐（整窗铺满显示） */
    this.segCenterX = cx; this.segCenterY = cy; this.segZ = cz + 0.0009;
    this.segParent = parent;
    const segW = 0.0064, segH = 0.0115, gap = 0.0019;
    const digitCount = 8;
    const totalW = digitCount*segW + (digitCount-1)*gap;
    const startX = cx - totalW/2 + segW/2;
    this.segCols = [];
    this.segMatOn  = this.emissivePlane(0,0,0xff8c1a,2.35);
    this.segMatOff = this.emissivePlane(0,0,0x2a1608,0.28);
    const t = 0.00125;   // 段厚
    for(let d=0; d<digitCount; d++){
      const col = [];
      const ox = startX + d*(segW+gap);
      const add = (w,h,dx,dy)=>{
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), this.segMatOff.clone());
        m.position.set(ox+dx, cy+dy, cz);
        m.userData.onColor=0xff8c1a; m.userData.offColor=0x2a1608;
        parent.add(m); col.push(m); this.segments.push(m);
      };
      // a 上
      add(segW, t, 0, segH/2 - t/2);
      // b 右上
      add(t, segH/2 - t, segW/2 - t/2, segH/4 - t/4);
      // c 右下
      add(t, segH/2 - t, segW/2 - t/2, -segH/4 + t/4);
      // d 下
      add(segW, t, 0, -segH/2 + t/2);
      // e 左下
      add(t, segH/2 - t, -segW/2 + t/2, -segH/4 + t/4);
      // f 左上
      add(t, segH/2 - t, -segW/2 + t/2, segH/4 - t/4);
      // g 中
      add(segW - t*2, t, 0, 0);
      // 小数点
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.0011,0.0011), this.segMatOff.clone());
      dot.position.set(ox+segW/2+0.0009, cy-segH/2+t/2, cz);
      dot.userData.onColor=0xff8c1a; dot.userData.offColor=0x2a1608; dot.userData.isDot=true;
      parent.add(dot); col.push(dot); this.segments.push(dot);
      this.segCols.push(col);
    }
  }

  /* ---- 通用文字丝印（CanvasTexture） ---- */
  buildPrintText(parent, text, cx, cy, cz, matOrW, aspect){
    const cv=document.createElement('canvas'); cv.width=512; cv.height=128;
    const c2=cv.getContext('2d'); c2.clearRect(0,0,512,128);
    c2.fillStyle='#3c4650'; c2.font='bold 62px Arial';
    c2.textAlign='center'; c2.textBaseline='middle';
    c2.fillText(text, 256, 68);
    const tx=new THREE.CanvasTexture(cv); tx.colorSpace=THREE.SRGBColorSpace;
    const w = (typeof matOrW === 'number'? matOrW : 0.018);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w, w*(aspect||0.25)),
      new THREE.MeshStandardMaterial({map:tx, transparent:true, roughness:0.7}));
    m.position.set(cx,cy,cz); parent.add(m); return m;
  }

  /* ---- 厂商 LOGO 丝印（环路网科技 / Circloop） ---- */
  buildVendorLogo(parent, cx, cy, cz){
    const cv=document.createElement('canvas'); cv.width=512; cv.height=160;
    const c2=cv.getContext('2d'); c2.clearRect(0,0,512,160);
    c2.fillStyle='#2f3842';
    c2.font='bold 62px "Microsoft YaHei",Arial';
    c2.textAlign='center'; c2.textBaseline='middle';
    c2.fillText('环路网科技', 256, 52);
    c2.font='bold 40px Arial';
    c2.fillText('Circloop', 256, 118);
    const tx=new THREE.CanvasTexture(cv); tx.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(0.036, 0.0112),
      new THREE.MeshStandardMaterial({map:tx, transparent:true, roughness:0.6, metalness:0.3}));
    m.position.set(cx,cy,cz); parent.add(m); return m;
  }

  /* ---- 前面板丝印（用 CanvasTexture 绘制中文/英文标识） ---- */
  buildFacePrint(parent, cx, cy, cz){
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 96;
    const g2 = cv.getContext('2d');
    g2.clearRect(0,0,cv.width,cv.height);
    g2.fillStyle = '#3c4650';
    g2.font = 'bold 46px "Microsoft YaHei",Arial';
    g2.textAlign='center'; g2.textBaseline='middle';
    g2.fillText('AD 音频解码器', cv.width/2, cv.height/2 - 4);
    g2.font = 'bold 30px Arial';
    g2.fillText('CIRCLOOP', 130, cv.height/2 - 4);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({map:tex, transparent:true, roughness:0.62, metalness:0.3});
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.135, 0.0127), mat);
    m.position.set(cx, cy, cz); parent.add(m);
  }

  /* ---- 背板建模 ----
     按现场宣讲口径还原：
       · 三块解码板卡（解码模块1 / 2 / 3），每块板卡负责一路节目的解码输出
       · 三块板卡 = 三路音频输出，每一路都分左右声道：
         1 路（模块1）= L / R 两个三芯（3 口）接口
         2 路（模块2）= L / R 两个三芯（3 口）接口
         3 路（模块3）= L / R 两个三芯（3 口）接口
         左声道用蓝色环、右声道用红色环区分，接口为圆柱形三芯插座
       · 面板最左 ASI 输入/输出 BNC，中部右侧为唯一的 RJ45 网口，
         最右为 AC 电源、开关、接地柱
     --------------------------------- */
  buildBackPanel(parent, W, H, BZ){
    const matBack = new THREE.MeshStandardMaterial({color:0xa8b0b8, roughness:0.5, metalness:0.72});
    const face = this.mesh(new THREE.BoxGeometry(W, H, 0.0035), matBack, 0, 0, BZ-0.0018);
    parent.add(face);
    this.reg(face,'backplane','设备背板',
      '1U 背板。左侧为 ASI 输入/输出 BNC；中部是三块解码板卡（解码模块1/2/3），三块板卡对应三路音频输出，' +
      '每一路都分左右声道，各配 2 个圆柱形三芯（3 口）接口（共 6 个：蓝环为左声道 L，红环为右声道 R）；' +
      '板卡右侧是本机唯一的 RJ45 网口（NET）；最右为 AC 100-240V 电源插座、电源开关与接地柱。','general');

    const zB = BZ-0.0040;   /* 背板外侧（机箱外） */
    const dark  = new THREE.MeshStandardMaterial({color:0x14181d, roughness:0.8});
    const metal = new THREE.MeshStandardMaterial({color:0x9aa2ab, roughness:0.34, metalness:0.9});
    const printMat = new THREE.MeshStandardMaterial({color:0x0d1014, roughness:0.5, metalness:0.4});
    const boardMat = new THREE.MeshStandardMaterial({color:0x1d5a3a, roughness:0.62, metalness:0.28});
    const shieldMat = new THREE.MeshStandardMaterial({color:0xb6bdc6, roughness:0.42, metalness:0.82});

    /* 通用丝印：z 可指定，默认贴在背板外表面（zB 再往外 0.3mm） */
    const mk = (txt, w, x, y, color='#0b0e12', px=34, z=zB-0.0003)=>{
      const cv=document.createElement('canvas'); cv.width=256; cv.height=64;
      const c2=cv.getContext('2d'); c2.clearRect(0,0,256,64);
      c2.fillStyle=color; c2.font=`bold ${px}px Arial`; c2.textAlign='center'; c2.textBaseline='middle';
      c2.fillText(txt,128,34);
      const tx=new THREE.CanvasTexture(cv); tx.colorSpace=THREE.SRGBColorSpace;
      const m=new THREE.Mesh(new THREE.PlaneGeometry(w,w*0.25),
        new THREE.MeshStandardMaterial({map:tx,transparent:true,roughness:0.6}));
      m.position.set(x,y,z); parent.add(m); return m;
    };
    const Z_SHIELD = zB-0.0010;   /* 板卡屏蔽罩表面 */
    const Z_PCB    = zB-0.0020;   /* 板卡 PCB 表面   */

    /* ================= 左：ASI 输入/输出 BNC ================= */
    const bncXY = [[-0.2065,0.0095],[-0.2065,-0.0095]];
    bncXY.forEach(([x,y],i)=>{
      const outer = this.mesh(new THREE.CylinderGeometry(0.0072,0.0072,0.0052,24), metal, x, y, zB);
      outer.rotation.x = Math.PI/2; parent.add(outer);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.0021,0.0021,0.0060,16), dark);
      inner.rotation.x = Math.PI/2; inner.position.set(x,y,zB-0.0012); parent.add(inner);
      const sq = this.mesh(new THREE.BoxGeometry(0.021,0.0170,0.004),
        new THREE.MeshStandardMaterial({color:0x2b323a, roughness:0.6, metalness:0.5}), x, y, zB+0.0022);
      parent.add(sq);
      this.reg(outer, i===0?'asi-in':'asi-out',
        i===0?'ASI IN（BNC 输入）':'ASI OUT（BNC 输出）',
        i===0 ? 'ASI 输入口：接收 270Mb/s 的 ASI 码流，作为 IP 之外的第二备份信源。'
              : 'ASI 输出口：把解码后或转发的 ASI 码流输出至下一级设备。','port');
      if(i===0) this.asiInPos = { x, y, z:zB };
      mk(i===0?'ASI IN':'ASI OUT', i===0?0.019:0.023, x, i===0?0.0195:-0.0195);
    });
    mk('ASI', 0.012, -0.2065, 0.0000, '#0b0e12', 30);

    /* ================= 中：三块解码板卡 + 六路输出接口 =================
       三块板卡 = 三路音频输出，每一路都分左右声道：
         板卡 1（解码模块1 · IP 组播） → 1 路输出：L（蓝环）+ R（红环）
         板卡 2（解码模块2 · ASI）    → 2 路输出：L（蓝环）+ R（红环）
         板卡 3（解码模块3 · E1）     → 3 路输出：L（蓝环）+ R（红环）
       接口统一为圆柱形三芯（3 口）插座，左声道蓝环、右声道红环
       ------------------------------------------------------------ */
    this.boardCards = [];
    const BOARD_X = [-0.135, -0.076, -0.017];      /* 模块3 / 模块2 / 模块1 */
    const BOARD_META = [
      { id:3, label:'解码模块3', sub:'E1 输入' },
      { id:2, label:'解码模块2', sub:'ASI 输入' },
      { id:1, label:'解码模块1', sub:'IP 组播输入' },
    ];
    const JACK_Y = -0.0080, JACK_DX = 0.0165;
    const BOARDS = BOARD_META.map((m,i)=>({
      ...m, x: BOARD_X[i], y: 0.0,
      out:[
        { ch:'M'+m.id+'L', side:'L', x: BOARD_X[i] - JACK_DX, y: JACK_Y,
          t:`解码模块${m.id} 左声道 L`, s:`${m.id} 路输出` },
        { ch:'M'+m.id+'R', side:'R', x: BOARD_X[i] + JACK_DX, y: JACK_Y,
          t:`解码模块${m.id} 右声道 R`, s:`${m.id} 路输出` },
      ],
    }));
    /* 左右声道配色：L 蓝 / R 红 */
    const SIDE_COLOR = { L:0x3f8fd6, R:0xd8443c };
    const SIDE_INK   = { L:'#8fd0ff', R:'#ff8f8a' };

    BOARDS.forEach(b=>{
      /* 板卡本体（绿色 PCB + 金属屏蔽罩） */
      const bMat = new THREE.MeshStandardMaterial({color:0x1d5a3a, roughness:0.62, metalness:0.28,
        emissive:0x000000, emissiveIntensity:0});
      const board = this.mesh(new THREE.BoxGeometry(0.0520,0.0280,0.0055), bMat, b.x, -0.0015, zB+0.0012);
      parent.add(board);
      const shield = this.mesh(new THREE.BoxGeometry(0.0540,0.0075,0.0040), shieldMat, b.x, 0.0165, zB+0.0014);
      parent.add(shield);
      /* 板卡固定螺钉 */
      [-0.0265,0.0265].forEach(dx=>{
        const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0022,0.0022,0.0016,12), metal);
        sc.rotation.x = Math.PI/2; sc.position.set(b.x+dx, 0.0165, zB-0.0014); parent.add(sc);
      });
      this.reg(board, 'board'+b.id, `板卡 · ${b.label}`,
        `第 ${b.id} 块解码板卡（插入机箱第 ${b.id} 槽位），输入方式：${b.sub}。` +
        `板卡解出一路节目的音频，从本板的两个三芯接口送出左、右声道。`,'general');
      mk(b.label, 0.040, b.x, 0.0165, '#0b0e12', 30, Z_SHIELD);
      mk(b.sub,   0.030, b.x, -0.0185, '#20303a', 24, Z_PCB);

      /* 该板卡对应的左右声道输出接口 */
      b.out.forEach(o=>{
        const jackMat = new THREE.MeshStandardMaterial({color:0x9aa2ab, roughness:0.34, metalness:0.9,
          emissive:0x000000, emissiveIntensity:0});
        /* 圆柱形三芯插座（向机箱外伸出） */
        const jack = this.mesh(new THREE.CylinderGeometry(0.0060,0.0060,0.0090,26), jackMat, o.x, o.y, zB-0.0020);
        jack.rotation.x = Math.PI/2; parent.add(jack);
        const collar = this.mesh(new THREE.CylinderGeometry(0.0068,0.0068,0.0016,26), jackMat, o.x, o.y, zB-0.0016);
        collar.rotation.x = Math.PI/2; parent.add(collar);
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0031,0.0031,0.0040,16), dark);
        hole.rotation.x = Math.PI/2; hole.position.set(o.x,o.y,zB-0.0052); parent.add(hole);
        /* 3 个针脚，直观体现“3 口接口” */
        [-1,0,1].forEach(k=>{
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.00075,0.00075,0.0070,8),
            new THREE.MeshStandardMaterial({color:0xd8b25a, roughness:0.3, metalness:0.95}));
          pin.rotation.x = Math.PI/2;
          pin.position.set(o.x + k*0.0019, o.y + (k===0?0.0015:0), zB-0.0046);
          parent.add(pin);
        });
        /* 声道色环：左蓝 / 右红，一眼区分 */
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.0072,0.0090,32),
          new THREE.MeshStandardMaterial({color:SIDE_COLOR[o.side], roughness:0.4, metalness:0.3,
            emissive:SIDE_COLOR[o.side], emissiveIntensity:0.35, side:THREE.DoubleSide}));
        ring.position.set(o.x, o.y, zB-0.0068); parent.add(ring);
        /* 记录接口坐标，供线缆建模使用 */
        (this.outJackPos = this.outJackPos||{})[o.ch] = { x:o.x, y:o.y, z:zB };
        this.reg(jack, 'out-'+o.ch, o.t,
          `背板上的圆柱形三芯（3 口）输出接口。${o.s}，` +
          `${o.side==='L'?'左声道 L（蓝色环）':'右声道 R（红色环）'}。点击即可把该通道选为试听输出。`,'outport');
        /* 丝印紧贴接口：L / R（与色环同色） */
        mk(o.side, 0.0090, o.x, o.y + 0.0115, SIDE_INK[o.side], 34, Z_PCB);
      });
    });

    /* ================= 中右：本机唯一的 RJ45 网口（NET） ================= */
    const netX = 0.0680;
    const netShell = this.mesh(new THREE.BoxGeometry(0.0172,0.0140,0.0060),
      new THREE.MeshStandardMaterial({color:0x333b44, roughness:0.48, metalness:0.72}), netX, 0.0, zB-0.0030);
    parent.add(netShell);
    const netSlot = new THREE.Mesh(new THREE.PlaneGeometry(0.0128,0.0090),
      new THREE.MeshStandardMaterial({color:0x0b0e12, roughness:0.95}));
    netSlot.position.set(netX, 0.0, zB-0.0061); netSlot.rotation.y = Math.PI; parent.add(netSlot);
    /* 网口状态灯（上下各一） */
    [-1,1].forEach(k=>{
      const nled = new THREE.Mesh(new THREE.CircleGeometry(0.0011,10),
        new THREE.MeshStandardMaterial({color:0x101418, emissive:0x123018, emissiveIntensity:0.9}));
      nled.position.set(netX + 0.0060, k*0.0040, zB-0.0063);
      parent.add(nled);
      (this.netLeds = this.netLeds||[]).push(nled);
    });
    this.netPortPos = { x:netX, y:0.0, z:zB };
    mk('NET', 0.018, netX, 0.0110, '#0b0e12', 30);
    mk('RJ45', 0.014, netX, -0.0120, '#28343e', 24);
    this.reg(netShell, 'rj45-net', 'NET 网口（RJ45，本机唯一网口）',
      '本机唯一的以太网口，位于背板。电脑浏览器经此口访问 WEB 后台（管理地址 192.168.1.150，账号 dtv / 123），' +
      'IP 组播码流也从该口进入；同时提供 SNMP Trap 上报。','port');

    /* ================= 右：电源插座 + 开关 + 接地柱 ================= */
    const pwrX = 0.1560;
    const pwr = this.mesh(new THREE.BoxGeometry(0.036,0.0275,0.0062),
      new THREE.MeshStandardMaterial({color:0x1a1f25, roughness:0.7, metalness:0.3}), pwrX, 0, zB+0.0024);
    parent.add(pwr);
    [0.0060,0.0000,-0.0060].forEach(dy=>{
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0016,0.0058,0.0032), metal);
      pin.position.set(pwrX, dy, zB-0.0004); parent.add(pin);
    });
    this.pwrPos = { x:pwrX, y:0.0, z:zB };
    this.reg(pwr,'power-in','AC 220V 电源输入插座',
      '标准 IEC 320-C14 三芯电源插座，本机由机柜 PDU 送入 AC 220V / 50Hz 市电（宽压设计 100–240V），' +
      '要求 10A 以上电源线并可靠接地。','port');

    const sw = this.mesh(new THREE.BoxGeometry(0.011,0.018,0.0082),
      new THREE.MeshStandardMaterial({color:0x2b323a, roughness:0.5, metalness:0.5}), 0.1930, 0.000, zB+0.0026);
    parent.add(sw);
    this.reg(sw,'power-sw','电源开关 I/O','船型电源开关，按下“ I ”通电，前面板 Power 灯亮。','button');

    const gnd = this.mesh(new THREE.CylinderGeometry(0.0042,0.0042,0.0058,18), metal, 0.2170, -0.0090, zB);
    gnd.rotation.x = Math.PI/2; parent.add(gnd);
    this.reg(gnd,'gnd','接地柱','机箱保护接地柱（⏚），必须与机架地排连接。','port');

    mk('AC 220V', 0.026, pwrX, 0.0180);
    mk('POWER', 0.019, 0.1930, 0.0145);
    mk('GND', 0.014, 0.2170, -0.0180);
  }

  /* ---------------- 数码管驱动 ----------------
     面板是 8 位窗口，传进来的短内容（如 3 位的 192 / 168）左侧对齐显示，
     其余位熄灭，效果与实机“一屏只显示 3 位数字”一致。            */
  setDisplay(str, dotPositions=[]){
    /* ===== 像素字体（点阵）显示 =====
       旧版用“七段码字形表”拼字符，菜单名（IP ADD / MCAST IP …）里没有的
       字母只能整格熄灭，导致“看着像显示不全”。
       现在改为把整行文字按【像素点阵字体】渲染进一张 Canvas 纹理，
       贴到数码管窗口上：数字、大小写字母、IP 里的点都能完整显示，
       且窗口多宽都能整行自适应铺开，不再掉字。
       ------------------------------------------------------ */
    const raw = String(str||'');
    this.displayText = raw;
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 256;
    const c = cv.getContext('2d');
    c.clearRect(0,0,cv.width,cv.height);

    /* 像素字体：自绘 5×7 点阵，放大后为方块像素，风格与实机数码管一致 */
    const chars = [...raw];
    if(chars.length){
      const GW = 5, GH = 7, GAP = 1;               /* 每字符 5×7 + 1 列间距 */
      const totalCols = chars.length*(GW+GAP) - GAP;
      /* 按窗口宽度自适应像素大小：字符多就画小一点，保证整行都放进窗口 */
      const dot = Math.max(3, Math.min(16, Math.floor((cv.width-24)/Math.max(1,totalCols))));
      const W = totalCols*dot, H = GH*dot;
      const x0 = Math.round((cv.width - W)/2), y0 = Math.round((cv.height - H)/2);
      /* 熄灭的点阵底纹（未点亮的“暗段”），与实机面板一致 */
      c.fillStyle = 'rgba(255,140,26,0.085)';
      chars.forEach((ch,i)=>{
        if(ch === ' ') return;
        const gx = x0 + i*(GW+GAP)*dot;
        for(let r=0;r<GH;r++) for(let k=0;k<GW;k++)
          c.fillRect(gx + k*dot + 1, y0 + r*dot + 1, dot-2, dot-2);
      });
      /* 点亮的像素 */
      c.fillStyle = '#ff9a2e';
      c.shadowColor = 'rgba(255,140,20,0.95)'; c.shadowBlur = 9;
      chars.forEach((ch,i)=>{
        const g = PIXFONT[ch] || PIXFONT[String(ch).toUpperCase()] || PIXFONT['?'];
        if(!g) return;
        const gx = x0 + i*(GW+GAP)*dot;
        for(let r=0;r<GH;r++){
          const row = g[r];
          for(let k=0;k<GW;k++) if(row[k] === '1') c.fillRect(gx + k*dot + 1, y0 + r*dot + 1, dot-2, dot-2);
        }
      });
      c.shadowBlur = 0;
    }

    const tex = this.ledTex || (this.ledTex = new THREE.CanvasTexture(cv));
    tex.image = cv; tex.needsUpdate = true; tex.colorSpace = THREE.SRGBColorSpace;
    /* 首次调用时创建显示面片（覆盖整个数码管窗口） */
    if(!this.ledPlane){
      const w = 0.0640, h = 0.0172;
      const mat = new THREE.MeshBasicMaterial({map:tex, transparent:true, depthWrite:false});
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), mat);
      m.position.set(this.segCenterX || 0, this.segCenterY || 0, this.segZ || 0.1562);
      this.ledPlane = m;
      (this.segParent || this.root || this.scene).add(m);
      /* 旧版单独建模的七段码只保留为“暗底”，避免与新字体重复发亮 */
      if(this.segCols) this.segCols.forEach(col=>col.forEach(seg=>{
        seg.material.emissive.setHex(0x2a1608);
        seg.material.emissiveIntensity = 0.22;
      }));
    }
  }
  setLed(name, on, color){
    const m = this.ledMeshes[name]; if(!m) return;
    const c = color!=null? color : (name==='power'?0x39d98a:0xf5b942);
    m.material.emissive.setHex(on? c : C.ledIdle);
    m.material.emissiveIntensity = on? 2.2 : 0.9;
  }
  /* ---- 输出通道高亮（左右声道 / 三块板卡对应三路输出声音） ---- */
  setChannelState(ch, state){
    /* state: 'off' | 'play' | 'lock' */
    const m = this.parts.find(x => x.userData.part && x.userData.part.id === 'out-'+ch);
    if(!m) return;
    m.userData.press = null;
    const color = state==='lock' ? 0x39d98a : (state==='play' ? 0x39c7ff : 0x000000);
    const emi = m.material.emissive;
    if(emi){
      emi.setHex(color);
      m.material.emissiveIntensity = state==='off' ? 0 : 2.0;
    }
    this.outChannels[ch] = { state, color };
    /* 通道点亮时，板卡丝印区域同步淡亮 */
    const board = this.parts.find(x => x.userData.part && x.userData.part.id === 'board'+ch.slice(1,2));
    if(board && board.material && board.material.emissive){
      board.material.emissive.setHex(state==='off'?0x000000:0x0d3a2a);
      board.material.emissiveIntensity = state==='off'?0:0.9;
    }
  }
  /* ---- 链路状态：idle(未配好) / ready(同网段) / online(ping 通，绿色) ----
     让孪生把“网线连接”这件事直接显示出来：网口灯变绿、网线整根亮起 */
  setLinkState(state){
    this.linkState = state;
    const color = state==='online' ? 0x39d98a : (state==='ready' ? 0x39c7ff : 0x000000);
    if(this.netTube && this.netTube.material){
      this.netTube.material.emissive = new THREE.Color(color);
      this.netTube.material.emissiveIntensity = state==='online' ? 0.85 : (state==='ready' ? 0.35 : 0);
    }
    (this.netCableParts||[]).forEach(m=>{
      if(m.material && m.material.emissive){
        m.material.emissive.setHex(color);
        m.material.emissiveIntensity = state==='off' ? 0 : (state==='online' ? 0.9 : 0.3);
      }
    });
    (this.netLeds||[]).forEach((l,i)=>{
      if(!l.material) return;
      const c = state==='online' ? 0x39d98a : (state==='ready' ? 0xf5b942 : 0x3a1c1c);
      l.material.emissive.setHex(c);
      l.material.emissiveIntensity = state==='online' ? 2.2 : (state==='ready' ? 1.4 : 0.6);
    });
    if(this.swBizPortLed && this.swBizPortLed.material){
      this.swBizPortLed.material.emissive.setHex(color);
      this.swBizPortLed.material.emissiveIntensity = state==='online' ? 1.8 : 0.4;
    }
  }

  /* 全部通道复位 */
  resetChannels(){
    Object.keys(this.outChannels || {}).forEach(ch => this.setChannelState(ch, 'off'));
    this.channelOut = null;
    if(this.parts) this.parts.forEach(m=>{
      if(m.userData.part && m.userData.part.id && m.userData.part.id.startsWith('board')){
        if(m.material && m.material.emissive){ m.material.emissive.setHex(0x000000); m.material.emissiveIntensity = 0; }
      }
    });
  }
  /* 选中某个输出通道作为试听输出 */
  selectChannel(ch){
    this.channelOut = ch;
    Object.keys(this.outChannels || {}).forEach(k => {
      if(k === ch) return;
      if(this.outChannels[k].state !== 'off') this.setChannelState(k, 'off');
    });
    this.setChannelState(ch, 'play');
    return ch;
  }

  flashButton(id, ms=260){
    const m = this.hotspots.find(h=>h.userData.part && h.userData.part.id===id);
    if(!m) return;
    this.pressQueue = this.pressQueue || [];
    const started = performance.now();
    if(!this.pressAnims) this.pressAnims = [];
    m.userData.press = {t: started, ms};
    if(!this.pressAnims.includes(m)) this.pressAnims.push(m);
  }

  /* ---------------- 交互 ---------------- */
  bind(){
    this.ray = new THREE.Raycaster();
    const jitter = 0.0055;   // 非按键类命中补偿（后面板小件）
    const onMove = (e)=>{
      /* 按住后拖动（旋转视角）视为取消，不再触发按键 */
      if(this._pt && !this._drag && Math.hypot(e.clientX-this._pt.x, e.clientY-this._pt.y) > 6){
        this._drag = true;
        this.handlers.release && this.handlers.release(null, e);
      }
      const hit = this.pick(e);
      this.canvas.style.cursor = hit? 'pointer' : 'grab';
      this.highlight(hit);
      if(hit){ this.handlers.hover(hit.userData.part, e); this.showTip(hit, e); }
      else this.hideTip();
    };
    this.canvas.addEventListener('pointermove', onMove);
    this.canvas.addEventListener('pointerdown', (e)=>{
      /* 按下：用于长按类交互（如 Menu 键长按进入菜单） */
      this._pt = {x:e.clientX, y:e.clientY}; this._drag = false;
      const hit = this.pick(e);
      this.handlers.down && this.handlers.down(hit ? hit.userData.part : null, e);
    });
    this.canvas.addEventListener('pointerup', (e)=>{
      const moved = this._pt ? Math.hypot(e.clientX-this._pt.x, e.clientY-this._pt.y) : 0;
      const hit = moved < 6 ? this.pick(e) : null;   /* 拖动过就不算点击 */
      this._pt = null; this._drag = false;
      if(hit) this.handlers.click(hit.userData.part, e);
      this.handlers.release && this.handlers.release(hit ? hit.userData.part : null, e);
    });
    this.canvas.addEventListener('pointerleave', ()=>{
      this.highlight(null); this.hideTip();
      /* 移出画布视为松手，保证长按判定不会卡住 */
      this._pt = null; this._drag = false;
      this.handlers.release && this.handlers.release(null, null);
    });
    const ro = new ResizeObserver(()=>this.resize());
    ro.observe(this.canvas.parentElement);
    this.resize();
  }
  showTip(hit, e){
    const el = document.getElementById('hoverTip');
    if(!el) return;
    const r = this.canvas.getBoundingClientRect();
    el.textContent = hit.userData.part.title;
    el.style.display='block';
    el.style.left = Math.min(r.width-140, e.clientX - r.left + 12) + 'px';
    el.style.top  = (e.clientY - r.top + 12) + 'px';
  }
  hideTip(){ const el=document.getElementById('hoverTip'); if(el) el.style.display='none'; }
  pick(e){
    if(!e || e.clientX==null) return null;
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    this.ray.setFromCamera(p, this.camera);
    /* 发光面片优先级更高 */
    const hot = this.ray.intersectObjects(this.hotspots, false);
    if(hot.length) return hot[0].object;
    const hits = this.ray.intersectObjects(this.parts, false);
    return hits.length? hits[0].object : null;
  }
  highlight(mesh){
    if(this._hl === mesh) return;
    if(this._hl && this._hl.material && this._hl.userData.hotspot){
      const u = this._hl.userData;
      this._hl.material.emissive.setHex(u.baseEmissive);
      this._hl.material.emissiveIntensity = 0.6;
      this._hl.scale.set(1,1,1);
    } else if(this._hl && this._hl.userData.part){
      this._hl.material.emissive && this._hl.material.emissive.setHex(this._hlOrig||0x000000);
    }
    this._hl = mesh;
    if(mesh){
      if(mesh.userData.hotspot){
        mesh.material.emissive.setHex(0x2f7fb8);
        mesh.material.emissiveIntensity = 1.4;
        if(mesh.userData.part.kind!=='button') mesh.scale.set(1.0,1.0,1.0);
      } else if(mesh.material && mesh.material.emissive){
        this._hlOrig = mesh.material.emissive.getHex();
        mesh.material.emissive.setHex(0x1d4a72);
      }
    }
  }

  /* ---------------- 相机视角 ---------------- */
  /* 三台设备上下分层：正视/背视把整机架（含上下两台 2U）都框进来 */
  viewFront(){ this.flyTo(new THREE.Vector3(0, 0.020, 0.92), new THREE.Vector3(0,0.000,0)); }
  viewBack(){  this.flyTo(new THREE.Vector3(0, 0.020,-0.96), new THREE.Vector3(0,0.000,0)); }
  viewIso(){   this.flyTo(new THREE.Vector3(0.46,0.30,0.94), new THREE.Vector3(0,0.000,0)); }
  /* 聚焦数码管：贴近面板最左侧的 8 位数码管窗 */
  viewDisplay(){ this.flyTo(new THREE.Vector3(-0.150,0.014,0.315), new THREE.Vector3(-0.150,0.004,0.150)); }
  /* 放大 / 缩小：沿视线推拉相机，受 min/maxDistance 约束 */
  zoomBy(f){
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const d = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, dir.length()*f));
    dir.setLength(d);
    this.flyTo(this.controls.target.clone().add(dir), this.controls.target.clone(), 240);
    return d;
  }
  /* 适合窗口：按当前容器尺寸和视野角算出刚好容纳整机机箱的距离 */
  fitView(){
    const el = this.canvas.parentElement;
    const w = el.clientWidth||800, h = el.clientHeight||500;
    /* 纵向跨度 = 交换机顶 → 发射机底 */
    const vSpan = (this.rackTop!=null && this.rackBot!=null)
      ? (this.rackTop - this.rackBot + 0.03) : 0.30;
    const span = Math.max(this.W||0.4826, vSpan);
    const fovV = this.camera.fov * D2R;
    const fovH = 2*Math.atan(Math.tan(fovV/2) * (w/h));
    const dist = (span/2) / Math.tan(Math.min(fovV, fovH)/2) * 1.18;
    this.flyTo(new THREE.Vector3(dist*0.34, dist*0.24, dist*0.90), new THREE.Vector3(0, 0.000, 0), 560);
    this.controls.minDistance = Math.max(0.20, dist*0.26);
    this.controls.maxDistance = dist*2.2;
  }
  flyTo(pos, target, ms=520){
    this.tween = {from:this.camera.position.clone(), to:pos,
      tFrom:this.controls.target.clone(), tTo:target, t0:performance.now(), ms};
  }

  resize(){
    const el = this.canvas.parentElement;
    const w = el.clientWidth, h = el.clientHeight;
    if(!w||!h) return;
    this.renderer.setSize(w,h,false);
    this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
  }

  /* ---------------- 渲染循环 ---------------- */
  animate(){
    const loop = ()=>{
      requestAnimationFrame(loop);
      const now = performance.now();
      if(this.tween){
        const k = Math.min(1,(now-this.tween.t0)/this.tween.ms);
        const e = k<0.5 ? 2*k*k : -1+(4-2*k)*k;
        this.camera.position.lerpVectors(this.tween.from, this.tween.to, e);
        this.controls.target.lerpVectors(this.tween.tFrom, this.tween.tTo, e);
        if(k>=1) this.tween=null;
      }
      /* 按键按压回弹 */
      if(this.pressAnims){
        this.pressAnims = this.pressAnims.filter(m=>{
          const p = m.userData.press;
          const k = Math.min(1,(now-p.t)/(p.ms||260));
          const press = Math.sin(Math.PI*k);
          const dz = (m.userData.part.kind==='button'? 0.0018 : 0.0008);
          m.position.z = (m.userData.z0!=null? m.userData.z0 : (m.userData.z0 = m.position.z - 0));
          m.position.z = m.userData.z0 - press*dz;
          if(k>=1){ m.position.z = m.userData.z0; return false; }
          return true;
        });
      }
      /* Work 灯呼吸 */
      if(this.ledMeshes.work && this._workOn){
        const b = 0.75 + 0.55*Math.abs(Math.sin(now/420));
        this.ledMeshes.work.material.emissiveIntensity = b*2.0;
      }
      /* 输出通道：播放中呼吸，锁定后常亮绿 */
      if(this.outChannels){
        Object.entries(this.outChannels).forEach(([ch, st])=>{
          if(!st || st.state === 'off') return;
          const m = this.parts.find(x => x.userData.part && x.userData.part.id === 'out-'+ch);
          if(!m || !m.material.emissive) return;
          if(st.state === 'play'){
            const b = 1.1 + 1.1*Math.abs(Math.sin(now/380));
            m.material.emissiveIntensity = b;
          } else {
            m.material.emissive.setHex(0x39d98a);
            m.material.emissiveIntensity = 2.2;
          }
        });
      }
      /* 发射机散热风扇旋转 */
      if(this.txFan) this.txFan.rotation.z += 0.10;
      /* 发射机前脸：频率在 88.3 附近微动、功率与电平柱随音频起伏 */
      if(this.txFaceCtx){
        this._txTick = (this._txTick||0) + 1;
        if(this._txTick % 12 === 0){
          const t = now/1000;
          const drift = Math.sin(t*0.9)*0.012 + Math.sin(t*2.7)*0.004;   /* ±0.016MHz 轻微漂动 */
          /* 左右声道电平：分别由两根卡侬线（M1L / M1R）决定，可单独点亮/断开 */
          const onL = this.txInL !== false, onR = this.txInR !== false;
          const base = this._txAudio ? 0.30 : 0;
          const lvL = onL ? Math.min(1, base + 0.46*Math.abs(Math.sin(t*1.6))       + 0.12*Math.abs(Math.sin(t*5.1))) : 0;
          const lvR = onR ? Math.min(1, base + 0.46*Math.abs(Math.sin(t*1.6+0.9))   + 0.12*Math.abs(Math.sin(t*4.3+1.7))) : 0;
          this.drawTxFace(88.30 + drift, lvL, lvR);
        }
      }
      /* 交换机面板：轻微呼吸，避免死板（不再有 VLAN 文字铭牌） */
      if(this.swFace && this.swFace.material){
        const e = 0.55 + 0.18*Math.abs(Math.sin(now/900));
        this.swFace.material.emissive && this.swFace.material.emissive.setHex(0x0a1520);
        this.swFace.material.emissiveIntensity = e;
      }
      /* 网口灯：链路通了快闪表示有数据；未连通时缓慢呼吸 */
      if(this.netLeds && this.linkState !== 'online'){
        this.netLeds.forEach((l,i)=>{
          const t = (now/(460+i*140))%2;
          const on = t < 0.55;
          const base = this.linkState==='ready' ? 0xf5b942 : 0x39d98a;
          l.material.emissive.setHex(on? base : 0x122016);
          l.material.emissiveIntensity = on? 1.5 : 0.3;
        });
      }
      if(this.netLeds && this.linkState === 'online'){
        this.netLeds.forEach((l,i)=>{
          const on = ((now/(300+i*110))%2) < 0.62;
          l.material.emissive.setHex(on? 0x39d98a : 0x122016);
          l.material.emissiveIntensity = on? 2.4 : 0.35;
        });
      }
      if(this.netTube && this.linkState === 'online' && this.netTube.material){
        const b = 0.55 + 0.35*Math.abs(Math.sin(now/700));
        this.netTube.material.emissiveIntensity = b;
      }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
  setWork(on){ this._workOn = on; if(!on) this.setLed('work', false); }
  setSpin(on){ this.controls.autoRotate = on; this.controls.autoRotateSpeed = 1.6; this.spin=on; }
}

/* ============================================================
   像素点阵字体（5×7）：数码管显示专用
   覆盖 0-9、A-Z、点、横线、冒号、斜杠、百分号与空格，
   这样菜单名（IP ADD / MCAST IP / SOFT VER …）与完整 IP、MAC 都能整行显示全
   ============================================================ */
const PIXFONT = {
  '0':['01110','10001','10011','10101','11001','10001','01110'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['01110','10001','00001','00010','00100','01000','11111'],
  '3':['11111','00010','00100','00010','00001','10001','01110'],
  '4':['00010','00110','01010','10010','11111','00010','00010'],
  '5':['11111','10000','11110','00001','00001','10001','01110'],
  '6':['00110','01000','10000','11110','10001','10001','01110'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00010','01100'],
  'A':['01110','10001','10001','11111','10001','10001','10001'],
  'B':['11110','10001','10001','11110','10001','10001','11110'],
  'C':['01110','10001','10000','10000','10000','10001','01110'],
  'D':['11100','10010','10001','10001','10001','10010','11100'],
  'E':['11111','10000','10000','11110','10000','10000','11111'],
  'F':['11111','10000','10000','11110','10000','10000','10000'],
  'G':['01110','10001','10000','10111','10001','10001','01111'],
  'H':['10001','10001','10001','11111','10001','10001','10001'],
  'I':['01110','00100','00100','00100','00100','00100','01110'],
  'J':['00111','00010','00010','00010','00010','10010','01100'],
  'K':['10001','10010','10100','11000','10100','10010','10001'],
  'L':['10000','10000','10000','10000','10000','10000','11111'],
  'M':['10001','11011','10101','10101','10001','10001','10001'],
  'N':['10001','11001','10101','10011','10001','10001','10001'],
  'O':['01110','10001','10001','10001','10001','10001','01110'],
  'P':['11110','10001','10001','11110','10000','10000','10000'],
  'Q':['01110','10001','10001','10001','10101','10010','01101'],
  'R':['11110','10001','10001','11110','10100','10010','10001'],
  'S':['01111','10000','10000','01110','00001','00001','11110'],
  'T':['11111','00100','00100','00100','00100','00100','00100'],
  'U':['10001','10001','10001','10001','10001','10001','01110'],
  'V':['10001','10001','10001','10001','10001','01010','00100'],
  'W':['10001','10001','10001','10101','10101','11011','10001'],
  'X':['10001','10001','01010','00100','01010','10001','10001'],
  'Y':['10001','10001','01010','00100','00100','00100','00100'],
  'Z':['11111','00001','00010','00100','01000','10000','11111'],
  '.':['00000','00000','00000','00000','00000','01100','01100'],
  '-':['00000','00000','00000','11111','00000','00000','00000'],
  '_':['00000','00000','00000','00000','00000','00000','11111'],
  ':':['00000','01100','01100','00000','01100','01100','00000'],
  '/':['00001','00010','00010','00100','01000','01000','10000'],
  '%':['11001','11010','00010','00100','01000','01011','10011'],
  '!':['00100','00100','00100','00100','00100','00000','00100'],
  '?':['01110','10001','00001','00110','00100','00000','00100'],
  ' ':['00000','00000','00000','00000','00000','00000','00000'],
};

/* 局部数字/字母字形 */
const DIGITS = {
  '0':[1,1,1,1,1,1,0],'1':[0,1,1,0,0,0,0],'2':[1,1,0,1,1,0,1],'3':[1,1,1,1,0,0,1],
  '4':[0,1,1,0,0,1,1],'5':[1,0,1,1,0,1,1],'6':[1,0,1,1,1,1,1],'7':[1,1,1,0,0,0,0],
  '8':[1,1,1,1,1,1,1],'9':[1,1,1,1,0,1,1],'-':[0,0,0,0,0,0,1],' ':[0,0,0,0,0,0,0],'_':[0,0,0,1,0,0,0],
};
const ALPHA = {
  'L':[0,0,1,1,1,1,0],'U':[0,1,1,1,1,1,0],'C':[1,0,0,1,1,1,0],'O':[1,1,1,1,1,1,0],
  'n':[0,0,1,0,1,0,0],'d':[0,1,1,1,1,0,1],'i':[0,0,0,0,1,0,0],'p':[1,1,0,0,1,1,1],
  'a':[1,1,0,1,1,0,1],'P':[1,1,0,0,1,1,1],'E':[1,0,0,1,1,1,1],'R':[0,0,0,0,1,0,0],
  'S':[1,0,1,1,0,1,1],'F':[1,0,0,0,1,1,1],'t':[0,0,1,1,1,0,1],'g':[1,1,1,1,0,1,1],
  'o':[0,0,1,1,1,0,0],'u':[0,0,1,1,1,0,0],'e':[1,1,0,1,1,1,1],'r':[0,0,0,0,1,0,0],
  'y':[0,1,1,0,0,1,1],'m':[0,0,0,0,0,0,0],
};
function glyphOfLocal(ch){
  if(DIGITS[ch]) return DIGITS[ch];
  if(ALPHA[ch]) return ALPHA[ch];
  const u = String(ch).toUpperCase();
  return ALPHA[u] || [0,0,0,0,0,0,0];
}
