# ZHY-ChromeExtensions

Chrome 浏览器插件集合仓库。每个插件独立一个文件夹，互不耦合，可单独打包、单独上架。

## 仓库约定

```
ZHY-ChromeExtensions/
├── README.md                 # 本文件
├── docs/
│   └── roadmap.md            # 做什么 / 不做什么 / 优先级
└── <ExtensionName>/          # 单个插件根目录（含自己的 manifest.json）
    ├── manifest.json
    ├── README.md             # 该插件说明
    └── ...
```

规则：

- **一插件一文件夹**，文件夹名用英文 PascalCase（如 `PageAnnotate`）
- 每个插件自带 `manifest.json`（Manifest V3）与独立 `README.md`
- 不共享构建产物；公共工具以后再抽 `packages/`，前期允许复制
- 不做「市场已饱和且难差异化」的通用小工具（见 [docs/roadmap.md](docs/roadmap.md)）

## 状态一览

| 文件夹 | 插件 | 状态 |
|--------|------|------|
| [`PageAnnotate`](PageAnnotate/) | 批注 / 整页滚动长截图 / 复制≠下载 / 中英日 | **v0.4.9** |
| [`WebToMarkdown`](WebToMarkdown/) | 网页→Markdown · 右键/YAML/历史 · MD/预览/分栏 | **v0.2.4** |
| [`WordBank`](WordBank/) | 英日词库 · 显示语言设定 · Excel/PDF(A4) | **v0.2.2** |
| `ColorPicker` | 颜色提取（页面色板 + 吸管） | **不做**（市场已饱和） |
| `WorkSession` | 按项目会话（规划） | 待开工 |
| `EnvSwitch` | 多环境切换（规划） | 待开工 |

## 本地加载

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选中某个插件文件夹（含 `manifest.json` 的那一层）
