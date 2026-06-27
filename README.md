# 谷咕咕扫码体验版

这个仓库用于托管谷咕咕 H5 体验页，可通过 GitHub Pages 长期访问。

站点入口是 `index.html`，图片、音频、视频等静态资源在 `assets/` 目录。

## 后端鸟类识别

前端会优先调用后端 Gemini 识别接口，失败后自动回退到浏览器端识别。

- Vercel: `api/recognize.js`
- Netlify: `netlify/functions/recognize.js`
- 必填环境变量: `GEMINI_API_KEY`
- 可选环境变量: `GEMINI_MODEL`，默认 `gemini-2.0-flash`

如果前端仍放在 GitHub Pages，后端放在 Vercel/Netlify，需要把后端 URL 配到 `window.__GUGUGU_RECOGNITION_API__`，二维码入口 `latest.html` 不需要变化。

不要把 Gemini API Key 写进 `index.html` 或任何前端文件。
