/**
 * 美代桌宠 · 原型自检脚本
 * 用法：node scripts/check.js        （在项目根目录执行）
 * 覆盖：脚本语法 / DOM 引用 / 多表情结构 / 互动系统 / 动作幅度 / 素材完整性
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
const ok  = (m) => console.log('  \u2713 ' + m);
const bad = (m) => { console.log('  \u2717 ' + m); failed++; };

function idsFor(withEyeClose) {
  const a = [];
  for (let i = 0; i <= 37; i++) a.push(String(i).padStart(2, '0'));
  a.push('99');
  if (withEyeClose) a.push('Eye_Close_01');
  a.push('Idle_01');
  return a;
}

const TARGETS = [
  { file: 'prototype/v2/index.html', ids: idsFor(true),  asset: (id) => 'prototype/v2/assets/full/' + id + '.png' },
  { file: 'prototype/v1/index.html', ids: idsFor(false), asset: (id) => 'prototype/v1/assets/spr/CH0317_spr_' + id + '.png' }
];

console.log('\n=== 美代桌宠原型 · 自检 ===');

for (const t of TARGETS) {
  const html = fs.readFileSync(path.join(ROOT, t.file), 'utf8');
  console.log('\n--- ' + t.file + ' ---');

  // 1. 脚本语法
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const code = scripts.join('\n');
  scripts.forEach((s, i) => {
    if (!s.trim()) return;
    try { new Function(s); ok('脚本#' + (i + 1) + ' 语法通过'); }
    catch (e) { bad('脚本#' + (i + 1) + ' 语法错误 → ' + e.message); }
  });

  // 2. DOM 引用
  const def = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = [...new Set([...html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]))];
  const missing = used.filter((id) => !def.has(id));
  if (missing.length) bad('引用了不存在的 id → ' + missing.join(', '));
  else ok('id 引用一致（定义 ' + def.size + ' 个）');

  // 3. 多表情 + 互动结构
  if (/sprs\s*:\s*\[/.test(code)) ok('多表情结构 sprs 存在');
  else bad('多表情结构 sprs 缺失');
  ['REACT', 'IX_INFO', 'IX_TEST', 'doReaction', 'bindInteract', 'buildReactUI', 'liveReact']
    .forEach((k) => { if (!new RegExp('\\b' + k + '\\b').test(code)) bad('缺少 ' + k); });
  ok('互动系统符号齐备');
  ['reactBtns', 'ixList'].forEach((id) => { if (!def.has(id)) bad('缺少元素 #' + id); });

  // 4. 各动作接线
  const wiring = [
    ['单击递进', /doReaction\('click',\s*clickStreak\)/],
    ['双击',     /doReaction\('dblclick'\)/],
    ['长按',     /doReaction\('longpress'\)/],
    ['拖拽',     /doReaction\('dragstart'\)/],
    ['放下',     /doReaction\('drop'\)/],
    ['悬停',     /doReaction\('hover'\)/]
  ];
  wiring.forEach(([n, re]) => { if (re.test(code)) ok(n + ' 已接线'); else bad(n + ' 未接线'); });

  // 5. 反应优先级 & 轮播互斥
  if (/live\s*\?\s*live\.sprs\[/.test(code)) ok('反应优先于状态表情');
  else bad('反应未覆盖状态表情');
  if (/if\s*\(liveReact\(\)\)\s*return;/.test(code)) ok('轮播与反应互斥');
  else bad('轮播未与反应互斥');
  /* 0.2.7：台本播放/休息期接管差分切换，旧轮播必须让位（仅约束 v2 —— v1 是旧预览壳） */
  if (t.file.includes('/v2/')) {
    if (/if\s*\(scriptSession\)\s*return;/.test(code)) ok('台本会话期间旧轮播抑制');
    else bad('缺「if (scriptSession) return;」—— 台本期间旧轮播仍在跑（掉回默认轮播的根因）');

    // 5b. 0.2.7 台本0 + 互动反应台本化
    ['defaultStateScript', 'stateScriptList', 'restStateScript', 'defaultReactScript',
     'REACT_SCRIPTS', 'cleanScript'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(code)) bad('缺少 ' + k + '（0.2.7 台本化）');
    });
    if (/function stateScriptList[\s\S]*?def\s*=\s*sc[\s\S]*?defaultStateScript\(mode\)/.test(code))
      ok('台本0：存储 def 优先，否则计算默认');
    else bad('stateScriptList 未按「def 优先 + 计算默认」实现');
    if (/line\.text\s*\|\|\s*''/.test(code)) ok('空台词行 = 静默换差分');
    else bad('空台词行语义缺失');
    if (/opts\.kind[\s\S]{0,400}defaultReactScript\(opts\.kind/.test(code))
      ok('互动反应走台本（用户配置优先，内置 REACT 兜底）');
    else bad('doReaction 未台本化');
    if (/restStateScript\(resolveMode\(state\)\)/.test(code))
      ok('互动播完 → 状态台本进安静期');
    else bad('互动播完后未安排状态台本安静期');

    // 5c. 0.2.8：行推进细粒度 + 闲置差分（0.2.12 重写为覆盖层，断言同步更新）
    if (/\},\s*200\)/.test(code)) ok('行推进 200ms 细粒度（短秒数行无空档）');
    else bad('缺 200ms 行推进器（秒数体感不准的根因）');
    ['IDLE_SPRS', 'cleanIdleSprs', 'idleSprsOf', 'IDLE_FAMILY'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(code)) bad('缺少 ' + k + '（0.2.12 闲置差分层）');
    });
    if (/restSprOf|cleanRestSprs|REST_SPR/.test(code)) bad('旧闲置差分符号残留（0.2.12 已重写为覆盖层）');
    else ok('旧 restSprs 符号已清理干净');

    // 5d. 0.2.9：整点台本化 + 重播冷却 + 待办提醒
    ['cleanScriptList', 'cleanReminders',
     'activeReminder', 'checkReminders', 'startReminderScript', 'finishReminder',
     'LAST_CFG', 'persistReminders'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(code)) bad('缺少 ' + k + '（0.2.9）');
    });
    if (/kind:\s*'chime'/.test(code) && /cleanScriptList\(p\.scripts/.test(code))
      ok('整点播报台本化（scripts 走台本引擎，旧字段回落）');
    else bad('playChime 未台本化');
    if (/\{ hour: ss\.hour \}/.test(code)) ok('台本行支持 {hour} 占位符');
    else bad('playScriptLine 缺 {hour} 插值');
    if (/kind === 'reminder' && activeReminder && ss\.rem/.test(code) && /Date\.now\(\) \+ 5000/.test(code))
      ok('提醒 alarm 播完歇 5s 循环重播 / ack 播完结束');
    else bad('提醒播完分支缺失');
    if (/kind === 'click' && activeReminder\.phase === 'alarm'\) startAck\(\)/.test(code))
      ok('单击桌宠 = 提醒确认（alarm → ack）');
    else bad('doReaction 缺提醒确认拦截');
    if (/data-remind/.test(html)) ok('提醒角标（data-remind）');
    else bad('缺提醒视觉标记');
    if (/checkReminders\(\);\s*\/\/ 待办提醒/.test(code)) ok('1s 心跳里做分钟级到点检查');
    else bad('心跳未接 checkReminders');
    /* 0.2.10：整点旧字段仅兜底；0.2.12：restDelayOf 已回归纯重播冷却 */
    if (/function restDelayOf/.test(code) && /return scriptRestMs;/.test(code))
      ok('restDelayOf = 纯重播冷却（闲置差分已脱离休息期）');
    else bad('restDelayOf 语义异常（0.2.12 应只返回 scriptRestMs）');
    /* 0.2.11：隐式台本0 无缝循环 + 休息期静默（截图 bug 根治护栏） */
    if (/def\._virt = 1/.test(code)) ok('隐式台本0 打 _virt 标记（计算默认）');
    else bad('stateScriptList 缺 _virt 标记');
    if (/else if \(ss\.script\._virt\) \{[\s\S]{0,400}ss\.idx = 0;[\s\S]{0,60}playScriptLine\(\)/.test(code))
      ok('隐式台本0 播完无缝循环（不进休息期）');
    else bad('advanceScript 缺 _virt 无缝循环分支');
    if (/hasUserScripts/.test(code)) bad('bubbleSilent 仍依赖 hasUserScripts（0.2.11 已删除该条件）');
    else ok('台本休息期一律静默（不限用户台本）');
    /* 0.2.12/0.2.13：闲置差分覆盖层（完全待机接管，与台本引擎解耦） */
    if (/var quiet = IDLE_FAMILY\.indexOf\(mode\) >= 0 && !activeReminder &&\s*\n\s*!\(scriptSession && scriptSession\.kind\)/.test(code))
      ok('完全待机（quiet）触发条件：闲置族 + 无提醒 + 会话无 kind');
    else bad('render 缺完全待机 quiet 判定');
    if (/var idleOn = quiet && !!idleSprsOf\(mode\)/.test(code))
      ok('覆盖层 = 完全待机 + 配了闲置差分（档位继承）');
    else bad('覆盖层未由 quiet + idleSprsOf 组成');
    if (/idleOn = false;\s*\/\/ 正在说话/.test(code) || /live\.line \|\| !scriptSession \|\| scriptSession\.id !== live\.scriptId/.test(code))
      ok('只有「正在说话 / 预览」让位 —— 存储版台本0 空台词行不再抢显示（0.2.13 闪表情根治）');
    else bad('覆盖层未按「有没有台词」让位');
    if (/idleOn && !idleOverlayOn\) \{[\s\S]{0,200}scriptSession = null;[\s\S]{0,40}react = null;/.test(code))
      ok('进入覆盖层挂起台本引擎（平常待机彻底安静）');
    else bad('覆盖层未挂起台本引擎');
    if (/var bubbleSilent = idleOn \|\|/.test(code))
      ok('覆盖层生效时气泡全程隐藏（完全待机 = 没有台词）');
    else bad('bubbleSilent 缺 idleOn 条件');
    if (/if \(idleOverlayOn\) return;/.test(code))
      ok('7s 轮播让位闲置覆盖层（闲置层自己按 idleSprMs 换图）');
    else bad('轮播 interval 缺覆盖层守卫');
    if (/idleSprMs = \(typeof cfg\.idleSprMs/.test(code))
      ok('idleSprMs 轮播间隔可配置（1–60s，默认 7s）');
    else bad('applyConfig 缺 idleSprMs');
    if (/Object\.keys\(IDLE_SPRS\)\.forEach/.test(code) && /prefetchMapped/.test(code))
      ok('闲置差分图已进预取缓存（直换 src 不闪烁）');
    else bad('prefetchMapped 未覆盖闲置差分');
    if (/legacy\[mode\]|cfg\.restSprs && cfg\.restSprs\[VER\]|\(cfg\.restSprs\)/.test(code))
      ok('旧 restSprs 单值配置自动迁移合并（老师已有配置不丢）');
    else bad('applyConfig 缺旧 restSprs 迁移合并');
    /* 0.2.13：破图根治 + 默认轮播可调 + 预览让位 */
    if (/layerBlink\.removeAttribute\('src'\)/.test(code) && !/layerBlink\.src = \(\(!live/.test(code))
      ok('眨眼层不用时移除 src（空字符串 src = 页面 URL = 破图图标，0.2.13 根治）');
    else bad('layerBlink 仍在设空字符串 src（会闪破图）');
    if (/stateCycleMs = \(typeof cfg\.stateCycleMs/.test(code) && /Math\.round\(stateCycleMs \/ 1000\)/.test(code))
      ok('默认轮播间隔可调（cfg.stateCycleMs → 台本0 行秒数 + 轮播节拍）');
    else bad('默认轮播间隔未接 cfg.stateCycleMs');
    if (/kind: 'preview'/.test(code))
      ok('设置页预览会话带 preview 标记（不被闲置覆盖层抢走）');
    else bad('playPreview 缺 kind 标记');
    if (/Date\.now\(\) < cycleNextAt/.test(code))
      ok('默认轮播按 stateCycleMs 节拍切换（cycleNextAt）');
    else bad('轮播 interval 缺 cycleNextAt 节拍');
    /* 0.2.14：闲置差分档位继承（「时而生效」根治） */
    if (/chain = \['idle_30', 'idle_15', 'idle_5', 'idle'\]/.test(code) &&
        /chain = \['idle_5', 'idle'\]/.test(code))
      ok('闲置差分档位继承：空闲档位没配时沿用更低档/待机');
    else bad('idleSprsOf 缺档位继承链');
    /* 0.2.14：今日消耗积分（桌宠页显示端） */
    ['pillCredits', 'nCredits'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(code)) bad('桌宠页缺 ' + k + '（0.2.14 积分）');
    });
    if (/petHost\.onCredits/.test(code)) ok('桌宠页接 miyo-credits 推送（今日积分）');
    else bad('桌宠页未接 onCredits');
    if (/credits === false/.test(code)) ok('积分胶囊可显隐（pillVisible.credits）');
    else bad('applyPillVisible 缺 credits');
    /* 0.2.15：待机眨眼差分统一为 99（v1 原 11 → 99，与 v2 一致） */
    if (/idle:\s*\{\s*sprs: \['00', '01'\], blink: '99'/.test(code))
      ok('v1 待机眨眼差分 = 99（与 v2 统一）');
    else bad('v1 待机眨眼差分不是 99');
    /* 0.2.16：闲置状态特效（眨眼/摇晃）+ 胶囊文案模板 */
    if (/var IDLE_BLINK/.test(code) && /var IDLE_SWAY/.test(code) && /data-sway/.test(code))
      ok('闲置特效：眨眼/摇晃配置结构与 data-sway 驱动');
    else bad('缺闲置特效（IDLE_BLINK/IDLE_SWAY/data-sway）');
    if (/k-idle-sway-x/.test(code) && /--sway-amp/.test(code) && /--sway-ms/.test(code))
      ok('摇晃 CSS 变量化（方向/幅度/周期可调）');
    else bad('摇晃 CSS 缺变量化');
    if (/blinkPeriodMs \? blinkPeriodMs :/.test(code))
      ok('眨眼间隔配置驱动（cfg.idleBlink.ms）');
    else bad('眨眼间隔未接配置');
    if (/PILL_TEXT_DEF/.test(code) && /splitPillTpl/.test(code) && /tWorkingA/.test(code))
      ok('胶囊文案模板化（cfg.pillText + {n}/{secs}/{scope}）');
    else bad('胶囊文案未模板化');
    if (/hasAttribute\('src'\)/.test(code))
      ok('眨眼条件 = 「有图就眨」（render 决定图层，待机/轮播都恢复眨眼）');
    else bad('scheduleBlink 未改为 hasAttribute 判断');
    /* 0.2.17：单击拆分 8 档 + 呼吸动画 */
    if (/'click' \+ Math\.min\(Math\.max\(1, opts\.streak \|\| 1\), 8\)/.test(code) &&
        /REACT_SCRIPTS\[opts\.kind\] && REACT_SCRIPTS\[opts\.kind\]\.length/.test(code))
      ok('单击拆分：click1–8 独立配置 → 旧 click 配置兜底 → 内置分档');
    else bad('单击拆分链路缺失');
    if (/reactScripts\['click' \+ \(i \+ 1\)\]/.test(code) || /'click' \+ \(i \+ 1\)/.test(code))
      ok('内置台本按 click1–8 暴露（设置页/预览兜底）');
    else bad('buildBuiltins 未按 clickN 暴露');
    if (/var IDLE_BREATHE/.test(code) && /data-breathe/.test(code) && /k-idle-breathe/.test(html))
      ok('呼吸动画：IDLE_BREATHE 配置 + data-breathe 驱动（.layer 层，与摇晃可同开）');
    else bad('缺呼吸动画');
    /* 0.3.1：气泡自定义 + 省内存立绘 + 预取裁剪 */
    if (/· 反应中/.test(code)) bad('气泡仍带「· 反应中」后缀（0.3.1 应移除）');
    else ok('气泡「· 反应中」后缀已移除');
    if (/var LOWMEM/.test(code) && /full_low/.test(code) && /cfg\.lowMem !== false/.test(code))
      ok('省内存立绘：cfg.lowMem 默认开，v2 走 400px 副本（full_low）');
    else bad('省内存立绘逻辑缺失');
    if (/hexToRgba/.test(code) && /--bubble-bg/.test(code) && /--bubble-scale/.test(code) &&
        /--bubble-nmfs/.test(code) && /--bubble-origin/.test(code))
      ok('气泡外观变量化（底色/透明度/边框/颜色字体/整体缩放/相对字号）');
    else bad('气泡外观变量化缺失');
    if (/bubbleName/.test(code)) ok('说话者名字可自定义（cfg.bubble.name）');
    else bad('气泡名字未接配置');
    if (/prefetchMapped\(\);\s*\/\* 0\.3\.1|0\.3\.1 起只预取/.test(code) || /0\.3\.1：预取裁剪后按新模式补齐/.test(code))
      ok('预取裁剪：台本行差分只预取当前模式');
    else bad('prefetchMapped 未按模式裁剪');
    /* 0.3.2：多系列差分包 + 检测开关 + 高度自适应 */
    if (/dirPack/.test(code) && /\.plain/.test(code) && /packsRootUrl/.test(code))
      ok('多系列差分包：packs 目录 + plain 命名 + dirPack 跟踪（0.3.3 统一单值）');
    else bad('多系列差分包逻辑缺失');
    if (/isForeignCharacter\(\)/.test(code) && /map\[lastCfg\.packDefaultId/.test(code))
      ok('角色包缺图仅使用当前角色默认图');
    else bad('缺当前角色缺图回退');
    if (/--sprite-h', target \+ 'px'/.test(code) && /naturalHeight \/ im\.naturalWidth/.test(code))
      ok('立绘高度自适应（按图片比例写 --sprite-h）');
    else bad('缺立绘高度自适应');
    if (/det\.enabled === false/.test(code) && /det\.working === false/.test(code))
      ok('WorkBuddy 检测开关：总开关 + 分类闸门（setState 前置清零）');
    else bad('缺检测开关闸门');
    /* 0.3.3：系列统一单值 + packIds 清单 + 换学生重置 01 */
    if (/lastCfg\.packFileUrl && lastCfg\.packFileUrl\[ver\]/.test(code))
      ok('系列包文件走每差分完整 URL（递归扫描）');
    if (/packIds && lastCfg\.packIds\[VER\]/.test(code) || /lastCfg\.packIds && lastCfg\.packIds\[VER\]/.test(code))
      ok('差分清单随学生切换（idsOf 优先 cfg.packIds）');
    else bad('idsOf 未接 packIds');
    if (/cfg\.packUrl && typeof cfg\.packUrl\.v1/.test(code))
      ok('系列包走主进程解析的 packUrl（外部根 → 内置兜底，便携版/绿色版都支持）');
    else bad('系列包未接 packUrl');
    if (/cfg\.packDefaultId && cfg\.packDefaultId\[VER\] \|\| idsOf\(\)\[0\]/.test(code))
      ok('角色默认映射来自自己的默认或首个差分');
    else bad('缺角色自身默认差分');
    /* 0.3.6：台本合并（v1/v2 统一 v2）+ 胶囊位置/大小 */
    if (/cleanLineMap\(cfg\.lines && cfg\.lines\.v2\)/.test(code) &&
        /cleanReactMap\(cfg\.reacts && cfg\.reacts\.v2, idsOf\(\)\)/.test(code) &&
        /cleanScripts\(cfg\.scripts && cfg\.scripts\.v2, idsOf\(\)\)/.test(code))
      ok('台本合并：v1/v2 统一沿用 v2 份（台词/语音/状态/互动）');
    else bad('台本合并缺失');
    if (/REACT_SCRIPTS_OTHER = REACT_SCRIPTS/.test(code) && /SCRIPTS_OTHER = SCRIPTS/.test(code))
      ok('OTHER 回退指向同一份（合并后无跨版本台本）');
    else bad('OTHER 回退未指向合并份');
    if (/--pill-dx/.test(code) && /--pill-scale/.test(code))
      ok('胶囊位置/大小可调（--pill-dx/--pill-dy/--pill-scale）');
    else bad('缺胶囊位置/大小变量');
    /* 0.3.11：缺号三级回退 + 语音文件夹 */
    if (/ticket !== spriteGeneration \|\| generation !== characterGeneration/.test(code) && /tried\.has/.test(code))
      ok('图片异步加载过滤过期角色回调并避免回退循环');
    else bad('缺图片代数检查或回退循环保护');
    if (/lastCfg\.voiceMap && lastCfg\.voiceMap\[p\]/.test(code) || /lastCfg\.voiceMap/.test(code))
      ok('语音文件夹：纯文件名走 voiceMap（packs/voice，免后缀，仅 ogg）');
    else bad('语音 voiceMap 解析缺失');
    /* 0.3.19：废弃 idle 台词删除 + 气泡静默 */
    if (/旧 idle 默认台词已废弃/.test(code) && /return '';/.test(code))
      ok('废弃 idle 默认台词已删除（空文本气泡静默）');
    else bad('废弃台词未删除');
    if (/lastCfg\.voiceRootUrl/.test(code)) ok('语音 voiceRootUrl 兜底（映射未命中时拼接）');
    else bad('缺 voiceRootUrl 兜底');
  }

  // 6. 动作幅度（本轮再次收敛：位移不得超过 4px）
  const tr = [...html.matchAll(/translateY\(-(\d+(?:\.\d+)?)px\)/g)].map((m) => parseFloat(m[1]));
  if (tr.length && Math.max(...tr) <= 4) ok('位移幅度收敛（' + Math.min(...tr) + '–' + Math.max(...tr) + 'px）');
  else bad('位移幅度异常 → ' + (tr.length ? Math.max(...tr) + 'px' : '未取到'));

  // 7. 素材完整性
  const missF = t.ids.filter((id) => !fs.existsSync(path.join(ROOT, t.asset(id))));
  if (missF.length) bad('缺失素材 → ' + missF.join(', '));
  else ok('素材 ' + t.ids.length + ' 张全部就位');

  // 8. 互动引用的表情必须在素材清单内
  const refs = new Set();
  [...code.matchAll(/sprs:\s*\[([^\]]*)\]/g)].forEach((m) => {
    [...m[1].matchAll(/'([^']+)'/g)].forEach((x) => refs.add(x[1]));
  });
  const out = [...refs].filter((id) => !t.ids.includes(id));
  if (out.length) bad('互动引用了清单外表情 → ' + out.join(', '));
  else ok('互动引用的 ' + refs.size + ' 个表情均在清单内');

  // 8b. 拖动手感 / 宿主交互（本轮修复项，防回归）
  if (/screenOf\(/.test(code) && /screenX/.test(code)) ok('宿主拖动按屏幕坐标求增量（防正反馈漂移）');
  else bad('宿主拖动未使用屏幕坐标');
  if (/\.pet\.dragging\s+\.sprite/.test(html)) ok('拖动时停用摇晃动画');
  else bad('拖动未停用摇晃动画');
  if (/--pet-scale/.test(html)) ok('支持 --pet-scale 缩放');
  else bad('缺少 --pet-scale');
  if (/addEventListener\(\s*'contextmenu'/.test(code) && /petHost\.menu/.test(code)) ok('右键 → 宿主原生菜单');
  else bad('右键菜单未接线');
  if (/function applyConfig/.test(code) && /petHost\.onConfig/.test(code)) ok('宿主配置（映射／大小）可下发');
  else bad('缺少 applyConfig');

  // 8c. 状态链路（待批准 / 仲裁 / 完成态护栏）
  if (/approval:\s*\{/.test(code)) ok('MAP 含 approval 状态');
  else bad('MAP 缺 approval');
  if (/showApproval && s\.approval > 0/.test(code)) ok('resolveMode 优先 approval');
  else bad('resolveMode 未优先处理 approval');
  if (/patch\.rev < lastRev/.test(code)) ok('setState 有 rev 单调闸');
  else bad('setState 缺 rev 闸');
  if (/patch\.justDone === true/.test(code)) ok('完成态优先信主进程 justDone');
  else bad('缺 justDone 处理');
  if (/if \(!HOSTED\)/.test(code) && /if \(HOSTED\) return;/.test(code)) ok('宿主模式关闭开发态通道');
  else bad('宿主模式未关闭 status.json / postMessage');
  {
    const ml = /var MODE_LABEL = \[([\s\S]*?)\];/.exec(code);
    const mlc = ml ? (ml[1].match(/\['/g) || []).length : 0;
    if (mlc >= 6) ok('MODE_LABEL 档位 ' + mlc + ' 项（含 approval / done / error）');
    else bad('MODE_LABEL 档位不足：' + mlc);
  }
  ['pillApproval', 'nApproval'].forEach((id) => { if (!def.has(id)) bad('缺少元素 #' + id); });
  ok('待批准胶囊元素齐备');

  // 9. 对外接口
  [['MiyoPet.setState', /MiyoPet\s*=\s*\{[\s\S]*?setState/],
   ['MiyoPet.react',   /react\s*:\s*doReaction/],
   ['postMessage 监听', /addEventListener\(\s*['"]message['"]/],
   ['status.json 轮询', /fetch\(\s*['"]\.\/status\.json/]].forEach(([n, re]) => {
    if (re.test(code)) ok(n + ' 已实现');
    else bad(n + ' 未找到');
  });
}

/* ---------- 打包脚本：网页端导出 ---------- */
console.log('\n--- scripts/build-exe.js / build-portable.js（网页端导出） ---');
{
  const bx = fs.readFileSync(path.join(ROOT, 'scripts', 'build-exe.js'), 'utf8');
  const bp = fs.readFileSync(path.join(ROOT, 'scripts', 'build-portable.js'), 'utf8');
  if (/settings\.html/.test(bx) && /__WEB_VERSION__/.test(bx) && /__WEB_ONLY__/.test(bx))
    ok('build-exe 导出网页端（版本 + WEB_ONLY 注入）');
  else bad('build-exe 缺网页端导出');
  if (/miyo-web/.test(bx) && /full_low/.test(bx)) ok('build-exe 附带 miyo-web 资源副本');
  else bad('build-exe 缺 miyo-web 资源附带');
  if (/settings\.html/.test(bp) && /miyo-web/.test(bp)) ok('build-portable 附带 miyo-web 资源副本');
  else bad('build-portable 缺 miyo-web 资源附带');
  if (/settings\.html/.test(bp) && /__WEB_ONLY__/.test(bp)) ok('build-portable 同步导出网页端（WEB_ONLY）');
  else bad('build-portable 缺网页端导出');
}

/* ---------- 设置窗口 ---------- */
console.log('\n--- prototype/v2/settings.html ---');
{
  const sp = path.join(ROOT, 'prototype', 'v2', 'settings.html');
  if (!fs.existsSync(sp)) bad('设置页缺失');
  else {
    const sh = fs.readFileSync(sp, 'utf8');
    const blocks = [...sh.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    blocks.forEach((s, i) => {
      if (!s.trim()) return;
      try { new Function(s); ok('脚本#' + (i + 1) + ' 语法通过'); }
      catch (e) { bad('脚本语法错误 → ' + e.message); }
    });
    ['getConfig', 'saveConfig', 'resetConfig'].forEach((k) => {
      if (new RegExp('petHost\\.' + k).test(sh)) ok('调用 petHost.' + k);
      else bad('未调用 petHost.' + k);
    });
    ['segMode', 'scale', 'top', 'mapBox', 'gallery'].forEach((id) => {
      if (!new RegExp('\\bid="' + id + '"').test(sh)) bad('设置页缺少 #' + id);
    });
    ok('版本 / 大小 / 置顶 / 映射 / 图库 控件齐备');
    /* 0.2.4/0.2.5：预设 / 音量 / 空闲阈值 控件（台本编辑已并入状态块，不再有独立 #scriptBox） */
    ['presetName', 'presetList', 'volume', 'idle5', 'hourOn', 'vScope'].forEach((id) => {
      if (!new RegExp('\\bid="' + id + '"').test(sh)) bad('设置页缺少 #' + id);
    });
    if (!/appendScriptEditor/.test(sh)) bad('设置页缺 appendScriptEditor（台本编辑必须并入状态块）');
    /* 0.2.7：通用台本列表编辑器 + 台本0 + 互动反应台本化；0.2.12：闲置差分编辑器见下方专节 */
    ['appendScriptListEditor', 'defaultScriptSeed', 'reactsRoot'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(sh)) bad('设置页缺 ' + k);
    });
    if (/defMode:\s*true/.test(sh)) ok('状态块启用台本0（defMode）');
    else bad('状态编辑器未启用台本0');
    if (/BUILTINS\.reactScripts/.test(sh)) ok('互动测试可回落内置台本');
    else bad('互动测试未接 BUILTINS.reactScripts');
    if (!/data-rchips|data-rlines|data-rms/.test(sh)) ok('旧互动逐级 UI（chips/lines/ms）已移除');
    else bad('旧互动反应 UI 残留');
    /* 0.2.9：重播冷却 UI + 整点台本编辑 + 待办提醒卡 */
    ['restMs', 'restMsVal', 'hourScriptBox', 'remindBox', 'remindAdd', 'buildReminders',
     'appendReminderEditor'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(sh)) bad('设置页缺 ' + k + '（0.2.9）');
    });
    if (/cfg\.reminders = cfg\.reminders \|\| \[\]|Array\.isArray\(cfg\.reminders\)/.test(sh))
      ok('提醒列表兜底');
    else bad('设置页缺 reminders 兜底');
    /* 0.2.10：整点旧模块（台词/关联表情/语音/差分预览/时长）已并入播报文本 */
    ['hourMs', 'hourLines', 'hourSprs', 'hourVoice', 'hourThumbs'].forEach((id) => {
      if (new RegExp('\\bid="' + id + '"').test(sh)) bad('整点旧模块 #' + id + ' 残留（0.2.10 已并入播报文本）');
    });
    if (/hourScriptBox/.test(sh) && /播报文本/.test(sh)) ok('整点播报已合并为「播报文本」单入口');
    else bad('整点播报合并版式缺失');
    if (/appVer/.test(sh)) ok('设置页显示程序版本（核对新旧包）');
    else bad('设置页缺 appVer 版本显示');
    /* 0.2.12：闲置差分编辑器（只给闲置族状态配，多张轮播） */
    ['IDLE_MODES', 'appendIdleSprRow', 'idleSprsRoot', 'idleSprMs', 'idleSprMsVal',
     'stateCycleMs', 'stateCycleMsVal'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(sh)) bad('设置页缺 ' + k + '（0.2.12 闲置差分）');
    });
    if (/IDLE_MODES\.indexOf\(mode\) >= 0\) \{[\s\S]{0,120}appendIdleSprRow\(mode, item\);[\s\S]{0,80}appendIdleFxRow\(mode, item\);/.test(sh))
      ok('闲置差分 + 眨眼/摇晃编辑器只出现在闲置族状态块');
    else bad('闲置族状态块缺 appendIdleSprRow/appendIdleFxRow');
    ['idleBlinkRoot', 'idleSwayRoot'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(sh)) bad('设置页缺 ' + k + '（0.2.16 闲置特效）');
    });
    if (/txtWorking/.test(sh) && /txtScope/.test(sh) && /cfg\.pillText\[pair\[1\]\]/.test(sh))
      ok('胶囊文案自定义输入框已接（cfg.pillText）');
    else bad('设置页缺胶囊文案输入框');
    /* 0.2.17：单击 1–8 拆分 + 旧格式迁移（不可填入台词的根因）+ 呼吸编辑行 */
    if (/kind: 'click1'/.test(sh) && /kind: 'click8'/.test(sh) && !/kind: 'click',\s+label: '单击'/.test(sh))
      ok('单击已拆成 8 个独立台本（click1–click8 一一对应）');
    else bad('REACT_KINDS 单击拆分缺失');
    if (/function normalizeReactList/.test(sh) && /normalizeReactList\(reactsRoot\(rk\.kind\)\)/.test(sh))
      ok('互动台本旧格式就地迁移（旧配置不再渲染成 0 行台本）');
    else bad('设置页缺 normalizeReactList');
    if (/sc\.lines = sc\.lines \|\| \[\]\)\.push/.test(sh))
      ok('添加一行防崩（lines 缺失时先补数组）');
    else bad('添加一行未做 lines 兜底');
    if (/idleBreatheRoot/.test(sh) && /呼吸起伏/.test(sh))
      ok('呼吸编辑行已接入闲置状态块（幅度%/周期可调）');
    else bad('设置页缺呼吸编辑行');
    /* 0.3.1：气泡设置控件 + 省内存开关 */
    ['bubScale', 'bubNmF', 'bubName', 'bubNmC', 'bubTxC', 'bubBg', 'bubBgA', 'bubBc',
     'bubNmFont', 'bubTxFont', 'lowMem'].forEach((k) => {
      if (!new RegExp('\\b' + k + '\\b').test(sh)) bad('设置页缺 ' + k + '（0.3.1）');
    });
    if (/bindBub\('bubScale'/.test(sh) && /bindBub\('bubNmF'/.test(sh))
      ok('气泡缩放/相对字号滑条已接（bindBub）');
    else bad('气泡缩放滑条未接');
    if (/cfg\.lowMem !== false/.test(sh)) ok('省内存立绘开关已接（cfg.lowMem）');
    else bad('设置页缺 lowMem 开关');
    /* 0.3.2：悬浮保存栏 / 检测开关 / 系列选择 */
    if (/savebar/.test(sh) && /position:fixed; left:14px; bottom:14px/.test(sh) && /appendChild\(el\.save\)/.test(sh))
      ok('保存/恢复默认已移入左下角悬浮栏（fixed，不随滚动消失）');
    else bad('缺悬浮保存栏');
    if (/id="savebar"[\s\S]*?<script>/.test(sh))
      ok('savebar 容器在主脚本之前（脚本初始化时要能取到，0.3.4 修）');
    else bad('savebar 容器在主脚本之后 → el.savebar=null，按钮移不进去');
    if (/el\.savebar && el\.save && el\.reset && el\.status/.test(sh))
      ok('悬浮栏节点移动有判空防御（缺元素不中断 boot）');
    else bad('悬浮栏移动缺判空');
    if (/detEnabled/.test(sh) && /paintDetect/.test(sh) && /detApproval\.disabled/.test(sh))
      ok('检测总开关 + 分类子开关已接（总关 → 子项禁用）');
    else bad('设置页缺检测开关');
    if (/buildSeriesSelects/.test(sh) && /packsList\(\)/.test(sh) && /serSel/.test(sh))
      ok('差分系列下拉已接（v1/v2 统一，packs-list 清单）');
    else bad('设置页缺系列下拉');
    if (/cfg\.packIds && cfg\.packIds\[editVer\]/.test(sh))
      ok('差分清单随学生切换（namesOf 优先 cfg.packIds）');
    else bad('namesOf 未接 packIds');
    if (/packScale/.test(sh)) bad('设置页仍残留 packScale（0.3.5 已取消分套）');
    else ok('缩放倍率已统一（无 packScale 分套）');
    if (/min="0.5" max="5"/.test(sh)) ok('大小滑条范围 0.5–5×');
    else bad('大小滑条范围未调整为 0.5–5×');
    if (/srcG\.urls && srcG\.urls\[id\]/.test(sh)) ok('图库缩略图走每差分完整 URL（0.3.9）');
    else bad('图库缩略图未接 urls');
    /* 0.3.6 */
    if (/gSerSel/.test(sh) && /gallerySource/.test(sh) && /pack\.url/.test(sh.replace(/\n/g, ' ')))
      ok('差分图库支持按系列浏览（gSerSel + 每包 ids/url）');
    else bad('设置页缺图库浏览切换');
    if (/thumb = document\.createElement\('img'\)/.test(sh))
      bad('台本行缩略图仍存在（0.3.6 应移除差分预览）');
    else ok('台本行差分预览缩略图已移除');
    if (/rowIdleText/.test(sh))
      ok('空闲开关行与文案框成对显示/隐藏（错位修复）');
    else bad('缺 rowIdleText');
    if (/pillDx/.test(sh) && /pillSc/.test(sh) && /cfg\.pillPos/.test(sh))
      ok('胶囊位置/大小设置已接（cfg.pillPos）');
    else bad('设置页缺胶囊位置/大小');
    if (/cfg\.scripts\.v2\[mode\] = \[\]/.test(sh) || /cfg\.scripts\.v2\[mode\]/.test(sh))
      ok('台本编辑器统一 v2（不再按版本独立设置）');
    else bad('台本编辑器未统一 v2');
    /* 0.3.11 */
    /* 0.3.15：输入编号 + datalist 建议保留；**闲置差分恢复「选中/输入即添加」**
       （0.3.14 两步交互=添加动作易漏，老师实测「配置了但不生效」的直接原因）。
       ⚠️ 0.3.11/0.3.13 曾两次出现「input+datalist 形态 → 台本/整点模块失效」，
       但 0.3.15 端到端诊断证明失效根因是两步交互漏添加，不是 datalist 本身；
       若失效再现，优先核对悬浮栏版本号与展开台本0 截图。 */
    /* 0.3.16：list 是只读 IDL 属性 —— 严格模式下赋值抛 TypeError 让三个模块
       全灭（0.3.11/0.3.13/0.3.15 三次失效的根因）；必须用 setAttribute */
    if (/sprInp\.list = 'diffIds'/.test(sh)) bad('仍存在 input.list 只读赋值（严格模式抛错）');
    else ok('input.list 改 setAttribute（只读 IDL 修复）');
    if (/window\.addEventListener\('error'/.test(sh) && /unhandledrejection/.test(sh))
      ok('全局错误浮窗（渲染期异常直接显示在悬浮栏）');
    else bad('缺全局错误浮窗');
    if (/sprInp\.addEventListener\('change'/.test(sh) && /R\[mode\]\.indexOf\(v\) < 0\) R\[mode\]\.push\(v\)/.test(sh))
      ok('闲置差分单框：选中/输入即添加（0.3.17）');
    else bad('闲置差分单框缺失');
    if (/function sortDiffIds/.test(sh)) ok('差分数字感知排序（00→20→99→命名）');
    else bad('缺数字感知排序');
    if (/cfg\.voiceMap/.test(sh)) ok('语音试听走 voiceMap（packs/voice 免后缀）');
    else bad('试听未接 voiceMap');
    if (/__galKey/.test(sh)) ok('图库懒加载+条件重建（卡顿修复）');
    else bad('图库未做条件重建');
    if (/预览大图跟随浏览系列/.test(sh)) ok('预览大图跟随浏览系列');
    else bad('预览未接浏览系列');
    if (/el\.savebar\.appendChild\(el\.appVer\)/.test(sh)) ok('版本号常驻悬浮保存栏');
    else bad('版本号未入悬浮栏');
    if (/voice 文件夹/.test(sh)) ok('语音路径提示更新（voice 文件夹）');
    else bad('语音提示未更新');
    /* 0.3.18：网页端导出副本（localStorage 后端） */
    if (/WEB_MODE/.test(sh) && /miyo-web-presets/.test(sh) && /__WEB_VERSION__/.test(sh))
      ok('设置页网页端兼容层（localStorage 配置/预设后端 + 版本占位）');
    else bad('设置页缺网页端兼容层');
    if (/probeWebBase/.test(sh)) ok('网页端资源基址探测（导出副本位置自适应）');
    else bad('缺网页端资源探测');
    /* 0.3.20 */
    if (/miyo-web\//.test(sh) && /cands = \['prototype\/v2\/', 'miyo-web\/', '.\/'\]/.test(sh))
      ok('探针候选含 miyo-web/（便携版网页端资源可达）');
    else bad('探针候选缺 miyo-web/');
    if (/el\.galConnect\.style\.display = ''/.test(sh)) ok('连接按钮显示修复（0.3.19 漏显示）');
    else bad('连接按钮仍未显示');
    if (/pvPane/.test(sh)) ok('预览左列 / 控件右列布局重排');
    else bad('缺双列布局重排');
    /* 0.3.19 */
    if (/pvZoom/.test(sh) && /applyPvTransform/.test(sh)) ok('预览缩放/聚焦控件（pvZoom/pvFx/pvFy）');
    else bad('缺预览缩放聚焦控件');
    if (/galConnect/.test(sh)) ok('网页差分文件夹连接按钮（galConnect）');
    else bad('缺差分文件夹连接按钮');
    if (/body\.host-mode #galleryCard/.test(sh) && /body\.web-only \.card:not\(#galleryCard\)/.test(sh))
      ok('双形态：宿主隐藏图库 / 网页纯差分浏览');
    else bad('缺双形态显隐');
    if (/webGatherPacks/.test(sh)) ok('网页差分文件夹枚举（webGatherPacks，递归 png/jpg）');
    else bad('缺 web 差分枚举');
    if (/var WEB_ONLY = '__WEB_ONLY__' === 'true'/.test(sh)) ok('导出副本差分专用页开关（WEB_ONLY 注入）');
    else bad('缺 WEB_ONLY 开关');
    /* 0.2.14：积分胶囊开关 */
    if (/vCredits/.test(sh) && /bindPill\('vCredits', 'credits'\)/.test(sh))
      ok('设置页「今日积分」显隐开关已接（bindPill credits）');
    else bad('设置页缺 vCredits 积分开关');
    /* 0.2.15：保存后禁止采纳主进程 cfg（编辑器脱钩回归护栏：
       一旦换对象，buildMap 绑定的 chips/台本/整点编辑器全部失联，
       表现为「首次生效、再改无效」） */
    if (/el\.save\.addEventListener[\s\S]{0,600}cfg = r\.config/.test(sh))
      bad('保存后仍采纳 r.config（编辑器脱钩：首次生效、再改无效）');
    else ok('保存后保留本地 cfg 对象（编辑器绑定不脱钩）');
    if (/cfg\.restSprs = \{ v1: \{\}, v2: \{\} \};/.test(sh) && /idleSprs\[v\]\[mode\] = \[old\[mode\]\]/.test(sh))
      ok('旧 restSprs 一次性迁移到 idleSprs（保存后清旧键防复活）');
    else bad('设置页缺 restSprs 迁移');
    ok('预设 / 音量 / 空闲阈值 控件齐备 · 台本编辑已并入状态块');
  }
}

/* ---------- 状态链路模块（scripts/ + electron/） ---------- */
function checkModule(rel, checks) {
  console.log('\n--- ' + rel + ' ---');
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { bad('文件缺失'); return; }
  const src = fs.readFileSync(p, 'utf8').replace(/^#![^\n]*/, '');   // 去掉 shebang（new Function 不认）
  try { new Function(src); ok('语法通过'); }
  catch (e) { bad('语法错误 → ' + e.message); }
  checks.forEach(([name, re]) => {
    if (re.test(src)) ok(name);
    else bad(name + ' 未找到');
  });
}

checkModule('scripts/state-core.js', [
  ['会话判定 resolveCurrentSession', /function resolveCurrentSession/],
  ['心跳新鲜窗口', /FRESH_MS|120000/],
  ['陷阱会话过滤（必须有 tasks 目录）', /hasTasks/],
  ['根目录多级兜底', /CODEBUDDY_CONFIG_DIR/],
  ['容错读 JSON（重试 + BOM + 0 字节）', /readJsonSafe/],
  ['ok / degraded 健康度', /degraded/],
  ['justDone 只在健康快照上置位', /if \(ok && lastScope === snap\.scope && lastActive > 0 && active === 0\)/],
  ['rev 单调（关键投影变化才自增）', /sig !== lastSig/],
  ['历史残留过滤', /dropStale|freshMs/]
]);

checkModule('scripts/approval-status.js', [
  ['needs-approval 识别', /needs-approval/],
  ['已收尾事件识别', /approval-timeout|approval-resolved/],
  ['按 toolCallId 配对', /toolCallId/],
  ['按 requestId 收尾整组', /resolvedReq/],
  ['只读文件尾部', /tailLines/],
  ['TTL 过期保护', /DEFAULT_TTL_MS|ttlMs/]
]);

checkModule('scripts/change-log.js', [
  ['JSONL 追加', /appendFileSync/],
  ['差异判定 diffEntry', /function diffEntry/],
  ['读最近 n 条', /function tail/],
  ['轮转裁剪 prune', /function prune/],
  ['磁盘不可写降级到内存', /log\.mem/]
]);

checkModule('scripts/task-status.js', [
  ['已改为内核兼容层', /require\('\.\/state-core'\)/],
  ['保留旧导出', /module\.exports[\s\S]*snapshot/]
]);

checkModule('electron/platform-paths.js', []);
checkModule('electron/character-packs.js', [
  ['异步统一包发现', /async function discoverPacks/],
  ['差分兼容 png 与 jpg', /jpe\?g/],
  ['原始 spr 命名兼容', /spr_\(\.\+\)/],
  ['深度受限递归扫描', /if \(depth > 3\)/],
  ['中文旧目录生成稳定身份', /'legacy:' \+ encodeURIComponent\(name\)/],
  ['校验真实路径防越界', /fs\.realpath/]
]);
checkModule('electron/config-store.js', [
  ['schema 2 迁移', /function migrateConfig/],
  ['原样备份在解析前', /file\+'\.bak'[\s\S]*JSON\.parse\(bytes/],
  ['串行同目录临时文件原子替换', /previous\.catch[\s\S]*fs\.rename\(temp,key\)/],
  ['保存绑定角色与 revision', /request\.characterId!==config\.activeCharacterId[\s\S]*request\.baseRevision!==config\.revision/]
]);

checkModule('electron/paths.js', [
  ['应用根解析 appRoot', /function appRoot/],
  ['兼容 app-root / 目录版两种布局', /app-root/]
]);

checkModule('electron/main.js', [
  ['引用状态内核', /require\(paths\.stateCore\(\)\)/],
  ['fs.watch 监听', /fs\.watch/],
  ['去抖窗口', /COALESCE_MS/],
  ['兜底轮询', /POLL_MS/],
  ['会话切换重建 watcher', /ensureWatchers/],
  ['变化记录落盘', /changeLog\.createLog/],
  ['历史 IPC', /history-tail/],
  ['统计范围菜单', /统计范围/],
  ['窗口按模式区分', /const WIN_BY_MODE/],
  ['窗口尺寸统一入口 applyWindow', /function applyWindow/],
  ['restSprs 白名单+默认值', /restSprs/],
  ['idleSprs 默认值（0.2.12 闲置差分层）', /idleSprs: \{ v1: \{\}, v2: \{\} \}/],
  ['idleSprMs 默认+clamp', /cfg\.idleSprMs = clampNum\(cfg\.idleSprMs, 1000, 60000/],
  ['stateCycleMs 默认+clamp（0.2.13 默认轮播可调）', /cfg\.stateCycleMs = clampNum\(cfg\.stateCycleMs, 1000, 60000/],
  ['restSprs→idleSprs 迁移', /legacy\[mode\]/],
  ['idleBlink/idleSway 默认（0.2.16 闲置特效）', /idleBlink: \{ v1: \{\}, v2: \{\} \}/],
  ['idleBreathe 默认（0.2.17 呼吸）', /idleBreathe: \{ v1: \{\}, v2: \{\} \}/],
  ['气泡外观默认使用当前角色名称', /name: cfg\.characterLabel \|\| '', scale: 1, nameScale: 1,/],
  ['省内存立绘默认开（0.3.1）', /cfg\.lowMem = cfg\.lowMem !== false/],
  ['检测开关默认（0.3.2）', /detect: \{ enabled: true, approval: true, working: true, pending: true \}/],
  ['差分系列默认单值（0.3.3）', /series: 'miyo',/],
  ['缩放上限 5×（0.3.10）', /MAX_SCALE = 5;/],
  ['便携版外部根（0.3.5）', /PORTABLE_EXECUTABLE_DIR/],
  ['packUrl 从统一角色描述符解析', /cfg\.packUrl\[v\] = fileUrlOfDir\(mode\.rootDir\)/],
  ['语音 voiceRootUrl 兜底（0.3.11/0.3.13）', /cfg\.voiceRootUrl/],
  ['voiceRoot 来自当前角色语音目录', /cfg\.voiceRoot = voiceDirs\.find/],
  ['voiceMap 当前角色免后缀映射', /cfg\.voiceMap\[f\.replace/],
  ['zip 自动解压（0.3.9）', /extractExternalZips/],
  ['当前角色绝对路径统一转标准 URL', /cfg\.packFileUrl\[v\] = Object\.fromEntries[\s\S]*paths\.fileUrlOf\(file\)/],
  ['10× 无屏幕钳制（0.3.9 底部锚定出屏）', /10× 的预期行为/],
  ['包发现只有一个注册表', /packRegistry = await packs\.discoverPacks/],
  ['外部 packs 根（0.3.3 exe 同目录）', /packsRootUrl/],
  ['角色切换使用独立配置并先提交后发布', /store\.switchCharacter[\s\S]*publishConfig\(candidate\)/],
  ['pillPos 默认清洗（0.3.6 胶囊位置/大小）', /cfg\.pillPos\.scale = clampNum/],
  ['整点台本统一 v2（0.3.6）', /cfg\.hourly && cfg\.hourly\.v2/],
  ['packs-list 与加载共享注册表及编号 URL', /for \(const pack of packRegistry\)[\s\S]*ids: Object\.keys\(mode\.sprites\)[\s\S]*urls: Object\.fromEntries/],
  ['packs-list IPC（0.3.2）', /packs-list/],
  ['pillText 字符串清洗（0.2.16 胶囊文案）', /cfg\.pillText\[k\] = cfg\.pillText\[k\]\.slice\(0, 120\)/],
  ['今日积分：miyo-credits 推送（0.2.14）', /send\('miyo-credits'/],
  ['今日积分：sidecar spawn credits-query.js', /credits-query\.js/],
  ['今日积分：Node22 运行时发现', /findCreditsNode/],
  ['今日积分：零点基线账本', /creditsLedger/],
  ['今日积分：页面重载补发', /if \(lastCredits\) send\('miyo-credits'/]
]);

checkModule('scripts/credits-query.js', [
  ['node:sqlite 读取', /node:sqlite/],
  ['session_usage 全表求和', /SELECT credit_json FROM session_usage/],
  ['只读打开（与 WorkBuddy 并存）', /readOnly: true/],
  ['db 路径多级兜底', /CODEBUDDY_CONFIG_DIR/],
  ['单行 JSON 输出', /JSON\.stringify\(\{ ok:/]
]);
/* 透明窗口禁用 setOpacity 的回归护栏（2026-10-12 事故：did-finish-load 里的
   setOpacity(1) 让 Windows 软件渲染下的透明窗口永久停止绘制，整窗全空） */
{
  const mainSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 去块注释
    .replace(/\/\/[^\n]*/g, '');          // 去行注释
  const n = (mainSrc.match(/\bsetOpacity\b/g) || []).length;
  if (n === 0) ok('main.js 代码中无 setOpacity（透明窗口绘制安全）');
  else bad('main.js 代码出现 setOpacity ' + n + ' 次 —— 透明窗口会因此停止绘制，必须移除');
}

checkModule('electron/preload.js', [
  ['推送状态 onState', /on\('miyo-state'/],
  ['读历史 getHistory', /getHistory/],
  ['统计范围 setScope', /setScope/],
  ['今日积分 onCredits（0.2.14）', /on\('miyo-credits', cb\)/],
  ['差分系列 packsList（0.3.2）', /packs-list/]
]);

checkModule('scripts/test-status.js', [
  ['造临时数据树', /mkdtempSync/],
  ['覆盖会话判定', /resolveCurrentSession/],
  ['覆盖防误判', /防误判/],
  ['覆盖权限配对', /readApprovals/]
]);

/* ---------- 跨文件一致性：桌宠宽度基准 ----------
 * 这是「半身模式显示不全」的防回归断言：
 *   窗口尺寸表在 main.js，桌宠宽度在单页 CSS 的 body[data-ver] 两段里，
 *   两处必须对得上，而且桌宠必须真的放得进窗口，否则又会被裁掉。
 */
console.log('\n--- 桌宠宽度基准（main.js ⟷ 单页 data-ver CSS）---');
{
  const mainPath = path.join(ROOT, 'electron', 'main.js');
  const mainSrc = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '';
  const m = /const WIN_BY_MODE = \{([\s\S]*?)\n\};/.exec(mainSrc);
  if (!m) {
    bad('main.js 缺 WIN_BY_MODE');
  } else {
    const table = {};
    [...m[1].matchAll(/(v1|v2):\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+),\s*petW:\s*(\d+)/g)]
      .forEach((x) => { table[x[1]] = { w: +x[2], h: +x[3], petW: +x[4] }; });

    const pagePath = path.join(ROOT, 'prototype', 'v2', 'index.html');
    const pageHtml = fs.readFileSync(pagePath, 'utf8');
    for (const ver of ['v1', 'v2']) {
      const t = table[ver];
      if (!t) { bad('WIN_BY_MODE 缺 ' + ver); continue; }
      const re = new RegExp('body\\[data-ver="' + ver + '"\\]\\{\\s*--pet-w:\\s*(\\d+)px');
      const pw = re.exec(pageHtml);
      if (!pw) bad('单页 CSS 缺 body[data-ver="' + ver + '"] 的 --pet-w');
      else if (+pw[1] !== t.petW) bad(ver + ' 宽度不一致：CSS ' + pw[1] + 'px ≠ main.js ' + t.petW + 'px');
      else ok(ver + ' 桌宠宽度一致（' + pw[1] + 'px）· 窗口基准 ' + t.w + '×' + t.h);

      if (t.petW > t.w - 20) bad(ver + ' 桌宠宽 ' + t.petW + 'px 放不进窗口宽 ' + t.w + 'px（会被裁）');
      else ok(ver + ' 桌宠放得进窗口（' + t.petW + ' ≤ ' + (t.w - 20) + '）');
    }
  }
}

/* ---------- 单页对外接口（硬约束）与新增元素/符号 ----------
 * 0.2.1 起为单页双模式：v1/v2 由同一页承载（body[data-ver] 切换），
 * 15 键 API 天然一致；prototype/v1/index.html 保留为浏览器预览壳，Electron 不加载。
 */
console.log('\n--- 单页对外接口与双模式结构 ---');
{
  const API_BASE = ['setState', 'getState', 'getMode', 'getSpr', 'isHosted', 'setApprovalVisible',
    'setMapping', 'getMapping', 'touch', 'react', 'liveLine', 'reaction'];
  const API_NEW = ['setPillVisible', 'chime', 'playVoice'];
  const pageHtml = fs.readFileSync(path.join(ROOT, 'prototype', 'v2', 'index.html'), 'utf8');

  const m = /window\.MiyoPet = \{([\s\S]*?)\n  \};/.exec(pageHtml);
  if (!m) {
    bad('单页缺 window.MiyoPet 定义');
  } else {
    const keys = [...m[1].matchAll(/^\s{4}([A-Za-z_]\w*)\s*:/gm)].map((x) => x[1]);
    const missApi = API_BASE.concat(API_NEW).filter((k) => keys.indexOf(k) < 0);
    if (missApi.length) bad('缺接口 → ' + missApi.join(', '));
    else ok('基础 ' + API_BASE.length + ' 个 + 新增 ' + API_NEW.length + ' 个接口齐备（共 ' + keys.length + ' 键）');
  }

  const els = [['pillScope', /id="pillScope"/], ['scopeText', /id="scopeText"/],
    ['pillConvs', /id="pillConvs"/], ['nConvs', /id="nConvs"/]];
  const miss = els.filter(([, re]) => !re.test(pageHtml)).map(([n]) => n);
  if (miss.length) bad('缺元素 → ' + miss.join(', '));
  else ok('口径 / 对话数胶囊元素齐备');

  const syms = [['layoutBubble', /function layoutBubble/], ['playChime', /function playChime/],
    ['playVoice', /function playVoice/], ['applyPillVisible', /function applyPillVisible/],
    ['--bubble-w', /--bubble-w/], ['--bubble-tail-x', /--bubble-tail-x/],
    ['CUSTOM_LINES', /CUSTOM_LINES/], ['lineOf', /function lineOf/],
    ['cleanLineMap', /function cleanLineMap/], ['setPillVisible', /setPillVisible/],
    ['VERSETS 版本表', /var VERSETS/], ['MAP 默认表', /var MAP_DEFAULTS/],
    ['版本热切换', /verChanged/], ['预取', /function prefetchMapped/],
    ['fillVars 变量插值', /function fillVars/], ['reacts 清洗', /function cleanReactMap/],
    ['语音播放', /function playVoiceFile/], ['语音路径解析', /function voiceSrc/],
    ['台本清洗', /function cleanScripts/], ['台本引擎', /function startScriptForMode/],
    ['台本行播放', /function playScriptLine/], ['音量', /voiceAudio\.volume = volume/]];
  const missS = syms.filter(([, re]) => !re.test(pageHtml)).map(([n]) => n);
  if (missS.length) bad('缺符号 → ' + missS.join(', '));
  else ok('气泡 / 台词 / 语音 / 整点 / 双模式 符号齐备');

  /* v1 素材路径护栏（0.2.1 事故：写成 ./assets/spr/ 导致切 v1 全部 404、桌宠隐形） */
  {
    const vm = /v1:\s*\{\s*dir:\s*'([^']+)'/.exec(pageHtml);
    if (!vm) bad('单页缺 VERSETS.v1');
    else if (vm[1] === '../v1/assets/spr/') ok('VERSETS.v1 路径正确（../v1/assets/spr/）');
    else bad('VERSETS.v1.dir = "' + vm[1] + '" —— 必须是 ../v1/assets/spr/，否则切 v1 全部 404');
  }

  /* 双模式 CSS 两段都要在 */
  for (const ver of ['v1', 'v2']) {
    if (!new RegExp('body\\[data-ver="' + ver + '"\\]').test(pageHtml)) {
      bad('单页缺 body[data-ver="' + ver + '"] CSS');
    } else if (ver === 'v1') ok('data-v1 CSS 段齐备');
  }
}

console.log('\n=== ' + (failed ? '未通过：' + failed + ' 项异常' : '全部通过 \u2713') + ' ===\n');
process.exit(failed ? 1 : 0);
