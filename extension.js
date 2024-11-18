// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");

const fs = require("fs");
const path = require("path");

const { extractProps } = require("./extractProps");

async function getScriptContentFromVueFile(filePath) {
  try {
    // 读取文件内容
    const fileContent = await fs.promises.readFile(filePath, "utf-8");

    // 使用正则表达式匹配 <script> 标签中的内容
    const scriptMatch = fileContent.match(
      /<script\b[^>]*>([\s\S]*?)<\/script>/
    );

    if (scriptMatch && scriptMatch[1]) {
      // 提取 <script> 标签中的文本内容
      return scriptMatch[1].trim();
    } else {
      throw new Error("未找到 <script> 标签");
    }
  } catch (error) {
    console.error(
      `Error reading script content from Vue file: ${error.message}`
    );
  }
}

/**
 * 创建 Webview 的 HTML 内容
 * @param {Array} data 数据数组
 * @returns {string} HTML 字符串
 */
function getWebviewContent(data) {
  // 将数据格式化为字符串
  const formattedData = data
    .map((item) => `${item.label}: ${item.value}`)
    .join(",\n");

  // 返回 HTML 内容
  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Data Panel</title>
          <style>
              body { font-family: Arial, sans-serif; padding: 10px; }
              textarea { width: 100%; height: 200px; }
              button { margin-top: 10px; padding: 5px 10px; }
          </style>
      </head>
      <body>
          <h2>默认生成的数据</h2>
          <b>请根据需要进行修改，以此作为组件的props</b>
          <textarea id="dataArea" readonly>${formattedData}</textarea>
          <button onclick="copyText()">复制</button>

          <script>
              // 复制文本的函数
              function copyText() {
                  const text = document.getElementById('dataArea').value;
                  // 向 VSCode 插件发送消息，执行复制操作
                  vscode.postMessage({ command: 'copy', text: text });
              }

              // 注入VSCode的API
              const vscode = acquireVsCodeApi();
          </script>
      </body>
      </html>
  `;
}

function activate(context) {
  const config = vscode.workspace.getConfiguration("generator");

  const Project_Components_Dir = config.get("scanDir", "src/components"); // 获取配置项 'myExtension.someValue'，如果没有设置则使用默认值
  // 执行扫描组件目录并生成缓存的操作
  scanComponentsAndCache(Project_Components_Dir);
  // 监听工作区的变化，便于在项目目录发生变动时重新扫描
  vscode.workspace.onDidChangeWorkspaceFolders((event) => {
    console.log(event);
    console.log("工作区文件夹发生变化");
    // 执行扫描组件目录并生成缓存的操作
    scanComponentsAndCache(Project_Components_Dir);
  });

  const defaultValueMap = {
    String: "''",
    Number: 0,
    Array: "[]",
    Object: "{}",
    Boolean: true,
  };

  function generateComponentTemplate(name, propList) {
    // 将 propList 中的每个属性格式化为 Vue 的 prop 绑定
    const props = propList.map((prop) => `:${prop}="${prop}"`).join(" ");

    // 使用模板字符串生成最终的组件模板
    return `<${name} ${props}></${name}>`;
  }

  function insertToEditor(str) {
    const editor = vscode.window.activeTextEditor;

    if (editor) {
      const position = editor.selection.active; // 光标位置

      // 在光标处插入数据
      editor.edit((editBuilder) => {
        editBuilder.insert(position, str);
      });
    }
  }

  const setDefaultValue = (source, key) => {
    const res = source.find((item) => {
      return item.label === key;
    });
    return Array.isArray(res.detail)
      ? defaultValueMap[res.detail[0]]
      : defaultValueMap[res.detail];
  };

  const disposable = vscode.commands.registerCommand(
    "generator-list.select",
    async () => {
      const jsonData = await readComponentsCacheFile();
      // @ts-ignore
      if (jsonData && typeof jsonData === "object") {
        const keys = Object.keys(jsonData);
        const selected = await vscode.window.showQuickPick(keys);

        if (selected) {
          getScriptContentFromVueFile(jsonData[selected]).then(
            async (scriptContent) => {
              if (scriptContent) {
                const propMetas = extractProps(scriptContent);
                // label、detail、description
                const options = propMetas.map((item) => ({
                  ...item,
                  detail: Array.isArray(item.detail)
                    ? item.detail.join("，")
                    : item.detail,
                }));
                const selectedList = await vscode.window.showQuickPick(
                  options,
                  {
                    canPickMany: true,
                    title: "选择属性",
                    placeHolder: "请选择组件需要的属性",
                  }
                );

                const res = selectedList.map((item) => {
                  return {
                    ...item,
                    value: setDefaultValue(propMetas, item.label),
                  };
                });

                const templateParams = {
                  name: selected,
                  propList: selectedList.map((item) => item.label),
                };

                const templateStr = generateComponentTemplate(
                  templateParams.name,
                  templateParams.propList
                );

                if (templateStr) {
                  insertToEditor(templateStr);
                }

                const panel = vscode.window.createWebviewPanel(
                  "dataPanel", // 标识符
                  "生成的组件数据", // 标题
                  vscode.ViewColumn.One, // 显示在编辑器的第一个栏
                  { enableScripts: true } // 启用JS
                );

                // 设置HTML内容
                panel.webview.html = getWebviewContent(res);

                // 监听消息传递，响应复制请求
                panel.webview.onDidReceiveMessage(
                  (message) => {
                    if (message.command === "copy") {
                      vscode.env.clipboard.writeText(message.text); // 复制到剪贴板
                      vscode.window.showInformationMessage(
                        "Text copied to clipboard!"
                      );
                    }
                  },
                  undefined,
                  context.subscriptions
                );
              }
            }
          );
        }
      }
    }
  );

  context.subscriptions.push(disposable);
}

function scanComponentsAndCache(dir) {
  // 获取当前工作区的根路径
  const workspaceFolders = vscode.workspace.workspaceFolders;

  // 如果没有打开工作区，直接返回
  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log("No workspace folder found.");
    return;
  }

  // 获取第一个工作区的路径
  const workspaceRoot = workspaceFolders[0].uri.fsPath; // 使用 workspaceFolders 获取根路径

  if (!workspaceRoot) {
    return;
  }
  const componentsDir = path.join(workspaceRoot, dir); // 假设components目录位于项目根目录

  // 判断components目录是否存在
  if (!fs.existsSync(componentsDir)) {
    console.log("Components directory not found.");
    return;
  }

  // 存储符合条件的目录和路径
  const componentsCache = {};

  // 扫描components目录
  scanDirectory(componentsDir, componentsCache);

  // 保存缓存到 `.settings/componentsCache.json` 文件中
  const settingsDir = path.join(workspaceRoot, ".settings");
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir); // 如果 `.settings` 目录不存在，则创建它
  }

  const cacheFilePath = path.join(settingsDir, "componentsCache.json");
  fs.writeFileSync(cacheFilePath, JSON.stringify(componentsCache, null, 2)); // 写入JSON文件
  console.log(`Cache saved to ${cacheFilePath}`);
}

// 扫描目录的递归函数
function scanDirectory(dir, componentsCache) {
  const files = fs.readdirSync(dir); // 读取目录内容
  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath); // 获取文件状态

    if (stats.isDirectory()) {
      // 如果是目录，递归扫描
      scanDirectory(filePath, componentsCache);
    } else if (file.endsWith(".vue")) {
      // 只处理 .vue 文件
      const fileNameWithoutExt = path.basename(file, ".vue"); // 获取文件名，不带扩展名
      if (fileNameWithoutExt === "index.vue") {
        // 如果是 index.vue，使用目录名作为键
        const dirName = path.basename(dir); // 获取当前目录的名称
        componentsCache[dirName] = filePath; // 将目录名称和绝对路径保存到缓存中
      } else {
        // 如果不是 index.vue，使用文件名作为键
        componentsCache[fileNameWithoutExt] = filePath; // 将文件名作为键，文件路径作为值
      }
    }
  });
}

function readComponentsCacheFile() {
  // 获取当前工作区的根路径
  const workspaceFolders = vscode.workspace.workspaceFolders;

  // 如果没有打开工作区，直接返回
  if (!workspaceFolders || workspaceFolders.length === 0) {
    console.log("No workspace folder found.");
    return;
  }

  // 获取第一个工作区的路径
  const workspaceRoot = workspaceFolders[0].uri.fsPath; // 使用 workspaceFolders 获取根路径

  if (!workspaceRoot) {
    return;
  }

  // 拼接 componentsCache.json 的路径
  const filePath = path.join(
    workspaceRoot,
    ".settings",
    "componentsCache.json"
  );

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    vscode.window.showErrorMessage("componentsCache.json not found.");
    return;
  }

  return new Promise((res, rej) => {
    // 读取文件内容
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        vscode.window.showErrorMessage("Failed to read componentsCache.json");
        return;
      }

      try {
        const jsonData = JSON.parse(data);
        res(jsonData);
      } catch (error) {
        rej("Failed to parse componentsCache.json");
        vscode.window.showErrorMessage("Failed to parse componentsCache.json");
      }
    });
  });
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
