# WordBank

英日**划词词库**：选中后自动补全**中文 / 英文 / 日文释义**、发音写法、变形、接续。界面 **中 / 英 / 日**。

## 功能（v0.3.x）

- **划词入库**：右键（自动 / 英语 / 日语）或 `Alt+W`（先入库再后台解析，页内 toast 提示）
- **三语释义**
  - 日语词 → 中文 + 英文（+ 日文条目）
  - 英语词 → 中文 + 日文（+ 英文原义）
- **日语文法**：优先查 [OpenJLPT](https://github.com/evanclan/OpenJLPT) 文法词典（CDN，本地缓存约 7 天）→ 显示 JLPT、语法接续、提示；未命中再走 Jisho
- **左右布局**：左侧词表，右侧词卡
- **新标签**：大页面查看全部词卡
- **导出**
  - **Excel**（`.xls`，Excel 可直接打开）
  - **PDF**：打开 **A4** 打印页 →「打印 / 另存为 PDF」
- **词卡**：变形、接续、提示、复制 Markdown、重新解析
- **本地存储**：默认本机

## 本地加载

1. `chrome://extensions` → 开发者模式  
2. 加载已解压扩展 → 选 `WordBank`  
3. 改代码后点 **重新加载**（需允许翻译接口权限）

## 权限说明

| 权限 | 用途 |
|------|------|
| `activeTab` / `scripting` | 读取选区与上下文 |
| `storage` | 本地词库 |
| `contextMenus` | 右键加入 |
| `downloads` | 导出 Excel |
| `dictionaryapi.dev` / `jisho.org` | 英日词典 |
| `cdn.jsdelivr.net`（OpenJLPT） | JLPT 文法词典 |
| `api.mymemory.translated.net` | 补全中/日/英互译 |

## 限制

- 翻译依赖免费接口，偶发失败或额度限制时释义可能不全
- 文法数据来自 OpenJLPT（CC BY-SA 4.0），首次使用需联网拉取并缓存
- 日语活用 / 英语不规则动词为近似规则
- PDF 通过系统打印对话框「另存为 PDF」生成，以保证 A4 排版

## 后续可做

- 复习队列
- 用户自备翻译 / AI Key
