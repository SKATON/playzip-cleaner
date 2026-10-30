# PlayZip Cleaner — 点击劫持与广告弹窗根治脚本
🆕 v6新增 4 道防线（叠加 v5 全部功能）
英文浏览器指纹伪装（源头防御）

覆盖 navigator.language / languages / userAgent / Intl 为 en-US
让 loadAds() 认为用户是非中文环境，从源头不注入 abcd.js
createElement 劫持（比 appendChild 更早拦截）

在元素创建阶段标记广告脚本，不等它插入 DOM
90 秒冷却计时器干扰

劫持 setTimeout / setInterval，将 ≥30 秒的延迟压缩为 1-3 秒
让 abcd.js 的冷却逻辑失效，弹窗节奏被打乱
存储层时间戳拦截

拦截广告相关的 localStorage 读写（lastClick / clickTime / adCooldown 等键）
阻止广告脚本通过存储追踪点击历史
✅ 保留 v5 全部防线
注入层路径级拦截（appendChild / insertBefore 重写）
遮罩/弹层清理（#dontfoid 等）
事件层 handleAdClick 拦截
window.open / location 跳转白名单
右下角"已启用"运行徽标

***

> 根治 playzip.com 恶意广告脚本注入与点击劫持（Clickjacking）的纵深防御用户脚本，基于浏览器深度取证开发，三层防线 + 弹窗/跳转兜底，v5 已根除"点击一次后无法继续点击、随后弹出广告页"问题。

**适用网站**：`https://playzip.com/*`、`https://*.playzip.com/*`（含全部子域）
**标签**：`#去广告` `#广告过滤` `#playzip` `#点击劫持` `#弹窗拦截`

***

## 一、脚本简介

PlayZip Cleaner 是一款针对 playzip.com 的**取证驱动型**广告拦截脚本。站点会在 `window.onload` 后动态注入两个恶意脚本实施**点击劫持**与**广告弹窗**，常规黑名单方案无法根治。本脚本通过"注入层 + 特征层 + 事件层"三道防线纵深防御，从源头切断广告链路，同时保持**零权限**（`@grant none`）、对站点业务功能零干扰。

| 项目 | 值 |
| --- | --- |
| 当前版本 | **5.0.0** |
| 运行时机 | `@run-at document-start`（页面解析前介入） |
| 权限要求 | `@grant none`（零权限最小化） |
| 子帧策略 | `@noframes`（仅主页面运行） |
| 兼容环境 | Tampermonkey（Edge / Chrome / Firefox）/ 脚本猫（ScriptCat） |

***

## 二、功能特性

* **第一道防线 · 注入层**：重写 `Element.prototype.appendChild` / `insertBefore`，广告脚本**根本不进入 DOM**，不会加载执行；
* **第二道防线 · 特征层**：通用点击劫持遮罩识别（`fixed/absolute` + z-index ≥ 1000 + 覆盖大面积，不依赖 id/class/透明背景，抗变体）+ 全屏广告 iframe 清理 + MutationObserver 持续监控；
* **第三道防线 · 事件层（v5 新增）**：拒绝广告脚本 `abcd.js` 的 `handleAdClick` 点击监听注册（双世界双保险），即使前两道防线失效也无法劫持点击；
* **window.open 站外弹窗白名单**：站外 URL 一律阻止，站内链接改为当前标签导航，定时防覆盖；
* **location 广告跳转拦截**：拦截 `location.assign` / `replace` / `href` 赋值的广告联盟跳转；
* **捕获阶段点击拦截**：点击遮罩元素立即阻止并移除；广告链接（含脚本化 `click()`）同样拦截；
* **运行确认徽标**：页面右下角绿色 **「PlayZip Cleaner v5 已启用」**，一眼确认脚本生效。

***

## 三、技术路径优势（核心）

### 1\. 取证驱动开发，不靠猜测与穷举

脚本开发前对 playzip.com 进行了**浏览器深度取证**，确认：

* 广告脚本 `aclib.js`（约 639KB）与 `/static/js/abcd.js` **均不在静态 HTML 中**，由 `loadAds()` 在 `window.onload` 后通过 `document.createElement('script')` **动态注入**；
* `aclib.js` 创建 `#dontfoid` 全屏透明遮罩（`znid=11311110`）实施**点击劫持**：覆盖全页接管点击，用户点击被跳转至广告联盟；
* `abcd.js` 对 `navigator.language === 'zh-cn'`（中文）用户监听 `body` 点击，**90 秒冷却期**后 `window.open` 弹广告，广告商按权重从 `t.jopeki.com`、`brimvale.xyz`、`aiyeyu.org`、`23.225.187.244` 选择。

实验验证：阻止这两个脚本后遮罩、劫持、广告请求全部消失，页面功能不受影响 —— 拦截源头即可根治。

### 2\. 注入层根治：广告脚本根本不进入 DOM

重写 `appendChild` / `insertBefore` 在 **DOM 插入层**拦截动态创建的广告 `<script>`。相比"事后用 MutationObserver 删除已插入脚本"的方案，注入层拦截有**根本性优势**：

