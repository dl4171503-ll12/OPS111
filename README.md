# AI一人学校

面向 6–18 岁的游戏化「一人一校」学习平台。1.0 版本。

## 快速启动

```bash
cd ai-school
npm install
npm run dev
```

打开：http://127.0.0.1:919/

## API 密钥

已从彩光AI父项目 `.env` 迁移：

- `DEEPSEEK_API_KEY` / `VITE_DEEPSEEK_API_KEY`
- `DEEPSEEK_API_KEY_BACKUP`（Kimi 备用）
- `VITE_SUPABASE_*`（保留，便于后续云端化）

本地 AI 走 Vite 中间件：`POST /api/school-llm`

## 分支

本仓库独立 Git，分支名：`ai-one-person-school`

## 文档

见 `docs/` 目录：部署说明、学生手册、家长手册、迭代建议。
