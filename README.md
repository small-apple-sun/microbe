## 微生物菌落图谱

独立静态网站，用于展示本地拍摄的菌落平板图片。

特点：

- 从本地原始 JPG 批量提取圆形培养皿区域
- 输出透明背景 WebP，只保留圆形平板内容
- 自动根据文件名生成图谱数据
- 纯静态 HTML/CSS/JS，可本地预览或部署

### 目录

- `assets/raw/`：可选，放原始图片
- `assets/processed/`：脚本生成的透明背景培养皿图
- `data/slides.json`：站点读取的数据
- `tools/process_colonies.py`：批量处理脚本

### 批量处理

```bash
cd /home/apple/microbe-colony-atlas
python3 tools/process_colonies.py "/home/apple/微生物本地图谱/微生物菌落图片"
```

处理完成后会生成：

- `assets/processed/*.webp`
- `data/slides.json`

### 本地预览

```bash
cd /home/apple/microbe-colony-atlas
./serve.sh
```

然后打开终端输出的本地地址。