* 广告脚本**从未加载、从未执行**，不存在"已执行代码带来的副作用"；
* 规避**同步脚本时序竞争**：同步脚本在插入时立即执行，观察者回调根本来不及删除，事后清理天然慢半拍；
* 从源头切断，无需等广告请求发出。

### 3\. 路径级精确拦截，而非域名黑名单穷举

* 广告脚本由 `loadAds()` **硬编码固定路径**：`/aclib.js`、`/static/js/abcd.js`；
* v5 采用**路径级精确拦截**：命中这两个路径的脚本**无论域名一律阻止**；
* 广告商**换域名、换文件名都追得上**（路径不变即被拦截，路径变更也有站外脚本白名单兜底）；
* 黑名单穷举方案则不同：广告域名随时更换，**换域名即失效**，永远慢一步。

### 4\. 三道防线纵深防御

| 防线 | 机制 | 失效兜底 |
| --- | --- | ---- |
| 第一道 | 注入层路径级拦截（`appendChild`/`insertBefore` 重写） | 广告脚本不加载，后续防线自动空闲 |
| 第二道 | 通用特征清理遮罩 / 全屏广告 iframe（结构特征识别，抗变体） | 漏网的弹层按 `fixed/absolute + z-index≥1000 + 大面积` 一律清除 |
| 第三道 | **事件层 `handleAdClick` 注册拦截（v5 新增）** | 即使广告脚本侥幸加载，其点击监听注册也被拒绝（页面世界 + 用户脚本世界双保险） |

第三道防线合并了 mk-playZip-BanJumpingAds 的 `handleAdClick` 拦截思路并优化：页面世界通过 `<script>` 补丁注入（CSP 拦截时降级告警，不中断主流程），用户脚本世界同步重写 `addEventListener`，双世界双保险；并周期性尝试移除已注册的 `handleAdClick` 监听。

另配 `window.open` 站外弹窗白名单、`location` 广告跳转拦截、捕获阶段点击拦截作为全链路兜底。

### 5\. 零权限、最小侵入

* `@grant none`：不申请任何扩展特权；
* `@run-at document-start`：在广告脚本注入前即建立防线；
* `@noframes`：仅在主页面运行，不污染子帧；
* 内联业务脚本完全放行，站点功能零影响。

### 6\. 运行确认徽标

页面右下角显示绿色 **「PlayZip Cleaner v5 已启用」** 徽标（半透明、不遮挡点击），安装后强刷页面即可**一眼确认脚本生效**，无需打开控制台排查。

***

## 四、安装方法

### 方式一：扩展内新建脚本

1. Edge / Chrome 安装 [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) 或 [脚本猫](https://microsoftedge.microsoft.com/addons/detail/scriptcat/liilgpjgabokdodognffmdgmehkjpgnp)；
2. 点击扩展图标 → **管理面板 / 添加新脚本**；
3. 删除模板内容，粘贴本脚本全部代码，保存；
4. 打开或刷新 playzip.com。

### 方式二：直接导入文件

保存 `playzip-cleaner.user.js` 到本地，在 Tampermonkey / 脚本猫管理面板 → **实用工具 / 导入** → 选择文件 → 确认安装。

### 安装后验证

* 强刷页面（`Ctrl+Shift+R` / `Cmd+Shift+R`）；
* 右下角出现绿色 **「PlayZip Cleaner v5 已启用」** 徽标即生效；
* 正常点击不再出现"点击一次后无法继续点击"与自动弹出广告页面。

***

## 五、版本历史

| 版本 | 方案 | 结果 |
| --- | --- | --- |
| **v2.0.0** | 广告域名黑名单穷举 + 遮罩特征拦截 | ❌ 仍弹窗：广告脚本可随时换域名/文件名，黑名单追不上，源头未切断 |
| **v3.0.0** | 域名白名单注入拦截 | ⚠️ 弹窗大幅减少，但白名单含 `playzip.com`，同域广告脚本（`/aclib.js`、`/abcd.js`）被误放行，源头拦截失效 |
| **v4.0.0** | **广告脚本路径级精确拦截** + 放宽遮罩识别 + 全屏广告 iframe 清理 | ✅ 根治弹窗：无论域名如何更换，固定广告路径一律拦截 |
| **v5.0.0（当前）** | 保留 v4 全部防线 + **新增事件层 `handleAdClick` 注册拦截**（纵深防御） | ✅ 根治 + 纵深兜底：即使广告脚本侥幸加载也无法注册点击监听 |

***

## 六、免责声明

本脚本仅用于**个人学习交流**与**屏蔽恶意广告弹窗、点击劫持**等损害用户体验的行为，不涉及站点数据篡改或账号相关操作。

* 请遵守 playzip.com 的服务条款与当地法律法规；
* 脚本仅拦截恶意广告行为，不破坏站点正常功能；如因站点改版导致功能异常，请反馈问题而非绕过站点防护；
* 使用本脚本产生的任何后果由使用者自行承担，作者不对因使用本脚本造成的损失负责。

***

*PlayZip Cleaner v5.0.0 · 取证驱动 · 纵深防御 · 零权限 · 仅限个人学习使用*
