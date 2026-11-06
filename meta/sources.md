# 免费素材源清单 + 许可速查

> 最后实测：**2026-10-26**（本机网络，Windows / Asia/Shanghai）。
> "可达性"指从这台机器能否直连；不可达不代表站点本身有问题，换网络环境可能就正常。

## 一、许可速查

| 许可 | 可商用 | 需署名 | 可修改 | 关键限制 |
| --- | --- | --- | --- | --- |
| **CC0-1.0** | 是 | 否 | 是 | 几乎没有限制（本项目原创素材用这个） |
| **CC BY 4.0** | 是 | **必须** | 是 | 必须标注作者 + 许可 + 改动 |
| **Unsplash License** | 是 | 否（建议） | 是 | 不得转售未改动原图；不得用他人照片冒充本人作品 |
| **Pexels License** | 是 | 否 | 是 | 不得转售未改动原图；不得用于建立同类图库 |
| **Pixabay Content License** | 是 | 否 | 是 | 不得转售未改动原图；不得用于建立同类图库 |
| **Mixkit Free License** | 是 | 否 | 是 | 不得把音频单独转售 / 作为素材包再分发 |
| **Coverr License** | 是 | 否 | 是 | 不得把原片直接转售 / 作为素材包再分发 |
| **Freesound (CC0/CC BY 混合)** | 看单条 | 看单条 | 看单条 | 每个文件许可不同，必须逐条确认 |

**通用红线**：无论哪个源，都**不要把整个素材库原样打包分发/售卖**；商用前确认画面里没有他人肖像、商标、可识别建筑（部分站点对人物肖像有额外限制）。

## 二、本机实测可达性

| 站点 | 类型 | 站点页 | 直链 CDN | 结论 |
| --- | --- | :---: | :---: | --- |
| **Lorem Picsum**（图片，源自 Unsplash） | 图片 | ✅ | ✅ | **已接入** `collect.py --only photos` |
| **Mixkit**（免费音乐 / 音效 / 视频模板） | 音频·视频 | ✅ | ✅ | **已接入** `collect.py --only bgm` |
| **Coverr**（免费视频） | 视频 | ✅ | ✅ | **已接入** `collect.py --only videos` |
| **images.pexels.com**（CDN 直链） | 图片 | ❌ 403 | ✅ | 可用，但需已知图片 ID |
| **cdn.pixabay.com**（CDN 直链） | 图片 | ❌ 403 | ✅ | 可用，但需已知图片 ID |
| **images.unsplash.com**（CDN 直链） | 图片 | — | ✅ | 可用，但需已知图片 ID |
| **Unsplash / Pexels / Pixabay 官方 API** | 图片 | — | — | 需注册 API Key，接入后可按关键词精准采集 |
| Wikimedia Commons | 图片·音频 | ❌ | ❌ | 本机不可达（需要代理） |
| Openverse API | 图片·音频 | ❌ | ❌ | 本机不可达 |
| Internet Archive | 音频·视频 | ❌ | ❌ | 本机不可达 |
| Freesound API | 音频 | ⚠️ 401 | — | 需 API Key |

> 结论：**本机可无 Key 直接批量采集的是 Picsum / Mixkit / Coverr 三家**；
> 想要"按关键词精准找图"，最省事的是去 Pexels 或 Pixabay 注册一个免费 API Key，再扩 `collect.py`。

## 三、推荐的补充来源（人工浏览用）

### 图片 / 视觉
- **Unsplash** <https://unsplash.com> — 高质量摄影，Unsplash License
- **Pexels** <https://www.pexels.com> — 照片 + 视频，Pexels License
- **Pixabay** <https://pixabay.com> — 照片 / 插画 / 矢量 / 视频，Pixabay Content License
- **Openverse** <https://openverse.org> — 聚合 CC 授权资源，可筛 CC0 / CC BY
- **Wikimedia Commons** <https://commons.wikimedia.org> — 大量 CC0 / 公有领域素材（历史图、地图、标本图）
- **unDraw** <https://undraw.co> — 开源 SVG 插画，可改主色，无需署名
- **Lucide / Feather / Tabler Icons** <https://lucide.dev> — 开源图标库（MIT），本项目图标为自绘，风格接近
- **SVG Repo** <https://www.svgrepo.com> — 汇集多许可 SVG，注意逐条看许可

