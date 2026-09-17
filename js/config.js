/* AD1200 教学系统 —— 全局常量与 PDU 模拟数据 */
/* 组播默认参数：
   · 组播源地址不单独设置 —— 默认显示/等于组播地址本身（源过滤使能同样默认 ON）
   · 自动切换（输入源自动倒换）默认保持“自动”，无需学员改动 */
export const MULTICAST = { group: '236.171.30.5', port: '4000', srcEnable: 'ON', srcMode: 'AUTO' };

export const SERVICES = [
  { sid: 101, name: '中国之声',       pcr: 101, audio: 102, bitrate: 128, tone: 262, freq: 'FM 106.2' },
  { sid: 102, name: '音乐之声',       pcr: 111, audio: 112, bitrate: 128, tone: 330, freq: 'FM 90.0'  },
  { sid: 103, name: '经济之声',       pcr: 121, audio: 122, bitrate: 128, tone: 392, freq: 'FM 96.6'  },
  { sid: 104, name: '桂林新闻综合',   pcr: 131, audio: 132, bitrate: 128, tone: 440, freq: 'FM 97.0'  },
  { sid: 105, name: '桂林旅游',       pcr: 141, audio: 142, bitrate: 128, tone: 494, freq: 'FM 96.3'  },
  { sid: 106, name: '发射台测试频率', pcr: 151, audio: 152, bitrate: 128, tone: 523, freq: 'TEST 1k'  },
];

export const PSW = 'AD1200DL';          // 设备各网口的出厂网段位（示例）
export const BOOT_IP = '192.168.1.150'; // 实机数码管读到的 IP
/* 登录账号密码：后台为空（每次打开登录页强制清空，不预填、不记忆） */
export const LOGIN = { user: 'dtv', pass: '123', prefill: '' };

export const STEP_IDS = ['intro', 'sameNet', 'checkIp', 'configPc', 'browse', 'multicast', 'search', 'play', 'api'];