### 音频
- **Mixkit Music** <https://mixkit.co/free-stock-music/> — 免费 BGM，无需署名
- **Pixabay Music** <https://pixabay.com/music/> — 免版税 BGM / 音效
- **Freesound** <https://freesound.org> — 音效宝库，逐条许可（筛 CC0）
- **Free Music Archive** <https://freemusicarchive.org> — 独立音乐，多为 CC 授权
- **YouTube Audio Library**（需登录 YouTube Studio） — 免版税音乐 / 音效
- **BBC Sound Effects** <https://sound-effects.bbcrewind.co.uk> — 仅供个人/教育用途，商用需申请

### 视频
- **Coverr** <https://coverr.co> — 免费实拍空镜，无需署名
- **Mixkit Video** <https://mixkit.co/free-stock-video/> — 免费视频片段 / 模板
- **Pexels Videos** <https://www.pexels.com/videos/> — 免费实拍视频
- **Pixabay Videos** <https://pixabay.com/videos/> — 免费视频
- **Videvo** <https://www.videvo.net> — 免费 + 付费混合，注意单条许可

### 像素 / 游戏素材
> 本项目 `assets/pixel/` 下的角色、道具、瓦片、UI、背景、8-bit 音频**全部由 `tools/make_pixel.py` 代码生成**，
> 未参考任何现有素材，按 CC0-1.0 使用。下面这些站点适合想要"更多风格"时去淘。

- **Kenney** <https://kenney.nl> — 全部 CC0，游戏 UI / 像素角色 / 音效，最省心
- **OpenGameArt** <https://opengameart.org> — 老牌游戏素材库，CC0 / CC BY / CC BY-SA 混合，**逐条看许可**
- **itch.io Free Game Assets** <https://itch.io/game-assets/free> — 独立作者素材包，许可写在商品页
- **Game-icons.net** <https://game-icons.net> — 4000+ 游戏图标，CC BY 3.0（需署名）
- **Lospec** <https://lospec.com/palette-list> — 像素调色板库，可参考配色（色板本身不受版权保护）
- **Aseprite / Piskel** — 像素绘制工具（Piskel 免费在线，Aseprite 付费）

## 四、采集时的自律清单

1. **一次一登记**：下载后立刻在 `meta/credits.json` 补 `file / title / author / source_url / license`，
   之后 `scan_assets.py` 会自动带进清单和预览页。
2. **保留原始链接**：不要只存文件名。三个月后你只会记得"这张图挺好看"。
3. **区分 CC0 与 CC BY**：CC BY 必须署名，署名文案建议：`Photo by <作者> on <站点>（<许可>）`。
4. **避开风险内容**：带水印样片、付费素材预览图、含清晰商标/人物肖像的素材，商用前需另行确认。
5. **别抓整站**：控制请求频率（本项目每个源只取少量样本），尊重站点 robots 与 ToS。
6. **备份**：素材库建议纳入 Git LFS 或云盘版本管理，`credits.json` 与文件同目录存放。

## 五、扩展 `collect.py` 的思路

```python
# 以 Pexels API 为例（需先申请免费 Key）
# 1) 在 collect_photos 里把 Picsum 列表换成 API 搜索：
#    GET https://api.pexels.com/v1/search?query=texture&per_page=20
#    header: Authorization: <YOUR_KEY>
# 2) 解析返回 JSON 的 photos[].src.large2x 作为下载直链
# 3) 许可字段填 "Pexels License" + https://www.pexels.com/license/
```

接入新源时只需保证：**下载 + 写一条 credits 记录**，索引与预览页会自动更新。
